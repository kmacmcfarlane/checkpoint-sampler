package api_test

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"sort"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	gensamplejobs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_jobs"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeSampleJobStore is an in-memory test double for service.SampleJobStore.
type fakeSampleJobStore struct {
	jobs      map[string]model.SampleJob
	items     map[string][]model.SampleJobItem
	studies   map[string]model.Study
	listErr   error
	getErr    error
	createErr error
	updateErr error
	deleteErr error
}

func newFakeSampleJobStore() *fakeSampleJobStore {
	return &fakeSampleJobStore{
		jobs:    make(map[string]model.SampleJob),
		items:   make(map[string][]model.SampleJobItem),
		studies: make(map[string]model.Study),
	}
}

func (f *fakeSampleJobStore) ListSampleJobs() ([]model.SampleJob, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	var result []model.SampleJob
	for _, j := range f.jobs {
		result = append(result, j)
	}
	return result, nil
}

func (f *fakeSampleJobStore) ListSampleJobsDesc() ([]model.SampleJob, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	var result []model.SampleJob
	for _, j := range f.jobs {
		result = append(result, j)
	}
	return result, nil
}

// sortedJobsDesc returns all jobs ordered by created_at DESC, id DESC (matching
// the store's ListSampleJobsPage ordering) so pagination tests are deterministic.
func (f *fakeSampleJobStore) sortedJobsDesc() []model.SampleJob {
	result := make([]model.SampleJob, 0, len(f.jobs))
	for _, j := range f.jobs {
		result = append(result, j)
	}
	sort.Slice(result, func(a, b int) bool {
		if result[a].CreatedAt.Equal(result[b].CreatedAt) {
			return result[a].ID > result[b].ID
		}
		return result[a].CreatedAt.After(result[b].CreatedAt)
	})
	return result
}

func (f *fakeSampleJobStore) ListSampleJobsPage(limit, offset int) ([]model.SampleJob, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	sorted := f.sortedJobsDesc()
	if offset >= len(sorted) {
		return []model.SampleJob{}, nil
	}
	end := min(offset+limit, len(sorted))
	return sorted[offset:end], nil
}

func (f *fakeSampleJobStore) CountSampleJobs() (int, error) {
	if f.listErr != nil {
		return 0, f.listErr
	}
	return len(f.jobs), nil
}

func (f *fakeSampleJobStore) GetSampleJob(id string) (model.SampleJob, error) {
	if f.getErr != nil {
		return model.SampleJob{}, f.getErr
	}
	j, ok := f.jobs[id]
	if !ok {
		return model.SampleJob{}, sql.ErrNoRows
	}
	return j, nil
}

