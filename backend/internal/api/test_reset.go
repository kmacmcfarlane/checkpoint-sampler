package api

import (
	"net/http"
	"os"

	"github.com/sirupsen/logrus"
)

// DBResetter is the interface required by the test reset endpoint.
// The store.Store type satisfies this interface via its ResetDB method.
type DBResetter interface {
	ResetDB() error
}

// BackgroundPauser is an optional interface for pausing background processes
// (e.g. the job executor) during database reset to prevent SQL errors from
// concurrent queries hitting dropped tables.
type BackgroundPauser interface {
	Pause()
	Resume()
}

// MountTestResetEndpoint conditionally registers DELETE /api/test/reset on the
// given mux. The endpoint is only mounted when the ENABLE_TEST_ENDPOINTS
// environment variable is set to "true". It drops all tables and reruns
// migrations, returning the database to a clean initial state.
//
// If a BackgroundPauser is provided, it is paused before the reset and resumed
// after, preventing race conditions with background polling loops.
//
// This is intended exclusively for E2E test isolation -- it must never be
// enabled in production.
func MountTestResetEndpoint(mux interface{ Handle(string, string, http.HandlerFunc) }, resetter DBResetter, pauser BackgroundPauser, logger *logrus.Logger) {
	if os.Getenv("ENABLE_TEST_ENDPOINTS") != "true" {
		return
	}

	logger.Warn("test-only reset endpoint enabled (ENABLE_TEST_ENDPOINTS=true)")

	mux.Handle("DELETE", "/api/test/reset", func(w http.ResponseWriter, r *http.Request) {
		logger.Info("test reset endpoint called -- resetting database")

		// Pause background processes to prevent SQL errors during table
		// drop/recreate. Resume is deferred so it always runs, even if
		// the reset itself fails.
		if pauser != nil {
			pauser.Pause()
			defer pauser.Resume()
		}

		if err := resetter.ResetDB(); err != nil {
			logger.WithError(err).Error("database reset failed")
			http.Error(w, "database reset failed", http.StatusInternalServerError)
			return
		}

		logger.Info("database reset completed successfully")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"reset_complete"}`))
	})
}
