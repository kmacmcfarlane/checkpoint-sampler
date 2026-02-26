package api_test

import (
	"context"
	"database/sql"
	"errors"
	"io"

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
	jobs       map[string]model.SampleJob
	items      map[string][]model.SampleJobItem
	presets    map[string]model.SamplePreset
	listErr    error
	getErr     error
	createErr  error
	updateErr  error
	deleteErr  error
}

func newFakeSampleJobStore() *fakeSampleJobStore {
	return &fakeSampleJobStore{
		jobs:    make(map[string]model.SampleJob),
		items:   make(map[string][]model.SampleJobItem),
		presets: make(map[string]model.SamplePreset),
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

func (f *fakeSampleJobStore) CreateSampleJob(job model.SampleJob) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.jobs[job.ID] = job
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

func (f *fakeSampleJobStore) CreateSampleJobItem(item model.SampleJobItem) error {
	f.items[item.JobID] = append(f.items[item.JobID], item)
	return nil
}

func (f *fakeSampleJobStore) UpdateSampleJobItem(item model.SampleJobItem) error {
	return nil
}

func (f *fakeSampleJobStore) GetSamplePreset(id string) (model.SamplePreset, error) {
	p, ok := f.presets[id]
	if !ok {
		return model.SamplePreset{}, sql.ErrNoRows
	}
	return p, nil
}

// fakePathMatcher is a test double for service.PathMatcher.
type fakePathMatcher struct{}

func (f *fakePathMatcher) MatchCheckpointPath(filename string) (string, error) {
	return filename, nil
}

// fakeSampleDirRemover is a test double for service.SampleDirRemover.
type fakeSampleDirRemover struct{}

func (f *fakeSampleDirRemover) RemoveSampleDir(checkpointFilename string) error {
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
		discovery = service.NewDiscoveryService(fs, []string{}, "", logger)

		// Create sample job service
		sampleJobSvc := service.NewSampleJobService(store, pathMatcher, &fakeSampleDirRemover{}, "/samples", logger)
		sampleJobs = api.NewSampleJobsService(sampleJobSvc, discovery)
	})

	Describe("Error responses include Goa ServiceError structure", func() {
		It("List returns ServiceError with proper fields on store failure", func() {
			store.listErr = errors.New("database connection failed")
			_, err := sampleJobs.List(ctx)
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
})