func (f *fakeSampleJobStore) HasRunningJob() (bool, error) {
	for _, j := range f.jobs {
		if j.Status == model.SampleJobStatusRunning {
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeSampleJobStore) CreateSampleJobWithItems(job model.SampleJob, items []model.SampleJobItem) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.jobs[job.ID] = job
	for _, item := range items {
		f.items[item.JobID] = append(f.items[item.JobID], item)
	}
	return nil
}

func (f *fakeSampleJobStore) UpdateSampleJob(job model.SampleJob) error {
	if f.updateErr != nil {
		return f.updateErr
	}
	if _, ok := f.jobs[job.ID]; !ok {
		return sql.ErrNoRows
	}
	f.jobs[job.ID] = job
	return nil
}

func (f *fakeSampleJobStore) DeleteSampleJob(id string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.jobs[id]; !ok {
		return sql.ErrNoRows
	}
	delete(f.jobs, id)
	delete(f.items, id)
	return nil
}

func (f *fakeSampleJobStore) ListSampleJobItems(jobID string) ([]model.SampleJobItem, error) {
	items, ok := f.items[jobID]
	if !ok {
		return []model.SampleJobItem{}, nil
	}
	return items, nil
}

func (f *fakeSampleJobStore) ListJobsProgress() (map[string]model.JobListProgress, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	result := make(map[string]model.JobListProgress)
	for jobID, items := range f.items {
		var counts model.ItemStatusCounts
		type detail struct{ exceptionType, nodeType, traceback string }
		byCheckpoint := make(map[string]map[string]detail)
		for _, it := range items {
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
	return result, nil
}

func (f *fakeSampleJobStore) UpdateSampleJobItem(item model.SampleJobItem) error {
	return nil
}

func (f *fakeSampleJobStore) GetStudy(id string) (model.Study, error) {
	s, ok := f.studies[id]
	if !ok {
		return model.Study{}, sql.ErrNoRows
	}
	return s, nil
}

// fakePathMatcher is a test double for service.PathMatcher.
type fakePathMatcher struct{}

func (f *fakePathMatcher) MatchCheckpointPath(filename string) (string, error) {
	return filename, nil
}

// fakeSampleDirRemover is a test double for service.SampleDirRemover.
type fakeSampleDirRemover struct{}

func (f *fakeSampleDirRemover) RemoveCheckpointOutputDir(trainingRunName string, studyName string, checkpointFilename string) error {
	return nil
}

// fakeCheckpointFileSystem is a test double for service.CheckpointFileSystem.
type fakeCheckpointFileSystem struct{}

func (f *fakeCheckpointFileSystem) ListSafetensorsFiles(root string) ([]string, error) {
	return []string{}, nil
}

func (f *fakeCheckpointFileSystem) DirectoryExists(path string) bool {
	return false
}

func (f *fakeCheckpointFileSystem) ListSubdirectories(root string) ([]string, error) {
	return nil, nil
}

var _ = Describe("SampleJobsService", func() {
	var (
		store       *fakeSampleJobStore
		pathMatcher *fakePathMatcher
		fs          *fakeCheckpointFileSystem
		discovery   *service.DiscoveryService
		sampleJobs  *api.SampleJobsService
		ctx         context.Context
		logger      *logrus.Logger
	)

	BeforeEach(func() {
		ctx = context.Background()
		store = newFakeSampleJobStore()
		pathMatcher = &fakePathMatcher{}
		fs = &fakeCheckpointFileSystem{}
		logger = logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests

		// Create discovery service with minimal setup
		discovery = service.NewDiscoveryService(fs, []string{}, nil, "", logger)

		// Create sample job service
		sampleJobSvc := service.NewSampleJobService(store, pathMatcher, &fakeSampleDirRemover{}, "/samples", logger)
		sampleJobs = api.NewSampleJobsService(sampleJobSvc, discovery)
	})

	Describe("Error responses include Goa ServiceError structure", func() {
		It("List returns ServiceError with proper fields on store failure", func() {
			store.listErr = errors.New("database connection failed")
			_, err := sampleJobs.List(ctx, &gensamplejobs.ListPayload{Limit: 50, Offset: 0})
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
			Expect(err.Error()).To(ContainSubstring("listing sample jobs"))
		})

		It("Show returns ServiceError with proper fields on store failure", func() {
			store.getErr = errors.New("database query failed")
			_, err := sampleJobs.Show(ctx, &gensamplejobs.ShowPayload{ID: "test-id"})
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
			Expect(err.Error()).To(ContainSubstring("fetching sample job"))
		})

		It("Show returns not_found ServiceError when job does not exist", func() {
			_, err := sampleJobs.Show(ctx, &gensamplejobs.ShowPayload{ID: "nonexistent"})
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("not_found"))
		})

		It("Delete returns ServiceError with proper fields on internal error", func() {
			// Pre-populate job so GetSampleJob succeeds and reaches DeleteSampleJob
			store.jobs["test-id"] = model.SampleJob{ID: "test-id", StudyName: "study-1"}
			store.deleteErr = errors.New("database write failed")
			err := sampleJobs.Delete(ctx, &gensamplejobs.DeletePayload{ID: "test-id"})
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
			Expect(err.Error()).To(ContainSubstring("deleting sample job"))
		})

		It("Delete returns not_found ServiceError with proper fields", func() {
			err := sampleJobs.Delete(ctx, &gensamplejobs.DeletePayload{ID: "nonexistent"})
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("not_found"))
		})
	})

	Describe("List vs Show progress parity (B-148)", func() {
		// makeItem builds an item for job-parity with the given id and status.
		makeItem := func(id string, status model.SampleJobItemStatus) model.SampleJobItem {
			return model.SampleJobItem{
				ID:                 id,
				JobID:              "job-parity",
				CheckpointFilename: "checkpoint-a.safetensors",
				PromptName:         "test",
				Status:             status,
			}
		}

		BeforeEach(func() {
			// A job whose stored completed_items counter is intentionally WRONG
			// (drifted): it claims 1 completed but the items say 3 completed.
			// Both endpoints must report the item-derived value (3), not the stored 1.
			store.jobs["job-parity"] = model.SampleJob{
				ID:             "job-parity",
				StudyID:        "study-1",
				StudyName:      "study-1",
				Status:         model.SampleJobStatusRunning,
				TotalItems:     5,
				CompletedItems: 1, // stale/drifted stored counter
			}
			store.items["job-parity"] = []model.SampleJobItem{
				makeItem("c1", model.SampleJobItemStatusCompleted),
				makeItem("c2", model.SampleJobItemStatusCompleted),
				makeItem("c3", model.SampleJobItemStatusCompleted),
				makeItem("f1", model.SampleJobItemStatusFailed),
				makeItem("p1", model.SampleJobItemStatusPending),
			}
		})

		It("reports identical completed/failed/pending counts from List and Show for a mixed-status job", func() {
			listResult, err := sampleJobs.List(ctx, &gensamplejobs.ListPayload{Limit: 50, Offset: 0})
			Expect(err).NotTo(HaveOccurred())
			Expect(listResult.Jobs).To(HaveLen(1))
			Expect(listResult.Total).To(Equal(1))
			listJob := listResult.Jobs[0]

			detail, err := sampleJobs.Show(ctx, &gensamplejobs.ShowPayload{ID: "job-parity"})
			Expect(err).NotTo(HaveOccurred())
			showJob := detail.Job

			// List and Show must agree on every progress field.
			Expect(listJob.CompletedItems).To(Equal(showJob.CompletedItems))
			Expect(listJob.FailedItems).To(Equal(showJob.FailedItems))
			Expect(listJob.PendingItems).To(Equal(showJob.PendingItems))

			// And the agreed value must be the item-derived count, not the stale stored counter (1).
			Expect(listJob.CompletedItems).To(Equal(3))
			Expect(listJob.FailedItems).To(Equal(1))
			Expect(listJob.PendingItems).To(Equal(1))
		})
	})

	Describe("Nil guard when ComfyUI is not configured (svc == nil)", func() {
		var disabledSvc *api.SampleJobsService

		BeforeEach(func() {
			// Construct SampleJobsService with nil inner service to simulate
			// a deployment without ComfyUI configured.
			disabledSvc = api.NewSampleJobsService(nil, discovery)
		})

		It("List returns an empty page without error", func() {
			result, err := disabledSvc.List(ctx, &gensamplejobs.ListPayload{Limit: 50, Offset: 0})
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeNil())
			Expect(result.Jobs).To(BeEmpty())
			Expect(result.Total).To(Equal(0))
		})

		It("Show returns service_unavailable ServiceError", func() {
			_, err := disabledSvc.Show(ctx, &gensamplejobs.ShowPayload{ID: "any-id"})
			Expect(err).To(HaveOccurred())
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("service_unavailable"))
		})

		It("Create returns invalid_payload ServiceError", func() {
			_, err := disabledSvc.Create(ctx, &gensamplejobs.CreateSampleJobPayload{
				TrainingRunName: "run-1",
				StudyID:         "study-1",
			})
			Expect(err).To(HaveOccurred())
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("invalid_payload"))
		})

		It("Start returns service_unavailable ServiceError", func() {
			_, err := disabledSvc.Start(ctx, &gensamplejobs.StartPayload{ID: "any-id"})
			Expect(err).To(HaveOccurred())
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("service_unavailable"))
		})

		It("Stop returns internal_error ServiceError", func() {
			_, err := disabledSvc.Stop(ctx, &gensamplejobs.StopPayload{ID: "any-id"})
			Expect(err).To(HaveOccurred())
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
		})

		It("Resume returns service_unavailable ServiceError", func() {
			_, err := disabledSvc.Resume(ctx, &gensamplejobs.ResumePayload{ID: "any-id"})
			Expect(err).To(HaveOccurred())
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("service_unavailable"))
		})

		It("RetryFailed returns service_unavailable ServiceError", func() {
			_, err := disabledSvc.RetryFailed(ctx, &gensamplejobs.RetryFailedPayload{ID: "any-id"})
			Expect(err).To(HaveOccurred())
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("service_unavailable"))
		})

		It("Delete returns internal_error ServiceError", func() {
			err := disabledSvc.Delete(ctx, &gensamplejobs.DeletePayload{ID: "any-id"})
			Expect(err).To(HaveOccurred())
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
		})
	})
})
