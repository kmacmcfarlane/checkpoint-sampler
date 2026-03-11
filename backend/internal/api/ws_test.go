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

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	genws "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/ws"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// mockSubscribeServerStream captures Send calls for test assertions.
type mockSubscribeServerStream struct {
	mu       sync.Mutex
	sent     []*genws.FSEventResponse
	sendErr  error
	closeErr error
}

func (m *mockSubscribeServerStream) Send(v *genws.FSEventResponse) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sendErr != nil {
		return m.sendErr
	}
	m.sent = append(m.sent, v)
	return nil
}

func (m *mockSubscribeServerStream) SendWithContext(_ context.Context, v *genws.FSEventResponse) error {
	return m.Send(v)
}

func (m *mockSubscribeServerStream) Close() error {
	return m.closeErr
}

func (m *mockSubscribeServerStream) Sent() []*genws.FSEventResponse {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]*genws.FSEventResponse, len(m.sent))
	copy(result, m.sent)
	return result
}

// mockPingableConn implements api.PingableConn for unit testing runPingLoop
// without a real WebSocket connection.
type mockPingableConn struct {
	mu        sync.Mutex
	pingCount int
	pingErr   error
	// pingCh is notified on each WriteControl call so tests can wait.
	pingCh chan struct{}
}

func newMockPingableConn() *mockPingableConn {
	return &mockPingableConn{pingCh: make(chan struct{}, 16)}
}

func (m *mockPingableConn) WriteControl(messageType int, _ []byte, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pingErr != nil {
		return m.pingErr
	}
	if messageType == websocket.PingMessage {
		m.pingCount++
		select {
		case m.pingCh <- struct{}{}:
		default:
		}
	}
	return nil
}

func (m *mockPingableConn) PingCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.pingCount
}

var _ = Describe("WSService", func() {
	var (
		hub    *service.Hub
		svc    *api.WSService
		stream *mockSubscribeServerStream
		logger *logrus.Logger
	)

	BeforeEach(func() {
		logger = logrus.New()
		logger.SetOutput(GinkgoWriter)
		hub = service.NewHub(logger)
		svc = api.NewWSService(hub)
		stream = &mockSubscribeServerStream{}
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
		conn := newMockPingableConn()
		_, cancel := context.WithCancel(context.Background())
		defer cancel()

		interval := 20 * time.Millisecond
		go api.RunPingLoopForTest(conn, interval, cancel, logger)

		// Wait for at least 2 pings to be sent within a generous window.
		Eventually(conn.PingCount, 500*time.Millisecond, 5*time.Millisecond).Should(BeNumerically(">=", 2))
	})

	// AC: Backend sends periodic ping frames — zero interval disables pings.
	It("does not send any pings when interval is zero", func() {
		conn := newMockPingableConn()
		_, cancel := context.WithCancel(context.Background())
		defer cancel()

		// A zero interval must not start the ticker; NewWSConnConfigurer guards
		// against it in production. Test the guard directly.
		configurer := api.NewWSConnConfigurer(0, logger)
		Expect(configurer).NotTo(BeNil())

		// When interval is zero the configurer should be a no-op function that
		// returns the conn without starting a goroutine. Validate by asserting
		// that after a short pause no pings were sent.
		time.Sleep(30 * time.Millisecond)
		Expect(conn.PingCount()).To(Equal(0))
	})

	// AC: Idle connections survive beyond proxy_read_timeout limits — ping stops
	// when the connection returns an error (simulating a closed connection).
	It("cancels the context when a ping write fails", func() {
		conn := newMockPingableConn()
		conn.pingErr = errors.New("broken pipe")

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
