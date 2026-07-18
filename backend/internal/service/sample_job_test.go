package service_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
	"syscall"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeSampleJobStore is an in-memory test double for service.SampleJobStore.
type fakeSampleJobStore struct {
	jobs                map[string]model.SampleJob
	items               map[string][]model.SampleJobItem
	studies             map[string]model.Study
	listJobsErr         error
	getJobErr           error
	hasRunningJobErr    error
	createJobErr        error
	updateJobErr        error
	deleteJobErr        error
	listItemsErr        error
	createItemErr       error
	updateItemErr       error
	getStudyErr         error
	listJobsProgressErr error
}

// computeFakeJobsProgress mirrors store.ListJobsProgress over in-memory items so
// that the fake store and the real store agree on aggregate progress semantics.
func computeFakeJobsProgress(items map[string][]model.SampleJobItem) map[string]model.JobListProgress {
	result := make(map[string]model.JobListProgress)
	for jobID, jobItems := range items {
		var counts model.ItemStatusCounts
		// checkpoint -> errMsg -> detail (empty errMsg map means failed w/o message)
		type detail struct{ exceptionType, nodeType, traceback string }
		byCheckpoint := make(map[string]map[string]detail)
		for _, it := range jobItems {
			switch it.Status {
			case model.SampleJobItemStatusCompleted:
				counts.Completed++
			case model.SampleJobItemStatusFailed, model.SampleJobItemStatusSkipped:
				counts.Failed++
				byMsg, ok := byCheckpoint[it.CheckpointFilename]
				if !ok {
					byMsg = make(map[string]detail)
					byCheckpoint[it.CheckpointFilename] = byMsg
				}
				if it.ErrorMessage != "" {
					byMsg[it.ErrorMessage] = detail{it.ExceptionType, it.NodeType, it.Traceback}
				}
			case model.SampleJobItemStatusPending:
				counts.Pending++
			}
		}
		var details []model.FailedItemDetail
		names := make([]string, 0, len(byCheckpoint))
		for cp := range byCheckpoint {
			names = append(names, cp)
		}
		sort.Strings(names)
		for _, cp := range names {
			byMsg := byCheckpoint[cp]
			if len(byMsg) == 0 {
				details = append(details, model.FailedItemDetail{CheckpointFilename: cp, ErrorMessage: "unknown error"})
				continue
			}
			for msg, d := range byMsg {
				details = append(details, model.FailedItemDetail{
					CheckpointFilename: cp,
					ErrorMessage:       msg,
					ExceptionType:      d.exceptionType,
					NodeType:           d.nodeType,
					Traceback:          d.traceback,
				})
			}
		}
		result[jobID] = model.JobListProgress{ItemCounts: counts, FailedItemDetails: details}
	}
	return result
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

func (f *fakeSampleJobStore) ListSampleJobsDesc() ([]model.SampleJob, error) {
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

// CreateSampleJobWithItems atomically stores a job and its items. To mirror the
// real store's transactional behavior, if createItemErr is set nothing is
// persisted (no job and no items), matching a rolled-back transaction.
func (f *fakeSampleJobStore) CreateSampleJobWithItems(j model.SampleJob, items []model.SampleJobItem) error {
	if f.createJobErr != nil {
		return f.createJobErr
	}
	if f.createItemErr != nil {
		return f.createItemErr
	}
	f.jobs[j.ID] = j
	for _, item := range items {
		f.items[item.JobID] = append(f.items[item.JobID], item)
	}
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

func (f *fakeSampleJobStore) ListJobsProgress() (map[string]model.JobListProgress, error) {
	if f.listJobsProgressErr != nil {
		return nil, f.listJobsProgressErr
	}
	return computeFakeJobsProgress(f.items), nil
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
	paths    map[string]string
	matchErr error
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
	removed []struct{ trainingRunName, studyName, checkpointFilename string }
	err     error
}

func (f *fakeSampleDirRemover) RemoveCheckpointOutputDir(trainingRunName string, studyName string, checkpointFilename string) error {
	if f.err != nil {
		return f.err
	}
	f.removed = append(f.removed, struct{ trainingRunName, studyName, checkpointFilename string }{trainingRunName, studyName, checkpointFilename})
	return nil
}

// fakeJobSampleDataRemover is a test double for service.JobSampleDataRemover.
type fakeJobSampleDataRemover struct {
	removed []struct{ trainingRunName, studyName, baseModel, checkpointFilename string }
	err     error
}

func (f *fakeJobSampleDataRemover) RemoveJobSampleDir(trainingRunName string, studyName string, baseModel string, checkpointFilename string) error {
	if f.err != nil {
		return f.err
	}
	f.removed = append(f.removed, struct{ trainingRunName, studyName, baseModel, checkpointFilename string }{trainingRunName, studyName, baseModel, checkpointFilename})
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

// fakeWorkflowRoleChecker is a test double for service.WorkflowRoleChecker.
type fakeWorkflowRoleChecker struct {
	workflows map[string]model.WorkflowTemplate
	err       error
}

func newFakeWorkflowRoleChecker() *fakeWorkflowRoleChecker {
	return &fakeWorkflowRoleChecker{workflows: make(map[string]model.WorkflowTemplate)}
}

func (f *fakeWorkflowRoleChecker) Get(_ context.Context, name string) (model.WorkflowTemplate, error) {
	if f.err != nil {
		return model.WorkflowTemplate{}, f.err
	}
	wf, ok := f.workflows[name]
	if !ok {
		return model.WorkflowTemplate{}, fmt.Errorf("workflow not found: %s", name)
	}
	return wf, nil
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
	store *fakeSampleJobStore
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

	// B-163: strength params are keyed on the LoRA dimension (derived from the job,
	// via dims.LoRA), NOT the per-item LoraModelPath — that path is empty at job
	// creation time (S-161) and only resolved at execution, so keying on it made
	// the creation-time filename diverge from the executor-written one.
	It("includes strength_model and strength_clip when the LoRA dimension is set", func() {
		item := model.SampleJobItem{
			PromptName:    "test",
			Steps:         20,
			CFG:           7.0,
			SamplerName:   "euler",
			Scheduler:     "simple",
			Seed:          42,
			StrengthModel: 0.80,
			StrengthClip:  0.90,
		}
		result := service.GenerateOutputFilenameWithDims(item, service.FilenameDimensions{LoRA: true})
		Expect(result).To(ContainSubstring("strength_clip=0.90"))
		Expect(result).To(ContainSubstring("strength_model=0.80"))
	})

	It("does NOT include strength values when the LoRA dimension is unset (non-LoRA job)", func() {
		item := model.SampleJobItem{
			PromptName:    "test",
			Steps:         20,
			CFG:           7.0,
			SamplerName:   "euler",
			Scheduler:     "simple",
			Seed:          42,
			StrengthModel: 1.0,
			StrengthClip:  1.0,
		}
		result := service.GenerateOutputFilename(item)
		Expect(result).NotTo(ContainSubstring("strength"))
	})

	// S-157: swept dimensions are encoded into the filename so the scanner can
	// surface them as grid axes; unswept dimensions are omitted.
	It("encodes swept S-157 dimensions when requested", func() {
		shift := 3.5
		item := model.SampleJobItem{
			PromptName: "p", Steps: 4, CFG: 1.0, SamplerName: "euler", Scheduler: "simple", Seed: 1,
			Width: 1024, Height: 768, VAE: "loras/ae.safetensors", TextEncoder: "clip_l.safetensors", Shift: &shift,
		}
		result := service.GenerateOutputFilenameWithDims(item, service.FilenameDimensions{
			Resolution: true, VAE: true, TextEncoder: true, Shift: true,
		})
		Expect(result).To(ContainSubstring("resolution=1024x768"))
		Expect(result).To(ContainSubstring("vae=ae.safetensors"))
		Expect(result).To(ContainSubstring("text_encoder=clip_l.safetensors"))
		Expect(result).To(ContainSubstring("shift=3.5"))
	})

	It("omits S-157 dimensions that are not swept (single-value studies unchanged)", func() {
		item := model.SampleJobItem{
			PromptName: "p", Steps: 4, CFG: 1.0, SamplerName: "euler", Scheduler: "simple", Seed: 1,
			Width: 1024, Height: 768, VAE: "ae.safetensors",
		}
		result := service.GenerateOutputFilenameWithDims(item, service.FilenameDimensions{})
		Expect(result).NotTo(ContainSubstring("resolution="))
		Expect(result).NotTo(ContainSubstring("vae="))
		Expect(result).NotTo(ContainSubstring("shift="))
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
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
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

			// S-161: paths are resolved lazily at execution time, so items are
			// persisted pending with an empty ComfyUIModelPath.
			for _, item := range items {
				Expect(item.ComfyUIModelPath).To(BeEmpty())
				Expect(item.Status).To(Equal(model.SampleJobItemStatusPending))
			}
		})

		It("calculates total items correctly", func() {
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())

			// 2 checkpoints × 2 prompts × 2 steps × 2 cfgs × 1 pair × 1 seed = 16
			Expect(job.TotalItems).To(Equal(16))
		})

		// S-157 AC4: expansion produces the full cross-product across all non-empty
		// promoted dimensions and substitutes per-item resolution/VAE/text-encoder/shift.
		It("expands the cross-product across S-157 multi-value dimensions", func() {
			multi := store.studies["study-1"]
			multi.Resolutions = []model.ResolutionPair{{Width: 1024, Height: 1024}, {Width: 768, Height: 768}}
			multi.VAEs = []string{"ae1.safetensors", "ae2.safetensors"}
			multi.TextEncoders = []string{"clip_a.safetensors"}
			multi.Shifts = []float64{2.0, 4.0}
			store.studies["study-1"] = multi

			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())

			// 2 ckpt × 2 prompts × 2 steps × 2 cfgs × 1 pair × 1 seed × 2 res × 2 vae × 1 te × 2 shift = 128
			Expect(job.TotalItems).To(Equal(128))

			items := store.items[job.ID]
			widths := map[int]bool{}
			vaes := map[string]bool{}
			shifts := map[float64]bool{}
			for _, it := range items {
				widths[it.Width] = true
				vaes[it.VAE] = true
				if it.Shift != nil {
					shifts[*it.Shift] = true
				}
				Expect(it.TextEncoder).To(Equal("clip_a.safetensors"))
			}
			Expect(widths).To(HaveKey(1024))
			Expect(widths).To(HaveKey(768))
			Expect(vaes).To(HaveKey("ae1.safetensors"))
			Expect(vaes).To(HaveKey("ae2.safetensors"))
			Expect(shifts).To(HaveKey(2.0))
			Expect(shifts).To(HaveKey(4.0))
		})

		// S-157: a study with empty promoted dimensions (role not declared) must not
		// multiply the cross-product nor set spurious per-item values.
		It("does not multiply the cross-product for empty promoted dimensions", func() {
			single := store.studies["study-1"]
			single.Resolutions = []model.ResolutionPair{{Width: 512, Height: 512}}
			single.VAEs = nil
			single.TextEncoders = nil
			single.Shifts = nil
			store.studies["study-1"] = single

			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			// unchanged: 2 ckpt × 8 = 16
			Expect(job.TotalItems).To(Equal(16))
			for _, it := range store.items[job.ID] {
				Expect(it.VAE).To(BeEmpty())
				Expect(it.TextEncoder).To(BeEmpty())
				Expect(it.Shift).To(BeNil())
				Expect(it.Width).To(Equal(512))
			}
		})

		It("returns error when study not found", func() {
			_, err := svc.Create("test-run", checkpoints, "nonexistent", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		// B-104: Reject job creation when the study has no workflow template configured.
		It("returns error when study has no workflow template", func() {
			noWorkflowStudy := model.Study{
				ID:      "study-no-wf",
				Name:    "No Workflow Study",
				Prompts: []model.NamedPrompt{{Name: "prompt1", Text: "text1"}},
				Steps:   []int{1},
				CFGs:    []float64{1.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "simple"},
				},
				Seeds:            []int64{42},
				WorkflowTemplate: "", // Empty workflow template
				Width:            512,
				Height:           512,
			}
			store.studies[noWorkflowStudy.ID] = noWorkflowStudy

			_, err := svc.Create("test-run", checkpoints, "study-no-wf", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("no workflow template configured"))
		})

		// S-161: creating a job no longer path-matches against ComfyUI. Even when the
		// path matcher would fail for every checkpoint (e.g. ComfyUI unreachable), Create
		// succeeds and persists a pending job with all items pending and unresolved paths.
		It("creates a pending job even when ComfyUI is unreachable (no eager path-match rejection)", func() {
			// Simulate ComfyUI being down: the matcher would return a connection error.
			// Create must not call it, so the job is still created.
			pathMatcher.matchErr = &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}
			pathMatcher.paths = make(map[string]string)

			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.Status).To(Equal(model.SampleJobStatusPending))

			items := store.items[job.ID]
			Expect(items).To(HaveLen(16))
			for _, item := range items {
				Expect(item.Status).To(Equal(model.SampleJobItemStatusPending))
				Expect(item.ComfyUIModelPath).To(BeEmpty())
			}
		})

		It("uses shift from study when study has a shift value", func() {
			// The study set up in BeforeEach has Shift = &1.5
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.Shift).NotTo(BeNil())
			Expect(*job.Shift).To(Equal(1.5))
		})

		It("has nil shift when study has no shift", func() {
			// Modify the study to have no shift
			studyNoShift := store.studies["study-1"]
			studyNoShift.Shift = nil
			store.studies["study-1"] = studyNoShift
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.Shift).To(BeNil())
		})

		DescribeTable("filters checkpoints by checkpoint_filenames when provided",
			func(filenames []string, expectedCount int) {
				job, err := svc.Create("test-run", checkpoints, "study-1", filenames, false, false, "", model.TrainingRunKindCheckpoint)
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

		It("stores all checkpoint filenames in the job when no filter is provided", func() {
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.CheckpointFilenames).To(ConsistOf("checkpoint1.safetensors", "checkpoint2.safetensors"))
		})

		It("stores only filtered checkpoint filenames when a filter is provided", func() {
			job, err := svc.Create("test-run", checkpoints, "study-1", []string{"checkpoint1.safetensors"}, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.CheckpointFilenames).To(ConsistOf("checkpoint1.safetensors"))
		})

		It("stores empty checkpoint filenames list when filter matches no checkpoints", func() {
			job, err := svc.Create("test-run", checkpoints, "study-1", []string{"nonexistent.safetensors"}, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.CheckpointFilenames).To(BeEmpty())
		})

		// B-114: clear_existing is stored as a job parameter, not executed at queue time
		It("stores clear_existing flag on the job but does NOT clear directories at queue time", func() {
			dirRemover.removed = nil
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, true, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			// Directories should NOT be cleared during Create
			Expect(dirRemover.removed).To(BeEmpty())
			// Flag should be stored on the job
			Expect(job.ClearExisting).To(BeTrue())
		})

		It("stores clear_existing=false when not requested", func() {
			job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.ClearExisting).To(BeFalse())
		})

		// B-106 AC1/AC2: Study regeneration creates a job with clear_existing for all checkpoints.
		// After an in-place study update, the frontend calls Create with clear_existing=true
		// and no checkpoint filter to regenerate all samples.
		Context("regeneration job creation (B-106)", func() {
			It("creates a job with clear_existing flag stored (clearing deferred to start)", func() {
				dirRemover.removed = nil
				job, err := svc.Create("test-run", checkpoints, "study-1", nil, true, false, "", model.TrainingRunKindCheckpoint)
				Expect(err).NotTo(HaveOccurred())

				// AC1: Job is created with correct study and training run
				Expect(job.StudyID).To(Equal("study-1"))
				Expect(job.TrainingRunName).To(Equal("test-run"))
				Expect(job.Status).To(Equal(model.SampleJobStatusPending))

				// B-114: clear_existing is stored as a param, not executed at queue time
				Expect(job.ClearExisting).To(BeTrue())
				Expect(dirRemover.removed).To(BeEmpty())

				// All items are created (no filter applied)
				items := store.items[job.ID]
				Expect(items).To(HaveLen(16)) // 2 checkpoints × 8 items per checkpoint

				// All checkpoint filenames are stored on the job
				Expect(job.CheckpointFilenames).To(ConsistOf("checkpoint1.safetensors", "checkpoint2.safetensors"))
			})

			It("reads workflow, VAE, and CLIP from the updated study definition", func() {
				// Simulate a study that was just updated in-place with new settings
				updatedStudy := store.studies["study-1"]
				updatedStudy.WorkflowTemplate = "new-workflow.json"
				updatedStudy.VAE = "new-vae.safetensors"
				updatedStudy.TextEncoder = "new-clip.safetensors"
				store.studies["study-1"] = updatedStudy

				job, err := svc.Create("test-run", checkpoints, "study-1", nil, true, false, "", model.TrainingRunKindCheckpoint)
				Expect(err).NotTo(HaveOccurred())

				// Job uses the updated study settings
				Expect(job.WorkflowName).To(Equal("new-workflow.json"))
				Expect(job.VAE).To(Equal("new-vae.safetensors"))
				Expect(job.CLIP).To(Equal("new-clip.safetensors"))
			})
		})

		// AC5: missing-only generation logic
		Context("with missing_only=true", func() {
			var fileChecker *fakeOutputFileChecker

			BeforeEach(func() {
				fileChecker = newFakeOutputFileChecker()
				svc.SetFileChecker(fileChecker)
			})

			It("skips items whose output file already exists on disk", func() {
				// B-163: the executor writes to {sampleDir}/{sanitizedRun}/{study}/{checkpoint}/{filename}
				// (via fileformat.StudyOutputDir), so missing-only detection must probe
				// that exact layout. Training run "test-run" sanitizes to "test-run".
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
				fileChecker.existingFiles["/samples/test-run/Test Study/checkpoint1.safetensors/"+expectedFilename] = true

				job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, true, "", model.TrainingRunKindCheckpoint)
				Expect(err).NotTo(HaveOccurred())

				// Total items should be 16 - 1 = 15 (one item skipped)
				Expect(job.TotalItems).To(Equal(15))
				items := store.items[job.ID]
				Expect(items).To(HaveLen(15))
			})

			It("creates all items when no output files exist", func() {
				// No files marked as existing
				job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, true, "", model.TrainingRunKindCheckpoint)
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
										fileChecker.existingFiles["/samples/test-run/Test Study/"+cp.Filename+"/"+fn] = true
									}
								}
							}
						}
					}
				}

				job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, true, "", model.TrainingRunKindCheckpoint)
				Expect(err).NotTo(HaveOccurred())
				Expect(job.TotalItems).To(Equal(0))
			})

			It("does not filter when fileChecker is nil", func() {
				svc.SetFileChecker(nil)

				job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, true, "", model.TrainingRunKindCheckpoint)
				Expect(err).NotTo(HaveOccurred())

				// All items should be created since no file checker is set
				Expect(job.TotalItems).To(Equal(16))
			})

			// B-163: the training run name is sanitized (slashes → underscores) into a
			// single directory level by fileformat.SanitizeTrainingRunName. Missing-only
			// detection must probe the sanitized path or it will never match on-disk
			// files for runs whose names contain slashes (e.g. "qwen/Qwen2-VL").
			It("detects existing checkpoint samples laid out under the sanitized run directory", func() {
				expectedFilename := service.GenerateOutputFilename(model.SampleJobItem{
					PromptName:  "prompt1",
					Steps:       1,
					CFG:         1.0,
					SamplerName: "euler",
					Scheduler:   "simple",
					Seed:        420,
				})
				// Run "qwen/Qwen2-VL" sanitizes to "qwen_Qwen2-VL" — a single level.
				fileChecker.existingFiles["/samples/qwen_Qwen2-VL/Test Study/checkpoint1.safetensors/"+expectedFilename] = true

				job, err := svc.Create("qwen/Qwen2-VL", checkpoints, "study-1", nil, false, true, "", model.TrainingRunKindCheckpoint)
				Expect(err).NotTo(HaveOccurred())

				// Exactly one item is skipped; the sanitized-path probe matched.
				Expect(job.TotalItems).To(Equal(15))
			})

			// B-163: LoRA jobs write into an EXTRA base-model directory level
			// ({run}/{study}/{baseModel}/{checkpoint}/...) and their filenames include
			// strength_model/strength_clip. Missing-only detection must reproduce both
			// or LoRA jobs regenerate every sample.
			It("detects existing LoRA samples laid out under the base-model directory with strength-keyed filenames", func() {
				loraStudy := model.Study{
					ID:             "lora-missing-study",
					Name:           "LoRA Study",
					Prompts:        []model.NamedPrompt{{Name: "prompt1", Text: "text1"}},
					NegativePrompt: "bad",
					Steps:          []int{20},
					CFGs:           []float64{7.0},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "simple"},
					},
					Seeds:            []int64{42},
					WorkflowTemplate: "lora-workflow.json",
					LoraStrengthPairs: []model.LoraStrengthPair{
						{StrengthModel: 0.8, StrengthClip: 0.9},
						{StrengthModel: 1.0, StrengthClip: 1.0},
					},
				}
				store.studies[loraStudy.ID] = loraStudy

				// Total items: 2 checkpoints × 2 strength pairs = 4.
				// Mark BOTH strength variants for checkpoint1 as existing on disk, at the
				// executor's layout: {run}/{study}/{baseModel}/{checkpoint}/{filename}.
				// Base model "loras/base.safetensors" → base-model dir "base".
				loraDims := service.FilenameDimensions{LoRA: true}
				for _, sp := range loraStudy.LoraStrengthPairs {
					fn := service.GenerateOutputFilenameWithDims(model.SampleJobItem{
						PromptName:    "prompt1",
						Steps:         20,
						CFG:           7.0,
						SamplerName:   "euler",
						Scheduler:     "simple",
						Seed:          42,
						StrengthModel: sp.StrengthModel,
						StrengthClip:  sp.StrengthClip,
					}, loraDims)
					fileChecker.existingFiles["/samples/lora-run/LoRA Study/base/checkpoint1.safetensors/"+fn] = true
				}

				job, err := svc.Create("lora-run", checkpoints, loraStudy.ID, nil, false, true, "loras/base.safetensors", model.TrainingRunKindLoRA)
				Expect(err).NotTo(HaveOccurred())

				// 4 total − 2 pre-existing (both checkpoint1 strength variants) = 2 remaining.
				Expect(job.TotalItems).To(Equal(2))
				items := store.items[job.ID]
				Expect(items).To(HaveLen(2))
				// Only checkpoint2 items survive.
				for _, item := range items {
					Expect(item.CheckpointFilename).To(Equal("checkpoint2.safetensors"))
				}
			})
		})

		// S-145: LoRA job creation tests
		Context("LoRA training runs", func() {
			var loraStudy model.Study

			BeforeEach(func() {
				loraStudy = model.Study{
					ID:             "lora-study-1",
					Name:           "LoRA Study",
					Prompts:        []model.NamedPrompt{{Name: "prompt1", Text: "text1"}},
					NegativePrompt: "bad",
					Steps:          []int{20},
					CFGs:           []float64{7.0},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "simple"},
					},
					Seeds:            []int64{42},
					WorkflowTemplate: "lora-workflow.json",
					VAE:              "vae.safetensors",
					TextEncoder:      "clip.safetensors",
					LoraStrengthPairs: []model.LoraStrengthPair{
						{StrengthModel: 0.8, StrengthClip: 0.9},
						{StrengthModel: 1.0, StrengthClip: 1.0},
					},
				}
				store.studies[loraStudy.ID] = loraStudy
			})

			It("returns error when LoRA run has no base model", func() {
				_, err := svc.Create("lora-run", checkpoints, "lora-study-1", nil, false, false, "", model.TrainingRunKindLoRA)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("require a base model"))
			})

			It("returns error when workflow lacks lora_loader cs_role", func() {
				checker := newFakeWorkflowRoleChecker()
				// Register a workflow without lora_loader role
				checker.workflows["lora-workflow.json"] = model.WorkflowTemplate{
					Name: "lora-workflow.json",
					Roles: map[string][]string{
						string(model.CSRoleSaveImage): {"1"},
					},
				}
				svc.SetWorkflowRoleChecker(checker)

				_, err := svc.Create("lora-run", checkpoints, "lora-study-1", nil, false, false, "base.safetensors", model.TrainingRunKindLoRA)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("lora_loader"))
				Expect(err.Error()).To(ContainSubstring("lora-capable workflow"))
			})

			It("succeeds when workflow has lora_loader cs_role", func() {
				checker := newFakeWorkflowRoleChecker()
				checker.workflows["lora-workflow.json"] = model.WorkflowTemplate{
					Name: "lora-workflow.json",
					Roles: map[string][]string{
						string(model.CSRoleSaveImage):  {"1"},
						string(model.CSRoleLoraLoader): {"2"},
					},
				}
				svc.SetWorkflowRoleChecker(checker)

				job, err := svc.Create("lora-run", checkpoints, "lora-study-1", nil, false, false, "base.safetensors", model.TrainingRunKindLoRA)
				Expect(err).NotTo(HaveOccurred())
				Expect(job.BaseModel).To(Equal("base.safetensors"))
			})

			It("expands lora_strength_pairs in the Cartesian product for LoRA runs", func() {
				// 2 checkpoints x 1 prompt x 1 step x 1 cfg x 1 pair x 1 seed x 2 strengths = 4
				job, err := svc.Create("lora-run", checkpoints, "lora-study-1", nil, false, false, "base-model.safetensors", model.TrainingRunKindLoRA)
				Expect(err).NotTo(HaveOccurred())
				Expect(job.TotalItems).To(Equal(4))
				Expect(job.BaseModel).To(Equal("base-model.safetensors"))

				items := store.items[job.ID]
				Expect(items).To(HaveLen(4))

				// Verify strength values are set on items
				strengths := make(map[string]bool)
				for _, item := range items {
					key := fmt.Sprintf("%.1f-%.1f", item.StrengthModel, item.StrengthClip)
					strengths[key] = true
				}
				Expect(strengths).To(HaveKey("0.8-0.9"))
				Expect(strengths).To(HaveKey("1.0-1.0"))
			})

			It("does NOT expand strength pairs for non-LoRA runs", func() {
				// Study has 2 strength pairs, but this is a checkpoint run
				store.studies["study-1"] = model.Study{
					ID:      "study-1",
					Name:    "Test Study",
					Prompts: []model.NamedPrompt{{Name: "prompt1", Text: "text1"}},
					Steps:   []int{20},
					CFGs:    []float64{7.0},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "simple"},
					},
					Seeds:            []int64{42},
					WorkflowTemplate: "workflow.json",
					LoraStrengthPairs: []model.LoraStrengthPair{
						{StrengthModel: 0.8, StrengthClip: 0.9},
						{StrengthModel: 1.0, StrengthClip: 1.0},
					},
				}

				// 2 checkpoints x 1 prompt x 1 step x 1 cfg x 1 pair x 1 seed = 2 (no strength expansion)
				job, err := svc.Create("test-run", checkpoints, "study-1", nil, false, false, "", model.TrainingRunKindCheckpoint)
				Expect(err).NotTo(HaveOccurred())
				Expect(job.TotalItems).To(Equal(2))
			})

			// S-161: LoRA jobs are also created with unresolved paths — LoraModelPath is
			// resolved lazily at execution time, not during Create.
			It("creates a LoRA job with unresolved paths (resolved at execution time)", func() {
				loraPathMatcher := newFakePathMatcher()
				loraPathMatcher.paths["checkpoint1.safetensors"] = "loras/checkpoint1.safetensors"
				loraPathMatcher.paths["checkpoint2.safetensors"] = "loras/checkpoint2.safetensors"
				svc.SetLoraPathMatcher(loraPathMatcher)

				job, err := svc.Create("lora-run", checkpoints, "lora-study-1", nil, false, false, "base.safetensors", model.TrainingRunKindLoRA)
				Expect(err).NotTo(HaveOccurred())
				Expect(job.Status).To(Equal(model.SampleJobStatusPending))

				items := store.items[job.ID]
				Expect(items).NotTo(BeEmpty())
				for _, item := range items {
					Expect(item.Status).To(Equal(model.SampleJobItemStatusPending))
					Expect(item.LoraModelPath).To(BeEmpty())
					Expect(item.ComfyUIModelPath).To(BeEmpty())
				}
			})

			It("treats single default strength pair as no expansion for LoRA runs", func() {
				singleStrengthStudy := loraStudy
				singleStrengthStudy.ID = "single-strength-study"
				singleStrengthStudy.LoraStrengthPairs = []model.LoraStrengthPair{
					{StrengthModel: 1.0, StrengthClip: 1.0},
				}
				store.studies[singleStrengthStudy.ID] = singleStrengthStudy

				// 2 checkpoints x 1 prompt x 1 step x 1 cfg x 1 pair x 1 seed x 1 strength = 2
				job, err := svc.Create("lora-run", checkpoints, singleStrengthStudy.ID, nil, false, false, "base.safetensors", model.TrainingRunKindLoRA)
				Expect(err).NotTo(HaveOccurred())
				Expect(job.TotalItems).To(Equal(2))
			})
		})
	})

	// S-153: Cap study total work items at the configured maximum.
	Describe("Create with max study items limit", func() {
		var (
			study       model.Study
			checkpoints []model.Checkpoint
		)

		BeforeEach(func() {
			study = model.Study{
				ID:             "study-limit",
				Name:           "Limit Study",
				Prompts:        []model.NamedPrompt{{Name: "prompt1", Text: "text1"}, {Name: "prompt2", Text: "text2"}},
				NegativePrompt: "bad",
				Steps:          []int{1, 4},
				CFGs:           []float64{1.0, 3.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "simple"},
				},
				Seeds:            []int64{420},
				WorkflowTemplate: "workflow.json",
			}
			store.studies[study.ID] = study

			// images-per-checkpoint = 2 prompts × 2 steps × 2 cfgs × 1 pair × 1 seed = 8
			// 2 checkpoints → total = 16
			checkpoints = []model.Checkpoint{
				{Filename: "checkpoint1.safetensors", StepNumber: 1000},
				{Filename: "checkpoint2.safetensors", StepNumber: 2000},
			}
			pathMatcher.paths["checkpoint1.safetensors"] = "models/checkpoint1.safetensors"
			pathMatcher.paths["checkpoint2.safetensors"] = "models/checkpoint2.safetensors"
		})

		It("allows a job whose total is exactly at the limit", func() {
			svc.SetMaxStudyItems(16) // total == limit
			job, err := svc.Create("test-run", checkpoints, study.ID, nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.TotalItems).To(Equal(16))
		})

		It("rejects a job whose total is one over the limit with a typed too_many_items error", func() {
			svc.SetMaxStudyItems(15) // total (16) is one over
			_, err := svc.Create("test-run", checkpoints, study.ID, nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).To(HaveOccurred())

			var tooMany *model.TooManyItemsError
			Expect(errors.As(err, &tooMany)).To(BeTrue())
			Expect(tooMany.Total).To(Equal(16))
			Expect(tooMany.Limit).To(Equal(15))
			Expect(tooMany.Code()).To(Equal(model.TooManyItemsCode))
		})

		It("respects a config override that raises the limit above the total", func() {
			svc.SetMaxStudyItems(1000000) // override well above total
			job, err := svc.Create("test-run", checkpoints, study.ID, nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.TotalItems).To(Equal(16))
		})

		It("does not enforce a limit when max study items is zero (unlimited)", func() {
			svc.SetMaxStudyItems(0)
			job, err := svc.Create("test-run", checkpoints, study.ID, nil, false, false, "", model.TrainingRunKindCheckpoint)
			Expect(err).NotTo(HaveOccurred())
			Expect(job.TotalItems).To(Equal(16))
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

		// B-165: Start must call RequestResume synchronously so the executor
		// adopts the job without racing the 1s poll tick.
		It("calls RequestResume on the executor after the status write", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusPending,
			}
			store.jobs[job.ID] = job

			Expect(executor.resumeCalled).To(BeFalse())

			result, err := svc.Start("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Status).To(Equal(model.SampleJobStatusRunning))
			Expect(executor.resumeCalled).To(BeTrue())
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

		// B-131: Clear-existing only removes selected checkpoint directories, not the whole study
		Context("clear-existing at start (B-131)", func() {
			It("clears only the selected checkpoint directories when ClearExisting=true with partial selection", func() {
				// AC: BE: Clear-existing only deletes samples for the selected checkpoints
				dirRemover.removed = nil
				job := model.SampleJob{
					ID:                  "job-clear-partial",
					TrainingRunName:     "test-run",
					StudyName:           "My Study",
					Status:              model.SampleJobStatusPending,
					ClearExisting:       true,
					CheckpointFilenames: []string{"cp1.safetensors"},
				}
				store.jobs[job.ID] = job

				result, err := svc.Start("job-clear-partial")
				Expect(err).NotTo(HaveOccurred())
				Expect(result.Status).To(Equal(model.SampleJobStatusRunning))

				// Only the selected checkpoint directory should be removed (not the whole study dir)
				Expect(dirRemover.removed).To(HaveLen(1))
				Expect(dirRemover.removed[0].trainingRunName).To(Equal("test-run"))
				Expect(dirRemover.removed[0].studyName).To(Equal("My Study"))
				Expect(dirRemover.removed[0].checkpointFilename).To(Equal("cp1.safetensors"))

				// ClearExisting should be reset to false so resume never re-clears
				Expect(result.ClearExisting).To(BeFalse())
				storedJob := store.jobs["job-clear-partial"]
				Expect(storedJob.ClearExisting).To(BeFalse())
			})

			It("clears all checkpoint directories when ClearExisting=true and all checkpoints are selected", func() {
				// AC: BE: Selecting all checkpoints with clear-existing clears all samples (full coverage path)
				dirRemover.removed = nil
				job := model.SampleJob{
					ID:                  "job-clear-all",
					TrainingRunName:     "test-run",
					StudyName:           "My Study",
					Status:              model.SampleJobStatusPending,
					ClearExisting:       true,
					CheckpointFilenames: []string{"cp1.safetensors", "cp2.safetensors", "cp3.safetensors"},
				}
				store.jobs[job.ID] = job

				result, err := svc.Start("job-clear-all")
				Expect(err).NotTo(HaveOccurred())
				Expect(result.Status).To(Equal(model.SampleJobStatusRunning))

				// All three checkpoint directories should be removed (one call per checkpoint)
				Expect(dirRemover.removed).To(HaveLen(3))
				Expect(dirRemover.removed[0].checkpointFilename).To(Equal("cp1.safetensors"))
				Expect(dirRemover.removed[1].checkpointFilename).To(Equal("cp2.safetensors"))
				Expect(dirRemover.removed[2].checkpointFilename).To(Equal("cp3.safetensors"))
				// All calls use the same training run and study
				for _, call := range dirRemover.removed {
					Expect(call.trainingRunName).To(Equal("test-run"))
					Expect(call.studyName).To(Equal("My Study"))
				}

				// ClearExisting should be reset to false so resume never re-clears
				Expect(result.ClearExisting).To(BeFalse())
				storedJob := store.jobs["job-clear-all"]
				Expect(storedJob.ClearExisting).To(BeFalse())
			})

			It("does not clear directories when ClearExisting=false", func() {
				// AC: BE: Unselected checkpoints are not affected
				dirRemover.removed = nil
				job := model.SampleJob{
					ID:                  "job-no-clear",
					Status:              model.SampleJobStatusPending,
					ClearExisting:       false,
					CheckpointFilenames: []string{"cp1.safetensors"},
				}
				store.jobs[job.ID] = job

				_, err := svc.Start("job-no-clear")
				Expect(err).NotTo(HaveOccurred())
				Expect(dirRemover.removed).To(BeEmpty())
			})
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

	// AC4: BE: Unit tests for stop+restart state transitions
	Describe("Stop+Restart cycle", func() {
		It("allows resume after stop completes via executor", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusRunning,
			}
			store.jobs[job.ID] = job

			// Stop the job (executor simulates the DB update to stopped)
			result, err := svc.Stop("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Status).To(Equal(model.SampleJobStatusStopped))
			Expect(executor.stopCalled).To(BeTrue())

			// Resume the stopped job
			resumed, err := svc.Resume("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(resumed.Status).To(Equal(model.SampleJobStatusRunning))
			Expect(executor.resumeCalled).To(BeTrue())
		})

		It("allows resume after stop falls back to direct DB update", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusRunning,
			}
			store.jobs[job.ID] = job

			// Simulate executor rejecting the stop (e.g. activeJobID mismatch)
			executor.stopErr = fmt.Errorf("job job-1 is not currently running")

			// Stop should still succeed via fallback DB update
			result, err := svc.Stop("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Status).To(Equal(model.SampleJobStatusStopped))
			Expect(executor.stopCalled).To(BeTrue())

			// Verify DB was updated to stopped
			stored := store.jobs["job-1"]
			Expect(stored.Status).To(Equal(model.SampleJobStatusStopped))

			// Resume should work because the job is now properly stopped in the DB
			resumed, err := svc.Resume("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(resumed.Status).To(Equal(model.SampleJobStatusRunning))
		})

		It("falls back to direct DB update when executor rejects stop", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusRunning,
			}
			store.jobs[job.ID] = job

			// Executor rejects because it doesn't think the job is active
			executor.stopErr = fmt.Errorf("job job-1 is not currently running")

			result, err := svc.Stop("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Status).To(Equal(model.SampleJobStatusStopped))

			// Verify the DB was updated
			stored := store.jobs["job-1"]
			Expect(stored.Status).To(Equal(model.SampleJobStatusStopped))
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

		// B-114: Resuming a stopped job does NOT re-clear existing samples.
		// The ClearExisting flag was already reset to false when the job first started.
		It("does not re-clear sample directories on resume (B-114)", func() {
			dirRemover.removed = nil
			job := model.SampleJob{
				ID:                  "job-resume",
				Status:              model.SampleJobStatusStopped,
				ClearExisting:       false, // already reset after first start
				CheckpointFilenames: []string{"cp1.safetensors"},
			}
			store.jobs[job.ID] = job

			_, err := svc.Resume("job-resume")
			Expect(err).NotTo(HaveOccurred())
			Expect(dirRemover.removed).To(BeEmpty())
		})
	})

	Describe("RetryFailed", func() {
		It("resets failed and skipped items to pending and transitions job to running", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusCompletedWithErrors,
			}
			store.jobs[job.ID] = job
			// B-141: i2 has a valid ComfyUIModelPath (failed at runtime, not path matching).
			// i3 has empty ComfyUIModelPath (skipped due to path matching failure) — re-matching needed.
			pathMatcher.paths["cp3.safetensors"] = "models/cp3.safetensors"
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, Status: model.SampleJobItemStatusCompleted, ComfyUIModelPath: "models/cp1.safetensors"},
				{ID: "i2", JobID: job.ID, Status: model.SampleJobItemStatusFailed, ComfyUIModelPath: "models/cp2.safetensors", ErrorMessage: "VRAM error", ExceptionType: "RuntimeError"},
				{ID: "i3", JobID: job.ID, Status: model.SampleJobItemStatusSkipped, ComfyUIModelPath: "", CheckpointFilename: "cp3.safetensors", ErrorMessage: "checkpoint not found in ComfyUI"},
				{ID: "i4", JobID: job.ID, Status: model.SampleJobItemStatusCompleted, ComfyUIModelPath: "models/cp4.safetensors"},
			}

			result, err := svc.RetryFailed("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Status).To(Equal(model.SampleJobStatusRunning))

			// Verify the job status was updated in the store
			updated, err := svc.Get("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(updated.Status).To(Equal(model.SampleJobStatusRunning))

			// Verify failed/skipped items are reset to pending
			items := store.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusCompleted)) // unchanged
			Expect(items[1].Status).To(Equal(model.SampleJobItemStatusPending))   // was failed
			Expect(items[1].ErrorMessage).To(BeEmpty())
			Expect(items[1].ExceptionType).To(BeEmpty())
			Expect(items[2].Status).To(Equal(model.SampleJobItemStatusPending)) // was skipped
			Expect(items[2].ErrorMessage).To(BeEmpty())
			Expect(items[3].Status).To(Equal(model.SampleJobItemStatusCompleted)) // unchanged
		})

		It("calls RequestResume on the executor", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusCompletedWithErrors,
			}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, Status: model.SampleJobItemStatusFailed, ComfyUIModelPath: "models/cp1.safetensors"},
			}

			_, err := svc.RetryFailed("job-1")
			Expect(err).NotTo(HaveOccurred())
			Expect(executor.resumeCalled).To(BeTrue())
		})

		DescribeTable("returns error when job is not completed_with_errors",
			func(status model.SampleJobStatus) {
				store.jobs["job-1"] = model.SampleJob{
					ID:     "job-1",
					Status: status,
				}

				_, err := svc.RetryFailed("job-1")
				Expect(err).To(HaveOccurred(), "expected error for status %s", status)
				Expect(err.Error()).To(ContainSubstring("cannot retry job"), "unexpected error for status %s", status)
			},
			Entry("pending", model.SampleJobStatusPending),
			Entry("stopped", model.SampleJobStatusStopped),
			Entry("completed", model.SampleJobStatusCompleted),
			Entry("failed", model.SampleJobStatusFailed),
		)

		It("returns error when job status is running (blocked by another running job check)", func() {
			// A running job triggers the "another job is already running" guard before
			// we check the job's own status.
			store.jobs["job-1"] = model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusRunning,
			}

			_, err := svc.RetryFailed("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("another job is already running"))
		})

		It("returns error when job not found", func() {
			_, err := svc.RetryFailed("nonexistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns error when ComfyUI is not connected", func() {
			executor.connected = false
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusCompletedWithErrors,
			}
			store.jobs[job.ID] = job

			_, err := svc.RetryFailed("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("ComfyUI not connected"))
		})

		It("returns error when another job is already running", func() {
			store.jobs["running-job"] = model.SampleJob{
				ID:     "running-job",
				Status: model.SampleJobStatusRunning,
			}
			store.jobs["job-1"] = model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusCompletedWithErrors,
			}

			_, err := svc.RetryFailed("job-1")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("another job is already running"))
		})

		It("does not modify completed items during retry", func() {
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusCompletedWithErrors,
			}
			store.jobs[job.ID] = job
			store.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, Status: model.SampleJobItemStatusCompleted, OutputPath: "/samples/img.png", ComfyUIModelPath: "models/cp1.safetensors"},
				{ID: "i2", JobID: job.ID, Status: model.SampleJobItemStatusFailed, ComfyUIModelPath: "models/cp2.safetensors"},
			}

			_, err := svc.RetryFailed("job-1")
			Expect(err).NotTo(HaveOccurred())

			// Completed item should be unchanged
			items := store.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusCompleted))
			Expect(items[0].OutputPath).To(Equal("/samples/img.png"))
		})

		// B-141: RetryFailed re-runs path matching for items with empty model paths.
		Context("re-matching empty model paths (B-141)", func() {
			It("re-matches checkpoint items with empty ComfyUIModelPath", func() {
				job := model.SampleJob{
					ID:     "job-1",
					Status: model.SampleJobStatusCompletedWithErrors,
					// BaseModel empty = checkpoint job
				}
				store.jobs[job.ID] = job
				store.items[job.ID] = []model.SampleJobItem{
					{ID: "i1", JobID: job.ID, Status: model.SampleJobItemStatusCompleted, ComfyUIModelPath: "models/cp1.safetensors", CheckpointFilename: "cp1.safetensors"},
					{ID: "i2", JobID: job.ID, Status: model.SampleJobItemStatusSkipped, ComfyUIModelPath: "", CheckpointFilename: "cp2.safetensors", ErrorMessage: "checkpoint not found"},
				}
				// Now the path is available
				pathMatcher.paths["cp2.safetensors"] = "models/cp2.safetensors"

				_, err := svc.RetryFailed("job-1")
				Expect(err).NotTo(HaveOccurred())

				items := store.items[job.ID]
				// Completed item unchanged
				Expect(items[0].ComfyUIModelPath).To(Equal("models/cp1.safetensors"))
				// Previously skipped item now has a path
				Expect(items[1].Status).To(Equal(model.SampleJobItemStatusPending))
				Expect(items[1].ComfyUIModelPath).To(Equal("models/cp2.safetensors"))
				Expect(items[1].ErrorMessage).To(BeEmpty())
			})

			It("re-matches LoRA items with empty LoraModelPath", func() {
				loraPathMatcher := newFakePathMatcher()
				svc.SetLoraPathMatcher(loraPathMatcher)

				job := model.SampleJob{
					ID:        "job-lora-1",
					Status:    model.SampleJobStatusCompletedWithErrors,
					BaseModel: "models/base.safetensors", // non-empty = LoRA job
				}
				store.jobs[job.ID] = job
				store.items[job.ID] = []model.SampleJobItem{
					{ID: "i1", JobID: job.ID, Status: model.SampleJobItemStatusCompleted, LoraModelPath: "loras/lora1.safetensors", CheckpointFilename: "lora1.safetensors"},
					{ID: "i2", JobID: job.ID, Status: model.SampleJobItemStatusSkipped, LoraModelPath: "", CheckpointFilename: "lora2.safetensors", ErrorMessage: "checkpoint not found"},
				}
				// Now the LoRA path is available
				loraPathMatcher.paths["lora2.safetensors"] = "loras/lora2.safetensors"

				_, err := svc.RetryFailed("job-lora-1")
				Expect(err).NotTo(HaveOccurred())

				items := store.items[job.ID]
				Expect(items[0].LoraModelPath).To(Equal("loras/lora1.safetensors"))
				Expect(items[1].Status).To(Equal(model.SampleJobItemStatusPending))
				Expect(items[1].LoraModelPath).To(Equal("loras/lora2.safetensors"))
				Expect(items[1].ErrorMessage).To(BeEmpty())
			})

			It("does not overwrite already-matched paths on retry", func() {
				job := model.SampleJob{
					ID:     "job-1",
					Status: model.SampleJobStatusCompletedWithErrors,
				}
				store.jobs[job.ID] = job
				store.items[job.ID] = []model.SampleJobItem{
					// Failed item that already has a valid ComfyUIModelPath (failed for a different reason)
					{ID: "i1", JobID: job.ID, Status: model.SampleJobItemStatusFailed, ComfyUIModelPath: "models/original.safetensors", CheckpointFilename: "cp1.safetensors", ErrorMessage: "VRAM error"},
				}
				// Set up a different path to verify it's NOT used
				pathMatcher.paths["cp1.safetensors"] = "models/different.safetensors"

				_, err := svc.RetryFailed("job-1")
				Expect(err).NotTo(HaveOccurred())

				items := store.items[job.ID]
				// Path should be preserved (not overwritten) since it was already set
				Expect(items[0].ComfyUIModelPath).To(Equal("models/original.safetensors"))
				Expect(items[0].Status).To(Equal(model.SampleJobItemStatusPending))
			})

			It("returns error when re-matching still produces zero viable items", func() {
				job := model.SampleJob{
					ID:     "job-1",
					Status: model.SampleJobStatusCompletedWithErrors,
				}
				store.jobs[job.ID] = job
				store.items[job.ID] = []model.SampleJobItem{
					{ID: "i1", JobID: job.ID, Status: model.SampleJobItemStatusSkipped, ComfyUIModelPath: "", CheckpointFilename: "cp1.safetensors"},
					{ID: "i2", JobID: job.ID, Status: model.SampleJobItemStatusSkipped, ComfyUIModelPath: "", CheckpointFilename: "cp2.safetensors"},
				}
				// pathMatcher has no paths — re-matching will also fail

				_, err := svc.RetryFailed("job-1")
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("all items still have unresolvable model paths"))
			})
		})
	})

	// B-133: updated_at must be stamped on every status transition so the job list
	// can be sorted by most-recently-active rather than creation time.
	Describe("updated_at is set on status transitions", func() {
		DescribeTable("sets updated_at to a non-zero time on each status transition",
			func(fromStatus model.SampleJobStatus, transition func(jobID string) error) {
				// AC: BE: Job updated_at timestamp is set on every status transition
				job := model.SampleJob{
					ID:     "job-ts",
					Status: fromStatus,
				}
				store.jobs[job.ID] = job

				err := transition("job-ts")
				Expect(err).NotTo(HaveOccurred())

				stored := store.jobs["job-ts"]
				Expect(stored.UpdatedAt.IsZero()).To(BeFalse(), "expected UpdatedAt to be set after transition from %s", fromStatus)
			},
			Entry("pending → running (Start)",
				model.SampleJobStatusPending,
				func(id string) error {
					_, err := svc.Start(id)
					return err
				},
			),
			Entry("stopped → running (Resume)",
				model.SampleJobStatusStopped,
				func(id string) error {
					_, err := svc.Resume(id)
					return err
				},
			),
			Entry("running → stopped (Stop, executor fallback)",
				model.SampleJobStatusRunning,
				func(id string) error {
					// Use a failing executor so the service falls back to a direct DB update,
					// which exercises the service-layer updated_at assignment.
					executor.stopErr = fmt.Errorf("job %s is not currently running", id)
					_, err := svc.Stop(id)
					executor.stopErr = nil // reset for other tests
					return err
				},
			),
			Entry("completed_with_errors → running (RetryFailed)",
				model.SampleJobStatusCompletedWithErrors,
				func(id string) error {
					store.items[id] = []model.SampleJobItem{
						{ID: "ri1", JobID: id, Status: model.SampleJobItemStatusFailed, ComfyUIModelPath: "models/cp1.safetensors"},
					}
					_, err := svc.RetryFailed(id)
					return err
				},
			),
		)
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

			// B-164: the remover must receive the training run name and base model
			// so it can resolve the actual on-disk output layout for LoRA jobs.
			job := model.SampleJob{ID: "job-1", StudyName: "My Study", TrainingRunName: "run-x", BaseModel: "loras/base.safetensors"}
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
				Expect(r.trainingRunName).To(Equal("run-x"))
				Expect(r.studyName).To(Equal("My Study"))
				Expect(r.baseModel).To(Equal("loras/base.safetensors"))
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

	Describe("ListProgress", func() {
		It("returns aggregate progress per job that matches GetProgress item counts (parity)", func() {
			// Two jobs with mixed-status items. ListProgress must report the same
			// completed/failed/pending counts as GetProgress for each job.
			store.jobs["job-x"] = model.SampleJob{ID: "job-x", TotalItems: 5}
			store.jobs["job-y"] = model.SampleJob{ID: "job-y", TotalItems: 2}
			store.items["job-x"] = []model.SampleJobItem{
				{ID: "x1", JobID: "job-x", CheckpointFilename: "chk1", Status: model.SampleJobItemStatusCompleted},
				{ID: "x2", JobID: "job-x", CheckpointFilename: "chk1", Status: model.SampleJobItemStatusCompleted},
				{ID: "x3", JobID: "job-x", CheckpointFilename: "chk2", Status: model.SampleJobItemStatusFailed, ErrorMessage: "boom"},
				{ID: "x4", JobID: "job-x", CheckpointFilename: "chk3", Status: model.SampleJobItemStatusSkipped, ErrorMessage: "missing"},
				{ID: "x5", JobID: "job-x", CheckpointFilename: "chk3", Status: model.SampleJobItemStatusPending},
			}
			store.items["job-y"] = []model.SampleJobItem{
				{ID: "y1", JobID: "job-y", CheckpointFilename: "chk1", Status: model.SampleJobItemStatusCompleted},
				{ID: "y2", JobID: "job-y", CheckpointFilename: "chk1", Status: model.SampleJobItemStatusPending},
			}

			listProgress, err := svc.ListProgress()
			Expect(err).NotTo(HaveOccurred())

			for _, jobID := range []string{"job-x", "job-y"} {
				showProgress, err := svc.GetProgress(jobID)
				Expect(err).NotTo(HaveOccurred())
				Expect(listProgress[jobID].ItemCounts).To(Equal(showProgress.ItemCounts),
					"list and show item counts must be identical for %s", jobID)
			}

			Expect(listProgress["job-x"].ItemCounts.Completed).To(Equal(2))
			Expect(listProgress["job-x"].ItemCounts.Failed).To(Equal(2)) // failed + skipped
			Expect(listProgress["job-x"].ItemCounts.Pending).To(Equal(1))
		})

		It("returns the failed item details for failed/skipped items", func() {
			store.jobs["job-f"] = model.SampleJob{ID: "job-f", TotalItems: 2}
			store.items["job-f"] = []model.SampleJobItem{
				{ID: "f1", JobID: "job-f", CheckpointFilename: "chkA", Status: model.SampleJobItemStatusFailed, ErrorMessage: "boom"},
				{ID: "f2", JobID: "job-f", CheckpointFilename: "chkA", Status: model.SampleJobItemStatusCompleted},
			}

			listProgress, err := svc.ListProgress()
			Expect(err).NotTo(HaveOccurred())
			Expect(listProgress["job-f"].FailedItemDetails).To(HaveLen(1))
			Expect(listProgress["job-f"].FailedItemDetails[0].CheckpointFilename).To(Equal("chkA"))
			Expect(listProgress["job-f"].FailedItemDetails[0].ErrorMessage).To(Equal("boom"))
		})

		It("returns an error when the store aggregate query fails", func() {
			store.listJobsProgressErr = errors.New("db error")
			_, err := svc.ListProgress()
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("listing job progress"))
		})
	})
})
