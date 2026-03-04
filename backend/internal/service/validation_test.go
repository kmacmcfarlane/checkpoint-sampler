package service_test

import (
	"fmt"
	"io"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeValidationFS implements service.ValidationFileSystem for testing.
type fakeValidationFS struct {
	files map[string][]string
	errs  map[string]error
}

func newFakeValidationFS() *fakeValidationFS {
	return &fakeValidationFS{
		files: make(map[string][]string),
		errs:  make(map[string]error),
	}
}

func (f *fakeValidationFS) ListPNGFiles(dir string) ([]string, error) {
	if err, ok := f.errs[dir]; ok {
		return nil, err
	}
	return f.files[dir], nil
}

func (f *fakeValidationFS) DirectoryExists(path string) bool {
	_, ok := f.files[path]
	return ok
}

var _ = Describe("ValidationService", func() {
	var (
		fs        *fakeValidationFS
		sampleDir string
		logger    *logrus.Logger
		svc       *service.ValidationService
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		fs = newFakeValidationFS()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
		svc = service.NewValidationService(fs, sampleDir, logger)
	})

	// AC4: Validation reuses completeness-check logic against the selected sample set directory
	Describe("ValidateTrainingRun", func() {
		// AC5: Validation results returned to the frontend (per-checkpoint completeness counts)
		It("returns all checkpoints as complete when all have the same file count", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "model-step00002000.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/model-step00001000.safetensors"] = []string{
				"seed=42&cfg=3&_00001_.png",
				"seed=43&cfg=3&_00001_.png",
			}
			fs.files["/samples/model-step00002000.safetensors"] = []string{
				"seed=42&cfg=3&_00001_.png",
				"seed=43&cfg=3&_00001_.png",
			}

			result, err := svc.ValidateTrainingRun(tr, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Expected).To(Equal(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Expected).To(Equal(2))
			Expect(result.Checkpoints[1].Verified).To(Equal(2))
			Expect(result.Checkpoints[1].Missing).To(Equal(0))
		})

		It("flags checkpoints with fewer files than the maximum as having missing samples", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "model-step00002000.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/model-step00001000.safetensors"] = []string{
				"seed=42&cfg=3&_00001_.png",
				"seed=43&cfg=3&_00001_.png",
				"seed=44&cfg=3&_00001_.png",
			}
			// Second checkpoint only has 1 file
			fs.files["/samples/model-step00002000.safetensors"] = []string{
				"seed=42&cfg=3&_00001_.png",
			}

			result, err := svc.ValidateTrainingRun(tr, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Expected).To(Equal(3))
			Expect(result.Checkpoints[0].Verified).To(Equal(3))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Expected).To(Equal(3))
			Expect(result.Checkpoints[1].Verified).To(Equal(1))
			Expect(result.Checkpoints[1].Missing).To(Equal(2))
		})

		It("handles checkpoints without samples (HasSamples=false)", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "model.safetensors", StepNumber: -1, HasSamples: false},
				},
				HasSamples: true,
			}

			fs.files["/samples/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.ValidateTrainingRun(tr, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(1))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			// The checkpoint without samples has 0 verified and 1 missing
			Expect(result.Checkpoints[1].Checkpoint).To(Equal("model.safetensors"))
			Expect(result.Checkpoints[1].Verified).To(Equal(0))
			Expect(result.Checkpoints[1].Missing).To(Equal(1))
		})

		It("handles missing sample directories gracefully", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "model-step00002000.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
				"seed=43&_00001_.png",
			}
			// model-step00002000.safetensors directory does not exist in fs.files

			result, err := svc.ValidateTrainingRun(tr, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Verified).To(Equal(0))
			Expect(result.Checkpoints[1].Missing).To(Equal(2))
		})

		It("handles study-scoped sample directories", func() {
			tr := model.TrainingRun{
				Name: "my-study/model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/my-study/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.ValidateTrainingRun(tr, "my-study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(1))
			Expect(result.Checkpoints[0].Expected).To(Equal(1))
			Expect(result.Checkpoints[0].Verified).To(Equal(1))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
		})

		It("returns error when ListPNGFiles fails", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model.safetensors", StepNumber: -1, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/model.safetensors"] = nil // directory exists
			fs.errs["/samples/model.safetensors"] = fmt.Errorf("disk error")

			_, err := svc.ValidateTrainingRun(tr, "")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("disk error"))
		})

		It("handles empty training run with no checkpoints", func() {
			tr := model.TrainingRun{
				Name:        "empty",
				Checkpoints: []model.Checkpoint{},
				HasSamples:  false,
			}

			result, err := svc.ValidateTrainingRun(tr, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(0))
		})

		It("returns zero expected when all checkpoints have no files", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			// Directory exists but empty
			fs.files["/samples/model-step00001000.safetensors"] = []string{}

			result, err := svc.ValidateTrainingRun(tr, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(1))
			Expect(result.Checkpoints[0].Expected).To(Equal(0))
			Expect(result.Checkpoints[0].Verified).To(Equal(0))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
		})
		It("populates summary fields (TotalExpected, TotalVerified, ExpectedPerCheckpoint)", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "model-step00002000.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/model-step00001000.safetensors"] = []string{
				"seed=42&cfg=3&_00001_.png",
				"seed=43&cfg=3&_00001_.png",
				"seed=44&cfg=3&_00001_.png",
			}
			fs.files["/samples/model-step00002000.safetensors"] = []string{
				"seed=42&cfg=3&_00001_.png",
			}

			result, err := svc.ValidateTrainingRun(tr, "")
			Expect(err).NotTo(HaveOccurred())
			// max count is 3 (from first checkpoint)
			Expect(result.ExpectedPerCheckpoint).To(Equal(3))
			Expect(result.TotalExpected).To(Equal(6))  // 3 * 2 checkpoints
			Expect(result.TotalVerified).To(Equal(4))   // 3 + 1
		})
	})

	// AC5: Unit tests for missing-sample generation logic (study-aware validation)
	Describe("ValidateTrainingRunWithStudy", func() {
		var study model.Study

		BeforeEach(func() {
			study = model.Study{
				ID:   "study-1",
				Name: "Test Study",
				Prompts: []model.NamedPrompt{
					{Name: "prompt1", Text: "text1"},
					{Name: "prompt2", Text: "text2"},
				},
				Steps: []int{20},
				CFGs:  []float64{7.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "normal"},
				},
				Seeds: []int64{42},
			}
			// study.ImagesPerCheckpoint() = 2 prompts * 1 step * 1 cfg * 1 pair * 1 seed = 2
		})

		It("uses study images-per-checkpoint as expected count", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/cp1.safetensors"] = []string{"a.png", "b.png"}
			fs.files["/samples/cp2.safetensors"] = []string{"a.png"}

			result, err := svc.ValidateTrainingRunWithStudy(tr, study, "")
			Expect(err).NotTo(HaveOccurred())

			// Expected per checkpoint is study.ImagesPerCheckpoint() = 2
			Expect(result.ExpectedPerCheckpoint).To(Equal(2))
			Expect(result.TotalExpected).To(Equal(4))  // 2 * 2 checkpoints
			Expect(result.TotalVerified).To(Equal(3))   // 2 + 1

			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Expected).To(Equal(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Expected).To(Equal(2))
			Expect(result.Checkpoints[1].Verified).To(Equal(1))
			Expect(result.Checkpoints[1].Missing).To(Equal(1))
		})

		It("handles checkpoints with more files than expected (no negative missing)", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			// 5 files but study expects only 2
			fs.files["/samples/cp1.safetensors"] = []string{"a.png", "b.png", "c.png", "d.png", "e.png"}

			result, err := svc.ValidateTrainingRunWithStudy(tr, study, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints[0].Expected).To(Equal(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(5))
			Expect(result.Checkpoints[0].Missing).To(Equal(0)) // clamped to 0
		})

		It("marks all checkpoints as missing when no directories exist", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}
			// No directories in fs.files

			result, err := svc.ValidateTrainingRunWithStudy(tr, study, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.TotalExpected).To(Equal(4))
			Expect(result.TotalVerified).To(Equal(0))
			Expect(result.Checkpoints[0].Missing).To(Equal(2))
			Expect(result.Checkpoints[1].Missing).To(Equal(2))
		})

		It("handles study-scoped sample directories", func() {
			tr := model.TrainingRun{
				Name: "my-study/model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/my-study/cp1.safetensors"] = []string{"a.png", "b.png"}

			result, err := svc.ValidateTrainingRunWithStudy(tr, study, "my-study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
		})

		It("handles checkpoints without samples (HasSamples=false)", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "cp-final.safetensors", StepNumber: -1, HasSamples: false},
				},
				HasSamples: true,
			}

			fs.files["/samples/cp1.safetensors"] = []string{"a.png", "b.png"}

			result, err := svc.ValidateTrainingRunWithStudy(tr, study, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			// Final checkpoint has no samples → verified=0, missing=2
			Expect(result.Checkpoints[1].Verified).To(Equal(0))
			Expect(result.Checkpoints[1].Missing).To(Equal(2))
		})

		It("returns error when ListPNGFiles fails", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/cp1.safetensors"] = nil // directory exists
			fs.errs["/samples/cp1.safetensors"] = fmt.Errorf("disk error")

			_, err := svc.ValidateTrainingRunWithStudy(tr, study, "")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("disk error"))
		})

		It("handles empty training run with no checkpoints", func() {
			tr := model.TrainingRun{
				Name:        "empty",
				Checkpoints: []model.Checkpoint{},
			}

			result, err := svc.ValidateTrainingRunWithStudy(tr, study, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(0))
			Expect(result.TotalExpected).To(Equal(0))
			Expect(result.TotalVerified).To(Equal(0))
			Expect(result.ExpectedPerCheckpoint).To(Equal(2))
		})
	})
})
