package service_test

import (
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

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

func (n *fakeNotifier) getAdded() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	cp := make([]string, len(n.added))
	copy(cp, n.added)
	return cp
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
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		notifier = newFakeNotifier()
		sink = newFakeEventSink()
		watcher = service.NewWatcher(notifier, sink, sampleDir, nil)
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
