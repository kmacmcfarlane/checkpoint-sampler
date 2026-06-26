package api_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/mock"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/apimocks"
	genws "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/ws"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeSubscribeServerStream captures Send calls for test assertions.
//
// It is a hand-written fake (not a mockery mock) because it implements the
// Goa-generated genws.SubscribeServerStream interface, and mockery must not be
// pointed at the generated internal/api/gen tree (DEVELOPMENT_PRACTICES 3.9 /
// TEST_PRACTICES 2.1.1). It also maintains thread-safe captured-send state that a
// call-expectation mock cannot express cleanly.
type fakeSubscribeServerStream struct {
	mu       sync.Mutex
	sent     []*genws.FSEventResponse
	sendErr  error
	closeErr error
}

func (m *fakeSubscribeServerStream) Send(v *genws.FSEventResponse) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sendErr != nil {
		return m.sendErr
	}
	m.sent = append(m.sent, v)
	return nil
}

func (m *fakeSubscribeServerStream) SendWithContext(_ context.Context, v *genws.FSEventResponse) error {
	return m.Send(v)
}

func (m *fakeSubscribeServerStream) Close() error {
	return m.closeErr
}

func (m *fakeSubscribeServerStream) Sent() []*genws.FSEventResponse {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]*genws.FSEventResponse, len(m.sent))
	copy(result, m.sent)
	return result
}

// pingableConn pairs the generated api.PingableConn mock with an atomic ping
// counter so ping-loop tests can wait on ping delivery without racing on the
// underlying testify mock's call log.
type pingableConn struct {
	*apimocks.MockPingableConn
	pingCount atomic.Int64
}

// newPingableConn builds a generated MockPingableConn whose WriteControl
// returns writeErr (nil = success) and increments the ping counter for each
// ping control frame.
func newPingableConn(writeErr error) *pingableConn {
	p := &pingableConn{MockPingableConn: &apimocks.MockPingableConn{}}
	p.EXPECT().WriteControl(mock.Anything, mock.Anything, mock.Anything).
		RunAndReturn(func(messageType int, _ []byte, _ time.Time) error {
			if writeErr != nil {
				return writeErr
			}
			if messageType == websocket.PingMessage {
				p.pingCount.Add(1)
			}
			return nil
		})
	return p
}

func (m *pingableConn) PingCount() int {
	return int(m.pingCount.Load())
}

var _ = Describe("WSService", func() {
	var (
		hub    *service.Hub
		svc    *api.WSService
		stream *fakeSubscribeServerStream
		logger *logrus.Logger
	)

	BeforeEach(func() {
		logger = logrus.New()
		logger.SetOutput(GinkgoWriter)
		hub = service.NewHub(logger)
		svc = api.NewWSService(hub)
		stream = &fakeSubscribeServerStream{}
	})

	Describe("Subscribe", func() {
		// AC: immediate WebSocket upgrade — Send() is called right away so the
		// HTTP 101 upgrade is triggered before any filesystem event fires.
		It("sends an initial connected event immediately to trigger WebSocket upgrade", func() {
			ctx, cancel := context.WithCancel(context.Background())
			cancel() // cancel immediately so Subscribe exits right away

			err := svc.Subscribe(ctx, stream)
			Expect(err).NotTo(HaveOccurred())

			sent := stream.Sent()
			Expect(sent).To(HaveLen(1))
			Expect(sent[0].Type).To(Equal("connected"))
		})

		It("returns an error when the initial Send fails", func() {
			sendErr := errors.New("upgrade failed")
			stream.sendErr = sendErr

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			err := svc.Subscribe(ctx, stream)
			Expect(err).To(Equal(sendErr))
		})

		It("registers a client with the hub while subscribed", func() {
			ctx, cancel := context.WithCancel(context.Background())

			subscribed := make(chan struct{})
			done := make(chan struct{})

			go func() {
				defer close(done)
				// Notify test that Subscribe has started
				close(subscribed)
				svc.Subscribe(ctx, stream) //nolint:errcheck
			}()

			// Wait for Subscribe goroutine to start (it registers after first Send)
			<-subscribed
			// Give the goroutine time to register
			Eventually(func() int {
				return hub.ClientCount()
			}).Should(Equal(1))

			cancel()
			<-done

			// After context cancel, client should be unregistered
			Expect(hub.ClientCount()).To(Equal(0))
		})

		It("unregisters the client when the context is cancelled", func() {
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan struct{})

			go func() {
				defer close(done)
				svc.Subscribe(ctx, stream) //nolint:errcheck
			}()

			// Wait for the client to register
			Eventually(func() int {
				return hub.ClientCount()
			}).Should(Equal(1))

			cancel()
			<-done

			Expect(hub.ClientCount()).To(Equal(0))
		})

		It("delivers hub events to the client after connection is established", func() {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			done := make(chan struct{})
			go func() {
				defer close(done)
				svc.Subscribe(ctx, stream) //nolint:errcheck
			}()

			// Wait for the client to register
			Eventually(func() int {
				return hub.ClientCount()
			}).Should(Equal(1))

			// Broadcast an event
			hub.Broadcast(model.FSEvent{
				Type: "image_added",
				Path: "checkpoint.safetensors/test.png",
			})

			// Eventually the stream should receive the event (in addition to the
			// initial "connected" event)
			Eventually(func() int {
				return len(stream.Sent())
			}).Should(Equal(2))

			sent := stream.Sent()
			Expect(sent[0].Type).To(Equal("connected"))
			Expect(sent[1].Type).To(Equal("image_added"))
			Expect(sent[1].Path).To(Equal("checkpoint.safetensors/test.png"))

			cancel()
			<-done
		})
	})
})

