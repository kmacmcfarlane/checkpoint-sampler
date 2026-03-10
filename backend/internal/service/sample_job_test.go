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
	jobs             map[string]model.SampleJob
	items            map[string][]model.SampleJobItem
	studies          map[string]model.Study
	listJobsErr      error
	getJobErr        error
	hasRunningJobErr error
	createJobErr     error
	updateJobErr     error
	deleteJobErr     error
	listItemsErr     error
	createItemErr    error
	updateItemErr    error
	getStudyErr      error
}

func newFakeSampleJobStore() *fakeSampleJobStore {
	return &fakeSampleJobStore{
		jobs:    make(map[string]model.SampleJob),
		items:   make(map[string][]model.SampleJobItem),
		studies: make(map[string]model.Study),
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

func (f *fakeSampleJobStore) HasRunningJob() (bool, error) {
	if f.hasRunningJobErr != nil {
		return false, f.hasRunningJobErr
	}
	for _, j := range f.jobs {
		if j.Status == model.SampleJobStatusRunning {
			return true, nil
		}
	}
	return false, nil
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

func (f *fakeSampleJobStore) GetStudy(id string) (model.Study, error) {
	if f.getStudyErr != nil {
		return model.Study{}, f.getStudyErr
	}
	s, ok := f.studies[id]
	if !ok {
		return model.Study{}, sql.ErrNoRows
	}
	return s, nil
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

// fakeJobSampleDataRemover is a test double for service.JobSampleDataRemover.
type fakeJobSampleDataRemover struct {
	removed []struct{ studyName, checkpointFilename string }
	err     error
}

func (f *fakeJobSampleDataRemover) RemoveJobSampleDir(studyName string, checkpointFilename string) error {
	if f.err != nil {
		return f.err
	}
	f.removed = append(f.removed, struct{ studyName, checkpointFilename string }{studyName, checkpointFilename})
	return nil
}

// fakeOutputFileChecker is a test double for service.OutputFileChecker.
type fakeOutputFileChecker struct {
	existingFiles map[string]bool
}

func newFakeOutputFileChecker() *fakeOutputFileChecker {
	return &fakeOutputFileChecker{existingFiles: make(map[string]bool)}
}

func (f *fakeOutputFileChecker) FileExists(path string) bool {
	return f.existingFiles[path]
}

// fakeSampleJobExecutor is a test double for service.SampleJobExecutor.
// It simulates the executor's contract: RequestStop both signals the stop AND
// updates the DB status to stopped (mirroring the real JobExecutor.RequestStop).
type fakeSampleJobExecutor struct {
	stopCalled   bool
	resumeCalled bool
	stopErr      error
	resumeErr    error
	connected    bool
	// store is optional; when set, RequestStop will write the stopped status to the
	// store to simulate the executor owning the DB transition.
	store        *fakeSampleJobStore
}

func newFakeSampleJobExecutor() *fakeSampleJobExecutor {
	return &fakeSampleJobExecutor{
		connected: true, // Default to connected for most tests
	}
}

func (f *fakeSampleJobExecutor) RequestStop(jobID string) error {
	f.stopCalled = true
	if f.stopErr != nil {
		return f.stopErr
	}
	// Simulate the executor's DB ownership: update the job status to stopped.
	if f.store != nil {
		if job, ok := f.store.jobs[jobID]; ok {
			job.Status = model.SampleJobStatusStopped
			f.store.jobs[jobID] = job
		}
	}
	return nil
}

func (f *fakeSampleJobExecutor) RequestResume(jobID string) error {
	f.resumeCalled = true
	return f.resumeErr
}

func (f *fakeSampleJobExecutor) IsConnected() bool {
	return f.connected
}

var _ = Describe("GenerateOutputFilename", func() {
	It("produces a consistent query-encoded filename", func() {
		item := model.SampleJobItem{
			PromptName:  "forest",
			Steps:       20,
			CFG:         7.0,
			SamplerName: "euler",
			Scheduler:   "simple",
			Seed:        420,
		}
		result := service.GenerateOutputFilename(item)
		// url.Values.Encode() sorts by key alphabetically
		Expect(result).To(Equal("cfg=7.0&prompt=forest&sampler=euler&scheduler=simple&seed=420&steps=20.png"))
	})

	It("handles floating-point CFG values", func() {
		item := model.SampleJobItem{
			PromptName:  "test",
			Steps:       1,
			CFG:         3.5,
			SamplerName: "euler",
			Scheduler:   "normal",
			Seed:        0,
		}
		result := service.GenerateOutputFilename(item)
		Expect(result).To(ContainSubstring("cfg=3.5"))
	})
})

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
		// Wire the store so the fake executor can simulate the DB ownership contract.
		executor.store = store
		logger = logrus.New()
		logger.SetOutput(io.Discard)
		svc = service.NewSampleJobService(store, pathMatcher, dirRemover, "/samples", logger)
		svc.SetExecutor(executor)
	})

	Describe("Create", func() {
		var (
			study       model.Study
			checkpoints []model.Checkpoint
		)

		BeforeEach(func() {
			shift := 1.5
			study = model.Study{
				ID:             "study-1",
				Name:           "Test Study",
				Prompts:        []model.NamedPrompt{{Name: "prompt1", Text: "text1"}, {Name: "prompt2", Text: "text2"}},
				NegativePrompt: "bad",
				Steps:          []int{1, 4},
				CFGs:           []float64{1.0, 3.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "simple"},
				},
				Seeds:            []int64{420},
				WorkflowTemplate: "workflow.json",
				VAE:              "vae.safetensors",
				TextEncoder:      "clip.safetensors",
				Shift:            &shift,
			}
			store.studies[study.ID] = study

			checkpoints = []model.Checkpoint{
				{Filename: "checkpoint1.safetensors", StepNumber: 1000},
				{Filename: "checkpoint2.safetensors", StepNumber: 2000},
			}

			pathMatcher.paths["checkpoint1.safetensors"] = "models/checkpoint1.safetensors"
			pathMatcher.paths["checkpoint2.safetensors"] = "models/checkpoint2.safetensors"
		})

		It("creates a job and expands items correctly", func() {
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.ID).NotTo(BeEmpty())
			Expect(job.TrainingRunName).To(Equal("test-run"))
			Expect(job.StudyID).To(Equal("study-1"))
			Expect(job.WorkflowName).To(Equal("workflow.json"))
			Expect(job.VAE).To(Equal("vae.safetensors"))
			Expect(job.CLIP).To(Equal("clip.safetensors"))
			Expect(job.Shift).NotTo(BeNil())
			Expect(*job.Shift).To(Equal(1.5))
			Expect(job.Status).To(Equal(model.SampleJobStatusPending))

			// Total items = 2 checkpoints × (2 prompts × 2 steps × 2 cfgs × 1 pair × 1 seed) = 2 × 8 = 16
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
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false)
			Expect(err).NotTo(HaveOccurred())

			// 2 checkpoints × 2 prompts × 2 steps × 2 cfgs × 1 pair × 1 seed = 16
			Expect(job.TotalItems).To(Equal(16))
		})

		It("returns error when study not found", func() {
			_, err := svc.Create("test-run", checkpoints, "nonexistent", nil, false, false)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("marks items as skipped when checkpoint path matching fails", func() {
			pathMatcher.paths = make(map[string]string) // Clear paths to simulate no matches

			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false)
			Expect(err).NotTo(HaveOccurred())

			items := store.items[job.ID]
			Expect(items).To(HaveLen(16))
			for _, item := range items {
				Expect(item.Status).To(Equal(model.SampleJobItemStatusSkipped))
				Expect(item.ErrorMessage).To(ContainSubstring("checkpoint not found in ComfyUI"))
			}
		})

		It("uses shift from study when study has a shift value", func() {
			// The study set up in BeforeEach has Shift = &1.5
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.Shift).NotTo(BeNil())
			Expect(*job.Shift).To(Equal(1.5))
		})

		It("has nil shift when study has no shift", func() {
			// Modify the study to have no shift
			studyNoShift := store.studies["study-1"]
			studyNoShift.Shift = nil
			store.studies["study-1"] = studyNoShift
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.Shift).To(BeNil())
		})

		DescribeTable("filters checkpoints by checkpoint_filenames when provided",
			func(filenames []string, expectedCount int) {
				job, err := svc.Create("test-run", checkpoints, "study-1", filenames, false, false)
				Expect(err).NotTo(HaveOccurred())
				// Each checkpoint produces 8 items (2 prompts × 2 steps × 2 cfgs × 1 pair × 1 seed)
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
			_, err := svc.Create("test-run", checkpoints, "study-1", nil, true, false)
			Expect(err).NotTo(HaveOccurred())
			// Both checkpoints should have been cleared
			Expect(dirRemover.removed).To(ConsistOf("checkpoint1.safetensors", "checkpoint2.safetensors"))
		})

		It("clears only the filtered checkpoints when both checkpoint_filenames and clear_existing are set", func() {
			dirRemover.removed = nil
			_, err := svc.Create("test-run", checkpoints, "study-1", []string{"checkpoint1.safetensors"}, true, false)
			Expect(err).NotTo(HaveOccurred())
			// Only checkpoint1 should have been cleared
			Expect(dirRemover.removed).To(ConsistOf("checkpoint1.safetensors"))
		})

		It("does not clear directories when clear_existing is false", func() {
			dirRemover.removed = nil
			_, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false)
			Expect(err).NotTo(HaveOccurred())
			Expect(dirRemover.removed).To(BeEmpty())
		})

		// AC5: missing-only generation logic
		Context("with missing_only=true", func() {
			var fileChecker *fakeOutputFileChecker

			BeforeEach(func() {
				fileChecker = newFakeOutputFileChecker()
				svc.SetFileChecker(fileChecker)
			})

			It("skips items whose output file already exists on disk", func() {
				// Study name is "Test Study", so output path is /samples/Test Study/{checkpoint}/{filename}
				// Generate the expected filename for one of the items (prompt1, steps=1, cfg=1.0, euler/simple, seed=420)
				expectedFilename := service.GenerateOutputFilename(model.SampleJobItem{
					PromptName:  "prompt1",
					Steps:       1,
					CFG:         1.0,
					SamplerName: "euler",
					Scheduler:   "simple",
					Seed:        420,
				})

				// Mark this file as existing for checkpoint1 only
				fileChecker.existingFiles["/samples/Test Study/checkpoint1.safetensors/"+expectedFilename] = true

				job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, true)
				Expect(err).NotTo(HaveOccurred())

				// Total items should be 16 - 1 = 15 (one item skipped)
				Expect(job.TotalItems).To(Equal(15))
				items := store.items[job.ID]
				Expect(items).To(HaveLen(15))
			})

			It("creates all items when no output files exist", func() {
				// No files marked as existing
				job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, true)
				Expect(err).NotTo(HaveOccurred())

				// All 16 items should be created
				Expect(job.TotalItems).To(Equal(16))
				items := store.items[job.ID]
				Expect(items).To(HaveLen(16))
			})

			It("creates zero items when all output files exist", func() {
				// Mark all expected files as existing
				for _, cp := range checkpoints {
					for _, prompt := range study.Prompts {
						for _, steps := range study.Steps {
							for _, cfg := range study.CFGs {
								for _, pair := range study.SamplerSchedulerPairs {
									for _, seed := range study.Seeds {
										fn := service.GenerateOutputFilename(model.SampleJobItem{
											PromptName:  prompt.Name,
											Steps:       steps,
											CFG:         cfg,
											SamplerName: pair.Sampler,
											Scheduler:   pair.Scheduler,
											Seed:        seed,
										})
										fileChecker.existingFiles["/samples/Test Study/"+cp.Filename+"/"+fn] = true
									}
								}
							}
						}
					}
				}

				job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, true)
				Expect(err).NotTo(HaveOccurred())
				Expect(job.TotalItems).To(Equal(0))
			})

			It("does not filter when fileChecker is nil", func() {
				svc.SetFileChecker(nil)

				job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, true)
				Expect(err).NotTo(HaveOccurred())

				// All items should be created since no file checker is set
				Expect(job.TotalItems).To(Equal(16))
			})
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

		It("returns error when job is not pending (stopped)", func() {
			// Use a stopped job so the running-job guard does not trigger
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusStopped,
			}
			store.jobs[job.ID] = job

			_, err := svc.Start("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("cannot start job"))
		})

		It("returns error when another job is already running", func() {
			// Another job already running
			store.jobs["running-job"] = model.SampleJob{
				ID:     "running-job",
				Status: model.SampleJobStatusRunning,
			}
			// Target job is pending and valid
			store.jobs["job-1"] = model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusPending,
			}

			_, err := svc.Start("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("another job is already running"))

			// Verify the pending job was NOT transitioned
			unchanged := store.jobs["job-1"]
			Expect(unchanged.Status).To(Equal(model.SampleJobStatusPending))
		})

		It("returns error when HasRunningJob store call fails", func() {
			store.hasRunningJobErr = errors.New("db connection lost")
			store.jobs["job-1"] = model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusPending,
			}

			_, err := svc.Start("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("checking for running jobs"))
		})

		It("allows starting a pending job when no other job is running", func() {
			// No running jobs in store
			store.jobs["job-1"] = model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusPending,
			}

			result, err := svc.Start("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Status).To(Equal(model.SampleJobStatusRunning))
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
		// AC3: BE: Deleting a job without the data flag removes only the database record
		It("deletes a job without removing sample data when deleteData=false", func() {
			jobDataRemover := &fakeJobSampleDataRemover{}
			svc.SetJobDataRemover(jobDataRemover)

			job := model.SampleJob{ID: "job-1", StudyName: "My Study"}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "checkpoint1.safetensors", Status: model.SampleJobItemStatusCompleted},
			}

			err := svc.Delete("job-1", false)
			Expect(err).NotTo(HaveOccurred())
			Expect(store.jobs).NotTo(HaveKey("job-1"))
			// No filesystem removal should have occurred
			Expect(jobDataRemover.removed).To(BeEmpty())
		})

		// AC4: BE: Deleting a job with the data flag also removes generated sample files
		It("deletes a job and removes sample data when deleteData=true", func() {
			jobDataRemover := &fakeJobSampleDataRemover{}
			svc.SetJobDataRemover(jobDataRemover)

			job := model.SampleJob{ID: "job-1", StudyName: "My Study"}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "checkpoint1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "checkpoint1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i3", JobID: job.ID, CheckpointFilename: "checkpoint2.safetensors", Status: model.SampleJobItemStatusCompleted},
			}

			err := svc.Delete("job-1", true)
			Expect(err).NotTo(HaveOccurred())
			Expect(store.jobs).NotTo(HaveKey("job-1"))
			// Each unique checkpoint should have been removed once
			Expect(jobDataRemover.removed).To(HaveLen(2))
			removedCheckpoints := []string{}
			for _, r := range jobDataRemover.removed {
				Expect(r.studyName).To(Equal("My Study"))
				removedCheckpoints = append(removedCheckpoints, r.checkpointFilename)
			}
			Expect(removedCheckpoints).To(ConsistOf("checkpoint1.safetensors", "checkpoint2.safetensors"))
		})

		It("does not call remover when deleteData=true but no remover is set", func() {
			svc.SetJobDataRemover(nil) // explicitly nil

			job := model.SampleJob{ID: "job-1", StudyName: "My Study"}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "checkpoint1.safetensors"},
			}

			err := svc.Delete("job-1", true)
			Expect(err).NotTo(HaveOccurred())
			Expect(store.jobs).NotTo(HaveKey("job-1"))
		})

		It("returns error when job not found", func() {
			err := svc.Delete("nonexistent", false)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns error when sample data removal fails", func() {
			jobDataRemover := &fakeJobSampleDataRemover{err: errors.New("disk error")}
			svc.SetJobDataRemover(jobDataRemover)

			job := model.SampleJob{ID: "job-1", StudyName: "My Study"}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "checkpoint1.safetensors"},
			}

			err := svc.Delete("job-1", true)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("removing job sample directory"))
			// DB record should NOT have been deleted (filesystem cleanup runs first)
			Expect(store.jobs).To(HaveKey("job-1"))
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

		It("counts skipped items as failed", func() {
			// B-061: Skipped items (e.g. checkpoint path matching failed) should be
			// counted in the Failed bucket so the frontend accurately reflects errors.
			job := model.SampleJob{ID: "job-skipped", TotalItems: 4}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, Status: model.SampleJobItemStatusCompleted},
				{ID: "i3", JobID: job.ID, Status: model.SampleJobItemStatusSkipped},
				{ID: "i4", JobID: job.ID, Status: model.SampleJobItemStatusFailed},
			}

			counts, err := svc.GetItemCounts("job-skipped")
			Expect(err).NotTo(HaveOccurred())
			Expect(counts.Completed).To(Equal(2))
			Expect(counts.Failed).To(Equal(2)) // both failed and skipped counted as failed
			Expect(counts.Pending).To(Equal(0))
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

		It("counts skipped items as failed in progress metrics", func() {
			// B-061: Skipped items should be counted in the Failed bucket in progress
			job := model.SampleJob{ID: "job-skip-progress", TotalItems: 3}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk2.safetensors", Status: model.SampleJobItemStatusSkipped, ErrorMessage: "checkpoint not found in ComfyUI"},
				{ID: "i3", JobID: job.ID, CheckpointFilename: "chk2.safetensors", Status: model.SampleJobItemStatusCompleted},
			}

			progress, err := svc.GetProgress("job-skip-progress")
			Expect(err).NotTo(HaveOccurred())
			Expect(progress.ItemCounts.Completed).To(Equal(2))
			Expect(progress.ItemCounts.Failed).To(Equal(1)) // skipped counted as failed
			Expect(progress.ItemCounts.Pending).To(Equal(0))

			// Skipped items with error messages should appear in failed item details
			Expect(progress.FailedItemDetails).To(HaveLen(1))
			Expect(progress.FailedItemDetails[0].CheckpointFilename).To(Equal("chk2.safetensors"))
			Expect(progress.FailedItemDetails[0].ErrorMessage).To(Equal("checkpoint not found in ComfyUI"))
		})
	})
})
