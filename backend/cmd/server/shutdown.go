package main

import (
	"context"
	"time"

	"github.com/sirupsen/logrus"
)

// Stoppable is any background worker that can be stopped gracefully.
type Stoppable interface {
	Stop()
}

// HTTPShutdowner is satisfied by *http.Server.
type HTTPShutdowner interface {
	Shutdown(ctx context.Context) error
}

// performShutdown orchestrates graceful shutdown in the required order:
//  1. Stop background workers (executor, watcher, fsState) so they no longer
//     touch the DB or submit requests.
//  2. Drain the HTTP server so in-flight requests complete before the DB closes.
//
// The caller is responsible for closing the DB and filesystem notifiers after
// this function returns.
func performShutdown(
	signalCtx context.Context,
	srv HTTPShutdowner,
	workers []Stoppable,
	httpTimeout time.Duration,
	logger logrus.FieldLogger,
) error {
	// Wait for shutdown signal.
	<-signalCtx.Done()
	logger.Info("shutdown signal received")

	// Step 1: stop background workers first so they do not issue new DB
	// queries while HTTP is still draining.
	for _, w := range workers {
		if w != nil {
			w.Stop()
		}
	}

	// Step 2: drain the HTTP server within the configured timeout.
	httpCtx, cancel := context.WithTimeout(context.Background(), httpTimeout)
	defer cancel()
	if err := srv.Shutdown(httpCtx); err != nil {
		logger.WithError(err).Error("HTTP server shutdown error")
		return err
	}

	return nil
}