// Exported for testing via the internal test package boundary.
// runPingLoop is the internal function under test; we access it via the
// exported NewWSConnConfigurer which drives the same code path.

var _ = Describe("WebSocket ping loop", func() {
	var logger *logrus.Logger

	BeforeEach(func() {
		logger = logrus.New()
		logger.SetOutput(GinkgoWriter)
	})

	// AC: Backend sends periodic WebSocket ping frames to keep connections alive.
	It("sends ping frames at the configured interval", func() {
		conn := newPingableConn(nil)
		_, cancel := context.WithCancel(context.Background())
		defer cancel()

		interval := 20 * time.Millisecond
		go api.RunPingLoopForTest(conn, interval, cancel, logger)

		// Wait for at least 2 pings to be sent within a generous window.
		Eventually(conn.PingCount, 500*time.Millisecond, 5*time.Millisecond).Should(BeNumerically(">=", 2))
	})

	// AC: Backend sends periodic ping frames — zero interval disables pings.
	It("does not send any pings when interval is zero", func() {
		// A zero interval must not start the ticker; NewWSConnConfigurer guards
		// against it in production. Test the guard directly.
		configurer := api.NewWSConnConfigurer(0, logger)
		Expect(configurer).NotTo(BeNil())

		// Invoke the configurer with a nil conn. For zero interval the configurer
		// must be a no-op: it returns the conn immediately without spawning a
		// ping goroutine. If the guard were missing, runPingLoop would be called
		// and would panic on the nil conn within the ticker interval.
		//
		// Calling configurer(nil, cancel) exercises the no-op path without a
		// sleep. The race detector will surface any unintended goroutine spawn.
		cancelCalled := false
		result := configurer(nil, func() { cancelCalled = true })
		Expect(result).To(BeNil(), "no-op configurer must return the input conn unchanged")
		Expect(cancelCalled).To(BeFalse(), "no-op configurer must not invoke cancel")
	})

	// AC: Idle connections survive beyond proxy_read_timeout limits — ping stops
	// when the connection returns an error (simulating a closed connection).
	It("cancels the context when a ping write fails", func() {
		conn := newPingableConn(errors.New("broken pipe"))

		_, cancel := context.WithCancel(context.Background())
		defer cancel()

		cancelled := atomic.Bool{}
		wrappedCancel := func() {
			cancelled.Store(true)
			cancel()
		}

		interval := 20 * time.Millisecond
		go api.RunPingLoopForTest(conn, interval, wrappedCancel, logger)

		// The cancel function should be called because the ping will fail.
		Eventually(cancelled.Load, 500*time.Millisecond, 5*time.Millisecond).Should(BeTrue())
	})

	// AC: Ping interval is configurable via config.yaml — configurer respects interval.
	It("NewWSConnConfigurer returns a no-op when interval is zero", func() {
		configurer := api.NewWSConnConfigurer(0, logger)
		Expect(configurer).NotTo(BeNil())
		// Calling it with a nil conn and cancel must not panic.
		Expect(func() { configurer(nil, func() {}) }).NotTo(Panic())
	})
})
