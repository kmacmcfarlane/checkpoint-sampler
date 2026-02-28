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

// MountTestResetEndpoint conditionally registers DELETE /api/test/reset on the
// given mux. The endpoint is only mounted when the ENABLE_TEST_ENDPOINTS
// environment variable is set to "true". It drops all tables and reruns
// migrations, returning the database to a clean initial state.
//
// This is intended exclusively for E2E test isolation -- it must never be
// enabled in production.
func MountTestResetEndpoint(mux interface{ Handle(string, string, http.HandlerFunc) }, resetter DBResetter, logger *logrus.Logger) {
	if os.Getenv("ENABLE_TEST_ENDPOINTS") != "true" {
		return
	}

	logger.Warn("test-only reset endpoint enabled (ENABLE_TEST_ENDPOINTS=true)")

	mux.Handle("DELETE", "/api/test/reset", func(w http.ResponseWriter, r *http.Request) {
		logger.Info("test reset endpoint called -- resetting database")

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
