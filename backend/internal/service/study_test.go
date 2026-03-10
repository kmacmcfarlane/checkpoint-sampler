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

// fakeStudyStore is an in-memory test double for service.StudyStore.
type fakeStudyStore struct {
	studies      map[string]model.Study
	listErr      error
	getErr       error
	getByNameErr error
	createErr    error
	updateErr    error
	deleteErr    error
}

func newFakeStudyStore() *fakeStudyStore {
	return &fakeStudyStore{studies: make(map[string]model.Study)}
}

func (f *fakeStudyStore) ListStudies() ([]model.Study, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	var result []model.Study
	for _, p := range f.studies {
		result = append(result, p)
	}
	return result, nil
}

func (f *fakeStudyStore) GetStudy(id string) (model.Study, error) {
	if f.getErr != nil {
		return model.Study{}, f.getErr
	}
	p, ok := f.studies[id]
	if !ok {
		return model.Study{}, sql.ErrNoRows
	}
	return p, nil
}

func (f *fakeStudyStore) GetStudyByName(name string, excludeID string) (model.Study, error) {
	if f.getByNameErr != nil {
		return model.Study{}, f.getByNameErr
	}
	for _, p := range f.studies {
		if p.Name == name && p.ID != excludeID {
			return p, nil
		}
	}
	return model.Study{}, sql.ErrNoRows
}

func (f *fakeStudyStore) CreateStudy(p model.Study) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.studies[p.ID] = p
	return nil
}

func (f *fakeStudyStore) UpdateStudy(p model.Study) error {
	if f.updateErr != nil {
		return f.updateErr
	}
	if _, ok := f.studies[p.ID]; !ok {
		return sql.ErrNoRows
	}
	f.studies[p.ID] = p
	return nil
}

func (f *fakeStudyStore) DeleteStudy(id string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.studies[id]; !ok {
		return sql.ErrNoRows
	}
	delete(f.studies, id)
	return nil
}

// fakeSampleChecker is a test double for service.StudySampleChecker.
type fakeSampleChecker struct {
	results map[string]bool
	err     error
}

func newFakeSampleChecker() *fakeSampleChecker {
	return &fakeSampleChecker{results: make(map[string]bool)}
}

func (f *fakeSampleChecker) StudyHasSamples(study model.Study) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	return f.results[study.ID], nil
}

// fakeSampleRemover is a test double for service.StudySampleDirRemover.
type fakeSampleRemover struct {
	removed []string
	err     error
}

func newFakeSampleRemover() *fakeSampleRemover {
	return &fakeSampleRemover{}
}

func (f *fakeSampleRemover) RemoveStudySampleDir(studyName string) error {
	if f.err != nil {
		return f.err
	}
	f.removed = append(f.removed, studyName)
	return nil
}

