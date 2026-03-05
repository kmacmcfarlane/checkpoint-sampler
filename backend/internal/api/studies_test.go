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
})
