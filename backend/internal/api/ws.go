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
		resp := &genws.FSEventResponse{
			Type: string(event.Type),
			Path: event.Path,
		}

		// Include inference progress data when present
		if event.InferenceProgressData != nil {
			d := event.InferenceProgressData
			resp.PromptID = &d.PromptID
			resp.CurrentValue = &d.CurrentValue
			resp.MaxValue = &d.MaxValue
			// Include per-sample ETA in inference progress events so the frontend
			// can display live sample ETA based on step completion rate.
			if d.SampleETASeconds > 0 {
				resp.SampleEtaSeconds = &d.SampleETASeconds
			}
		}

		// Include job progress data when present
		if event.JobProgressData != nil {
			d := event.JobProgressData
			resp.JobID = &d.JobID
			resp.Status = &d.Status
			resp.TotalItems = &d.TotalItems
			resp.CompletedItems = &d.CompletedItems
			resp.FailedItems = &d.FailedItems
			resp.PendingItems = &d.PendingItems
			resp.CheckpointsCompleted = &d.CheckpointsCompleted
			resp.TotalCheckpoints = &d.TotalCheckpoints
			if d.CurrentCheckpoint != "" {
				resp.CurrentCheckpoint = &d.CurrentCheckpoint
			}
			if d.CurrentCheckpointTotal > 0 {
				resp.CurrentCheckpointProgress = &d.CurrentCheckpointProgress
				resp.CurrentCheckpointTotal = &d.CurrentCheckpointTotal
			}
			// Map checkpoint completeness data
			if len(d.CheckpointCompleteness) > 0 {
				completeness := make([]*genws.CheckpointCompletenessInfo, len(d.CheckpointCompleteness))
				for i, info := range d.CheckpointCompleteness {
					completeness[i] = &genws.CheckpointCompletenessInfo{
						Checkpoint: info.Checkpoint,
						Expected:   info.Expected,
						Verified:   info.Verified,
						Missing:    info.Missing,
					}
				}
				resp.CheckpointCompleteness = completeness
			}
			// Map ETA fields (only when non-zero, meaning an estimate is available)
			if d.SampleETASeconds > 0 {
				resp.SampleEtaSeconds = &d.SampleETASeconds
			}
			if d.JobETASeconds > 0 {
				resp.JobEtaSeconds = &d.JobETASeconds
			}
			// Map failed item details with structured error info
			if len(d.FailedItemDetails) > 0 {
				details := make([]*genws.WSFailedItemDetail, len(d.FailedItemDetails))
				for i, detail := range d.FailedItemDetails {
					fd := &genws.WSFailedItemDetail{
						CheckpointFilename: detail.CheckpointFilename,
						ErrorMessage:       detail.ErrorMessage,
					}
					if detail.ExceptionType != "" {
						fd.ExceptionType = &detail.ExceptionType
					}
					if detail.NodeType != "" {
						fd.NodeType = &detail.NodeType
					}
					if detail.Traceback != "" {
						fd.Traceback = &detail.Traceback
					}
					details[i] = fd
				}
				resp.FailedItemDetails = details
			}
		}

		if err := c.stream.Send(resp); err != nil {
			return
		}
	}
}

// Close stops the write pump.
func (c *streamClient) Close() {
	close(c.events)
	<-c.done
}
