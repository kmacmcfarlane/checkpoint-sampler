package service

import (
	"log"
	"sync"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// HubClient is a connected WebSocket client that can receive events.
type HubClient interface {
	// SendEvent sends an event to the client. Returns false if the client
	// is no longer writable and should be removed.
	SendEvent(event model.FSEvent) bool
}

// Hub manages connected WebSocket clients and broadcasts filesystem events.
type Hub struct {
	mu      sync.RWMutex
	clients map[HubClient]struct{}
	logger  *log.Logger
}

// NewHub creates a new Hub.
func NewHub(logger *log.Logger) *Hub {
	return &Hub{
		clients: make(map[HubClient]struct{}),
		logger:  logger,
	}
}

// Register adds a client to the hub.
func (h *Hub) Register(c HubClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
}

// Unregister removes a client from the hub.
func (h *Hub) Unregister(c HubClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// Broadcast sends an FSEvent to all connected clients.
// Clients that fail to receive are removed.
func (h *Hub) Broadcast(event model.FSEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if !c.SendEvent(event) {
			delete(h.clients, c)
			if h.logger != nil {
				h.logger.Printf("hub: removed unresponsive client")
			}
		}
	}
}
