package service_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeValidationFS implements service.ValidationFileSystem for testing.
type fakeValidationFS struct {
	files       map[string][]string
	errs        map[string]error
	fileData    map[string][]byte
	readErrs    map[string]error
	existFiles  map[string]bool // tracks individual file existence for FileExists
}

func newFakeValidationFS() *fakeValidationFS {
	return &fakeValidationFS{
		files:      make(map[string][]string),
		errs:       make(map[string]error),
		fileData:   make(map[string][]byte),
		readErrs:   make(map[string]error),
		existFiles: make(map[string]bool),
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

// FileExists returns true if the file was explicitly registered via existFiles,
// or if the file's basename is in the directory listing for its parent dir.
func (f *fakeValidationFS) FileExists(path string) bool {
	if explicit, ok := f.existFiles[path]; ok {
		return explicit
	}
	// Fall back to checking the parent directory listing.
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	for _, name := range f.files[dir] {
		if name == base {
			return true
		}
	}
	return false
}

func (f *fakeValidationFS) ReadFile(path string) ([]byte, error) {
	if err, ok := f.readErrs[path]; ok {
		return nil, err
	}
	data, ok := f.fileData[path]
	if !ok {
		return nil, os.ErrNotExist
	}
	return data, nil
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
			// AC3: Totals across all checkpoints
			Expect(result.TotalExpected).To(Equal(4))
			Expect(result.TotalActual).To(Equal(4))
			Expect(result.TotalMissing).To(Equal(0))
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
			// AC3: Totals when checkpoints have missing files
			Expect(result.TotalExpected).To(Equal(6)) // 3 per checkpoint × 2 checkpoints
			Expect(result.TotalActual).To(Equal(4))   // 3 + 1
			Expect(result.TotalMissing).To(Equal(2))  // 6 - 4
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
		// B-049: Strict study-scoped sample discovery
		It("checks study-scoped directory even when HasSamples=false (legacy path absent)", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					// HasSamples=false because legacy path sample_dir/cp1.safetensors/ doesn't exist
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: false},
					{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: false},
				},
				HasSamples: false,
			}

			// Study-scoped directory exists with files
			fs.files["/samples/my-study/cp1.safetensors"] = []string{"a.png", "b.png"}
			fs.files["/samples/my-study/cp2.safetensors"] = []string{"a.png"}

			result, err := svc.ValidateTrainingRun(tr, "my-study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			// max count is 2 (from cp1)
			Expect(result.ExpectedPerCheckpoint).To(Equal(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Verified).To(Equal(1))
			Expect(result.Checkpoints[1].Missing).To(Equal(1))
		})

		// B-049: HasSamples=true (from legacy path) but study-scoped directory absent
		It("returns zero verified when HasSamples=true but study directory does not exist", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					// HasSamples=true because legacy path sample_dir/cp1.safetensors/ exists
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			// Legacy path exists (this is what set HasSamples=true)
			fs.files["/samples/cp1.safetensors"] = []string{"a.png", "b.png"}
			// Study-scoped directory does NOT exist — no entry in fs.files for /samples/other-study/cp1.safetensors

			result, err := svc.ValidateTrainingRun(tr, "other-study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(1))
			// Expected is 0 because max count across study-scoped dirs is 0
			Expect(result.ExpectedPerCheckpoint).To(Equal(0))
			Expect(result.Checkpoints[0].Verified).To(Equal(0))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
		})

		// B-075: TotalMissing aggregate must be clamped to 0 — defensive guard
		// ValidateTrainingRun uses the max-file-count heuristic so totalVerified can
		// never exceed totalExpected through normal file system state. However the clamp
		// is still important as a defensive boundary. Confirm TotalMissing is exactly 0
		// (not negative) when all checkpoints are complete (verified == expected).
		It("returns TotalMissing of zero when all checkpoints are fully verified", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}

			fs.files["/samples/cp1.safetensors"] = []string{"a.png", "b.png"}
			fs.files["/samples/cp2.safetensors"] = []string{"a.png", "b.png"}

			result, err := svc.ValidateTrainingRun(tr, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.TotalExpected).To(Equal(4))
			Expect(result.TotalVerified).To(Equal(4))
			Expect(result.TotalMissing).To(Equal(0))
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

		// B-132: extra files should be flagged (missing=0 but extra>0)
		It("flags checkpoints with more files than expected as having extra samples", func() {
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
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			// B-132: extra files must be tracked
			Expect(result.Checkpoints[0].Extra).To(Equal(3))
		})

		// B-132: TotalExtra aggregate when all checkpoints have more files than expected
		It("tracks TotalExtra when all checkpoints have more files than expected", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}

			// study expects 2 per checkpoint (4 total), but both checkpoints have 5 each
			fs.files["/samples/cp1.safetensors"] = []string{"a.png", "b.png", "c.png", "d.png", "e.png"}
			fs.files["/samples/cp2.safetensors"] = []string{"a.png", "b.png", "c.png", "d.png", "e.png"}

			result, err := svc.ValidateTrainingRunWithStudy(tr, study, "")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.TotalExpected).To(Equal(4))   // 2 * 2 checkpoints
			Expect(result.TotalVerified).To(Equal(10))  // 5 + 5
			Expect(result.TotalMissing).To(Equal(0))
			// B-132: extra files are tracked
			Expect(result.TotalExtra).To(Equal(6)) // (5-2) + (5-2)
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

		It("handles checkpoints without samples in legacy path (HasSamples=false)", func() {
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

		// B-049: Study-scoped validation must check study dir even when HasSamples=false
		It("checks study-scoped directory even when HasSamples=false (legacy path absent)", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					// HasSamples=false: legacy path doesn't exist
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: false},
					{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: false},
				},
				HasSamples: false,
			}

			// Study-scoped directories have files
			fs.files["/samples/Test Study/cp1.safetensors"] = []string{"a.png", "b.png"}
			fs.files["/samples/Test Study/cp2.safetensors"] = []string{"a.png", "b.png"}

			result, err := svc.ValidateTrainingRunWithStudy(tr, study, "Test Study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.ExpectedPerCheckpoint).To(Equal(2))
			Expect(result.TotalExpected).To(Equal(4))
			Expect(result.TotalVerified).To(Equal(4)) // all found
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Verified).To(Equal(2))
			Expect(result.Checkpoints[1].Missing).To(Equal(0))
		})

		// B-049: HasSamples=true from legacy but study-scoped dir absent → verified=0
		It("returns zero verified when HasSamples=true but study directory absent", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			// Legacy path exists (this is what set HasSamples=true)
			fs.files["/samples/cp1.safetensors"] = []string{"a.png", "b.png"}
			// Study-scoped directory does NOT exist

			result, err := svc.ValidateTrainingRunWithStudy(tr, study, "Other Study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.ExpectedPerCheckpoint).To(Equal(2))
			Expect(result.TotalExpected).To(Equal(2))
			Expect(result.TotalVerified).To(Equal(0))
			Expect(result.Checkpoints[0].Verified).To(Equal(0))
			Expect(result.Checkpoints[0].Missing).To(Equal(2))
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

	// AC: Validating a sample set uses the manifest as the source of truth for expected outputs.
	// B-132: count-strict validation and per-sample param verification.
	Describe("ValidateTrainingRunWithManifest", func() {
		var (
			manifestData []byte
			// expectedFile1 and expectedFile2 are the canonical filenames for the two
			// expected samples derived from the test manifest's parameter combinations:
			// manifest: prompts=[prompt1,prompt2], steps=[20], cfgs=[7.0],
			//           pairs=[euler/normal], seeds=[42]
			expectedFile1 string // cfg=7.0&prompt=prompt1&sampler=euler&scheduler=normal&seed=42&steps=20.png
			expectedFile2 string // cfg=7.0&prompt=prompt2&sampler=euler&scheduler=normal&seed=42&steps=20.png
		)

		BeforeEach(func() {
			// Create a manifest with 2 images per checkpoint
			manifest := fileformat.JobManifest{
				JobID:           "job-manifest-1",
				TrainingRunName: "model",
				StudyName:       "Test Study",
				Prompts: []fileformat.ManifestNamedPrompt{
					{Name: "prompt1", Text: "text1"},
					{Name: "prompt2", Text: "text2"},
				},
				Steps:                 []int{20},
				CFGs:                  []float64{7.0},
				SamplerSchedulerPairs: []fileformat.ManifestSamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "normal"},
				},
				Seeds:               []int64{42},
				Width:               1024,
				Height:              768,
				ImagesPerCheckpoint: 2,
				Checkpoints: []string{
					"cp1.safetensors",
					"cp2.safetensors",
				},
			}
			var err error
			manifestData, err = fileformat.MarshalManifest(manifest)
			Expect(err).NotTo(HaveOccurred())

			// Pre-compute the canonical expected filenames so tests use the real
			// GenerateOutputFilename format rather than hardcoding the query string.
			expectedFile1 = service.GenerateOutputFilename(model.SampleJobItem{
				PromptName:  "prompt1",
				Steps:       20,
				CFG:         7.0,
				SamplerName: "euler",
				Scheduler:   "normal",
				Seed:        42,
			})
			expectedFile2 = service.GenerateOutputFilename(model.SampleJobItem{
				PromptName:  "prompt2",
				Steps:       20,
				CFG:         7.0,
				SamplerName: "euler",
				Scheduler:   "normal",
				Seed:        42,
			})
		})

		// AC: Validation iterates over expected param combinations; only matching samples count.
		It("uses manifest images-per-checkpoint as expected count", func() {
			fs.fileData["/samples/Test Study/manifest.json"] = manifestData
			// cp1 has both expected files; cp2 has only the first.
			fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1, expectedFile2}
			fs.files["/samples/Test Study/cp2.safetensors"] = []string{expectedFile1}

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}

			result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).NotTo(HaveOccurred())

			Expect(result.ExpectedPerCheckpoint).To(Equal(2))
			Expect(result.TotalExpected).To(Equal(4))
			Expect(result.TotalVerified).To(Equal(3))

			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Expected).To(Equal(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Expected).To(Equal(2))
			Expect(result.Checkpoints[1].Verified).To(Equal(1))
			Expect(result.Checkpoints[1].Missing).To(Equal(1))
		})

		It("returns error when manifest file does not exist", func() {
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			_, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("manifest not found"))
			// R-015 AC2: classifiable via the sentinel (errors.Is), so the API
			// layer can detect it without substring matching.
			Expect(errors.Is(err, service.ErrManifestNotFound)).To(BeTrue())
			// R-015 AC4: the absolute manifest path must not be embedded in the
			// error (it is logged server-side instead).
			Expect(err.Error()).NotTo(ContainSubstring("/samples"))
		})

		It("returns error when manifest file is invalid JSON", func() {
			fs.fileData["/samples/Test Study/manifest.json"] = []byte("not-json")

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			_, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("parsing manifest"))
		})

		// B-132: foreign sample (wrong name, not part of expected set) does NOT count as verified.
		// AC: Validation fails when sampleset has more samples than expected.
		It("does not count foreign (unexpected) files as verified; tracks them as extra", func() {
			fs.fileData["/samples/Test Study/manifest.json"] = manifestData
			// Both expected files are present, plus 3 foreign files not in the expected set.
			fs.files["/samples/Test Study/cp1.safetensors"] = []string{
				expectedFile1, expectedFile2,
				"foreign1.png", "foreign2.png", "foreign3.png",
			}

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).NotTo(HaveOccurred())
			// AC: verified counts only the 2 expected samples that exist.
			Expect(result.Checkpoints[0].Expected).To(Equal(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			// B-132: the 3 foreign files are tracked as extra.
			Expect(result.Checkpoints[0].Extra).To(Equal(3))
		})

		// B-132: original bug — a copied sample with wrong metadata was counted as verified.
		// After rework, only expected param combinations count as verified.
		It("does not count a foreign sample with modified metadata as verified", func() {
			fs.fileData["/samples/Test Study/manifest.json"] = manifestData
			// One expected file and one foreign (copied, modified) sample.
			foreignFile := "copied-sample-with-wrong-params.png"
			fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1, foreignFile}

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).NotTo(HaveOccurred())
			// Only the one expected file counts as verified.
			Expect(result.Checkpoints[0].Verified).To(Equal(1))
			Expect(result.Checkpoints[0].Missing).To(Equal(1)) // expectedFile2 is absent
			// The foreign file is tracked as extra — it should not inflate the verified count.
			Expect(result.Checkpoints[0].Extra).To(Equal(1))
		})

		// B-132: TotalExtra aggregate when all checkpoints have foreign files.
		It("tracks TotalExtra when all checkpoints contain only foreign files", func() {
			fs.fileData["/samples/Test Study/manifest.json"] = manifestData
			// Neither checkpoint has the expected param-combination filenames.
			fs.files["/samples/Test Study/cp1.safetensors"] = []string{"a.png", "b.png", "c.png"}
			fs.files["/samples/Test Study/cp2.safetensors"] = []string{"d.png", "e.png", "f.png"}

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: true},
				},
				HasSamples: true,
			}

			result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.TotalExpected).To(Equal(4))  // 2 * 2 checkpoints
			Expect(result.TotalVerified).To(Equal(0))  // no expected samples found
			Expect(result.TotalMissing).To(Equal(4))   // all 2+2 expected are absent
			// B-132: all 3+3 files are foreign and tracked as extra
			Expect(result.TotalExtra).To(Equal(6))
		})

		// B-132: count-strict — extra expected files AND some missing = both tracked.
		It("tracks both extra foreign files and missing expected files simultaneously", func() {
			fs.fileData["/samples/Test Study/manifest.json"] = manifestData
			// expectedFile1 is present but expectedFile2 is absent; 2 extra foreign files exist.
			fs.files["/samples/Test Study/cp1.safetensors"] = []string{
				expectedFile1,
				"foreign-a.png", "foreign-b.png",
			}

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints[0].Verified).To(Equal(1))
			Expect(result.Checkpoints[0].Missing).To(Equal(1))
			Expect(result.Checkpoints[0].Extra).To(Equal(2))
		})

		It("handles checkpoints without legacy samples (HasSamples=false) but with study dir expected files", func() {
			fs.fileData["/samples/Test Study/manifest.json"] = manifestData

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
					{Filename: "cp-final.safetensors", StepNumber: -1, HasSamples: false},
				},
				HasSamples: true,
			}

			// cp1 has both expected files; cp-final has none.
			fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1, expectedFile2}

			result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Verified).To(Equal(0))
			Expect(result.Checkpoints[1].Missing).To(Equal(2))
		})

		// B-049: Manifest validation ignores HasSamples and always checks study output dir.
		It("finds expected samples in study dir even when HasSamples=false", func() {
			fs.fileData["/samples/Test Study/manifest.json"] = manifestData

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					// HasSamples=false: legacy path doesn't exist
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: false},
					{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: false},
				},
				HasSamples: false,
			}

			// Study output dir has correct expected files for both checkpoints.
			fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1, expectedFile2}
			fs.files["/samples/Test Study/cp2.safetensors"] = []string{expectedFile1}

			result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Verified).To(Equal(1))
			Expect(result.Checkpoints[1].Missing).To(Equal(1))
			Expect(result.TotalVerified).To(Equal(3))
		})

		It("returns error when ReadFile has a non-not-found error", func() {
			fs.readErrs["/samples/Test Study/manifest.json"] = fmt.Errorf("disk read error")

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			_, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("reading manifest"))
		})

		It("returns error when ListPNGFiles fails for a checkpoint directory", func() {
			fs.fileData["/samples/Test Study/manifest.json"] = manifestData
			fs.files["/samples/Test Study/cp1.safetensors"] = nil // directory exists
			fs.errs["/samples/Test Study/cp1.safetensors"] = fmt.Errorf("disk I/O error")

			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
				},
				HasSamples: true,
			}

			_, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("disk I/O error"))
		})

		// B-132: per-sample param verification via sidecar JSON files.
		// Validation now iterates expected filenames and checks each sidecar.
		Describe("per-sample param verification", func() {
			var (
				tr           model.TrainingRun
				validSidecar1 []byte
				validSidecar2 []byte
			)

			BeforeEach(func() {
				tr = model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
					},
					HasSamples: true,
				}

				// Build sidecars whose params exactly match the manifest.
				// (manifest: prompts=[prompt1,prompt2], steps=[20], cfgs=[7.0],
				//  pairs=[euler/normal], seeds=[42])
				var err error
				validSidecar1, err = json.Marshal(fileformat.SidecarMetadata{
					Checkpoint:  "cp1.safetensors",
					PromptName:  "prompt1",
					Seed:        42,
					CFG:         7.0,
					Steps:       20,
					SamplerName: "euler",
					Scheduler:   "normal",
					Width:       1024,
					Height:      768,
				})
				Expect(err).NotTo(HaveOccurred())
				validSidecar2, err = json.Marshal(fileformat.SidecarMetadata{
					Checkpoint:  "cp1.safetensors",
					PromptName:  "prompt2",
					Seed:        42,
					CFG:         7.0,
					Steps:       20,
					SamplerName: "euler",
					Scheduler:   "normal",
					Width:       1024,
					Height:      768,
				})
				Expect(err).NotTo(HaveOccurred())
			})

			// AC: Validation checks each sample against per-sample JSON for exact param match.
			It("reports zero invalid params when all sidecars match the manifest", func() {
				fs.fileData["/samples/Test Study/manifest.json"] = manifestData
				// Use the correct expected filenames.
				fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1, expectedFile2}

				sidecarBase1 := expectedFile1[:len(expectedFile1)-4] // strip .png
				sidecarBase2 := expectedFile2[:len(expectedFile2)-4]
				fs.fileData["/samples/Test Study/cp1.safetensors/"+sidecarBase1+".json"] = validSidecar1
				fs.fileData["/samples/Test Study/cp1.safetensors/"+sidecarBase2+".json"] = validSidecar2

				result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints[0].Verified).To(Equal(2))
				Expect(result.Checkpoints[0].InvalidParams).To(Equal(0))
				Expect(result.TotalInvalidParams).To(Equal(0))
			})

			// AC: Param mismatch in sidecar — sample is not counted as verified, counted as invalidParams.
			DescribeTable("flags expected sample as invalid when sidecar param does not match",
				func(badField string, badSidecar fileformat.SidecarMetadata) {
					fs.fileData["/samples/Test Study/manifest.json"] = manifestData
					// Place the expected file on disk with a mismatched sidecar.
					fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1}
					sidecarBase := expectedFile1[:len(expectedFile1)-4]
					data, err := json.Marshal(badSidecar)
					Expect(err).NotTo(HaveOccurred())
					fs.fileData["/samples/Test Study/cp1.safetensors/"+sidecarBase+".json"] = data

					result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
					Expect(err).NotTo(HaveOccurred())
					// AC: param mismatch means NOT verified.
					Expect(result.Checkpoints[0].Verified).To(Equal(0), "field %s: expected 0 verified for param mismatch", badField)
					Expect(result.Checkpoints[0].InvalidParams).To(Equal(1), "expected invalid param for field %s", badField)
					Expect(result.TotalInvalidParams).To(Equal(1))
				},
				Entry("seed not in manifest", "seed", fileformat.SidecarMetadata{
					Checkpoint: "cp1.safetensors", PromptName: "prompt1",
					Seed: 999, CFG: 7.0, Steps: 20, SamplerName: "euler", Scheduler: "normal",
				}),
				Entry("cfg not in manifest", "cfg", fileformat.SidecarMetadata{
					Checkpoint: "cp1.safetensors", PromptName: "prompt1",
					Seed: 42, CFG: 99.9, Steps: 20, SamplerName: "euler", Scheduler: "normal",
				}),
				Entry("steps not in manifest", "steps", fileformat.SidecarMetadata{
					Checkpoint: "cp1.safetensors", PromptName: "prompt1",
					Seed: 42, CFG: 7.0, Steps: 50, SamplerName: "euler", Scheduler: "normal",
				}),
				Entry("sampler not in manifest", "sampler", fileformat.SidecarMetadata{
					Checkpoint: "cp1.safetensors", PromptName: "prompt1",
					Seed: 42, CFG: 7.0, Steps: 20, SamplerName: "dpm_2", Scheduler: "normal",
				}),
				Entry("scheduler not in manifest", "scheduler", fileformat.SidecarMetadata{
					Checkpoint: "cp1.safetensors", PromptName: "prompt1",
					Seed: 42, CFG: 7.0, Steps: 20, SamplerName: "euler", Scheduler: "sgm_uniform",
				}),
				Entry("prompt_name not in manifest", "prompt_name", fileformat.SidecarMetadata{
					Checkpoint: "cp1.safetensors", PromptName: "unknown_prompt",
					Seed: 42, CFG: 7.0, Steps: 20, SamplerName: "euler", Scheduler: "normal",
				}),
			)

			// When no sidecar exists for an expected file, the PNG still counts as verified.
			// Older outputs may pre-date sidecar generation.
			It("counts expected PNG as verified when no sidecar exists (legacy output)", func() {
				fs.fileData["/samples/Test Study/manifest.json"] = manifestData
				// expectedFile1 is present but has no sidecar.
				fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1}

				result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
				Expect(err).NotTo(HaveOccurred())
				// Without a sidecar, params cannot be verified → still counted as verified (legacy compat).
				Expect(result.Checkpoints[0].Verified).To(Equal(1))
				Expect(result.Checkpoints[0].InvalidParams).To(Equal(0))
				Expect(result.TotalInvalidParams).To(Equal(0))
			})

			// When sidecar JSON is unparseable, the expected sample is counted as invalidParams (not verified).
			It("counts expected PNG as invalid when sidecar is corrupt (unparseable JSON)", func() {
				fs.fileData["/samples/Test Study/manifest.json"] = manifestData
				fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1}
				sidecarBase := expectedFile1[:len(expectedFile1)-4]
				fs.fileData["/samples/Test Study/cp1.safetensors/"+sidecarBase+".json"] = []byte("{not valid json")

				result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints[0].Verified).To(Equal(0))
				Expect(result.Checkpoints[0].InvalidParams).To(Equal(1))
				Expect(result.TotalInvalidParams).To(Equal(1))
			})

			It("counts expected PNG as invalid when sidecar read fails with a non-not-found error", func() {
				fs.fileData["/samples/Test Study/manifest.json"] = manifestData
				fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1}
				sidecarBase := expectedFile1[:len(expectedFile1)-4]
				fs.readErrs["/samples/Test Study/cp1.safetensors/"+sidecarBase+".json"] = fmt.Errorf("disk I/O error")

				result, err := svc.ValidateTrainingRunWithManifest(tr, "Test Study")
				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints[0].Verified).To(Equal(0))
				Expect(result.Checkpoints[0].InvalidParams).To(Equal(1))
				Expect(result.TotalInvalidParams).To(Equal(1))
			})

			It("accumulates TotalInvalidParams across all checkpoints", func() {
				tr2 := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "cp1.safetensors", StepNumber: 1000, HasSamples: true},
						{Filename: "cp2.safetensors", StepNumber: 2000, HasSamples: true},
					},
					HasSamples: true,
				}

				fs.fileData["/samples/Test Study/manifest.json"] = manifestData
				fs.files["/samples/Test Study/cp1.safetensors"] = []string{expectedFile1}
				fs.files["/samples/Test Study/cp2.safetensors"] = []string{expectedFile1}

				// Both have sidecars with a wrong seed (mismatch against manifest's seed=42).
				badSidecar, err := json.Marshal(fileformat.SidecarMetadata{
					PromptName: "prompt1", Seed: 999, CFG: 7.0, Steps: 20,
					SamplerName: "euler", Scheduler: "normal",
				})
				Expect(err).NotTo(HaveOccurred())
				sidecarBase := expectedFile1[:len(expectedFile1)-4]
				fs.fileData["/samples/Test Study/cp1.safetensors/"+sidecarBase+".json"] = badSidecar
				fs.fileData["/samples/Test Study/cp2.safetensors/"+sidecarBase+".json"] = badSidecar

				result, err := svc.ValidateTrainingRunWithManifest(tr2, "Test Study")
				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints[0].InvalidParams).To(Equal(1))
				Expect(result.Checkpoints[1].InvalidParams).To(Equal(1))
				Expect(result.TotalInvalidParams).To(Equal(2))
			})
		})
	})

	// AC3: Regenerating a sample set reads the manifest to determine what to generate
	// AC5: Unit tests for manifest read
	Describe("ReadManifest", func() {
		It("reads and parses a manifest from the study output directory", func() {
			manifest := fileformat.JobManifest{
				JobID:           "job-read-1",
				TrainingRunName: "model",
				StudyName:       "My Study",
				ImagesPerCheckpoint: 4,
				Checkpoints:     []string{"cp1.safetensors"},
			}
			data, err := fileformat.MarshalManifest(manifest)
			Expect(err).NotTo(HaveOccurred())

			fs.fileData["/samples/My Study/manifest.json"] = data

			result, err := svc.ReadManifest("My Study")
			Expect(err).NotTo(HaveOccurred())
			Expect(result.JobID).To(Equal("job-read-1"))
			Expect(result.StudyName).To(Equal("My Study"))
			Expect(result.ImagesPerCheckpoint).To(Equal(4))
			Expect(result.Checkpoints).To(Equal([]string{"cp1.safetensors"}))
		})

		It("returns error when manifest does not exist", func() {
			_, err := svc.ReadManifest("Nonexistent Study")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("manifest not found"))
		})

		It("returns error when manifest is invalid JSON", func() {
			fs.fileData["/samples/Bad Study/manifest.json"] = []byte("{invalid}")

			_, err := svc.ReadManifest("Bad Study")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("parsing manifest"))
		})
	})
})
