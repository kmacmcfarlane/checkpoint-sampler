package store

import "time"

// SetKeepaliveTimingsForTest overrides the WebSocket keepalive timings so tests
// can use short timeouts instead of the multi-second production defaults. It
// must be called before Connect.
func (c *ComfyUIWSClient) SetKeepaliveTimingsForTest(pingInterval, pongWait, writeWait time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pingInterval = pingInterval
	c.pongWait = pongWait
	c.writeWait = writeWait
}
