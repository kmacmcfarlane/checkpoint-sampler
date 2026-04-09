package service_test

import (
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fsnotify/fsnotify"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeDiscoverer implements service.FSStateDiscoverer.
type fakeDiscoverer struct {
	runs []model.TrainingRun
	err  error
	// callCount tracks how many times Discover was called.
	// Uses atomic.Int32 to avoid data races between the watchLoop goroutine
	// (which increments) and the test goroutine (which reads via Eventually).
	callCount atomic.Int32
}

func (f *fakeDiscoverer) Discover() ([]model.TrainingRun, error) {
	f.callCount.Add(1)
	return f.runs, f.err
}

// fakeViewerDiscoverer implements service.FSStateViewerDiscoverer.
type fakeViewerDiscoverer struct {
	runs      []model.TrainingRun
	err       error
	callCount atomic.Int32
}

func (f *fakeViewerDiscoverer) DiscoverViewable() ([]model.TrainingRun, error) {
	f.callCount.Add(1)
	return f.runs, f.err
}

// fakeFSStateNotifier implements service.WatcherNotifier for testing FSState watching.
type fakeFSStateNotifier struct {
	events  chan fsnotify.Event
	errors  chan error
	added   []string
	removed []string
	mu      sync.Mutex
}

func newFakeFSStateNotifier() *fakeFSStateNotifier {
	return &fakeFSStateNotifier{
		events: make(chan fsnotify.Event, 10),
		errors: make(chan error, 10),
	}
}

func (f *fakeFSStateNotifier) Add(name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.added = append(f.added, name)
	return nil
}

func (f *fakeFSStateNotifier) Remove(name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removed = append(f.removed, name)
	return nil
}

func (f *fakeFSStateNotifier) addedPaths() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := make([]string, len(f.added))
	copy(result, f.added)
	return result
}

func (f *fakeFSStateNotifier) removedPaths() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := make([]string, len(f.removed))
	copy(result, f.removed)
	return result
}

func (f *fakeFSStateNotifier) Events() <-chan fsnotify.Event { return f.events }
func (f *fakeFSStateNotifier) Errors() <-chan error          { return f.errors }
func (f *fakeFSStateNotifier) Close() error {
	close(f.events)
	close(f.errors)
	return nil
}

