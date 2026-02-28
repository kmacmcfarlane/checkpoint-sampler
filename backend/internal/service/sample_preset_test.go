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

// fakeSamplePresetStore is an in-memory test double for service.SamplePresetStore.
type fakeSamplePresetStore struct {
	presets   map[string]model.SamplePreset
	listErr   error
	getErr    error
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
	if f.getErr != nil {
		return model.SamplePreset{}, f.getErr
	}
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

var _ = Describe("SamplePresetService", func() {
	var (
		store  *fakeSamplePresetStore
		svc    *service.SamplePresetService
		logger *logrus.Logger
	)

	BeforeEach(func() {
		store = newFakeSamplePresetStore()
		logger = logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests
		svc = service.NewSamplePresetService(store, logger)
	})

	Describe("List", func() {
		It("returns empty slice when no presets exist", func() {
			result, err := svc.List()
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})

		It("returns all sample presets from the store", func() {
			store.presets["p1"] = model.SamplePreset{ID: "p1", Name: "One"}
			store.presets["p2"] = model.SamplePreset{ID: "p2", Name: "Two"}

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
		var validPrompts []model.NamedPrompt
		var validSteps []int
		var validCFGs []float64
		var validPairs []model.SamplerSchedulerPair
		var validSeeds []int64

		BeforeEach(func() {
			validPrompts = []model.NamedPrompt{
				{Name: "prompt1", Text: "a test prompt"},
			}
			validSteps = []int{4, 8}
			validCFGs = []float64{1.0, 3.0}
			validPairs = []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "simple"},
			}
			validSeeds = []int64{420}
		})

		It("creates a sample preset with valid inputs", func() {
			result, err := svc.Create("Test", validPrompts, "negative", validSteps, validCFGs, validPairs, validSeeds, 1344, 1344)
			Expect(err).NotTo(HaveOccurred())
			Expect(result.ID).NotTo(BeEmpty())
			Expect(result.Name).To(Equal("Test"))
			Expect(result.Prompts).To(Equal(validPrompts))
			Expect(result.NegativePrompt).To(Equal("negative"))
			Expect(result.Steps).To(Equal(validSteps))
			Expect(result.CFGs).To(Equal(validCFGs))
			Expect(result.SamplerSchedulerPairs).To(Equal(validPairs))
			Expect(result.Seeds).To(Equal(validSeeds))
			Expect(result.Width).To(Equal(1344))
			Expect(result.Height).To(Equal(1344))
			Expect(result.CreatedAt).NotTo(BeZero())
			Expect(result.UpdatedAt).NotTo(BeZero())
		})

		It("persists the preset in the store", func() {
			_, err := svc.Create("Stored", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512)
			Expect(err).NotTo(HaveOccurred())
			Expect(store.presets).To(HaveLen(1))
		})

		It("rejects empty name", func() {
			_, err := svc.Create("", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("name must not be empty"))
		})

		It("returns error when store fails", func() {
			store.createErr = errors.New("insert failed")
			_, err := svc.Create("Test", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("insert failed"))
		})
	})

	Describe("Validation", func() {
		type validationTestCase struct {
			name          string
			prompts       []model.NamedPrompt
			steps         []int
			cfgs          []float64
			pairs         []model.SamplerSchedulerPair
			seeds         []int64
			width         int
			height        int
			expectedError string
		}

		DescribeTable("validates required fields and constraints",
			func(tc validationTestCase) {
				_, err := svc.Create(tc.name, tc.prompts, "", tc.steps, tc.cfgs, tc.pairs, tc.seeds, tc.width, tc.height)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring(tc.expectedError))
			},
			Entry("rejects empty name",
				validationTestCase{
					name:          "",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "name must not be empty",
				}),
			Entry("rejects empty prompts",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "at least one prompt is required",
				}),
			Entry("rejects prompt with empty name",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "prompt 0 name must not be empty",
				}),
			Entry("rejects prompt with empty text",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "name", Text: ""}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "prompt 0 text must not be empty",
				}),
			Entry("rejects empty steps",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "at least one step count is required",
				}),
			Entry("rejects zero step",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{0},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "step 0 must be positive",
				}),
			Entry("rejects negative step",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{-1},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "step 0 must be positive",
				}),
			Entry("rejects empty cfgs",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "at least one CFG value is required",
				}),
			Entry("rejects zero cfg",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "CFG 0 must be positive",
				}),
			Entry("rejects negative cfg",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{-1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "CFG 0 must be positive",
				}),
			Entry("rejects empty sampler/scheduler pairs",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "at least one sampler/scheduler pair is required",
				}),
			Entry("rejects pair with empty sampler",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "pair 0 sampler must not be empty",
				}),
			Entry("rejects pair with empty scheduler",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: ""}},
					seeds:         []int64{420},
					width:         512,
					height:        512,
					expectedError: "pair 0 scheduler must not be empty",
				}),
			Entry("rejects empty seeds",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{},
					width:         512,
					height:        512,
					expectedError: "at least one seed is required",
				}),
			Entry("rejects zero width",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         0,
					height:        512,
					expectedError: "width must be positive",
				}),
			Entry("rejects negative width",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         -1,
					height:        512,
					expectedError: "width must be positive",
				}),
			Entry("rejects zero height",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        0,
					expectedError: "height must be positive",
				}),
			Entry("rejects negative height",
				validationTestCase{
					name:          "Test",
					prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
					steps:         []int{4},
					cfgs:          []float64{1.0},
					pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
					seeds:         []int64{420},
					width:         512,
					height:        -1,
					expectedError: "height must be positive",
				}),
		)
	})

	Describe("Update", func() {
		var validPrompts []model.NamedPrompt
		var validSteps []int
		var validCFGs []float64
		var validPairs []model.SamplerSchedulerPair
		var validSeeds []int64

		BeforeEach(func() {
			validPrompts = []model.NamedPrompt{
				{Name: "prompt1", Text: "a test prompt"},
			}
			validSteps = []int{4, 8}
			validCFGs = []float64{1.0, 3.0}
			validPairs = []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "simple"},
			}
			validSeeds = []int64{420}

			store.presets["existing"] = model.SamplePreset{
				ID:             "existing",
				Name:           "Original",
				Prompts:        validPrompts,
				NegativePrompt: "",
				Steps:          []int{1},
				CFGs:           []float64{1.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "simple"},
				},
				Seeds:  []int64{100},
				Width:  512,
				Height: 512,
			}
		})

		It("updates all fields", func() {
			newPrompts := []model.NamedPrompt{
				{Name: "new_prompt", Text: "new text"},
			}
			newPairs := []model.SamplerSchedulerPair{
				{Sampler: "dpmpp_2m", Scheduler: "sgm_uniform"},
			}
			result, err := svc.Update("existing", "Renamed", newPrompts, "new negative", validSteps, validCFGs, newPairs, validSeeds, 1344, 1344)
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Name).To(Equal("Renamed"))
			Expect(result.Prompts).To(Equal(newPrompts))
			Expect(result.NegativePrompt).To(Equal("new negative"))
			Expect(result.Steps).To(Equal(validSteps))
			Expect(result.CFGs).To(Equal(validCFGs))
			Expect(result.SamplerSchedulerPairs).To(Equal(newPairs))
			Expect(result.Width).To(Equal(1344))
			Expect(result.Height).To(Equal(1344))
		})

		It("returns error for non-existent preset", func() {
			_, err := svc.Update("missing", "Name", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("rejects invalid inputs during update", func() {
			_, err := svc.Update("existing", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("name must not be empty"))
		})
	})

	Describe("Delete", func() {
		BeforeEach(func() {
			store.presets["to-delete"] = model.SamplePreset{ID: "to-delete", Name: "Remove Me"}
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

	Describe("ImagesPerCheckpoint calculation", func() {
		// AC: Images-per-checkpoint = prompts x steps x cfgs x pairs x seeds
		It("calculates total correctly with pairs instead of cross-product", func() {
			prompts := []model.NamedPrompt{
				{Name: "p1", Text: "text1"},
				{Name: "p2", Text: "text2"},
			}
			steps := []int{4, 8}
			cfgs := []float64{1.0, 3.0}
			// 2 explicit pairs instead of 1 sampler x 2 schedulers cross-product
			pairs := []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "simple"},
				{Sampler: "euler", Scheduler: "normal"},
			}
			seeds := []int64{420, 421}

			result, err := svc.Create("Test", prompts, "", steps, cfgs, pairs, seeds, 512, 512)
			Expect(err).NotTo(HaveOccurred())
			// 2 prompts * 2 steps * 2 cfgs * 2 pairs * 2 seeds = 32
			Expect(result.ImagesPerCheckpoint()).To(Equal(32))
		})

		It("calculates correctly with a single pair", func() {
			prompts := []model.NamedPrompt{
				{Name: "p1", Text: "text1"},
			}
			steps := []int{4}
			cfgs := []float64{1.0}
			pairs := []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			}
			seeds := []int64{420}

			result, err := svc.Create("Test", prompts, "", steps, cfgs, pairs, seeds, 512, 512)
			Expect(err).NotTo(HaveOccurred())
			// 1 prompt * 1 step * 1 cfg * 1 pair * 1 seed = 1
			Expect(result.ImagesPerCheckpoint()).To(Equal(1))
		})
	})
})
