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
	genstudies "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/studies"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeSampleCheckerAPI is a test double for service.StudySampleChecker.
type fakeSampleCheckerAPI struct {
	hasSamples bool
	err        error
}

func (f *fakeSampleCheckerAPI) StudyHasSamples(study model.Study) (bool, error) {
	return f.hasSamples, f.err
}

// fakeStudyStoreAPI is an in-memory test double for service.StudyStore.
type fakeStudyStoreAPI struct {
	studies   map[string]model.Study
	listErr   error
	createErr error
	updateErr error
	deleteErr error
}

func newFakeStudyStoreAPI() *fakeStudyStoreAPI {
	return &fakeStudyStoreAPI{studies: make(map[string]model.Study)}
}

func (f *fakeStudyStoreAPI) ListStudies() ([]model.Study, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	var result []model.Study
	for _, p := range f.studies {
		result = append(result, p)
	}
	return result, nil
}

func (f *fakeStudyStoreAPI) GetStudy(id string) (model.Study, error) {
	p, ok := f.studies[id]
	if !ok {
		return model.Study{}, sql.ErrNoRows
	}
	return p, nil
}

func (f *fakeStudyStoreAPI) CreateStudy(p model.Study) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.studies[p.ID] = p
	return nil
}

func (f *fakeStudyStoreAPI) UpdateStudy(p model.Study) error {
	if f.updateErr != nil {
		return f.updateErr
	}
	if _, ok := f.studies[p.ID]; !ok {
		return sql.ErrNoRows
	}
	f.studies[p.ID] = p
	return nil
}

func (f *fakeStudyStoreAPI) GetStudyByName(name string, excludeID string) (model.Study, error) {
	for _, p := range f.studies {
		if p.Name == name && p.ID != excludeID {
			return p, nil
		}
	}
	return model.Study{}, sql.ErrNoRows
}

func (f *fakeStudyStoreAPI) DeleteStudy(id string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.studies[id]; !ok {
		return sql.ErrNoRows
	}
	delete(f.studies, id)
	return nil
}

// fakeDiscoverer implements api.TrainingRunDiscoverer for testing.
type fakeDiscoverer struct {
	runs []model.TrainingRun
	err  error
}

func (f *fakeDiscoverer) Discover() ([]model.TrainingRun, error) {
	return f.runs, f.err
}

// fakeAvailabilityFSAPI implements service.StudyAvailabilityFileSystem for testing.
type fakeAvailabilityFSAPI struct {
	subdirs  map[string][]string
	dirExist map[string]bool
}

func newFakeAvailabilityFSAPI() *fakeAvailabilityFSAPI {
	return &fakeAvailabilityFSAPI{
		subdirs:  make(map[string][]string),
		dirExist: make(map[string]bool),
	}
}

func (f *fakeAvailabilityFSAPI) ListSubdirectories(root string) ([]string, error) {
	dirs, ok := f.subdirs[root]
	if !ok {
		return []string{}, nil
	}
	return dirs, nil
}

func (f *fakeAvailabilityFSAPI) DirectoryExists(path string) bool {
	return f.dirExist[path]
}

