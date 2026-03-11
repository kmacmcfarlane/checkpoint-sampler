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
