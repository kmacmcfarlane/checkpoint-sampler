package service

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"github.com/fsnotify/fsnotify"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// isInotifyExhaustion reports whether err is an inotify watch-limit exhaustion
// (ENOSPC from inotify_add_watch). Under heavy parallel load (e.g. many E2E
// backends sharing one host's inotify budget) fs.inotify.max_user_watches can
// be exhausted, causing fsnotify.Watcher.Add to return ENOSPC. Despite the
// "no space left on device" text this is NOT a real disk-space condition and
// must be handled gracefully rather than treated as a fatal watch failure.
func isInotifyExhaustion(err error) bool {
	return errors.Is(err, syscall.ENOSPC)
}

// WatcherEventSink receives filesystem events from the watcher.
type WatcherEventSink interface {
	Broadcast(event model.FSEvent)
}

// WatcherNotifier provides filesystem notification capabilities.
// This interface allows testing without real fsnotify.
type WatcherNotifier interface {
	Add(name string) error
	Remove(name string) error
	Events() <-chan fsnotify.Event
	Errors() <-chan error
	Close() error
}

// fsnotifyAdapter wraps a real *fsnotify.Watcher to implement WatcherNotifier.
type fsnotifyAdapter struct {
	w *fsnotify.Watcher
}

func (a *fsnotifyAdapter) Add(name string) error         { return a.w.Add(name) }
func (a *fsnotifyAdapter) Remove(name string) error      { return a.w.Remove(name) }
func (a *fsnotifyAdapter) Events() <-chan fsnotify.Event { return a.w.Events }
func (a *fsnotifyAdapter) Errors() <-chan error          { return a.w.Errors }
func (a *fsnotifyAdapter) Close() error                  { return a.w.Close() }

// NewFSNotifier creates a WatcherNotifier backed by a real fsnotify.Watcher.
func NewFSNotifier() (WatcherNotifier, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &fsnotifyAdapter{w: w}, nil
}

// IsDirFunc determines whether a path is a directory.
// Replaceable for testing.
type IsDirFunc func(path string) bool

// OSIsDir is the default IsDirFunc using os.Stat.
func OSIsDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// Watcher watches filesystem directories for changes and broadcasts events.
type Watcher struct {
	mu        sync.Mutex
	notifier  WatcherNotifier
	sink      WatcherEventSink
	sampleDir string
	isDir     IsDirFunc
	logger    *logrus.Entry
	done      chan struct{}
	stopped   chan struct{}
	watching  bool

	// watchMu guards watched. Directories are added both from
	// WatchTrainingRun (under mu) and from the loop goroutine when new
	// directories appear (handleEvent), so the set needs its own lock.
	watchMu sync.Mutex
	// watched is the set of directories currently registered with the
	// notifier. It is used to remove every active watch on a run switch so
	// inotify descriptors do not leak across switches.
	watched map[string]struct{}

	// enospcOnce guards the single actionable warning emitted when the inotify
	// watch limit is first hit, so failures do not spam the log per directory.
	enospcOnce sync.Once
}

// logWatchErr logs a failed watch registration. Inotify watch-limit exhaustion
// (ENOSPC) is logged once at warn level with actionable guidance to avoid
// flooding the log with one error per directory; any other error is logged at
// error level as before.
func (w *Watcher) logWatchErr(dir string, err error) {
	if isInotifyExhaustion(err) {
		w.enospcOnce.Do(func() {
			w.logger.WithField("hint", "raise fs.inotify.max_user_watches / fs.inotify.max_user_instances").
				Warn("watcher hit inotify watch limit (ENOSPC); some live updates may be missed until the limit is raised")
		})
		return
	}
	w.logger.WithFields(logrus.Fields{
		"dir":   dir,
		"error": err.Error(),
	}).Error("failed to watch directory")
}

// NewWatcher creates a new Watcher.
func NewWatcher(notifier WatcherNotifier, sink WatcherEventSink, sampleDir string, logger *logrus.Logger) *Watcher {
	return &Watcher{
		notifier:  notifier,
		sink:      sink,
		sampleDir: sampleDir,
		isDir:     OSIsDir,
		logger:    logger.WithField("component", "watcher"),
	}
}

// SetIsDirFunc overrides the directory detection function (for testing).
func (w *Watcher) SetIsDirFunc(fn IsDirFunc) {
	w.isDir = fn
}

// addWatch registers dir with the notifier and records it in the tracked set
// so it can be removed later. Errors are logged and swallowed (a failed Add
// must not be tracked, otherwise we would later Remove a watch that was never
// registered).
func (w *Watcher) addWatch(dir string) error {
	if err := w.notifier.Add(dir); err != nil {
		return err
	}
	w.watchMu.Lock()
	if w.watched == nil {
		w.watched = make(map[string]struct{})
	}
	w.watched[dir] = struct{}{}
	w.watchMu.Unlock()
	return nil
}

// removeAllWatches removes every directory currently registered with the
// notifier and clears the tracked set. This is the leak fix: without it,
// inotify watch descriptors from prior runs accumulate on every run switch.
func (w *Watcher) removeAllWatches() {
	w.watchMu.Lock()
	dirs := make([]string, 0, len(w.watched))
	for dir := range w.watched {
		dirs = append(dirs, dir)
	}
	w.watched = make(map[string]struct{})
	w.watchMu.Unlock()

	for _, dir := range dirs {
		if err := w.notifier.Remove(dir); err != nil {
			w.logger.WithFields(logrus.Fields{
				"dir":   dir,
				"error": err.Error(),
			}).Debug("failed to remove watch on switch")
		}
	}
}

