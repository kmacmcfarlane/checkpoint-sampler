package store

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// Default keepalive timings. A client-side ping/pong keepalive detects
// half-open connections (Wi-Fi drop, host poweroff without RST) where
// conn.ReadMessage() would otherwise block forever. The read deadline is
// refreshed on every successful read and on every pong, so long GPU-bound
// generations (during which ComfyUI sends no execution events) do not cause
// spurious disconnects as long as pongs keep flowing.
const (
	defaultPingInterval = 30 * time.Second
	defaultPongWait     = 90 * time.Second
	defaultWriteWait    = 10 * time.Second
)

// ComfyUIWSClient provides WebSocket connectivity to ComfyUI for real-time updates.
type ComfyUIWSClient struct {
	url      string
	clientID string
	logger   *logrus.Entry

	// Keepalive timings. Defaulted in the constructor; tests may override
	// them before calling Connect to use short timeouts.
	pingInterval time.Duration
	pongWait     time.Duration
	writeWait    time.Duration

	mu                sync.RWMutex
	conn              *websocket.Conn
	handlers          []model.ComfyUIEventHandler
	disconnectHandler func()
	stopCh            chan struct{}
	stopped           bool
}

// comfyUIEventEntity is the JSON-serializable store entity for WebSocket events.
type comfyUIEventEntity struct {
	Type string                 `json:"type"`
	Data map[string]interface{} `json:"data"`
}

// toModelComfyUIEvent converts store entity to model.ComfyUIEvent.
func toModelComfyUIEvent(entity comfyUIEventEntity) model.ComfyUIEvent {
	return model.ComfyUIEvent{
		Type: entity.Type,
		Data: entity.Data,
	}
}

// NewComfyUIWSClient creates a new ComfyUI WebSocket client.
// The baseURL should be the HTTP(S) URL (e.g., "http://localhost:8188" or "https://comfyui.example.com").
// The WebSocket URL is derived by converting http -> ws and https -> wss, and appending /ws.
// A unique client_id is generated at construction time and appended as a query parameter to the
// WebSocket URL. The same client_id must be used in prompt submissions so that ComfyUI routes
// prompt-specific events (executing, executed, execution_error) to this connection.
func NewComfyUIWSClient(baseURL string, logger *logrus.Logger) *ComfyUIWSClient {
	clientID := uuid.New().String()
	wsURL := DeriveWebSocketURL(baseURL, clientID)
	return &ComfyUIWSClient{
		url:          wsURL,
		clientID:     clientID,
		logger:       logger.WithField("component", "comfyui_ws"),
		handlers:     []model.ComfyUIEventHandler{},
		stopCh:       make(chan struct{}),
		pingInterval: defaultPingInterval,
		pongWait:     defaultPongWait,
		writeWait:    defaultWriteWait,
	}
}

// GetClientID returns the unique client ID associated with this WebSocket session.
// This must be included in all ComfyUI prompt submissions so that ComfyUI routes
// prompt-specific WebSocket events (executing, executed, execution_error) to this connection.
func (c *ComfyUIWSClient) GetClientID() string {
	return c.clientID
}

// DeriveWebSocketURL converts an HTTP(S) URL to a WebSocket URL with a client_id query parameter.
// http://host:port -> ws://host:port/ws?clientId=<clientID>
// https://host:port -> wss://host:port/ws?clientId=<clientID>
//
// The clientId parameter is required so that ComfyUI routes prompt-specific WebSocket events
// (executing, executed, execution_error) to this connection. Without a matching clientId,
// ComfyUI only sends general status events and not prompt-specific completion events.
func DeriveWebSocketURL(httpURL string, clientID string) string {
	// Parse the HTTP URL
	parsed, err := url.Parse(httpURL)
	if err != nil {
		// Fallback to simple string replacement if parsing fails
		wsURL := strings.Replace(httpURL, "http://", "ws://", 1)
		wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
		if clientID != "" {
			return wsURL + "/ws?clientId=" + url.QueryEscape(clientID)
		}
		return wsURL + "/ws"
	}

	// Convert scheme
	scheme := "ws"
	if parsed.Scheme == "https" {
		scheme = "wss"
	}

	// Build WebSocket URL with clientId query parameter
	q := url.Values{}
	if clientID != "" {
		q.Set("clientId", clientID)
	}
	wsURL := &url.URL{
		Scheme:   scheme,
		Host:     parsed.Host,
		Path:     "/ws",
		RawQuery: q.Encode(),
	}

	return wsURL.String()
}

// AddHandler registers an event handler.
func (c *ComfyUIWSClient) AddHandler(handler model.ComfyUIEventHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handlers = append(c.handlers, handler)
}

// SetDisconnectHandler registers a callback that is invoked when the WebSocket
// connection is lost (readLoop exits due to a read error). This allows the
// executor to mark itself as disconnected and trigger reconnection.
func (c *ComfyUIWSClient) SetDisconnectHandler(handler func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.disconnectHandler = handler
}

