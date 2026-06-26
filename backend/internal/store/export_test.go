package store

import (
	"time"

	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
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

// ToModelObjectInfo exposes the internal mapper for unit testing.
func ToModelObjectInfo(e objectInfoEntity) *model.ObjectInfo {
	return toModelObjectInfo(e)
}

// ObjectInfoEntityForTest constructs an objectInfoEntity for use in tests.
func ObjectInfoEntityForTest(name, category string, output []string, required, optional map[string][]interface{}) objectInfoEntity {
	return objectInfoEntity{
		Name:     name,
		Category: category,
		Output:   output,
		Input: objectInfoInputEntity{
			Required: required,
			Optional: optional,
		},
	}
}