var _ = Describe("FSState", func() {
	var (
		cpDisc     *fakeDiscoverer
		viewerDisc *fakeViewerDiscoverer
		logger     *logrus.Logger
	)

	BeforeEach(func() {
		cpDisc = &fakeDiscoverer{
			runs: []model.TrainingRun{
				{Name: "model-a", HasSamples: true},
				{Name: "model-b", HasSamples: false},
			},
		}
		viewerDisc = &fakeViewerDiscoverer{
			runs: []model.TrainingRun{
				{Name: "study/model-a", HasSamples: true},
			},
		}
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	Describe("Populate", func() {
		It("caches training runs from both discovery sources", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			err := state.Populate()
			Expect(err).NotTo(HaveOccurred())

			cpRuns := state.CheckpointRuns()
			Expect(cpRuns).To(HaveLen(2))
			Expect(cpRuns[0].Name).To(Equal("model-a"))
			Expect(cpRuns[1].Name).To(Equal("model-b"))

			viewRuns := state.ViewableRuns()
			Expect(viewRuns).To(HaveLen(1))
			Expect(viewRuns[0].Name).To(Equal("study/model-a"))
		})

		It("returns error when checkpoint discovery fails", func() {
			cpDisc.err = fmt.Errorf("disk error")
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			err := state.Populate()
			Expect(err).To(MatchError(ContainSubstring("disk error")))
		})

		It("returns error when viewer discovery fails", func() {
			viewerDisc.err = fmt.Errorf("viewer error")
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			err := state.Populate()
			Expect(err).To(MatchError(ContainSubstring("viewer error")))
		})

		It("returns empty slices before Populate is called", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			Expect(state.CheckpointRuns()).To(BeEmpty())
			Expect(state.ViewableRuns()).To(BeEmpty())
		})
	})

	Describe("CheckpointRuns and ViewableRuns", func() {
		It("returns defensive copies that do not mutate the snapshot", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			Expect(state.Populate()).To(Succeed())

			cpRuns := state.CheckpointRuns()
			cpRuns[0].Name = "mutated"
			Expect(state.CheckpointRuns()[0].Name).To(Equal("model-a"))
		})
	})

	Describe("StartWatching", func() {
		It("watches the specified directories", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			// Use a no-op walkDirs that returns no subdirectories (default behavior for empty dirs).
			state.SetWalkDirFunc(func(root string) ([]string, error) { return nil, nil })
			Expect(state.Populate()).To(Succeed())

			notifier := newFakeFSStateNotifier()
			state.StartWatching(notifier, []string{"/samples", "/checkpoints"})
			defer state.Stop()

			Expect(notifier.addedPaths()).To(ConsistOf("/samples", "/checkpoints"))
		})

		It("recursively walks existing subdirectories and adds them to the watcher", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			state.SetWalkDirFunc(func(root string) ([]string, error) {
				if root == "/samples" {
					return []string{"/samples/model-a", "/samples/model-a/study1"}, nil
				}
				return nil, nil
			})
			Expect(state.Populate()).To(Succeed())

			notifier := newFakeFSStateNotifier()
			state.StartWatching(notifier, []string{"/samples"})
			defer state.Stop()

			Expect(notifier.addedPaths()).To(ConsistOf(
				"/samples",
				"/samples/model-a",
				"/samples/model-a/study1",
			))
		})

		It("refreshes snapshot on directory create events", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			state.SetDebounce(50 * time.Millisecond)
			state.SetWalkDirFunc(func(root string) ([]string, error) { return nil, nil })
			state.SetIsDirFunc(func(path string) bool { return false })
			Expect(state.Populate()).To(Succeed())
			Expect(cpDisc.callCount.Load()).To(Equal(int32(1)))

			notifier := newFakeFSStateNotifier()
			state.StartWatching(notifier, []string{"/samples"})
			defer state.Stop()

			// Update what discovery returns for the next refresh.
			cpDisc.runs = []model.TrainingRun{
				{Name: "model-a", HasSamples: true},
				{Name: "model-b", HasSamples: false},
				{Name: "model-c", HasSamples: true},
			}

			// Send a directory create event.
			notifier.events <- fsnotify.Event{
				Name: "/samples/new-dir",
				Op:   fsnotify.Create,
			}

			// Wait for debounce + refresh.
			Eventually(func() int {
				return len(state.CheckpointRuns())
			}, 2*time.Second, 50*time.Millisecond).Should(Equal(3))
		})

		It("debounces rapid filesystem events", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			state.SetDebounce(100 * time.Millisecond)
			state.SetWalkDirFunc(func(root string) ([]string, error) { return nil, nil })
			state.SetIsDirFunc(func(path string) bool { return false })
			Expect(state.Populate()).To(Succeed())

			notifier := newFakeFSStateNotifier()
			state.StartWatching(notifier, []string{"/samples"})
			defer state.Stop()

			// Send 5 rapid events.
			for i := 0; i < 5; i++ {
				notifier.events <- fsnotify.Event{
					Name: fmt.Sprintf("/samples/dir-%d", i),
					Op:   fsnotify.Create,
				}
			}

			// Wait for debounce to complete and refresh to happen.
			Eventually(func() int32 {
				return cpDisc.callCount.Load()
			}, 2*time.Second, 50*time.Millisecond).Should(BeNumerically(">=", int32(2)))

			// Should be 2 (initial + one debounced refresh), not 6.
			Expect(cpDisc.callCount.Load()).To(BeNumerically("<=", int32(3)))
		})

		It("ignores write-only events", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			state.SetDebounce(50 * time.Millisecond)
			state.SetWalkDirFunc(func(root string) ([]string, error) { return nil, nil })
			Expect(state.Populate()).To(Succeed())

			notifier := newFakeFSStateNotifier()
			state.StartWatching(notifier, []string{"/samples"})
			defer state.Stop()

			// Send a Write event (should be ignored).
			notifier.events <- fsnotify.Event{
				Name: "/samples/file.txt",
				Op:   fsnotify.Write,
			}

			// Verify that no refresh occurs over the observation window.
			Consistently(func() int32 {
				return cpDisc.callCount.Load()
			}, 200*time.Millisecond, 50*time.Millisecond).Should(Equal(int32(1))) // Only the initial Populate.
		})

		It("dynamically watches newly created directories", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			state.SetDebounce(50 * time.Millisecond)
			state.SetWalkDirFunc(func(root string) ([]string, error) { return nil, nil })
			state.SetIsDirFunc(func(path string) bool {
				return path == "/samples/new-model"
			})
			Expect(state.Populate()).To(Succeed())

			notifier := newFakeFSStateNotifier()
			state.StartWatching(notifier, []string{"/samples"})
			defer state.Stop()

			// Send a create event for a new directory.
			notifier.events <- fsnotify.Event{
				Name: "/samples/new-model",
				Op:   fsnotify.Create,
			}

			// The new directory should be dynamically added to the watcher.
			Eventually(func() []string {
				return notifier.addedPaths()
			}, 2*time.Second, 50*time.Millisecond).Should(ContainElement("/samples/new-model"))
		})

		It("dynamically watches subdirectories of newly created directories", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			state.SetDebounce(50 * time.Millisecond)
			// walkDirs returns a nested subdirectory for the newly created dir.
			state.SetWalkDirFunc(func(root string) ([]string, error) {
				if root == "/samples/new-model" {
					return []string{"/samples/new-model/study1"}, nil
				}
				return nil, nil
			})
			state.SetIsDirFunc(func(path string) bool {
				return path == "/samples/new-model"
			})
			Expect(state.Populate()).To(Succeed())

			notifier := newFakeFSStateNotifier()
			state.StartWatching(notifier, []string{"/samples"})
			defer state.Stop()

			// Send a create event for the new directory.
			notifier.events <- fsnotify.Event{
				Name: "/samples/new-model",
				Op:   fsnotify.Create,
			}

			// Both the new directory and its subdirectory should be watched.
			Eventually(func() []string {
				return notifier.addedPaths()
			}, 2*time.Second, 50*time.Millisecond).Should(ContainElements(
				"/samples/new-model",
				"/samples/new-model/study1",
			))
		})

		It("removes watch when a directory is deleted", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			state.SetDebounce(50 * time.Millisecond)
			state.SetWalkDirFunc(func(root string) ([]string, error) { return nil, nil })
			Expect(state.Populate()).To(Succeed())

			notifier := newFakeFSStateNotifier()
			state.StartWatching(notifier, []string{"/samples"})
			defer state.Stop()

			// Send a remove event.
			notifier.events <- fsnotify.Event{
				Name: "/samples/old-model",
				Op:   fsnotify.Remove,
			}

			// The removed path should be passed to notifier.Remove.
			Eventually(func() []string {
				return notifier.removedPaths()
			}, 2*time.Second, 50*time.Millisecond).Should(ContainElement("/samples/old-model"))
		})

		It("removes watch when a directory is renamed", func() {
			state := service.NewFSState(cpDisc, viewerDisc, logger)
			state.SetDebounce(50 * time.Millisecond)
			state.SetWalkDirFunc(func(root string) ([]string, error) { return nil, nil })
			Expect(state.Populate()).To(Succeed())

			notifier := newFakeFSStateNotifier()
			state.StartWatching(notifier, []string{"/samples"})
			defer state.Stop()

			// Send a rename event.
			notifier.events <- fsnotify.Event{
				Name: "/samples/renamed-model",
				Op:   fsnotify.Rename,
			}

			// The renamed path should be passed to notifier.Remove.
			Eventually(func() []string {
				return notifier.removedPaths()
			}, 2*time.Second, 50*time.Millisecond).Should(ContainElement("/samples/renamed-model"))
		})
	})
})
