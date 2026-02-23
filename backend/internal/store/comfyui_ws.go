package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"
)

// ComfyUIWSClient provides WebSocket connectivity to ComfyUI for real-time updates.
type ComfyUIWSClient struct {
	url    string
	logger *logrus.Entry

	mu       sync.RWMutex
	conn     *websocket.Conn
	handlers []ComfyUIEventHandler
	stopCh   chan struct{}
	stopped  bool
}

// ComfyUIEventHandler is a callback for ComfyUI events.
type ComfyUIEventHandler func(event ComfyUIEvent)

// ComfyUIEvent represents a WebSocket event from ComfyUI.
type ComfyUIEvent struct {
	Type string                 `json:"type"`
	Data map[string]interface{} `json:"data"`
}

// NewComfyUIWSClient creates a new ComfyUI WebSocket client.
func NewComfyUIWSClient(host string, port int, logger *logrus.Logger) *ComfyUIWSClient {
	return &ComfyUIWSClient{
		url:      fmt.Sprintf("ws://%s:%d/ws", host, port),
		logger:   logger.WithField("component", "comfyui_ws"),
		handlers: []ComfyUIEventHandler{},
		stopCh:   make(chan struct{}),
	}
}

// AddHandler registers an event handler.
func (c *ComfyUIWSClient) AddHandler(handler ComfyUIEventHandler) {
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

		_, message, err := conn.ReadMessage()
		if err != nil {
			c.logger.WithError(err).Error("WebSocket read error")
			return
		}

		var event ComfyUIEvent
		if err := json.Unmarshal(message, &event); err != nil {
			c.logger.WithError(err).Error("failed to unmarshal WebSocket event")
			continue
		}

		c.logger.WithField("event_type", event.Type).Debug("received WebSocket event")
		c.dispatchEvent(event)
	}
}

// dispatchEvent calls all registered handlers with the event.
func (c *ComfyUIWSClient) dispatchEvent(event ComfyUIEvent) {
	c.mu.RLock()
	handlers := c.handlers
	c.mu.RUnlock()

	for _, handler := range handlers {
		handler(event)
	}
}
