package api_test

import (
	"context"
	"database/sql"
	"errors"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	genpresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/presets"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakePresetStore is an in-memory test double for service.PresetStore.
type fakePresetStore struct {
	presets   map[string]model.Preset
	listErr   error
	createErr error
}

func newFakePresetStore() *fakePresetStore {
	return &fakePresetStore{presets: make(map[string]model.Preset)}
}

func (f *fakePresetStore) ListPresets() ([]model.Preset, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	var result []model.Preset
	for _, p := range f.presets {
		result = append(result, p)
	}
	return result, nil
}

func (f *fakePresetStore) GetPreset(id string) (model.Preset, error) {
	p, ok := f.presets[id]
	if !ok {
		return model.Preset{}, sql.ErrNoRows
	}
	return p, nil
}

func (f *fakePresetStore) CreatePreset(p model.Preset) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.presets[p.ID] = p
	return nil
}

func (f *fakePresetStore) UpdatePreset(p model.Preset) error {
	if _, ok := f.presets[p.ID]; !ok {
		return sql.ErrNoRows
	}
	f.presets[p.ID] = p
	return nil
}

func (f *fakePresetStore) DeletePreset(id string) error {
	if _, ok := f.presets[id]; !ok {
		return sql.ErrNoRows
	}
	delete(f.presets, id)
	return nil
}

var _ = Describe("PresetsService", func() {
	var (
		store   *fakePresetStore
		presets *api.PresetsService
		ctx     context.Context
	)

	BeforeEach(func() {
		ctx = context.Background()
		store = newFakePresetStore()
		presetSvc := service.NewPresetService(store)
		presets = api.NewPresetsService(presetSvc)
	})

	Describe("List", func() {
		It("returns empty slice when no presets exist", func() {
			result, err := presets.List(ctx)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})

		It("returns all presets with correct response mapping", func() {
			store.presets["p1"] = model.Preset{
				ID:   "p1",
				Name: "Config A",
				Mapping: model.PresetMapping{
					X:      "cfg",
					Y:      "prompt",
					Combos: []string{"seed"},
				},
			}

			result, err := presets.List(ctx)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].ID).To(Equal("p1"))
			Expect(result[0].Name).To(Equal("Config A"))
			Expect(*result[0].Mapping.X).To(Equal("cfg"))
			Expect(*result[0].Mapping.Y).To(Equal("prompt"))
			Expect(result[0].Mapping.Slider).To(BeNil())
			Expect(result[0].Mapping.Combos).To(Equal([]string{"seed"}))
		})

		It("returns error when store fails", func() {
			store.listErr = errors.New("db error")
			_, err := presets.List(ctx)
			Expect(err).To(HaveOccurred())
		})
	})

	Describe("Create", func() {
		It("creates a preset and returns the response", func() {
			x := "cfg"
			payload := &genpresets.CreatePresetPayload{
				Name: "New Preset",
				Mapping: &genpresets.PresetMappingPayload{
					X:      &x,
					Combos: []string{"seed"},
				},
			}

			result, err := presets.Create(ctx, payload)
			Expect(err).NotTo(HaveOccurred())
			Expect(result.ID).NotTo(BeEmpty())
			Expect(result.Name).To(Equal("New Preset"))
			Expect(*result.Mapping.X).To(Equal("cfg"))
			Expect(result.Mapping.Combos).To(Equal([]string{"seed"}))
			Expect(result.CreatedAt).NotTo(BeEmpty())
		})

		It("returns invalid_payload error for empty name", func() {
			payload := &genpresets.CreatePresetPayload{
				Name: "",
				Mapping: &genpresets.PresetMappingPayload{
					Combos: []string{},
				},
			}

			_, err := presets.Create(ctx, payload)
			Expect(err).To(HaveOccurred())
		})
	})

	Describe("Update", func() {
		BeforeEach(func() {
			store.presets["existing"] = model.Preset{
				ID:   "existing",
				Name: "Original",
				Mapping: model.PresetMapping{
					X:      "cfg",
					Combos: []string{},
				},
			}
		})

		It("updates a preset and returns the response", func() {
			y := "prompt"
			payload := &genpresets.UpdatePresetPayload{
				ID:   "existing",
				Name: "Updated",
				Mapping: &genpresets.PresetMappingPayload{
					Y:      &y,
					Combos: []string{"cfg"},
				},
			}

			result, err := presets.Update(ctx, payload)
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Name).To(Equal("Updated"))
			Expect(result.Mapping.X).To(BeNil())
			Expect(*result.Mapping.Y).To(Equal("prompt"))
			Expect(result.Mapping.Combos).To(Equal([]string{"cfg"}))
		})

		It("returns not_found error for non-existent preset", func() {
			payload := &genpresets.UpdatePresetPayload{
				ID:   "nonexistent",
				Name: "Ghost",
				Mapping: &genpresets.PresetMappingPayload{
					Combos: []string{},
				},
			}

			_, err := presets.Update(ctx, payload)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})

	Describe("Delete", func() {
		BeforeEach(func() {
			store.presets["to-delete"] = model.Preset{
				ID:   "to-delete",
				Name: "Delete Me",
			}
		})

		It("deletes an existing preset", func() {
			err := presets.Delete(ctx, &genpresets.DeletePayload{ID: "to-delete"})
			Expect(err).NotTo(HaveOccurred())
			Expect(store.presets).NotTo(HaveKey("to-delete"))
		})

		It("returns not_found error for non-existent preset", func() {
			err := presets.Delete(ctx, &genpresets.DeletePayload{ID: "nonexistent"})
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})
})
