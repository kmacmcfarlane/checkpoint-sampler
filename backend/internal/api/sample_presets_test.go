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
	gensamplepresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_presets"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeSamplePresetStore is an in-memory test double for service.SamplePresetStore.
type fakeSamplePresetStore struct {
	presets   map[string]model.SamplePreset
	listErr   error
	createErr error
	updateErr error
	deleteErr error
}

func newFakeSamplePresetStore() *fakeSamplePresetStore {
	return &fakeSamplePresetStore{presets: make(map[string]model.SamplePreset)}
}

func (f *fakeSamplePresetStore) ListSamplePresets() ([]model.SamplePreset, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	var result []model.SamplePreset
	for _, p := range f.presets {
		result = append(result, p)
	}
	return result, nil
}

func (f *fakeSamplePresetStore) GetSamplePreset(id string) (model.SamplePreset, error) {
	p, ok := f.presets[id]
	if !ok {
		return model.SamplePreset{}, sql.ErrNoRows
	}
	return p, nil
}

func (f *fakeSamplePresetStore) CreateSamplePreset(p model.SamplePreset) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.presets[p.ID] = p
	return nil
}

func (f *fakeSamplePresetStore) UpdateSamplePreset(p model.SamplePreset) error {
	if f.updateErr != nil {
		return f.updateErr
	}
	if _, ok := f.presets[p.ID]; !ok {
		return sql.ErrNoRows
	}
	f.presets[p.ID] = p
	return nil
}

func (f *fakeSamplePresetStore) DeleteSamplePreset(id string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.presets[id]; !ok {
		return sql.ErrNoRows
	}
	delete(f.presets, id)
	return nil
}

var _ = Describe("SamplePresetsService", func() {
	var (
		store          *fakeSamplePresetStore
		samplePresets  *api.SamplePresetsService
		ctx            context.Context
		logger         *logrus.Logger
	)

	BeforeEach(func() {
		ctx = context.Background()
		store = newFakeSamplePresetStore()
		logger = logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests
		samplePresetSvc := service.NewSamplePresetService(store, logger)
		samplePresets = api.NewSamplePresetsService(samplePresetSvc)
	})

	Describe("Error responses include Goa ServiceError structure", func() {
		It("List returns ServiceError with proper fields on store failure", func() {
			store.listErr = errors.New("database connection failed")
			_, err := samplePresets.List(ctx)
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
			Expect(err.Error()).To(ContainSubstring("listing sample presets"))
		})

		It("Delete returns ServiceError with proper fields on internal error", func() {
			store.deleteErr = errors.New("database write failed")
			err := samplePresets.Delete(ctx, &gensamplepresets.DeletePayload{ID: "test-id"})
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("internal_error"))
			Expect(err.Error()).To(ContainSubstring("deleting sample preset"))
		})

		It("Delete returns not_found ServiceError with proper fields", func() {
			err := samplePresets.Delete(ctx, &gensamplepresets.DeletePayload{ID: "nonexistent"})
			Expect(err).To(HaveOccurred())

			// Verify it's a Goa ServiceError with proper structure
			serviceErr, ok := err.(errorNamer)
			Expect(ok).To(BeTrue(), "error should implement ErrorNamer interface")
			Expect(serviceErr.ErrorName()).To(Equal("not_found"))
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})
})