// Connect establishes the WebSocket connection and starts listening for events.
func (c *ComfyUIWSClient) Connect(ctx context.Context) error {
	c.logger.WithField("url", c.url).Trace("entering Connect")
	defer c.logger.Trace("returning from Connect")

	c.mu.Lock()
	if c.conn != nil {
		c.mu.Unlock()
		c.logger.Warn("already connected")
		return fmt.Errorf("already connected")
	}
	c.mu.Unlock()

	c.logger.WithField("url", c.url).Debug("dialing ComfyUI WebSocket")
	dialer := websocket.DefaultDialer
	conn, _, err := dialer.DialContext(ctx, c.url, nil)
	if err != nil {
		c.logger.WithFields(logrus.Fields{
			"url":   c.url,
			"error": err.Error(),
		}).Error("failed to dial ComfyUI WebSocket")
		return fmt.Errorf("dialing ComfyUI WebSocket: %w", err)
	}

	// Install keepalive: set an initial read deadline and refresh it on every
	// pong. The ping writer goroutine (started below) keeps pongs flowing so a
	// healthy-but-idle connection never trips the deadline, while a dead
	// half-open peer stops responding and the deadline expires, causing the
	// next ReadMessage to fail and the disconnect handler to fire.
	if c.pongWait > 0 {
		_ = conn.SetReadDeadline(time.Now().Add(c.pongWait))
		conn.SetPongHandler(func(string) error {
			return conn.SetReadDeadline(time.Now().Add(c.pongWait))
		})
	}

	c.mu.Lock()
	c.conn = conn
	c.stopped = false
	c.mu.Unlock()

	c.logger.Info("ComfyUI WebSocket connected")

	// connClosed is closed when the read loop exits, signalling the ping
	// writer to stop so it does not leak across reconnects.
	connClosed := make(chan struct{})
	go c.readLoop(connClosed)
	go c.pingLoop(conn, connClosed)

	return nil
}

// pingLoop periodically sends WebSocket ping control frames to keep the
// connection alive and to detect half-open peers. It stops when the read loop
// exits (connClosed) or when the client is closed (stopCh). A write failure is
// treated as a dead connection: closing conn unblocks the read loop, which
// then fires the disconnect handler.
func (c *ComfyUIWSClient) pingLoop(conn *websocket.Conn, connClosed <-chan struct{}) {
	if c.pingInterval <= 0 {
		return
	}

	ticker := time.NewTicker(c.pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-connClosed:
			return
		case <-c.stopCh:
			return
		case <-ticker.C:
			deadline := time.Now().Add(c.writeWait)
			if err := conn.WriteControl(websocket.PingMessage, nil, deadline); err != nil {
				c.logger.WithError(err).Warn("WebSocket ping failed; closing connection")
				// Closing the connection unblocks ReadMessage in the read
				// loop, which triggers the disconnect/reconnect path.
				_ = conn.Close()
				return
			}
		}
	}
}

// Close closes the WebSocket connection.
func (c *ComfyUIWSClient) Close() error {
	c.logger.Trace("entering Close")
	defer c.logger.Trace("returning from Close")

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.stopped {
		c.logger.Debug("already stopped")
		return nil
	}

	c.stopped = true
	close(c.stopCh)

	if c.conn != nil {
		err := c.conn.Close()
		c.conn = nil
		if err != nil {
			c.logger.WithError(err).Error("failed to close WebSocket connection")
		} else {
			c.logger.Info("WebSocket connection closed")
		}
		return err
	}

	return nil
}

// readLoop continuously reads messages from the WebSocket. connClosed is
// closed when the loop exits so the paired ping writer goroutine stops.
func (c *ComfyUIWSClient) readLoop(connClosed chan<- struct{}) {
	unexpectedExit := true // Track whether we exited due to an error (not a graceful stop)

	defer close(connClosed)

	defer func() {
		c.mu.Lock()
		if c.conn != nil {
			c.conn.Close()
			c.conn = nil
		}
		disconnectHandler := c.disconnectHandler
		c.mu.Unlock()

		// Notify the executor that the connection was lost so it can mark
		// itself as disconnected and trigger reconnection on the next tick.
		// Only fire on unexpected exits (read errors), not graceful shutdowns.
		if unexpectedExit && disconnectHandler != nil {
			disconnectHandler()
		}
	}()

	for {
		select {
		case <-c.stopCh:
			unexpectedExit = false
			return
		default:
		}

		c.mu.RLock()
		conn := c.conn
		c.mu.RUnlock()

		if conn == nil {
			unexpectedExit = false
			return
		}

		msgType, message, err := conn.ReadMessage()
		if err != nil {
			c.logger.WithError(err).Error("WebSocket read error")
			return
		}

		// Any successful read (data or pong) proves the peer is alive, so
		// refresh the read deadline. Pongs are also handled by the pong
		// handler installed in Connect; this covers data messages.
		if c.pongWait > 0 {
			_ = conn.SetReadDeadline(time.Now().Add(c.pongWait))
		}

		// ComfyUI sends binary messages for in-progress preview images.
		// These are not JSON events and must be silently skipped.
		if msgType == websocket.BinaryMessage {
			c.logger.WithField("bytes", len(message)).Debug("received binary WebSocket message (preview image), skipping")
			continue
		}

		var eventEntity comfyUIEventEntity
		if err := json.Unmarshal(message, &eventEntity); err != nil {
			c.logger.WithError(err).Error("failed to unmarshal WebSocket event")
			continue
		}

		event := toModelComfyUIEvent(eventEntity)
		c.logger.WithFields(logrus.Fields{
			"event_type": event.Type,
		}).Debug("received ComfyUI WebSocket event")
		c.dispatchEvent(event)
	}
}

// dispatchEvent calls all registered handlers with the event.
func (c *ComfyUIWSClient) dispatchEvent(event model.ComfyUIEvent) {
	c.mu.RLock()
	handlers := c.handlers
	c.mu.RUnlock()

	for _, handler := range handlers {
		handler(event)
	}
}