// WatchTrainingRun starts watching directories belonging to the given training run.
// Any previously watched directories are cleared first.
// The study name is derived from run.Name — for study-scoped runs like "study/model",
// checkpoint directories are resolved under sample_dir/study/ rather than sample_dir/.
func (w *Watcher) WatchTrainingRun(run model.TrainingRun) error {
	w.logger.WithField("run_name", run.Name).Trace("entering WatchTrainingRun")
	defer w.logger.Trace("returning from WatchTrainingRun")

	w.mu.Lock()
	defer w.mu.Unlock()

	// Stop any existing watching
	w.stopLocked()

	// Derive the study name from the training run name. For study-scoped runs
	// like "demo-study/demo-model", checkpoint sample directories live under
	// sample_dir/demo-study/ rather than directly under sample_dir/.
	studyName := StudyNameForRun(run.Name)

	// Build the list of directories to watch.
	// For each checkpoint with samples, watch its sample directory.
	dirs := make([]string, 0)
	for _, cp := range run.Checkpoints {
		if cp.HasSamples {
			var dir string
			if studyName != "" {
				dir = filepath.Join(w.sampleDir, studyName, cp.Filename)
			} else {
				dir = filepath.Join(w.sampleDir, cp.Filename)
			}
			dirs = append(dirs, dir)
		}
	}

	// Watch the directory where new checkpoint directories would appear.
	// For study-scoped runs, this is the study directory; for legacy runs, the sample_dir root.
	if studyName != "" {
		dirs = append(dirs, filepath.Join(w.sampleDir, studyName))
	} else {
		dirs = append(dirs, w.sampleDir)
	}

	w.logger.WithFields(logrus.Fields{
		"run_name":  run.Name,
		"dir_count": len(dirs),
	}).Debug("prepared directory watch list")

	for _, dir := range dirs {
		if err := w.addWatch(dir); err != nil {
			w.logWatchErr(dir, err)
		} else {
			w.logger.WithField("dir", dir).Debug("watching directory")
		}
	}

	// Start the event processing loop
	w.done = make(chan struct{})
	w.stopped = make(chan struct{})
	w.watching = true
	go w.loop()

	w.logger.WithField("run_name", run.Name).Info("started watching training run directories")

	return nil
}

// Stop stops watching all directories.
func (w *Watcher) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopLocked()
}

func (w *Watcher) stopLocked() {
	if !w.watching {
		return
	}
	close(w.done)
	<-w.stopped
	w.watching = false
	// The loop goroutine has exited, so no more dynamic watches can be added.
	// Remove every directory the previous run registered to prevent inotify
	// watch descriptors from leaking across run switches.
	w.removeAllWatches()
}

// loop processes fsnotify events and forwards them to the sink.
func (w *Watcher) loop() {
	w.logger.Trace("entering watcher event loop")
	defer close(w.stopped)
	defer w.logger.Trace("exiting watcher event loop")

	for {
		select {
		case <-w.done:
			return
		case ev, ok := <-w.notifier.Events():
			if !ok {
				return
			}
			w.handleEvent(ev)
		case err, ok := <-w.notifier.Errors():
			if !ok {
				return
			}
			w.logger.WithError(err).Error("filesystem watcher error")
		}
	}
}

// handleEvent converts an fsnotify event into a model.FSEvent and broadcasts it.
func (w *Watcher) handleEvent(ev fsnotify.Event) {
	w.logger.WithFields(logrus.Fields{
		"event_name": ev.Name,
		"event_op":   ev.Op.String(),
	}).Trace("entering handleEvent")
	defer w.logger.Trace("returning from handleEvent")

	relPath, err := filepath.Rel(w.sampleDir, ev.Name)
	if err != nil {
		w.logger.WithFields(logrus.Fields{
			"absolute_path": ev.Name,
			"error":         err.Error(),
		}).Error("failed to compute relative path for filesystem event")
		return
	}
	relPath = filepath.ToSlash(relPath)

	w.logger.WithFields(logrus.Fields{
		"event_op":      ev.Op.String(),
		"relative_path": relPath,
	}).Debug("processing filesystem event")

	switch {
	case ev.Op.Has(fsnotify.Create):
		if isPNGFile(ev.Name) {
			w.sink.Broadcast(model.FSEvent{
				Type: model.EventImageAdded,
				Path: relPath,
			})
			w.logger.WithField("image_path", relPath).Info("image added")
		} else if w.isDir(ev.Name) {
			w.sink.Broadcast(model.FSEvent{
				Type: model.EventDirectoryAdded,
				Path: relPath,
			})
			w.logger.WithField("directory_path", relPath).Info("directory added")
			// Watch the new directory for images
			if err := w.addWatch(ev.Name); err != nil {
				w.logWatchErr(ev.Name, err)
			}
		}
	case ev.Op.Has(fsnotify.Remove) || ev.Op.Has(fsnotify.Rename):
		if isPNGFile(ev.Name) {
			w.sink.Broadcast(model.FSEvent{
				Type: model.EventImageRemoved,
				Path: relPath,
			})
			w.logger.WithField("image_path", relPath).Info("image removed")
		}
	}
}

// isPNGFile checks if a path has a .png extension (case-insensitive).
func isPNGFile(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".png")
}
