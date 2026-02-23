package store

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// ComfyUIWSClient provides WebSocket connectivity to ComfyUI for real-time updates.
type ComfyUIWSClient struct {
	url    string
	logger *log.Logger

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
func NewComfyUIWSClient(host string, port int, logger *log.Logger) *ComfyUIWSClient {
	if logger == nil {
		logger = log.Default()
	}
	return &ComfyUIWSClient{
		url:      fmt.Sprintf("ws://%s:%d/ws", host, port),
		logger:   logger,
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
	c.mu.Lock()
	if c.conn != nil {
		c.mu.Unlock()
		return fmt.Errorf("already connected")
	}
	c.mu.Unlock()

	dialer := websocket.DefaultDialer
	conn, _, err := dialer.DialContext(ctx, c.url, nil)
	if err != nil {
		return fmt.Errorf("dialing ComfyUI WebSocket: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.stopped = false
	c.mu.Unlock()

	go c.readLoop()

	return nil
}

// Close closes the WebSocket connection.
func (c *ComfyUIWSClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.stopped {
		return nil
	}

	c.stopped = true
	close(c.stopCh)

	if c.conn != nil {
		err := c.conn.Close()
		c.conn = nil
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
			c.logger.Printf("ComfyUI WebSocket read error: %v", err)
			return
		}

		var event ComfyUIEvent
		if err := json.Unmarshal(message, &event); err != nil {
			c.logger.Printf("ComfyUI WebSocket unmarshal error: %v", err)
			continue
		}

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