var _ = Describe("StudyService", func() {
	var (
		store         *fakeStudyStore
		sampleChecker *fakeSampleChecker
		svc           *service.StudyService
		logger        *logrus.Logger
	)

	BeforeEach(func() {
		store = newFakeStudyStore()
		sampleChecker = newFakeSampleChecker()
		logger = logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests
		svc = service.NewStudyService(store, sampleChecker, logger)
	})

	Describe("List", func() {
		It("returns empty slice when no studies exist", func() {
			result, err := svc.List()
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})

		It("returns all studies from the store", func() {
			store.studies["p1"] = model.Study{ID: "p1", Name: "One"}
			store.studies["p2"] = model.Study{ID: "p2", Name: "Two"}

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

		It("creates a study with valid inputs", func() {
			result, err := svc.Create("Test", "", validPrompts, "negative", validSteps, validCFGs, validPairs, validSeeds, 1344, 1344, "", "", "", nil)
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

		It("uses study name as output dir name", func() {
			result, err := svc.Create("OutputTest", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).NotTo(HaveOccurred())
			Expect(result.OutputDirName()).To(Equal("OutputTest"))
		})

		It("persists the study in the store", func() {
			_, err := svc.Create("Stored", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).NotTo(HaveOccurred())
			Expect(store.studies).To(HaveLen(1))
		})

		It("rejects empty name", func() {
			_, err := svc.Create("", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("name must not be empty"))
		})

		It("returns error when store fails", func() {
			store.createErr = errors.New("insert failed")
			_, err := svc.Create("Test", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
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
				_, err := svc.Create(tc.name, "", tc.prompts, "", tc.steps, tc.cfgs, tc.pairs, tc.seeds, tc.width, tc.height, "", "", "", nil)
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
		Entry("rejects duplicate step values",
			validationTestCase{
				name:          "Test",
				prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
				steps:         []int{4, 8, 4},
				cfgs:          []float64{1.0},
				pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
				seeds:         []int64{420},
				width:         512,
				height:        512,
				expectedError: "duplicate step value 4",
			}),
		Entry("rejects duplicate CFG values",
			validationTestCase{
				name:          "Test",
				prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
				steps:         []int{4},
				cfgs:          []float64{1.0, 3.0, 1.0},
				pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
				seeds:         []int64{420},
				width:         512,
				height:        512,
				expectedError: "duplicate CFG value 1",
			}),
		Entry("rejects duplicate sampler/scheduler pairs",
			validationTestCase{
				name:    "Test",
				prompts: []model.NamedPrompt{{Name: "p1", Text: "text"}},
				steps:   []int{4},
				cfgs:    []float64{1.0},
				pairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "simple"},
					{Sampler: "heun", Scheduler: "normal"},
					{Sampler: "euler", Scheduler: "simple"},
				},
				seeds:         []int64{420},
				width:         512,
				height:        512,
				expectedError: `duplicate sampler/scheduler pair "euler"/"simple"`,
			}),
		Entry("rejects duplicate seed values",
			validationTestCase{
				name:          "Test",
				prompts:       []model.NamedPrompt{{Name: "p1", Text: "text"}},
				steps:         []int{4},
				cfgs:          []float64{1.0},
				pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
				seeds:         []int64{420, 100, 420},
				width:         512,
				height:        512,
				expectedError: "duplicate seed value 420",
			}),
		Entry("rejects duplicate prompt names",
			validationTestCase{
				name: "Test",
				prompts: []model.NamedPrompt{
					{Name: "forest", Text: "a forest"},
					{Name: "city", Text: "a city"},
					{Name: "forest", Text: "another forest"},
				},
				steps:         []int{4},
				cfgs:          []float64{1.0},
				pairs:         []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
				seeds:         []int64{420},
				width:         512,
				height:        512,
				expectedError: `duplicate prompt name "forest"`,
			}),
		)
	})

	Describe("Filename character validation", func() {
		type filenameTestCase struct {
			name          string
			expectError   bool
			expectedError string
		}

		validPrompts := []model.NamedPrompt{{Name: "p1", Text: "text"}}
		validSteps := []int{4}
		validCFGs := []float64{1.0}
		validPairs := []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}}
		validSeeds := []int64{420}

		DescribeTable("validates study name filesystem safety",
			func(tc filenameTestCase) {
				_, err := svc.Create(tc.name, "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
				if tc.expectError {
					Expect(err).To(HaveOccurred())
					Expect(err.Error()).To(ContainSubstring(tc.expectedError))
				} else {
					Expect(err).NotTo(HaveOccurred())
				}
			},
			// AC: Valid names must be accepted
			Entry("accepts alphanumeric name",
				filenameTestCase{name: "MyStudy123", expectError: false}),
			Entry("accepts name with hyphens",
				filenameTestCase{name: "my-study-v2", expectError: false}),
			Entry("accepts name with underscores",
				filenameTestCase{name: "my_study_v2", expectError: false}),
			Entry("accepts name with dots",
				filenameTestCase{name: "my.study.v2", expectError: false}),
			Entry("accepts name with spaces",
				filenameTestCase{name: "My Study Config", expectError: false}),
			// AC: Problematic characters must be rejected
			Entry("rejects name with opening parenthesis",
				filenameTestCase{name: "study(1)", expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with closing parenthesis",
				filenameTestCase{name: "study)1", expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with forward slash",
				filenameTestCase{name: "study/v2", expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with backslash",
				filenameTestCase{name: `study\v2`, expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with colon",
				filenameTestCase{name: "study:v2", expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with asterisk",
				filenameTestCase{name: "study*", expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with question mark",
				filenameTestCase{name: "study?", expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with less-than sign",
				filenameTestCase{name: "study<v2", expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with greater-than sign",
				filenameTestCase{name: "study>v2", expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with pipe",
				filenameTestCase{name: "study|v2", expectError: true, expectedError: "disallowed characters"}),
			Entry("rejects name with double quote",
				filenameTestCase{name: `study"v2`, expectError: true, expectedError: "disallowed characters"}),
		)
	})

	Describe("Duplicate name rejection", func() {
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

			// Pre-seed the store with an existing study named "Existing"
			store.studies["existing-id"] = model.Study{
				ID:   "existing-id",
				Name: "Existing",
			}
		})

		It("rejects Create when a study with the same name already exists", func() {
			_, err := svc.Create("Existing", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("already exists"))
		})

		It("allows Create when no study with that name exists", func() {
			_, err := svc.Create("New Name", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).NotTo(HaveOccurred())
		})

		It("rejects Update when another study already has the target name", func() {
			// Seed a second study to be updated
			store.studies["other-id"] = model.Study{
				ID:                    "other-id",
				Name:                  "Other",
				Prompts:               validPrompts,
				Steps:                 validSteps,
				CFGs:                  validCFGs,
				SamplerSchedulerPairs: validPairs,
				Seeds:                 validSeeds,
				Width:                 512,
				Height:                512,
			}
			// Try to rename "Other" to "Existing" — should be rejected
			_, err := svc.Update("other-id", "Existing", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("already exists"))
		})

		It("allows Update when saving a study with its own current name", func() {
			// Pre-seed the study being updated
			store.studies["self-id"] = model.Study{
				ID:                    "self-id",
				Name:                  "Self",
				Prompts:               validPrompts,
				Steps:                 validSteps,
				CFGs:                  validCFGs,
				SamplerSchedulerPairs: validPairs,
				Seeds:                 validSeeds,
				Width:                 512,
				Height:                512,
			}
			// Saving with the same name should succeed (self-exclusion)
			_, err := svc.Update("self-id", "Self", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).NotTo(HaveOccurred())
		})
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

			store.studies["existing"] = model.Study{
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
			result, err := svc.Update("existing", "Renamed", "", newPrompts, "new negative", validSteps, validCFGs, newPairs, validSeeds, 1344, 1344, "", "", "", nil)
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

		It("does not change output directory structure on update", func() {
			result, err := svc.Update("existing", "Original", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).NotTo(HaveOccurred())
			Expect(result.OutputDirName()).To(Equal("Original"))
		})

		It("returns error for non-existent study", func() {
			_, err := svc.Update("missing", "Name", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("rejects invalid inputs during update", func() {
			_, err := svc.Update("existing", "", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("name must not be empty"))
		})
	})

	Describe("Fork", func() {
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

			store.studies["source"] = model.Study{
				ID:                    "source",
				Name:                  "Source Study",
				Prompts:               validPrompts,
				Steps:                 validSteps,
				CFGs:                  validCFGs,
				SamplerSchedulerPairs: validPairs,
				Seeds:                 validSeeds,
				Width:                 512,
				Height:                512,
			}
		})

		It("creates a new study from source with modified settings", func() {
			newPrompts := []model.NamedPrompt{
				{Name: "new_prompt", Text: "forked prompt"},
			}
			result, err := svc.Fork("source", "Forked Study", "", newPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 1024, 1024, "", "", "", nil)
			Expect(err).NotTo(HaveOccurred())
			Expect(result.ID).NotTo(Equal("source"))
			Expect(result.Name).To(Equal("Forked Study"))
			Expect(result.Prompts).To(Equal(newPrompts))
			Expect(result.Width).To(Equal(1024))
			Expect(result.Height).To(Equal(1024))
		})

		It("returns error when source study does not exist", func() {
			_, err := svc.Fork("nonexistent", "Forked", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("rejects fork when new name already exists", func() {
			_, err := svc.Fork("source", "Source Study", "", validPrompts, "", validSteps, validCFGs, validPairs, validSeeds, 512, 512, "", "", "", nil)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("already exists"))
		})
	})

	Describe("HasSamples", func() {
		BeforeEach(func() {
			store.studies["with-samples"] = model.Study{ID: "with-samples", Name: "Has Samples"}
			store.studies["no-samples"] = model.Study{ID: "no-samples", Name: "No Samples"}

			sampleChecker.results["with-samples"] = true
			sampleChecker.results["no-samples"] = false
		})

		It("returns true when study has samples on disk", func() {
			hasSamples, err := svc.HasSamples("with-samples")
			Expect(err).NotTo(HaveOccurred())
			Expect(hasSamples).To(BeTrue())
		})

		It("returns false when study has no samples", func() {
			hasSamples, err := svc.HasSamples("no-samples")
			Expect(err).NotTo(HaveOccurred())
			Expect(hasSamples).To(BeFalse())
		})

		It("returns error for non-existent study", func() {
			_, err := svc.HasSamples("nonexistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns error when sample checker fails", func() {
			sampleChecker.err = errors.New("fs error")
			_, err := svc.HasSamples("with-samples")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("fs error"))
		})
	})

	Describe("Delete", func() {
		BeforeEach(func() {
			store.studies["to-delete"] = model.Study{ID: "to-delete", Name: "Remove Me"}
		})

		// AC: BE: Deleting a study without the data flag removes only the database record
		It("deletes an existing study without removing sample data when deleteData=false", func() {
			err := svc.Delete("to-delete", false)
			Expect(err).NotTo(HaveOccurred())
			Expect(store.studies).NotTo(HaveKey("to-delete"))
		})

		// AC: BE: Deleting a study without the data flag removes only the database record
		It("returns error for non-existent study", func() {
			err := svc.Delete("nonexistent", false)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})

	Describe("Delete with sample data removal", func() {
		var remover *fakeSampleRemover

		BeforeEach(func() {
			remover = newFakeSampleRemover()
			svc = service.NewStudyService(store, sampleChecker, logger).WithSampleRemover(remover)
			store.studies["study-with-data"] = model.Study{ID: "study-with-data", Name: "My Study"}
			store.studies["study-no-data"] = model.Study{ID: "study-no-data", Name: "Another Study"}
		})

		// AC: BE: Deleting a study with the data flag also removes the study's sample output directory
		It("removes the sample directory when deleteData=true", func() {
			err := svc.Delete("study-with-data", true)
			Expect(err).NotTo(HaveOccurred())
			Expect(store.studies).NotTo(HaveKey("study-with-data"))
			Expect(remover.removed).To(ConsistOf("My Study"))
		})

		// AC: BE: Deleting a study without the data flag removes only the database record
		It("does not remove the sample directory when deleteData=false", func() {
			err := svc.Delete("study-no-data", false)
			Expect(err).NotTo(HaveOccurred())
			Expect(store.studies).NotTo(HaveKey("study-no-data"))
			Expect(remover.removed).To(BeEmpty())
		})

		// AC: BE: Test delete of study with no sample data (should work gracefully)
		It("succeeds when deleteData=true and study has no sample directory", func() {
			err := svc.Delete("study-with-data", true)
			Expect(err).NotTo(HaveOccurred())
			// No-op removal should not cause an error
		})

		It("returns error when sample directory removal fails", func() {
			remover.err = errors.New("permission denied")
			err := svc.Delete("study-with-data", true)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("permission denied"))
			// DB record should NOT be deleted since filesystem removal failed
			Expect(store.studies).To(HaveKey("study-with-data"))
		})

		It("returns error for non-existent study even with deleteData=true", func() {
			err := svc.Delete("nonexistent", true)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
			Expect(remover.removed).To(BeEmpty())
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

			result, err := svc.Create("Test", "", prompts, "", steps, cfgs, pairs, seeds, 512, 512, "", "", "", nil)
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

			result, err := svc.Create("Test", "", prompts, "", steps, cfgs, pairs, seeds, 512, 512, "", "", "", nil)
			Expect(err).NotTo(HaveOccurred())
			// 1 prompt * 1 step * 1 cfg * 1 pair * 1 seed = 1
			Expect(result.ImagesPerCheckpoint()).To(Equal(1))
		})
	})
})
