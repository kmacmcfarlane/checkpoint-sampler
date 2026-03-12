// Package testutil provides shared test helpers for backend tests.
package testutil

import (
	"github.com/sirupsen/logrus"
	"github.com/sirupsen/logrus/hooks/test"
)

// LogCapture holds a logger wired to an in-memory hook so tests can inspect
// emitted log entries without writing to any output stream.
type LogCapture struct {
	Logger *logrus.Logger
	Hook   *test.Hook
}

// NewLogCapture creates a logrus.Logger that discards output but captures all
// entries via a test hook. The logger level is set to TraceLevel so every
// entry is recorded regardless of severity.
func NewLogCapture() *LogCapture {
	logger, hook := test.NewNullLogger()
	logger.SetLevel(logrus.TraceLevel)
	return &LogCapture{Logger: logger, Hook: hook}
}

// Reset clears all captured entries, mirroring hook.Reset() but available
// directly on the capture struct.
func (c *LogCapture) Reset() {
	c.Hook.Reset()
}

// EntriesAtLevel returns all captured entries that match the given level.
func (c *LogCapture) EntriesAtLevel(level logrus.Level) []*logrus.Entry {
	var out []*logrus.Entry
	for _, e := range c.Hook.AllEntries() {
		if e.Level == level {
			out = append(out, e)
		}
	}
	return out
}

// MessagesAtLevel returns the Message strings of all captured entries that
// match the given level.
func (c *LogCapture) MessagesAtLevel(level logrus.Level) []string {
	entries := c.EntriesAtLevel(level)
	msgs := make([]string, 0, len(entries))
	for _, e := range entries {
		msgs = append(msgs, e.Message)
	}
	return msgs
}