var _ = Describe("StudiesService", func() {
	var (
		store   *fakeStudyStoreAPI
		studies *api.StudiesService
		ctx     context.Context
		logger  *logrus.Logger
	)

	BeforeEach(func() {
		ctx = context.Background()
		store = newFakeStudyStoreAPI()
		logger = logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests
		sampleChecker := &fakeSampleCheckerAPI{}
		studySvc := service.NewStudyService(store, sampleChecker, logger)
		studies = api.NewStudiesService(studySvc, nil, nil)
	})

	Describe("Error responses include Goa ServiceError structure", func() {
		It("List returns ServiceError with proper fields on store failure", func() {
			store.listErr = errors.New("database connection failed")
			_, err := studies.List(ctx)
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
			Expect(err.Error()).To(ContainSubstring("listing studies"))
		})

		It("Delete returns ServiceError with proper fields on internal error", func() {
			store.studies["test-id"] = model.Study{ID: "test-id", Name: "Test Study"}
			store.deleteErr = errors.New("database write failed")
			err := studies.Delete(ctx, &genstudies.DeletePayload{ID: "test-id"})
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
			Expect(err.Error()).To(ContainSubstring("deleting study"))
		})

		It("Delete returns not_found ServiceError with proper fields", func() {
			err := studies.Delete(ctx, &genstudies.DeletePayload{ID: "nonexistent"})
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("not_found"))
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})

	Describe("Availability", func() {
		var (
			availStore   *fakeStudyStoreAPI
			availFS      *fakeAvailabilityFSAPI
			discoverer   *fakeDiscoverer
			availStudies *api.StudiesService
		)

		BeforeEach(func() {
			availStore = newFakeStudyStoreAPI()
			availFS = newFakeAvailabilityFSAPI()
			discoverer = &fakeDiscoverer{}
			sampleChecker := &fakeSampleCheckerAPI{}
			studySvc := service.NewStudyService(availStore, sampleChecker, logger)
			availabilitySvc := service.NewStudyAvailabilityService(availFS, "/samples", logger)
			availStudies = api.NewStudiesService(studySvc, availabilitySvc, discoverer)
		})

		It("returns per-study availability for a valid training run", func() {
			// Set up store with two studies
			availStore.studies["s1"] = model.Study{ID: "s1", Name: "StudyA"}
			availStore.studies["s2"] = model.Study{ID: "s2", Name: "StudyB"}

			// Set up discoverer with one training run
			discoverer.runs = []model.TrainingRun{
				{
					Name: "model-run",
					Checkpoints: []model.Checkpoint{
						{Filename: "cp1.safetensors"},
					},
				},
			}
			// Path pattern: {sampleDir}/{sanitized_run_name}/{study_name}
			availFS.subdirs["/samples/model-run/StudyA"] = []string{"cp1.safetensors"}
			availFS.subdirs["/samples/model-run/StudyB"] = []string{"other.safetensors"}

			result, err := availStudies.Availability(ctx, &genstudies.AvailabilityPayload{TrainingRunID: 0})
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))

			// Find entries by study ID (order may vary from map iteration)
			var studyA, studyB *genstudies.StudyAvailabilityResponse
			for _, r := range result {
				switch r.StudyID {
				case "s1":
					studyA = r
				case "s2":
					studyB = r
				}
			}
			Expect(studyA).NotTo(BeNil())
			Expect(studyA.StudyName).To(Equal("StudyA"))
			Expect(studyA.HasSamples).To(BeTrue())

			Expect(studyB).NotTo(BeNil())
			Expect(studyB.StudyName).To(Equal("StudyB"))
			Expect(studyB.HasSamples).To(BeFalse())
		})

		It("returns not_found error when training run ID is out of range", func() {
			discoverer.runs = []model.TrainingRun{
				{Name: "only-run", Checkpoints: []model.Checkpoint{}},
			}

			_, err := availStudies.Availability(ctx, &genstudies.AvailabilityPayload{TrainingRunID: 5})
			Expect(err).To(HaveOccurred())

			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("not_found"))
		})

		It("returns internal_error when discovery fails", func() {
			discoverer.err = errors.New("filesystem unavailable")

			_, err := availStudies.Availability(ctx, &genstudies.AvailabilityPayload{TrainingRunID: 0})
			Expect(err).To(HaveOccurred())

			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
			Expect(err.Error()).To(ContainSubstring("discovering training runs"))
		})

		It("returns internal_error when listing studies fails", func() {
			availStore.listErr = errors.New("db error")
			discoverer.runs = []model.TrainingRun{
				{Name: "run", Checkpoints: []model.Checkpoint{}},
			}

			_, err := availStudies.Availability(ctx, &genstudies.AvailabilityPayload{TrainingRunID: 0})
			Expect(err).To(HaveOccurred())

			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
			Expect(err.Error()).To(ContainSubstring("listing studies"))
		})

		It("returns empty result when no studies exist", func() {
			discoverer.runs = []model.TrainingRun{
				{Name: "run", Checkpoints: []model.Checkpoint{{Filename: "cp.safetensors"}}},
			}

			result, err := availStudies.Availability(ctx, &genstudies.AvailabilityPayload{TrainingRunID: 0})
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(BeEmpty())
		})
	})
})
