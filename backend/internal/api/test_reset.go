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

// SampleDirCleaner is an optional interface for removing study-generated
// sample directories during test reset. When provided, study directories
// (non-safetensors directories at the root of sample_dir) are removed to
// prevent filesystem state from leaking between E2E tests.
type SampleDirCleaner interface {
	CleanStudyDirs() error
}

// FixtureSeeder is an optional interface for seeding deterministic fixture data
// (studies + sample directories) after a test reset. When provided, the test
// reset endpoint calls SeedFixtures() after CleanStudyDirs() to restore the
// fixture state required by E2E tests (e.g. regen-confirmation.spec.ts).
type FixtureSeeder interface {
	SeedFixtures() error
}

// MountTestResetEndpoint conditionally registers DELETE /api/test/reset on the
// given mux. The endpoint is only mounted when the ENABLE_TEST_ENDPOINTS
// environment variable is set to "true". It drops all tables and reruns
// migrations, returning the database to a clean initial state.
//
// If a BackgroundPauser is provided, it is paused before the reset and resumed
// after, preventing race conditions with background polling loops.
//
// If a SampleDirCleaner is provided, study-generated sample directories are
// removed to restore the sample_dir to its original fixture state.
//
// If a FixtureSeeder is provided, deterministic fixture data is seeded after
// cleanup to ensure E2E tests start with known-good state.
//
// This is intended exclusively for E2E test isolation -- it must never be
// enabled in production.
func MountTestResetEndpoint(mux interface{ Handle(string, string, http.HandlerFunc) }, resetter DBResetter, pauser BackgroundPauser, cleaner SampleDirCleaner, seeder FixtureSeeder, logger *logrus.Logger) {
	if os.Getenv("ENABLE_TEST_ENDPOINTS") != "true" {
		return
	}

	logger.Warn("test-only reset endpoint enabled (ENABLE_TEST_ENDPOINTS=true)")

	mux.Handle("DELETE", "/api/test/reset", func(w http.ResponseWriter, r *http.Request) {
		logger.Info("test reset endpoint called -- resetting database and sample directory")

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

		// Clean up study-generated sample directories to prevent
		// filesystem state from leaking between E2E tests.
		if cleaner != nil {
			if err := cleaner.CleanStudyDirs(); err != nil {
				logger.WithError(err).Error("sample directory cleanup failed")
				http.Error(w, "sample directory cleanup failed", http.StatusInternalServerError)
				return
			}
		}

		// Seed deterministic fixture data (studies + sample dirs) so that
		// E2E tests that rely on pre-existing samples start in known-good state.
		if seeder != nil {
			if err := seeder.SeedFixtures(); err != nil {
				logger.WithError(err).Error("fixture seeding failed")
				http.Error(w, "fixture seeding failed", http.StatusInternalServerError)
				return
			}
		}

		logger.Info("database reset, sample directory cleanup, and fixture seeding completed successfully")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"reset_complete"}`))
	})
}
