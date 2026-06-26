package api

import (
	"context"
	"time"

	"github.com/sirupsen/logrus"
)

// RunPingLoopForTest exposes the internal runPingLoop function for unit testing.
// It is only compiled during test runs (export_test.go convention).
func RunPingLoopForTest(conn PingableConn, interval time.Duration, cancel context.CancelFunc, logger *logrus.Logger) {
	runPingLoop(conn, interval, cancel, logger)
}

// OriginAllowedForTest exposes the internal originAllowed function for unit
// testing of the same-host WebSocket/CORS origin policy.
func OriginAllowedForTest(originHeader, hostHeader string, allowed []string) bool {
	return originAllowed(originHeader, hostHeader, allowed)
}
