package service_test

import (
	"sync"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
)

// fakeHubClient implements service.HubClient for testing.
type fakeHubClient struct {
	mu       sync.Mutex
	events   []model.FSEvent
	sendOK   bool
}

func newFakeHubClient(sendOK bool) *fakeHubClient {
	return &fakeHubClient{sendOK: sendOK}
}

func (c *fakeHubClient) SendEvent(event model.FSEvent) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, event)
	return c.sendOK
}

func (c *fakeHubClient) getEvents() []model.FSEvent {
	c.mu.Lock()
	defer c.mu.Unlock()
	cp := make([]model.FSEvent, len(c.events))
	copy(cp, c.events)
	return cp
}

var _ = Describe("Hub", func() {
	var hub *service.Hub

	BeforeEach(func() {
		hub = service.NewHub(nil)
	})

	Describe("Register and Unregister", func() {
		It("starts with zero clients", func() {
			Expect(hub.ClientCount()).To(Equal(0))
		})

		It("increases client count on register", func() {
			c := newFakeHubClient(true)
			hub.Register(c)
			Expect(hub.ClientCount()).To(Equal(1))
		})

		It("decreases client count on unregister", func() {
			c := newFakeHubClient(true)
			hub.Register(c)
			hub.Unregister(c)
			Expect(hub.ClientCount()).To(Equal(0))
		})

		It("handles unregister of unknown client gracefully", func() {
			c := newFakeHubClient(true)
			hub.Unregister(c)
			Expect(hub.ClientCount()).To(Equal(0))
		})

		It("tracks multiple clients independently", func() {
			c1 := newFakeHubClient(true)
			c2 := newFakeHubClient(true)
			hub.Register(c1)
			hub.Register(c2)
			Expect(hub.ClientCount()).To(Equal(2))

			hub.Unregister(c1)
			Expect(hub.ClientCount()).To(Equal(1))
		})
	})

	Describe("Broadcast", func() {
		It("sends events to all registered clients", func() {
			c1 := newFakeHubClient(true)
			c2 := newFakeHubClient(true)
			hub.Register(c1)
			hub.Register(c2)

			event := model.FSEvent{
				Type: model.EventImageAdded,
				Path: "checkpoint.safetensors/image.png",
			}
			hub.Broadcast(event)

			Expect(c1.getEvents()).To(HaveLen(1))
			Expect(c1.getEvents()[0].Type).To(Equal(model.EventImageAdded))
			Expect(c1.getEvents()[0].Path).To(Equal("checkpoint.safetensors/image.png"))
			Expect(c2.getEvents()).To(HaveLen(1))
		})

		It("does nothing when no clients are registered", func() {
			event := model.FSEvent{
				Type: model.EventImageAdded,
				Path: "test.png",
			}
			// Should not panic
			hub.Broadcast(event)
		})

		It("removes clients that fail to receive", func() {
			good := newFakeHubClient(true)
			bad := newFakeHubClient(false) // SendEvent returns false
			hub.Register(good)
			hub.Register(bad)

			hub.Broadcast(model.FSEvent{
				Type: model.EventImageAdded,
				Path: "test.png",
			})

			// Bad client should be removed
			Expect(hub.ClientCount()).To(Equal(1))
			// Good client should still receive
			Expect(good.getEvents()).To(HaveLen(1))
		})

		It("does not send to unregistered clients", func() {
			c := newFakeHubClient(true)
			hub.Register(c)
			hub.Unregister(c)

			hub.Broadcast(model.FSEvent{
				Type: model.EventImageAdded,
				Path: "test.png",
			})

			Expect(c.getEvents()).To(BeEmpty())
		})

		It("broadcasts multiple events in sequence", func() {
			c := newFakeHubClient(true)
			hub.Register(c)

			hub.Broadcast(model.FSEvent{Type: model.EventImageAdded, Path: "a.png"})
			hub.Broadcast(model.FSEvent{Type: model.EventImageRemoved, Path: "b.png"})
			hub.Broadcast(model.FSEvent{Type: model.EventDirectoryAdded, Path: "newdir"})

			events := c.getEvents()
			Expect(events).To(HaveLen(3))
			Expect(events[0].Type).To(Equal(model.EventImageAdded))
			Expect(events[1].Type).To(Equal(model.EventImageRemoved))
			Expect(events[2].Type).To(Equal(model.EventDirectoryAdded))
		})
	})
})
