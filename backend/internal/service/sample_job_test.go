package service_test

import (
	"database/sql"
	"errors"
	"io"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeSampleJobStore is an in-memory test double for service.SampleJobStore.
type fakeSampleJobStore struct {
	jobs          map[string]model.SampleJob
	items         map[string][]model.SampleJobItem
	presets       map[string]model.SamplePreset
	listJobsErr   error
	getJobErr     error
	createJobErr  error
	updateJobErr  error
	deleteJobErr  error
	listItemsErr  error
	createItemErr error
	updateItemErr error
	getPresetErr  error
}

func newFakeSampleJobStore() *fakeSampleJobStore {
	return &fakeSampleJobStore{
		jobs:    make(map[string]model.SampleJob),
		items:   make(map[string][]model.SampleJobItem),
		presets: make(map[string]model.SamplePreset),
	}
}

func (f *fakeSampleJobStore) ListSampleJobs() ([]model.SampleJob, error) {
	if f.listJobsErr != nil {
		return nil, f.listJobsErr
	}
	var result []model.SampleJob
	for _, j := range f.jobs {
		result = append(result, j)
	}
	return result, nil
}

func (f *fakeSampleJobStore) GetSampleJob(id string) (model.SampleJob, error) {
	if f.getJobErr != nil {
		return model.SampleJob{}, f.getJobErr
	}
	j, ok := f.jobs[id]
	if !ok {
		return model.SampleJob{}, sql.ErrNoRows
	}
	return j, nil
}

func (f *fakeSampleJobStore) CreateSampleJob(j model.SampleJob) error {
	if f.createJobErr != nil {
		return f.createJobErr
	}
	f.jobs[j.ID] = j
	return nil
}

func (f *fakeSampleJobStore) UpdateSampleJob(j model.SampleJob) error {
	if f.updateJobErr != nil {
		return f.updateJobErr
	}
	if _, ok := f.jobs[j.ID]; !ok {
		return sql.ErrNoRows
	}
	f.jobs[j.ID] = j
	return nil
}

func (f *fakeSampleJobStore) DeleteSampleJob(id string) error {
	if f.deleteJobErr != nil {
		return f.deleteJobErr
	}
	if _, ok := f.jobs[id]; !ok {
		return sql.ErrNoRows
	}
	delete(f.jobs, id)
	delete(f.items, id) // Cascade delete items
	return nil
}

func (f *fakeSampleJobStore) ListSampleJobItems(jobID string) ([]model.SampleJobItem, error) {
	if f.listItemsErr != nil {
		return nil, f.listItemsErr
	}
	return f.items[jobID], nil
}

func (f *fakeSampleJobStore) CreateSampleJobItem(i model.SampleJobItem) error {
	if f.createItemErr != nil {
		return f.createItemErr
	}
	f.items[i.JobID] = append(f.items[i.JobID], i)
	return nil
}

func (f *fakeSampleJobStore) UpdateSampleJobItem(i model.SampleJobItem) error {
	if f.updateItemErr != nil {
		return f.updateItemErr
	}
	items := f.items[i.JobID]
	for idx := range items {
		if items[idx].ID == i.ID {
			items[idx] = i
			f.items[i.JobID] = items
			return nil
		}
	}
	return sql.ErrNoRows
}

func (f *fakeSampleJobStore) GetSamplePreset(id string) (model.SamplePreset, error) {
	if f.getPresetErr != nil {
		return model.SamplePreset{}, f.getPresetErr
	}
	p, ok := f.presets[id]
	if !ok {
		return model.SamplePreset{}, sql.ErrNoRows
	}
	return p, nil
}

// fakePathMatcher is a test double for service.PathMatcher.
type fakePathMatcher struct {
	paths     map[string]string
	matchErr  error
}

func newFakePathMatcher() *fakePathMatcher {
	return &fakePathMatcher{paths: make(map[string]string)}
}

func (f *fakePathMatcher) MatchCheckpointPath(filename string) (string, error) {
	if f.matchErr != nil {
		return "", f.matchErr
	}
	path, ok := f.paths[filename]
	if !ok {
		return "", errors.New("checkpoint not found in ComfyUI")
	}
	return path, nil
}

// fakeSampleDirRemover is a test double for service.SampleDirRemover.
type fakeSampleDirRemover struct {
	removed []string
	err     error
}

func (f *fakeSampleDirRemover) RemoveSampleDir(checkpointFilename string) error {
	if f.err != nil {
		return f.err
	}
	f.removed = append(f.removed, checkpointFilename)
	return nil
}

// fakeSampleJobExecutor is a test double for service.SampleJobExecutor.
type fakeSampleJobExecutor struct {
	stopCalled   bool
	resumeCalled bool
	stopErr      error
	resumeErr    error
	connected    bool
}

func newFakeSampleJobExecutor() *fakeSampleJobExecutor {
	return &fakeSampleJobExecutor{
		connected: true, // Default to connected for most tests
	}
}

func (f *fakeSampleJobExecutor) RequestStop(jobID string) error {
	f.stopCalled = true
	return f.stopErr
}

func (f *fakeSampleJobExecutor) RequestResume(jobID string) error {
	f.resumeCalled = true
	return f.resumeErr
}

func (f *fakeSampleJobExecutor) IsConnected() bool {
	return f.connected
}

var _ = Describe("SampleJobService", func() {
	var (
		store       *fakeSampleJobStore
		pathMatcher *fakePathMatcher
		dirRemover  *fakeSampleDirRemover
		executor    *fakeSampleJobExecutor
		svc         *service.SampleJobService
		logger      *logrus.Logger
	)

	BeforeEach(func() {
		store = newFakeSampleJobStore()
		pathMatcher = newFakePathMatcher()
		dirRemover = &fakeSampleDirRemover{}
		executor = newFakeSampleJobExecutor()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
		svc = service.NewSampleJobService(store, pathMatcher, dirRemover, "/samples", logger)
		svc.SetExecutor(executor)
	})

	Describe("Create", func() {
		var (
			samplePreset model.SamplePreset
			checkpoints  []model.Checkpoint
		)

		BeforeEach(func() {
			samplePreset = model.SamplePreset{
				ID:             "preset-1",
				Name:           "Test Preset",
				Prompts:        []model.NamedPrompt{{Name: "prompt1", Text: "text1"}, {Name: "prompt2", Text: "text2"}},
				NegativePrompt: "bad",
				Steps:          []int{1, 4},
				CFGs:           []float64{1.0, 3.0},
				Samplers:       []string{"euler"},
				Schedulers:     []string{"simple"},
				Seeds:          []int64{420},
			}
			store.presets[samplePreset.ID] = samplePreset

			checkpoints = []model.Checkpoint{
				{Filename: "checkpoint1.safetensors", StepNumber: 1000},
				{Filename: "checkpoint2.safetensors", StepNumber: 2000},
			}

			pathMatcher.paths["checkpoint1.safetensors"] = "models/checkpoint1.safetensors"
			pathMatcher.paths["checkpoint2.safetensors"] = "models/checkpoint2.safetensors"
		})

		It("creates a job and expands items correctly", func() {
			shift := 1.5
			job, err := svc.Create("test-run", checkpoints, "preset-1", "workflow.json", "vae.safetensors", "clip.safetensors", &shift, nil, false)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.ID).NotTo(BeEmpty())
			Expect(job.TrainingRunName).To(Equal("test-run"))
			Expect(job.SamplePresetID).To(Equal("preset-1"))
			Expect(job.WorkflowName).To(Equal("workflow.json"))
			Expect(job.VAE).To(Equal("vae.safetensors"))
			Expect(job.CLIP).To(Equal("clip.safetensors"))
			Expect(job.Shift).NotTo(BeNil())
			Expect(*job.Shift).To(Equal(1.5))
			Expect(job.Status).To(Equal(model.SampleJobStatusPending))

			// Total items = 2 checkpoints × (2 prompts × 2 steps × 2 cfgs × 1 sampler × 1 scheduler × 1 seed) = 2 × 8 = 16
			Expect(job.TotalItems).To(Equal(16))
			Expect(job.CompletedItems).To(Equal(0))

			// Verify items were created
			items := store.items[job.ID]
			Expect(items).To(HaveLen(16))

			// Verify checkpoint path matching
			for _, item := range items {
				Expect(item.ComfyUIModelPath).NotTo(BeEmpty())
				Expect(item.Status).To(Equal(model.SampleJobItemStatusPending))
			}
		})

		It("calculates total items correctly", func() {
			job, err := svc.Create("test-run", checkpoints, "preset-1", "workflow.json", "", "", nil, nil, false)
			Expect(err).NotTo(HaveOccurred())

			// 2 checkpoints × 2 prompts × 2 steps × 2 cfgs × 1 sampler × 1 scheduler × 1 seed = 16
			Expect(job.TotalItems).To(Equal(16))
		})

		It("returns error when preset not found", func() {
			_, err := svc.Create("test-run", checkpoints, "nonexistent", "workflow.json", "", "", nil, nil, false)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("marks items as skipped when checkpoint path matching fails", func() {
			pathMatcher.paths = make(map[string]string) // Clear paths to simulate no matches

			job, err := svc.Create("test-run", checkpoints, "preset-1", "workflow.json", "", "", nil, nil, false)
			Expect(err).NotTo(HaveOccurred())

			items := store.items[job.ID]
			Expect(items).To(HaveLen(16))
			for _, item := range items {
				Expect(item.Status).To(Equal(model.SampleJobItemStatusSkipped))
				Expect(item.ErrorMessage).To(ContainSubstring("checkpoint not found in ComfyUI"))
			}
		})

		It("handles nil shift parameter", func() {
			job, err := svc.Create("test-run", checkpoints, "preset-1", "workflow.json", "", "", nil, nil, false)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.Shift).To(BeNil())
		})

		DescribeTable("filters checkpoints by checkpoint_filenames when provided",
			func(filenames []string, expectedCount int) {
				job, err := svc.Create("test-run", checkpoints, "preset-1", "workflow.json", "", "", nil, filenames, false)
				Expect(err).NotTo(HaveOccurred())
				// Each checkpoint produces 8 items (2 prompts × 2 steps × 2 cfgs × 1 sampler × 1 scheduler × 1 seed)
				Expect(job.TotalItems).To(Equal(expectedCount * 8))
				items := store.items[job.ID]
				Expect(items).To(HaveLen(expectedCount * 8))
			},
			Entry("nil filter uses all checkpoints", nil, 2),
			Entry("empty filter uses all checkpoints", []string{}, 2),
			Entry("single checkpoint filter", []string{"checkpoint1.safetensors"}, 1),
			Entry("both checkpoints listed", []string{"checkpoint1.safetensors", "checkpoint2.safetensors"}, 2),
			Entry("nonexistent filename results in empty job", []string{"nonexistent.safetensors"}, 0),
		)

		It("clears existing sample directories when clear_existing is true", func() {
			dirRemover.removed = nil
			_, err := svc.Create("test-run", checkpoints, "preset-1", "workflow.json", "", "", nil, nil, true)
			Expect(err).NotTo(HaveOccurred())
			// Both checkpoints should have been cleared
			Expect(dirRemover.removed).To(ConsistOf("checkpoint1.safetensors", "checkpoint2.safetensors"))
		})

		It("clears only the filtered checkpoints when both checkpoint_filenames and clear_existing are set", func() {
			dirRemover.removed = nil
			_, err := svc.Create("test-run", checkpoints, "preset-1", "workflow.json", "", "", nil, []string{"checkpoint1.safetensors"}, true)
			Expect(err).NotTo(HaveOccurred())
			// Only checkpoint1 should have been cleared
			Expect(dirRemover.removed).To(ConsistOf("checkpoint1.safetensors"))
		})

		It("does not clear directories when clear_existing is false", func() {
			dirRemover.removed = nil
			_, err := svc.Create("test-run", checkpoints, "preset-1", "workflow.json", "", "", nil, nil, false)
			Expect(err).NotTo(HaveOccurred())
			Expect(dirRemover.removed).To(BeEmpty())
		})
	})

	Describe("Get", func() {
		It("returns a job by ID", func() {
			job := model.SampleJob{
				ID:              "job-1",
				TrainingRunName: "test-run",
				Status:          model.SampleJobStatusPending,
			}
			store.jobs[job.ID] = job

			result, err := svc.Get("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.ID).To(Equal("job-1"))
		})

		It("returns error when job not found", func() {
			_, err := svc.Get("nonexistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})

	Describe("Start", func() {
		It("transitions pending job to running", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusPending,
			}
			store.jobs[job.ID] = job

			result, err := svc.Start("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Status).To(Equal(model.SampleJobStatusRunning))

			// Verify the job was updated in the store
			updated, err := svc.Get("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(updated.Status).To(Equal(model.SampleJobStatusRunning))
		})

		It("returns error when ComfyUI is not connected", func() {
			executor.connected = false
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusPending,
			}
			store.jobs[job.ID] = job

			_, err := svc.Start("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("ComfyUI not connected"))
		})

		It("returns error when job not found", func() {
			_, err := svc.Start("nonexistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns error when job is not pending", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusRunning,
			}
			store.jobs[job.ID] = job

			_, err := svc.Start("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("cannot start job"))
		})
	})

	Describe("List", func() {
		It("returns all jobs", func() {
			store.jobs["job-1"] = model.SampleJob{ID: "job-1"}
			store.jobs["job-2"] = model.SampleJob{ID: "job-2"}

			result, err := svc.List()
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
		})

		It("returns empty slice when no jobs exist", func() {
			result, err := svc.List()
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})
	})

	Describe("Stop", func() {
		It("transitions running job to stopped", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusRunning,
			}
			store.jobs[job.ID] = job

			result, err := svc.Stop("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Status).To(Equal(model.SampleJobStatusStopped))
		})

		It("returns error when job is not running", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusPending,
			}
			store.jobs[job.ID] = job

			_, err := svc.Stop("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("cannot stop job"))
		})

		It("returns error when job not found", func() {
			_, err := svc.Stop("nonexistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})

	Describe("Resume", func() {
		It("transitions stopped job to running", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusStopped,
			}
			store.jobs[job.ID] = job

			result, err := svc.Resume("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Status).To(Equal(model.SampleJobStatusRunning))
		})

		It("returns error when job is not stopped", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusRunning,
			}
			store.jobs[job.ID] = job

			_, err := svc.Resume("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("cannot resume job"))
		})

		It("returns error when job not found", func() {
			_, err := svc.Resume("nonexistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})

	Describe("Delete", func() {
		It("deletes a job", func() {
			job := model.SampleJob{ID: "job-1"}
			store.jobs[job.ID] = job

			err := svc.Delete("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(store.jobs).NotTo(HaveKey("job-1"))
		})

		It("returns error when job not found", func() {
			err := svc.Delete("nonexistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})

	Describe("GetItemCounts", func() {
		It("computes counts with mixed item statuses", func() {
			job := model.SampleJob{ID: "job-counts", TotalItems: 6}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, Status: model.SampleJobItemStatusCompleted},
				{ID: "i3", JobID: job.ID, Status: model.SampleJobItemStatusFailed},
				{ID: "i4", JobID: job.ID, Status: model.SampleJobItemStatusPending},
				{ID: "i5", JobID: job.ID, Status: model.SampleJobItemStatusPending},
				{ID: "i6", JobID: job.ID, Status: model.SampleJobItemStatusRunning}, // running items are not counted in any bucket
			}

			counts, err := svc.GetItemCounts("job-counts")
			Expect(err).NotTo(HaveOccurred())
			Expect(counts.Completed).To(Equal(2))
			Expect(counts.Failed).To(Equal(1))
			Expect(counts.Pending).To(Equal(2))
		})

		It("returns zero counts for a job with no items", func() {
			job := model.SampleJob{ID: "job-empty", TotalItems: 0}
			store.jobs[job.ID] = job

			counts, err := svc.GetItemCounts("job-empty")
			Expect(err).NotTo(HaveOccurred())
			Expect(counts.Completed).To(Equal(0))
			Expect(counts.Failed).To(Equal(0))
			Expect(counts.Pending).To(Equal(0))
		})

		It("returns error when list items fails", func() {
			store.listItemsErr = errors.New("db error")
			_, err := svc.GetItemCounts("any-id")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("listing sample job items"))
		})
	})

	Describe("GetProgress", func() {
		It("computes progress metrics correctly", func() {
			job := model.SampleJob{
				ID:         "job-1",
				TotalItems: 16,
			}
			store.jobs[job.ID] = job

			// 2 checkpoints, 8 items each
			// Checkpoint 1: all 8 items completed
			// Checkpoint 2: 3 of 8 items completed
			for i := 0; i < 8; i++ {
				store.items[job.ID] = append(store.items[job.ID], model.SampleJobItem{
					ID:                 "item-1-" + string(rune(i)),
					JobID:              job.ID,
					CheckpointFilename: "checkpoint1.safetensors",
					Status:             model.SampleJobItemStatusCompleted,
				})
			}
			for i := 0; i < 8; i++ {
				status := model.SampleJobItemStatusPending
				if i < 3 {
					status = model.SampleJobItemStatusCompleted
				}
				store.items[job.ID] = append(store.items[job.ID], model.SampleJobItem{
					ID:                 "item-2-" + string(rune(i)),
					JobID:              job.ID,
					CheckpointFilename: "checkpoint2.safetensors",
					Status:             status,
				})
			}

			progress, err := svc.GetProgress("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(progress.TotalCheckpoints).To(Equal(2))
			Expect(progress.CheckpointsCompleted).To(Equal(1))
			Expect(progress.CurrentCheckpoint).To(Equal("checkpoint2.safetensors"))
			Expect(progress.CurrentCheckpointProgress).To(Equal(3))
			Expect(progress.CurrentCheckpointTotal).To(Equal(8))
		})

		It("returns error when job not found", func() {
			_, err := svc.GetProgress("nonexistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("populates item counts in progress", func() {
			job := model.SampleJob{ID: "job-counts", TotalItems: 4}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusFailed, ErrorMessage: "VRAM overflow"},
				{ID: "i3", JobID: job.ID, CheckpointFilename: "chk2.safetensors", Status: model.SampleJobItemStatusPending},
				{ID: "i4", JobID: job.ID, CheckpointFilename: "chk2.safetensors", Status: model.SampleJobItemStatusPending},
			}

			progress, err := svc.GetProgress("job-counts")
			Expect(err).NotTo(HaveOccurred())
			Expect(progress.ItemCounts.Completed).To(Equal(1))
			Expect(progress.ItemCounts.Failed).To(Equal(1))
			Expect(progress.ItemCounts.Pending).To(Equal(2))
		})

		It("populates failed item details grouped by checkpoint", func() {
			job := model.SampleJob{ID: "job-details", TotalItems: 4}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk-a.safetensors", Status: model.SampleJobItemStatusFailed, ErrorMessage: "VRAM overflow"},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk-a.safetensors", Status: model.SampleJobItemStatusFailed, ErrorMessage: "VRAM overflow"},
				{ID: "i3", JobID: job.ID, CheckpointFilename: "chk-b.safetensors", Status: model.SampleJobItemStatusFailed, ErrorMessage: "timeout expired"},
				{ID: "i4", JobID: job.ID, CheckpointFilename: "chk-c.safetensors", Status: model.SampleJobItemStatusCompleted},
			}

			progress, err := svc.GetProgress("job-details")
			Expect(err).NotTo(HaveOccurred())

			// Should have 2 failed item details (chk-a with VRAM overflow, chk-b with timeout)
			Expect(progress.FailedItemDetails).To(HaveLen(2))

			// Build a map for deterministic assertion
			detailMap := make(map[string]string)
			for _, d := range progress.FailedItemDetails {
				detailMap[d.CheckpointFilename] = d.ErrorMessage
			}
			Expect(detailMap).To(HaveKey("chk-a.safetensors"))
			Expect(detailMap["chk-a.safetensors"]).To(Equal("VRAM overflow"))
			Expect(detailMap).To(HaveKey("chk-b.safetensors"))
			Expect(detailMap["chk-b.safetensors"]).To(Equal("timeout expired"))

			// chk-c should not appear (no failures)
			Expect(detailMap).NotTo(HaveKey("chk-c.safetensors"))
		})

		It("returns empty failed item details when no items have failed", func() {
			job := model.SampleJob{ID: "job-no-fail", TotalItems: 2}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
			}

			progress, err := svc.GetProgress("job-no-fail")
			Expect(err).NotTo(HaveOccurred())
			Expect(progress.FailedItemDetails).To(BeEmpty())
			Expect(progress.FailedItemDetails).NotTo(BeNil())
		})

		It("includes checkpoint with unknown error when failed item has no error message", func() {
			job := model.SampleJob{ID: "job-no-msg", TotalItems: 1}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusFailed, ErrorMessage: ""},
			}

			progress, err := svc.GetProgress("job-no-msg")
			Expect(err).NotTo(HaveOccurred())
			Expect(progress.FailedItemDetails).To(HaveLen(1))
			Expect(progress.FailedItemDetails[0].CheckpointFilename).To(Equal("chk1.safetensors"))
			Expect(progress.FailedItemDetails[0].ErrorMessage).To(Equal("unknown error"))
		})
	})
})
