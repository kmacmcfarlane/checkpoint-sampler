package store

import (
	"time"

	"github.com/sirupsen/logrus"
)

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

// NewComfyUIHTTPClientWithTimeouts is a test-only constructor that injects
// custom per-call timeout budgets so unit tests can use small, fast timeouts
// instead of the production defaults (10 s / 120 s).
func NewComfyUIHTTPClientWithTimeouts(baseURL string, logger *logrus.Logger, controlPlane, download time.Duration) *ComfyUIHTTPClient {
	return newComfyUIHTTPClientWithTimeouts(baseURL, logger, comfyUITimeouts{
		controlPlane: controlPlane,
		download:     download,
	})
}
