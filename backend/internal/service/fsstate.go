package service

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// WalkDirFunc lists immediate subdirectories of a directory.
// Replaceable for testing.
type WalkDirFunc func(root string) ([]string, error)

// OSWalkDirs is the default WalkDirFunc that recursively discovers all
// subdirectories under root using the real filesystem.
func OSWalkDirs(root string) ([]string, error) {
	var dirs []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // skip inaccessible entries
		}
		if d.IsDir() && path != root {
			dirs = append(dirs, path)
		}
		return nil
	})
	return dirs, err
}

// FSStateDiscoverer abstracts the discovery of training runs so that FSState
// does not depend on concrete discovery services.
type FSStateDiscoverer interface {
	Discover() ([]model.TrainingRun, error)
}

// FSStateViewerDiscoverer abstracts the viewer-based discovery of training runs.
type FSStateViewerDiscoverer interface {
	DiscoverViewable() ([]model.TrainingRun, error)
}

// FSState holds an in-memory snapshot of filesystem-derived data (training runs
// for both checkpoint and viewer sources). It is populated on startup and
// refreshed reactively when the filesystem changes.
type FSState struct {
	mu sync.RWMutex

	checkpointRuns []model.TrainingRun
	viewableRuns   []model.TrainingRun

	checkpointDiscovery FSStateDiscoverer
	viewerDiscovery     FSStateViewerDiscoverer
	logger              *logrus.Entry

	// debounce controls how long to wait after the last filesystem event
	// before re-running discovery, to batch rapid changes.
	debounce time.Duration

	// isDir checks whether a path is a directory. Replaceable for testing.
	isDir IsDirFunc
	// walkDirs recursively discovers subdirectories. Replaceable for testing.
	walkDirs WalkDirFunc

	// notify channel is used to signal a refresh is needed.
	notify chan struct{}
	done   chan struct{}
	// stopOnce ensures Stop() is idempotent and safe to call multiple times.
	stopOnce sync.Once
}

// NewFSState creates a new FSState instance. Call Populate() to fill it and
// StartWatching() to begin reactive updates.
func NewFSState(
	checkpointDiscovery FSStateDiscoverer,
	viewerDiscovery FSStateViewerDiscoverer,
	logger *logrus.Logger,
) *FSState {
	return &FSState{
		checkpointDiscovery: checkpointDiscovery,
		viewerDiscovery:     viewerDiscovery,
		logger:              logger.WithField("component", "fsstate"),
		debounce:            500 * time.Millisecond,
		isDir:               OSIsDir,
		walkDirs:            OSWalkDirs,
		notify:              make(chan struct{}, 1),
	}
}

// SetDebounce overrides the debounce duration (for testing).
func (s *FSState) SetDebounce(d time.Duration) {
	s.debounce = d
}

// SetIsDirFunc overrides the directory detection function (for testing).
func (s *FSState) SetIsDirFunc(fn IsDirFunc) {
	s.isDir = fn
}

// SetWalkDirFunc overrides the directory walking function (for testing).
func (s *FSState) SetWalkDirFunc(fn WalkDirFunc) {
	s.walkDirs = fn
}

// Populate runs both discovery methods and stores the results in the snapshot.
// This is called once at startup and can be called again to force a refresh.
func (s *FSState) Populate() error {
	s.logger.Trace("entering Populate")
	defer s.logger.Trace("returning from Populate")

	start := time.Now()

	checkpointRuns, err := s.checkpointDiscovery.Discover()
	if err != nil {
		s.logger.WithError(err).Error("failed to discover checkpoint training runs for snapshot")
		return err
	}

	viewableRuns, err := s.viewerDiscovery.DiscoverViewable()
	if err != nil {
		s.logger.WithError(err).Error("failed to discover viewable training runs for snapshot")
		return err
	}

	s.mu.Lock()
	s.checkpointRuns = checkpointRuns
	s.viewableRuns = viewableRuns
	s.mu.Unlock()

	elapsed := time.Since(start)
	s.logger.WithFields(logrus.Fields{
		"checkpoint_runs": len(checkpointRuns),
		"viewable_runs":   len(viewableRuns),
		"elapsed_ms":      elapsed.Milliseconds(),
	}).Info("FSState snapshot populated")

	return nil
}

// CheckpointRuns returns a copy of the cached checkpoint-discovered training runs.
func (s *FSState) CheckpointRuns() []model.TrainingRun {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// Perform a shallow copy of the slice so the caller gets an independent
	// backing array. Note: inner slices within each TrainingRun (e.g.,
	// Checkpoints) are not deep-copied — callers must not mutate them.
	result := make([]model.TrainingRun, len(s.checkpointRuns))
	copy(result, s.checkpointRuns)
	return result
}

// ViewableRuns returns a copy of the cached viewer-discovered training runs.
func (s *FSState) ViewableRuns() []model.TrainingRun {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]model.TrainingRun, len(s.viewableRuns))
	copy(result, s.viewableRuns)
	return result
}

// requestRefresh signals the background loop to re-run discovery.
// Non-blocking: if a refresh is already pending, additional requests are merged.
func (s *FSState) requestRefresh() {
	select {
	case s.notify <- struct{}{}:
	default:
		// A refresh is already pending — skip.
	}
}

