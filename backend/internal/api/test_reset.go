package api

import (
	"net/http"
	"os"
	"sync"

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

// SnapshotRefresher is an optional interface for synchronously repopulating an
// in-memory filesystem-state snapshot (FSState) after the reset endpoint has
// mutated the sample directory (cleanup + fixture seeding).
//
// B-176: viewer-discovery serves training runs from the FSState snapshot, which
// is otherwise only refreshed asynchronously via debounced fsnotify events (or a
// 15s polling fallback when inotify watch registration is degraded — see B-178).
// E2E tests hit the discovery endpoint immediately after reset returns, so
// without a synchronous refresh the snapshot still reflects the pre-seed state
// and freshly seeded runs (e.g. the slash-sanitized "test-run_my-model" run) are
// missing. Repopulating here makes discovery deterministic regardless of the
// inotify watch state. *service.FSState satisfies this via its Populate method.
type SnapshotRefresher interface {
	Populate() error
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
// If a SnapshotRefresher is provided, the in-memory FSState snapshot is
// repopulated after seeding so discovery endpoints reflect the seeded state
// immediately (B-176).
//
// This is intended exclusively for E2E test isolation -- it must never be
// enabled in production.
func MountTestResetEndpoint(mux interface{ Handle(string, string, http.HandlerFunc) }, resetter DBResetter, pauser BackgroundPauser, cleaner SampleDirCleaner, seeder FixtureSeeder, refresher SnapshotRefresher, logger *logrus.Logger) {
	if os.Getenv("ENABLE_TEST_ENDPOINTS") != "true" {
		return
	}

	logger.Warn("test-only reset endpoint enabled (ENABLE_TEST_ENDPOINTS=true)")

	// Serialize all reset requests so that concurrent E2E shards do not
	// race on table drops, migrations, or schema_migrations inserts.
	var resetMu sync.Mutex

	mux.Handle("DELETE", "/api/test/reset", func(w http.ResponseWriter, r *http.Request) {
		resetMu.Lock()
		defer resetMu.Unlock()

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

		// Synchronously repopulate the in-memory filesystem-state snapshot so
		// that discovery endpoints (viewer-discovery / source=samples) reflect
		// the just-seeded sample directories on the very next request, rather
		// than waiting for a debounced fsnotify event or the degraded-mode
		// polling fallback (B-176). Without this, E2E tests that call an
		// immediately-following discovery request observe stale state and miss
		// freshly seeded runs.
		if refresher != nil {
			if err := refresher.Populate(); err != nil {
				logger.WithError(err).Error("FSState snapshot refresh failed after reset")
				http.Error(w, "snapshot refresh failed", http.StatusInternalServerError)
				return
			}
		}

		logger.Info("database reset, sample directory cleanup, and fixture seeding completed successfully")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"reset_complete"}`))
	})
}
