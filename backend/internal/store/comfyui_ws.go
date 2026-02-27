package store

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// ComfyUIWSClient provides WebSocket connectivity to ComfyUI for real-time updates.
type ComfyUIWSClient struct {
	url    string
	logger *logrus.Entry

	mu       sync.RWMutex
	conn     *websocket.Conn
	handlers []model.ComfyUIEventHandler
	stopCh   chan struct{}
	stopped  bool
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
func NewComfyUIWSClient(baseURL string, logger *logrus.Logger) *ComfyUIWSClient {
	wsURL := DeriveWebSocketURL(baseURL)
	return &ComfyUIWSClient{
		url:      wsURL,
		logger:   logger.WithField("component", "comfyui_ws"),
		handlers: []model.ComfyUIEventHandler{},
		stopCh:   make(chan struct{}),
	}
}

// DeriveWebSocketURL converts an HTTP(S) URL to a WebSocket URL.
// http://host:port -> ws://host:port/ws
// https://host:port -> wss://host:port/ws
func DeriveWebSocketURL(httpURL string) string {
	// Parse the HTTP URL
	parsed, err := url.Parse(httpURL)
	if err != nil {
		// Fallback to simple string replacement if parsing fails
		wsURL := strings.Replace(httpURL, "http://", "ws://", 1)
		wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
		return wsURL + "/ws"
	}

	// Convert scheme
	scheme := "ws"
	if parsed.Scheme == "https" {
		scheme = "wss"
	}

	// Build WebSocket URL
	wsURL := &url.URL{
		Scheme: scheme,
		Host:   parsed.Host,
		Path:   "/ws",
	}

	return wsURL.String()
}

// AddHandler registers an event handler.
func (c *ComfyUIWSClient) AddHandler(handler model.ComfyUIEventHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handlers = append(c.handlers, handler)
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

	c.mu.Lock()
	c.conn = conn
	c.stopped = false
	c.mu.Unlock()

	c.logger.Info("ComfyUI WebSocket connected")
	go c.readLoop()

	return nil
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

// readLoop continuously reads messages from the WebSocket.
func (c *ComfyUIWSClient) readLoop() {
	defer func() {
		c.mu.Lock()
		if c.conn != nil {
			c.conn.Close()
			c.conn = nil
		}
		c.mu.Unlock()
	}()

	for {
		select {
		case <-c.stopCh:
			return
		default:
		}

		c.mu.RLock()
		conn := c.conn
		c.mu.RUnlock()

		if conn == nil {
			return
		}

		msgType, message, err := conn.ReadMessage()
		if err != nil {
			c.logger.WithError(err).Error("WebSocket read error")
			return
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