// StartWatching begins watching the given directories for filesystem events.
// When a directory-level event (create/remove) occurs in any watched directory,
// the snapshot is re-populated after a debounce window.
//
// On Linux, inotify only fires events for immediate children of a watched
// directory. To detect changes at arbitrary depth (e.g. a new study directory
// at /samples/model/StudyName/), StartWatching recursively walks all existing
// subdirectories and adds them to the watcher. The watchLoop dynamically adds
// newly created subdirectories so that future events within them are captured.
func (s *FSState) StartWatching(notifier WatcherNotifier, dirs []string) {
	s.logger.Trace("entering StartWatching")

	s.done = make(chan struct{})

	watchCount := 0
	for _, dir := range dirs {
		if err := notifier.Add(dir); err != nil {
			s.logger.WithFields(logrus.Fields{
				"dir":   dir,
				"error": err.Error(),
			}).Error("failed to watch directory for FSState")
		} else {
			watchCount++
			s.logger.WithField("dir", dir).Debug("FSState watching directory")
		}

		// Recursively walk existing subdirectories and add them to the
		// watcher so that events at any depth are captured.
		subdirs, err := s.walkDirs(dir)
		if err != nil {
			s.logger.WithFields(logrus.Fields{
				"dir":   dir,
				"error": err.Error(),
			}).Warn("failed to walk subdirectories for FSState")
			continue
		}
		for _, sub := range subdirs {
			if err := notifier.Add(sub); err != nil {
				s.logger.WithFields(logrus.Fields{
					"dir":   sub,
					"error": err.Error(),
				}).Error("failed to watch subdirectory for FSState")
			} else {
				watchCount++
				s.logger.WithField("dir", sub).Debug("FSState watching subdirectory")
			}
		}
	}

	go s.watchLoop(notifier)
	s.logger.WithFields(logrus.Fields{
		"top_level_dirs": len(dirs),
		"total_watches":  watchCount,
	}).Info("FSState watching started")
}

// Stop stops the background watching loop. It is safe to call multiple times.
func (s *FSState) Stop() {
	s.stopOnce.Do(func() {
		if s.done != nil {
			close(s.done)
		}
	})
}

// watchLoop listens for filesystem events and triggers debounced refreshes.
func (s *FSState) watchLoop(notifier WatcherNotifier) {
	s.logger.Trace("entering FSState watchLoop")
	defer s.logger.Trace("exiting FSState watchLoop")

	var debounceTimer *time.Timer

	for {
		select {
		case <-s.done:
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			return

		case ev, ok := <-notifier.Events():
			if !ok {
				return
			}
			// Only react to create/remove events (directory structure changes).
			if ev.Op.Has(fsnotify.Create) || ev.Op.Has(fsnotify.Remove) || ev.Op.Has(fsnotify.Rename) {
				s.logger.WithFields(logrus.Fields{
					"event_name": ev.Name,
					"event_op":   ev.Op.String(),
				}).Debug("FSState detected filesystem event, scheduling refresh")

				// When a new directory is created, start watching it (and
				// any subdirectories that may already exist inside it) so
				// that future events within it are captured by inotify.
				if ev.Op.Has(fsnotify.Create) && s.isDir(ev.Name) {
					if err := notifier.Add(ev.Name); err != nil {
						s.logger.WithFields(logrus.Fields{
							"dir":   ev.Name,
							"error": err.Error(),
						}).Error("failed to add watch for new directory in FSState")
					} else {
						s.logger.WithField("dir", ev.Name).Debug("FSState dynamically watching new directory")
					}
					// Also walk its subdirectories in case the directory
					// was created with nested content (e.g. by mv or cp -r).
					subdirs, walkErr := s.walkDirs(ev.Name)
					if walkErr == nil {
						for _, sub := range subdirs {
							if addErr := notifier.Add(sub); addErr != nil {
								s.logger.WithFields(logrus.Fields{
									"dir":   sub,
									"error": addErr.Error(),
								}).Error("failed to add watch for new subdirectory in FSState")
							}
						}
					}
				}

				// When a directory is removed or renamed, clean up the stale watch.
				if ev.Op.Has(fsnotify.Remove) || ev.Op.Has(fsnotify.Rename) {
					if err := notifier.Remove(ev.Name); err != nil {
						// This is expected to fail for files (not dirs), so log at debug.
						s.logger.WithFields(logrus.Fields{
							"path":  ev.Name,
							"error": err.Error(),
						}).Debug("FSState failed to remove watch (may be a file, not a directory)")
					}
				}

				// Reset the debounce timer.
				if debounceTimer != nil {
					debounceTimer.Stop()
				}
				debounceTimer = time.AfterFunc(s.debounce, func() {
					s.requestRefresh()
				})
			}

		case <-s.notify:
			// Execute the refresh.
			if err := s.Populate(); err != nil {
				s.logger.WithError(err).Error("FSState refresh failed")
			}

		case err, ok := <-notifier.Errors():
			if !ok {
				return
			}
			s.logger.WithError(err).Error("FSState watcher error")
		}
	}
}
