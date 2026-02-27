package api

import (
	"context"

	genws "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/ws"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// WSService implements the generated ws service interface.
type WSService struct {
	hub *service.Hub
}

// NewWSService creates a new WSService.
func NewWSService(hub *service.Hub) *WSService {
	return &WSService{hub: hub}
}

// Subscribe registers the caller as a WebSocket client and streams filesystem
// change events until the client disconnects.
//
// The Goa-generated WebSocket stream defers the HTTP 101 upgrade until the
// first Send() call. Without an immediate Send(), the Go HTTP server's
// WriteTimeout (30s) and nginx's proxy_read_timeout would close the connection
// before any filesystem event fires, causing "WebSocket closed before
// connection established" errors — especially from remote LAN hosts where no
// events are in flight. Sending an initial "connected" event immediately
// triggers the upgrade, establishing the WebSocket connection right away.
// The frontend ignores unknown event types, so this is safe to send.
func (s *WSService) Subscribe(ctx context.Context, stream genws.SubscribeServerStream) error {
	// Trigger the HTTP 101 WebSocket upgrade immediately.
	if err := stream.Send(&genws.FSEventResponse{Type: "connected", Path: ""}); err != nil {
		return err
	}

	c := newStreamClient(stream)
	s.hub.Register(c)
	defer func() {
		s.hub.Unregister(c)
		c.Close()
		stream.Close()
	}()

	// Block until context is cancelled (client disconnects or server shutdown).
	<-ctx.Done()
	return nil
}

// streamClient adapts a Goa SubscribeServerStream to service.HubClient.
type streamClient struct {
	stream genws.SubscribeServerStream
	events chan model.FSEvent
	done   chan struct{}
}

func newStreamClient(stream genws.SubscribeServerStream) *streamClient {
	c := &streamClient{
		stream: stream,
		events: make(chan model.FSEvent, 64),
		done:   make(chan struct{}),
	}
	go c.writePump()
	return c
}

// SendEvent queues an FSEvent for delivery to the WebSocket client.
// Returns false if the client's buffer is full (slow client).
func (c *streamClient) SendEvent(event model.FSEvent) bool {
	select {
	case c.events <- event:
		return true
	default:
		return false
	}
}

func (c *streamClient) writePump() {
	defer close(c.done)
	for event := range c.events {
		err := c.stream.Send(&genws.FSEventResponse{
			Type: string(event.Type),
			Path: event.Path,
		})
		if err != nil {
			return
		}
	}
}

// Close stops the write pump.
func (c *streamClient) Close() {
	close(c.events)
	<-c.done
}
