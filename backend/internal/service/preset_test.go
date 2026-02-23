package service_test

import (
	"database/sql"
	"errors"
	"io"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
	"github.com/sirupsen/logrus/hooks/test"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakePresetStore is an in-memory test double for service.PresetStore.
type fakePresetStore struct {
	presets   map[string]model.Preset
	listErr   error
	getErr    error
	createErr error
	updateErr error
	deleteErr error
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
	if f.getErr != nil {
		return model.Preset{}, f.getErr
	}
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
	if f.updateErr != nil {
		return f.updateErr
	}
	if _, ok := f.presets[p.ID]; !ok {
		return sql.ErrNoRows
	}
	f.presets[p.ID] = p
	return nil
}

func (f *fakePresetStore) DeletePreset(id string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.presets[id]; !ok {
		return sql.ErrNoRows
	}
	delete(f.presets, id)
	return nil
}

var _ = Describe("PresetService", func() {
	var (
		store  *fakePresetStore
		svc    *service.PresetService
		logger *logrus.Logger
	)

	BeforeEach(func() {
		store = newFakePresetStore()
		logger = logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests
		svc = service.NewPresetService(store, logger)
	})

	Describe("List", func() {
		It("returns empty slice when no presets exist", func() {
			result, err := svc.List()
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})

		It("returns all presets from the store", func() {
			store.presets["p1"] = model.Preset{ID: "p1", Name: "One"}
			store.presets["p2"] = model.Preset{ID: "p2", Name: "Two"}

			result, err := svc.List()
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
		})

		It("returns error when store fails", func() {
			store.listErr = errors.New("db error")
			_, err := svc.List()
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("db error"))
		})
	})

	Describe("Create", func() {
		It("creates a preset with a generated UUID", func() {
			mapping := model.PresetMapping{
				X:      "cfg",
				Combos: []string{"seed"},
			}

			result, err := svc.Create("Test", mapping)
			Expect(err).NotTo(HaveOccurred())
			Expect(result.ID).NotTo(BeEmpty())
			Expect(result.Name).To(Equal("Test"))
			Expect(result.Mapping.X).To(Equal("cfg"))
			Expect(result.Mapping.Combos).To(Equal([]string{"seed"}))
			Expect(result.CreatedAt).NotTo(BeZero())
			Expect(result.UpdatedAt).NotTo(BeZero())
		})

		It("persists the preset in the store", func() {
			_, err := svc.Create("Stored", model.PresetMapping{Combos: []string{}})
			Expect(err).NotTo(HaveOccurred())
			Expect(store.presets).To(HaveLen(1))
		})

		It("rejects empty name", func() {
			_, err := svc.Create("", model.PresetMapping{Combos: []string{}})
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("name must not be empty"))
		})

		It("returns error when store fails", func() {
			store.createErr = errors.New("insert failed")
			_, err := svc.Create("Test", model.PresetMapping{Combos: []string{}})
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("insert failed"))
		})
	})

	Describe("Update", func() {
		BeforeEach(func() {
			store.presets["existing"] = model.Preset{
				ID:   "existing",
				Name: "Original",
				Mapping: model.PresetMapping{
					X:      "cfg",
					Combos: []string{"seed"},
				},
			}
		})

		It("updates name and mapping", func() {
			newMapping := model.PresetMapping{
				Y:      "prompt",
				Combos: []string{"cfg"},
			}
			result, err := svc.Update("existing", "Renamed", newMapping)
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Name).To(Equal("Renamed"))
			Expect(result.Mapping.Y).To(Equal("prompt"))
			Expect(result.Mapping.X).To(Equal(""))
		})

		It("returns error for non-existent preset", func() {
			_, err := svc.Update("missing", "Name", model.PresetMapping{Combos: []string{}})
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("rejects empty name", func() {
			_, err := svc.Update("existing", "", model.PresetMapping{Combos: []string{}})
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("name must not be empty"))
		})
	})

	Describe("Delete", func() {
		BeforeEach(func() {
			store.presets["to-delete"] = model.Preset{ID: "to-delete", Name: "Remove Me"}
		})

		It("deletes an existing preset", func() {
			err := svc.Delete("to-delete")
			Expect(err).NotTo(HaveOccurred())
			Expect(store.presets).NotTo(HaveKey("to-delete"))
		})

		It("returns error for non-existent preset", func() {
			err := svc.Delete("nonexistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})

	Describe("Logging", func() {
		var (
			hook *test.Hook
		)

		BeforeEach(func() {
			logger, hook = test.NewNullLogger()
			logger.SetLevel(logrus.TraceLevel)
			store = newFakePresetStore()
			svc = service.NewPresetService(store, logger)
		})

		It("logs trace entry/exit for List", func() {
			_, _ = svc.List()

			var traceLogs []string
			for _, entry := range hook.Entries {
				if entry.Level == logrus.TraceLevel {
					traceLogs = append(traceLogs, entry.Message)
				}
			}
			Expect(traceLogs).To(ContainElement("entering List"))
			Expect(traceLogs).To(ContainElement("returning from List"))
		})

		It("logs info on successful create", func() {
			_, _ = svc.Create("Test Preset", model.PresetMapping{Combos: []string{}})

			var infoLogs []string
			for _, entry := range hook.Entries {
				if entry.Level == logrus.InfoLevel {
					infoLogs = append(infoLogs, entry.Message)
				}
			}
			Expect(infoLogs).To(ContainElement("preset created"))
		})

		It("logs error when store fails", func() {
			store.listErr = errors.New("database error")
			_, _ = svc.List()

			var errorLogs []string
			for _, entry := range hook.Entries {
				if entry.Level == logrus.ErrorLevel {
					errorLogs = append(errorLogs, entry.Message)
				}
			}
			Expect(errorLogs).To(ContainElement("failed to list presets"))
		})

		It("logs debug for intermediate values", func() {
			store.presets["test-id"] = model.Preset{ID: "test-id", Name: "Test"}
			_, _ = svc.Update("test-id", "New Name", model.PresetMapping{Combos: []string{}})

			var debugLogs []string
			for _, entry := range hook.Entries {
				if entry.Level == logrus.DebugLevel {
					debugLogs = append(debugLogs, entry.Message)
				}
			}
			Expect(debugLogs).To(ContainElement("fetched existing preset from store"))
		})

		It("logs validation failures at warn level, not error", func() {
			_, _ = svc.Create("", model.PresetMapping{Combos: []string{}})

			var warnLogs []string
			var errorLogs []string
			for _, entry := range hook.Entries {
				if entry.Level == logrus.WarnLevel {
					warnLogs = append(warnLogs, entry.Message)
				}
				if entry.Level == logrus.ErrorLevel {
					errorLogs = append(errorLogs, entry.Message)
				}
			}
			Expect(warnLogs).To(ContainElement("preset name validation failed: name is empty"))
			Expect(errorLogs).NotTo(ContainElement("preset name validation failed: name is empty"))
		})

		It("logs not found conditions at debug level, not error", func() {
			_, _ = svc.Update("nonexistent", "Test", model.PresetMapping{Combos: []string{}})

			var debugLogs []string
			var errorLogs []string
			for _, entry := range hook.Entries {
				if entry.Level == logrus.DebugLevel {
					debugLogs = append(debugLogs, entry.Message)
				}
				if entry.Level == logrus.ErrorLevel {
					errorLogs = append(errorLogs, entry.Message)
				}
			}
			Expect(debugLogs).To(ContainElement("preset not found"))
			Expect(errorLogs).NotTo(ContainElement("preset not found"))
		})
	})
})
