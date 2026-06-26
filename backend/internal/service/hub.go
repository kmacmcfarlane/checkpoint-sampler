package service

import (
	"sync"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// MaxHubClients is the maximum number of concurrent WebSocket clients the hub
// will accept. Connections beyond this limit are rejected. A generous fixed
// default is used; no config key is needed at this scale.
const MaxHubClients = 100

// HubClient is a connected WebSocket client that can receive events.
type HubClient interface {
	// SendEvent sends an event to the client. Returns false if the client
	// is no longer writable and should be removed.
	SendEvent(event model.FSEvent) bool
}

// Hub manages connected WebSocket clients and broadcasts filesystem events.
type Hub struct {
	mu         sync.RWMutex
	clients    map[HubClient]struct{}
	maxClients int
	logger     *logrus.Entry
}

// NewHub creates a new Hub with the default client cap.
func NewHub(logger *logrus.Logger) *Hub {
	return &Hub{
		clients:    make(map[HubClient]struct{}),
		maxClients: MaxHubClients,
		logger:     logger.WithField("component", "hub"),
	}
}

// Register adds a client to the hub. Returns true if the client was accepted,
// or false if the hub is at capacity (the client is not added).
func (h *Hub) Register(c HubClient) bool {
	h.logger.Trace("entering Register")
	defer h.logger.Trace("returning from Register")

	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.clients) >= h.maxClients {
		h.logger.WithField("max_clients", h.maxClients).Warn("hub at capacity, rejecting websocket client")
		return false
	}
	h.clients[c] = struct{}{}
	h.logger.WithField("client_count", len(h.clients)).Debug("client registered")
	return true
}

// Unregister removes a client from the hub.
func (h *Hub) Unregister(c HubClient) {
	h.logger.Trace("entering Unregister")
	defer h.logger.Trace("returning from Unregister")

	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	h.logger.WithField("client_count", len(h.clients)).Debug("client unregistered")
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
	h.logger.WithFields(logrus.Fields{
		"event_type": event.Type,
		"event_path": event.Path,
	}).Trace("entering Broadcast")
	defer h.logger.Trace("returning from Broadcast")

	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if !c.SendEvent(event) {
			delete(h.clients, c)
			h.logger.WithField("client_count", len(h.clients)).Info("removed unresponsive websocket client")
		}
	}
	h.logger.WithFields(logrus.Fields{
		"event_type":   event.Type,
		"event_path":   event.Path,
		"client_count": len(h.clients),
	}).Debug("broadcasted event to clients")
}
