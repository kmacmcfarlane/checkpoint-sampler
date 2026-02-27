package api_test

import (
	"context"
	"errors"
	"sync"

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
