package service_test

import (
	"io"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeNotifier implements service.WatcherNotifier for testing.
type fakeNotifier struct {
	mu      sync.Mutex
	events  chan fsnotify.Event
	errors  chan error
	added   []string
	removed []string
	closed  bool
}

func newFakeNotifier() *fakeNotifier {
	return &fakeNotifier{
		events:  make(chan fsnotify.Event, 64),
		errors:  make(chan error, 8),
		added:   make([]string, 0),
		removed: make([]string, 0),
	}
}

func (n *fakeNotifier) Add(name string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.added = append(n.added, name)
	return nil
}

func (n *fakeNotifier) Remove(name string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.removed = append(n.removed, name)
	return nil
}

func (n *fakeNotifier) Events() <-chan fsnotify.Event {
	return n.events
}

func (n *fakeNotifier) Errors() <-chan error {
	return n.errors
}

func (n *fakeNotifier) Close() error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.closed = true
	return nil
}

// isWatched reports whether the parent directory of name is currently an active
// watch (added but not removed). Real inotify only delivers events for files
// whose parent directory has a live watch descriptor.
func (n *fakeNotifier) isWatched(name string) bool {
	parent := filepath.Dir(name)
	for _, active := range n.activeWatches() {
		if active == parent || active == name {
			return true
		}
	}
	return false
}

// emit mimics real inotify delivery: an event is only delivered to the loop if
// its directory still has a live watch. Events for removed watches are dropped,
// just as the kernel drops them after IN_IGNORED. Returns true if delivered.
func (n *fakeNotifier) emit(ev fsnotify.Event) bool {
	if !n.isWatched(ev.Name) {
		return false
	}
	n.events <- ev
	return true
}

func (n *fakeNotifier) getAdded() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	cp := make([]string, len(n.added))
	copy(cp, n.added)
	return cp
}

func (n *fakeNotifier) getRemoved() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	cp := make([]string, len(n.removed))
	copy(cp, n.removed)
	return cp
}

// activeWatches returns the set of directories that have been added but not
// subsequently removed — i.e. the watches still live in the notifier. This
// mirrors the inotify watch descriptor set that would leak without the fix.
func (n *fakeNotifier) activeWatches() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	active := make(map[string]int)
	for _, d := range n.added {
		active[d]++
	}
	for _, d := range n.removed {
		active[d]--
	}
	result := make([]string, 0)
	for d, count := range active {
		if count > 0 {
			result = append(result, d)
		}
	}
	return result
}

// fakeEventSink collects broadcast events for test assertions.
type fakeEventSink struct {
	mu     sync.Mutex
	events []model.FSEvent
}

func newFakeEventSink() *fakeEventSink {
	return &fakeEventSink{}
}

func (s *fakeEventSink) Broadcast(event model.FSEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event)
}

func (s *fakeEventSink) getEvents() []model.FSEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]model.FSEvent, len(s.events))
	copy(cp, s.events)
	return cp
}

func (s *fakeEventSink) waitForEvents(count int, timeout time.Duration) []model.FSEvent {
	deadline := time.After(timeout)
	for {
		select {
		case <-deadline:
			return s.getEvents()
		case <-time.After(5 * time.Millisecond):
			events := s.getEvents()
			if len(events) >= count {
				return events
			}
		}
	}
}

var _ = Describe("Watcher", func() {
	var (
		notifier  *fakeNotifier
		sink      *fakeEventSink
		watcher   *service.Watcher
		sampleDir string
		logger    *logrus.Logger
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		notifier = newFakeNotifier()
		sink = newFakeEventSink()
		logger = logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests
		watcher = service.NewWatcher(notifier, sink, sampleDir, logger)
	})

	AfterEach(func() {
		watcher.Stop()
	})

	Describe("WatchTrainingRun", func() {
		It("watches sample directories for checkpoints with samples", func() {
			run := model.TrainingRun{
				Name: "test-model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-step1000.safetensors", HasSamples: true},
					{Filename: "model-step2000.safetensors", HasSamples: false},
					{Filename: "model-step3000.safetensors", HasSamples: true},
				},
			}

			err := watcher.WatchTrainingRun(run)
			Expect(err).NotTo(HaveOccurred())

			added := notifier.getAdded()
			// Should watch: 2 checkpoint sample dirs + sample_dir root
			Expect(added).To(HaveLen(3))
			Expect(added).To(ContainElement("/samples/model-step1000.safetensors"))
			Expect(added).To(ContainElement("/samples/model-step3000.safetensors"))
			Expect(added).To(ContainElement("/samples"))
		})

		It("always watches the sample directory root", func() {
			run := model.TrainingRun{
				Name:        "empty-model",
				Checkpoints: []model.Checkpoint{},
			}

			err := watcher.WatchTrainingRun(run)
			Expect(err).NotTo(HaveOccurred())

			added := notifier.getAdded()
			Expect(added).To(HaveLen(1))
			Expect(added[0]).To(Equal("/samples"))
		})

		// AC: File watcher correctly resolves nested study directory paths for checkpoint watch directories
		It("watches study-scoped sample directories for checkpoints with samples", func() {
			run := model.TrainingRun{
				Name: "demo-study/demo-model",
				Checkpoints: []model.Checkpoint{
					{Filename: "demo-model-step00001000.safetensors", HasSamples: true},
					{Filename: "demo-model-step00002000.safetensors", HasSamples: true},
					{Filename: "demo-model-step00003000.safetensors", HasSamples: false},
				},
			}

			err := watcher.WatchTrainingRun(run)
			Expect(err).NotTo(HaveOccurred())

			added := notifier.getAdded()
			// Should watch: 2 checkpoint sample dirs under study + study dir
			Expect(added).To(HaveLen(3))
			Expect(added).To(ContainElement("/samples/demo-study/demo-model-step00001000.safetensors"))
			Expect(added).To(ContainElement("/samples/demo-study/demo-model-step00002000.safetensors"))
			Expect(added).To(ContainElement("/samples/demo-study"))
		})

		// AC: Selecting the demo training run does not produce 'failed to watch directory' errors
		It("watches the study directory (not sample_dir root) for study-scoped runs with no checkpoints", func() {
			run := model.TrainingRun{
				Name:        "my-study/empty-model",
				Checkpoints: []model.Checkpoint{},
			}

			err := watcher.WatchTrainingRun(run)
			Expect(err).NotTo(HaveOccurred())

			added := notifier.getAdded()
			Expect(added).To(HaveLen(1))
			Expect(added[0]).To(Equal("/samples/my-study"))
		})

		It("stops previous watching when called again", func() {
			run1 := model.TrainingRun{
				Name:        "run1",
				Checkpoints: []model.Checkpoint{},
			}
			run2 := model.TrainingRun{
				Name:        "run2",
				Checkpoints: []model.Checkpoint{},
			}

			err := watcher.WatchTrainingRun(run1)
			Expect(err).NotTo(HaveOccurred())

			err = watcher.WatchTrainingRun(run2)
			Expect(err).NotTo(HaveOccurred())

			// Both runs should have added the sample dir
			added := notifier.getAdded()
			Expect(added).To(HaveLen(2))
		})

		// AC: switching training runs removes all previously-added watches before adding new ones.
		It("removes every previously-added watch when switching runs", func() {
			run1 := model.TrainingRun{
				Name: "study-a/model-a",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-a-step1000.safetensors", HasSamples: true},
					{Filename: "model-a-step2000.safetensors", HasSamples: true},
				},
			}
			run2 := model.TrainingRun{
				Name: "study-b/model-b",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-b-step1000.safetensors", HasSamples: true},
				},
			}

			Expect(watcher.WatchTrainingRun(run1)).To(Succeed())

			run1Dirs := []string{
				"/samples/study-a/model-a-step1000.safetensors",
				"/samples/study-a/model-a-step2000.safetensors",
				"/samples/study-a",
			}

			Expect(watcher.WatchTrainingRun(run2)).To(Succeed())

			// Every directory registered by run1 must have been removed.
			removed := notifier.getRemoved()
			for _, dir := range run1Dirs {
				Expect(removed).To(ContainElement(dir),
					"expected previous-run watch %q to be removed on switch", dir)
			}

			// The live watch set must contain only run2's directories.
			Expect(notifier.activeWatches()).To(ConsistOf(
				"/samples/study-b/model-b-step1000.safetensors",
				"/samples/study-b",
			))
		})

		// AC: the watcher tracks its active watch set; repeated switches do not grow the watch count.
		It("does not grow the active watch set across repeated run switches", func() {
			run := model.TrainingRun{
				Name: "study/model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-step1000.safetensors", HasSamples: true},
					{Filename: "model-step2000.safetensors", HasSamples: true},
				},
			}
			expected := []string{
				"/samples/study/model-step1000.safetensors",
				"/samples/study/model-step2000.safetensors",
				"/samples/study",
			}

			for i := 0; i < 10; i++ {
				Expect(watcher.WatchTrainingRun(run)).To(Succeed())
				Expect(notifier.activeWatches()).To(ConsistOf(expected),
					"active watch set must equal only the current run's dirs after switch %d", i+1)
			}
		})

		// AC: dynamically-added per-image-directory watches are removed on switch.
		It("removes dynamically-added directory watches when switching runs", func() {
			run1 := model.TrainingRun{
				Name:        "run1",
				Checkpoints: []model.Checkpoint{},
			}
			run2 := model.TrainingRun{
				Name:        "run2",
				Checkpoints: []model.Checkpoint{},
			}

			Expect(watcher.WatchTrainingRun(run1)).To(Succeed())

			// A new checkpoint directory appears at runtime and gets a dynamic watch.
			watcher.SetIsDirFunc(func(path string) bool {
				return path == "/samples/dynamic-checkpoint.safetensors"
			})
			notifier.events <- fsnotify.Event{
				Name: "/samples/dynamic-checkpoint.safetensors",
				Op:   fsnotify.Create,
			}
			// Synchronize on the broadcast for the directory_added event.
			sink.waitForEvents(1, time.Second)
			Expect(notifier.activeWatches()).To(ContainElement("/samples/dynamic-checkpoint.safetensors"))

			// Switching runs must remove the dynamic watch too.
			Expect(watcher.WatchTrainingRun(run2)).To(Succeed())
			Expect(notifier.getRemoved()).To(ContainElement("/samples/dynamic-checkpoint.safetensors"))
			Expect(notifier.activeWatches()).To(ConsistOf("/samples"))
		})
	})

	Describe("event handling", func() {
		BeforeEach(func() {
			run := model.TrainingRun{
				Name:        "test",
				Checkpoints: []model.Checkpoint{},
			}
			err := watcher.WatchTrainingRun(run)
			Expect(err).NotTo(HaveOccurred())
		})

		It("broadcasts image_added for new PNG files", func() {
			notifier.events <- fsnotify.Event{
				Name: "/samples/checkpoint.safetensors/image.png",
				Op:   fsnotify.Create,
			}

			events := sink.waitForEvents(1, time.Second)
			Expect(events).To(HaveLen(1))
			Expect(events[0].Type).To(Equal(model.EventImageAdded))
			Expect(events[0].Path).To(Equal("checkpoint.safetensors/image.png"))
		})

		It("broadcasts image_removed for removed PNG files", func() {
			notifier.events <- fsnotify.Event{
				Name: "/samples/checkpoint.safetensors/old.png",
				Op:   fsnotify.Remove,
			}

			events := sink.waitForEvents(1, time.Second)
			Expect(events).To(HaveLen(1))
			Expect(events[0].Type).To(Equal(model.EventImageRemoved))
			Expect(events[0].Path).To(Equal("checkpoint.safetensors/old.png"))
		})

		It("broadcasts image_removed for renamed PNG files", func() {
			notifier.events <- fsnotify.Event{
				Name: "/samples/checkpoint.safetensors/moved.png",
				Op:   fsnotify.Rename,
			}

			events := sink.waitForEvents(1, time.Second)
			Expect(events).To(HaveLen(1))
			Expect(events[0].Type).To(Equal(model.EventImageRemoved))
		})

		It("broadcasts directory_added for new directories", func() {
			// Make isDir return true for the created path
			watcher.SetIsDirFunc(func(path string) bool {
				return path == "/samples/new-checkpoint.safetensors"
			})

			notifier.events <- fsnotify.Event{
				Name: "/samples/new-checkpoint.safetensors",
				Op:   fsnotify.Create,
			}

			events := sink.waitForEvents(1, time.Second)
			Expect(events).To(HaveLen(1))
			Expect(events[0].Type).To(Equal(model.EventDirectoryAdded))
			Expect(events[0].Path).To(Equal("new-checkpoint.safetensors"))
		})

		It("adds a watch on newly created directories", func() {
			watcher.SetIsDirFunc(func(path string) bool {
				return path == "/samples/new-dir"
			})

			notifier.events <- fsnotify.Event{
				Name: "/samples/new-dir",
				Op:   fsnotify.Create,
			}

			// Wait for the event to be processed
			sink.waitForEvents(1, time.Second)

			// The watcher should have added a watch for the new directory
			added := notifier.getAdded()
			Expect(added).To(ContainElement("/samples/new-dir"))
		})

		It("ignores non-PNG file creation events", func() {
			// isDir returns false (it's a file, but not PNG)
			watcher.SetIsDirFunc(func(path string) bool { return false })

			notifier.events <- fsnotify.Event{
				Name: "/samples/checkpoint.safetensors/data.json",
				Op:   fsnotify.Create,
			}

			// Give it time to process
			time.Sleep(50 * time.Millisecond)
			events := sink.getEvents()
			Expect(events).To(BeEmpty())
		})

		It("ignores non-PNG file removal events", func() {
			notifier.events <- fsnotify.Event{
				Name: "/samples/checkpoint.safetensors/data.json",
				Op:   fsnotify.Remove,
			}

			time.Sleep(50 * time.Millisecond)
			events := sink.getEvents()
			Expect(events).To(BeEmpty())
		})

		It("handles Write events without broadcasting", func() {
			notifier.events <- fsnotify.Event{
				Name: "/samples/checkpoint.safetensors/image.png",
				Op:   fsnotify.Write,
			}

			time.Sleep(50 * time.Millisecond)
			events := sink.getEvents()
			Expect(events).To(BeEmpty())
		})

		It("handles case-insensitive PNG extensions", func() {
			notifier.events <- fsnotify.Event{
				Name: "/samples/checkpoint.safetensors/IMAGE.PNG",
				Op:   fsnotify.Create,
			}

			events := sink.waitForEvents(1, time.Second)
			Expect(events).To(HaveLen(1))
			Expect(events[0].Type).To(Equal(model.EventImageAdded))
		})
	})

	// AC: events from the previous run's directories are no longer delivered after a switch.
	Describe("event isolation across run switches", func() {
		It("does not deliver events from the previous run's directories after switching", func() {
			run1 := model.TrainingRun{
				Name: "old-study/old-model",
				Checkpoints: []model.Checkpoint{
					{Filename: "old-model-step1000.safetensors", HasSamples: true},
				},
			}
			run2 := model.TrainingRun{
				Name: "new-study/new-model",
				Checkpoints: []model.Checkpoint{
					{Filename: "new-model-step1000.safetensors", HasSamples: true},
				},
			}

			Expect(watcher.WatchTrainingRun(run1)).To(Succeed())
			Expect(watcher.WatchTrainingRun(run2)).To(Succeed())

			// The previous run's watch is gone, so the fake (like real inotify)
			// drops events for that directory: they never reach the loop.
			oldEvent := fsnotify.Event{
				Name: "/samples/old-study/old-model-step1000.safetensors/stale.png",
				Op:   fsnotify.Create,
			}
			Expect(notifier.emit(oldEvent)).To(BeFalse(),
				"stale event from removed watch must not be delivered")

			// A sentinel event from the current run IS delivered. Waiting for it
			// to be broadcast guarantees the loop has drained the channel, so if
			// the stale event had been delivered it would already be in the sink.
			sentinel := fsnotify.Event{
				Name: "/samples/new-study/new-model-step1000.safetensors/fresh.png",
				Op:   fsnotify.Create,
			}
			Expect(notifier.emit(sentinel)).To(BeTrue())

			events := sink.waitForEvents(1, time.Second)
			Expect(events).To(HaveLen(1))
			Expect(events[0].Type).To(Equal(model.EventImageAdded))
			Expect(events[0].Path).To(Equal("new-study/new-model-step1000.safetensors/fresh.png"))
		})
	})

	Describe("Stop", func() {
		It("can be called without starting a watch", func() {
			// Should not panic
			watcher.Stop()
		})

		It("can be called multiple times", func() {
			run := model.TrainingRun{
				Name:        "test",
				Checkpoints: []model.Checkpoint{},
			}
			err := watcher.WatchTrainingRun(run)
			Expect(err).NotTo(HaveOccurred())

			watcher.Stop()
			watcher.Stop()
		})
	})
})
