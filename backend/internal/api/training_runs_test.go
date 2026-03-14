package api_test

import (
	"context"
	"fmt"
	"io"
	"os"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeViewerDiscoveryFS implements service.ViewerFileSystem for testing.
type fakeViewerDiscoveryFS struct {
	subdirs map[string][]string // dir path → list of subdirectory names
	errs    map[string]error    // dir path → error to return
}

func newFakeViewerDiscoveryFS() *fakeViewerDiscoveryFS {
	return &fakeViewerDiscoveryFS{
		subdirs: make(map[string][]string),
		errs:    make(map[string]error),
	}
}

func (f *fakeViewerDiscoveryFS) ListSubdirectories(root string) ([]string, error) {
	if err, ok := f.errs[root]; ok {
		return nil, err
	}
	return f.subdirs[root], nil
}

func (f *fakeViewerDiscoveryFS) DirectoryExists(path string) bool {
	_, ok := f.subdirs[path]
	return ok
}

// fakeScanFS implements service.ScannerFileSystem for testing.
type fakeScanFS struct {
	files map[string][]string
	errs  map[string]error
}

func newFakeScanFS() *fakeScanFS {
	return &fakeScanFS{
		files: make(map[string][]string),
		errs:  make(map[string]error),
	}
}

func (f *fakeScanFS) ListPNGFiles(dir string) ([]string, error) {
	if err, ok := f.errs[dir]; ok {
		return nil, err
	}
	return f.files[dir], nil
}

func (f *fakeScanFS) DirectoryExists(path string) bool {
	_, ok := f.files[path]
	return ok
}

func (f *fakeScanFS) FileExists(path string) bool {
	return false
}

func (f *fakeScanFS) ReadFile(path string) ([]byte, error) {
	return nil, os.ErrNotExist
}

// fakeCheckpointDiscoveryFS implements service.CheckpointFileSystem for testing.
type fakeCheckpointDiscoveryFS struct {
	safetensors map[string][]string // root → relative file paths
	dirs        map[string]bool     // path → exists?
}

func newFakeCheckpointDiscoveryFS() *fakeCheckpointDiscoveryFS {
	return &fakeCheckpointDiscoveryFS{
		safetensors: make(map[string][]string),
		dirs:        make(map[string]bool),
	}
}

func (f *fakeCheckpointDiscoveryFS) ListSafetensorsFiles(root string) ([]string, error) {
	return f.safetensors[root], nil
}

func (f *fakeCheckpointDiscoveryFS) DirectoryExists(path string) bool {
	return f.dirs[path]
}

// fakeStudyGetter implements the api.StudyGetter interface for testing.
type fakeStudyGetter struct {
	studies map[string]model.Study
	err     error
}

func newFakeStudyGetter() *fakeStudyGetter {
	return &fakeStudyGetter{studies: make(map[string]model.Study)}
}

func (f *fakeStudyGetter) GetStudy(id string) (model.Study, error) {
	if f.err != nil {
		return model.Study{}, f.err
	}
	s, ok := f.studies[id]
	if !ok {
		return model.Study{}, fmt.Errorf("study %q not found", id)
	}
	return s, nil
}

var _ = Describe("TrainingRunsService", func() {
	var (
		viewerFS        *fakeViewerDiscoveryFS
		scanFS          *fakeScanFS
		cpFS            *fakeCheckpointDiscoveryFS
		viewerDiscovery *service.ViewerDiscoveryService
		cpDiscovery     *service.DiscoveryService
		scanner         *service.Scanner
		sampleDir       string
		logger          *logrus.Logger
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		viewerFS = newFakeViewerDiscoveryFS()
		scanFS = newFakeScanFS()
		cpFS = newFakeCheckpointDiscoveryFS()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	// Helper to create a TrainingRunsService with all dependencies
	makeSvc := func(validator *service.ValidationService, watcher *service.Watcher) *api.TrainingRunsService {
		return api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, watcher, nil)
	}

	Describe("List", func() {
		// AC1: Scanner discovers viewable content from sample output directories
		It("returns empty slice when no sample directories found", func() {
			viewerFS.subdirs[sampleDir] = []string{}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})

		It("returns training runs discovered from sample output directories", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-a.safetensors",
				"model-a-step00001000.safetensors",
				"model-b.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
			// Sorted by name
			Expect(result[0].Name).To(Equal("model-a"))
			Expect(result[0].CheckpointCount).To(Equal(2))
			Expect(result[1].Name).To(Equal("model-b"))
			Expect(result[1].CheckpointCount).To(Equal(1))
		})

		It("includes checkpoint details in response", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Checkpoints).To(HaveLen(2))
			Expect(result[0].Checkpoints[0].Filename).To(Equal("model-step00001000.safetensors"))
			Expect(result[0].Checkpoints[0].StepNumber).To(Equal(1000))
			// All viewer-discovered checkpoints have samples
			Expect(result[0].Checkpoints[0].HasSamples).To(BeTrue())
			Expect(result[0].Checkpoints[1].Filename).To(Equal("model-step00002000.safetensors"))
			Expect(result[0].Checkpoints[1].HasSamples).To(BeTrue())
		})

		// AC1: All listed runs have samples by definition
		It("returns all runs via samples source", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-a.safetensors",
				"model-b.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[1].HasSamples).To(BeTrue())
		})

		// AC2: Training runs derived from study directory structure
		It("discovers study-scoped training runs", func() {
			viewerFS.subdirs[sampleDir] = []string{"my-study"}
			viewerFS.subdirs[sampleDir+"/my-study"] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Name).To(Equal("my-study/model"))
			Expect(result[0].CheckpointCount).To(Equal(2))
		})

		// source=checkpoints returns checkpoint-based training runs
		It("returns checkpoint-based training runs when source=checkpoints", func() {
			cpFS.safetensors["/checkpoints"] = []string{
				"qwen/psai4rt-v0.3.0-step00001000.safetensors",
				"qwen/psai4rt-v0.3.0-step00002000.safetensors",
				"qwen/psai4rt-v0.3.0.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "checkpoints"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Name).To(Equal("qwen/psai4rt-v0.3.0"))
			Expect(result[0].CheckpointCount).To(Equal(3))
		})

		It("returns checkpoint-based runs with correct has_samples flag", func() {
			cpFS.safetensors["/checkpoints"] = []string{
				"model-a.safetensors",
				"model-b.safetensors",
			}
			// model-a has a sample directory, model-b does not
			cpFS.dirs[sampleDir+"/model-a.safetensors"] = true
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "checkpoints"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
			// Sorted by name: model-a, model-b
			Expect(result[0].Name).To(Equal("model-a"))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[1].Name).To(Equal("model-b"))
			Expect(result[1].HasSamples).To(BeFalse())
		})

		It("defaults to samples source when source parameter is empty", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"viewer-model.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			// Source defaults to "samples" via Goa Default() — pass it explicitly
			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Name).To(Equal("viewer-model"))
		})
	})

	Describe("Scan", func() {
		It("returns not_found for invalid training run ID", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 5})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns not_found for negative ID", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: -1})

			Expect(err).To(HaveOccurred())
		})

		It("returns scan results with images and dimensions (legacy)", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			scanFS.files[sampleDir+"/model-step00001000.safetensors"] = []string{
				"seed=1&cfg=3&_00001_.png",
				"seed=2&cfg=7&_00001_.png",
			}

			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 0})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(2))
			Expect(result.Dimensions).NotTo(BeEmpty())
		})

		It("auto-derives study name for study-scoped runs", func() {
			viewerFS.subdirs[sampleDir] = []string{"my-study"}
			viewerFS.subdirs[sampleDir+"/my-study"] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			// The scanner should look at /samples/my-study/model-step00001000.safetensors/
			scanFS.files[sampleDir+"/my-study/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 0})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(1))
		})

		It("returns scan_failed when scanner encounters an error", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			scanFS.errs[sampleDir+"/model-step00001000.safetensors"] = fmt.Errorf("disk error")

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 0})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("disk error"))
		})

		It("maps model types to API response types correctly", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			scanFS.files[sampleDir+"/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}
			scanFS.files[sampleDir+"/model-step00002000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 0})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(2))

			dimMap := make(map[string]*gentrainingruns.DimensionResponse)
			for _, d := range result.Dimensions {
				dimMap[d.Name] = d
			}
			Expect(dimMap["checkpoint"].Type).To(Equal("int"))
			Expect(dimMap["checkpoint"].Values).To(Equal([]string{"1000", "2000"}))
			Expect(dimMap["seed"].Type).To(Equal("int"))
		})
	})

	Describe("Validate", func() {
		// AC3: API endpoint to trigger validation of a selected sample set on demand
		It("returns not_found for invalid training run ID", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			validator := service.NewValidationService(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, nil)

			_, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 5})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		// AC4: Validation reuses completeness-check logic against the selected sample set directory
		// AC5: Validation results returned to the frontend (per-checkpoint completeness counts)
		It("returns per-checkpoint completeness when all are complete", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			validator := service.NewValidationService(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, nil)

			scanFS.files[sampleDir+"/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
				"seed=43&_00001_.png",
			}
			scanFS.files[sampleDir+"/model-step00002000.safetensors"] = []string{
				"seed=42&_00001_.png",
				"seed=43&_00001_.png",
			}

			result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 0})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Expected).To(Equal(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Missing).To(Equal(0))
		})

		It("returns per-checkpoint completeness with missing files", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			validator := service.NewValidationService(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, nil)

			scanFS.files[sampleDir+"/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
				"seed=43&_00001_.png",
			}
			// Second checkpoint has fewer files
			scanFS.files[sampleDir+"/model-step00002000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 0})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Missing).To(Equal(1))
		})

		It("auto-derives study name for study-scoped runs", func() {
			viewerFS.subdirs[sampleDir] = []string{"my-study"}
			viewerFS.subdirs[sampleDir+"/my-study"] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			validator := service.NewValidationService(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, nil)

			scanFS.files[sampleDir+"/my-study/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 0})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(1))
			Expect(result.Checkpoints[0].Expected).To(Equal(1))
			Expect(result.Checkpoints[0].Verified).To(Equal(1))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
		})

		// B-079: Study-aware validation uses checkpoint discovery (same source as the frontend).
		// Before fix, the Validate endpoint used viewer discovery, which returns no runs before
		// generation (causing not_found) and returns runs with embedded study dirs after
		// generation (causing double-nested paths and wrong validation results).
		Describe("study-aware validation (study_id provided)", func() {
			studyID := "study-abc"

			It("returns per-checkpoint completeness using checkpoint discovery before samples exist", func() {
				// Viewer discovery returns nothing (no samples yet)
				viewerFS.subdirs[sampleDir] = []string{}
				// Checkpoint discovery returns the training run
				cpFS.safetensors["/checkpoints"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{
					ID:      studyID,
					Name:    "Test Study",
					Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
					Steps:   []int{20},
					CFGs:    []float64{7},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "normal"},
					},
					Seeds: []int64{42},
				}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				// No sample files yet — all checkpoints should show 0 verified
				sid := studyID
				result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 0, StudyID: &sid})

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints).To(HaveLen(2))
				Expect(result.Checkpoints[0].Verified).To(Equal(0))
				Expect(result.Checkpoints[1].Verified).To(Equal(0))
				Expect(result.ExpectedPerCheckpoint).To(Equal(1))
			})

			It("returns per-checkpoint completeness using correct scoped dir after generation", func() {
				// After generation: samples exist at {sampleDir}/{trainingRunName}/{studyName}/{checkpoint}/
				// Viewer discovery finds new-layout run (name embeds study output dir).
				studyName := "Test Study"
				viewerFS.subdirs[sampleDir] = []string{"model"}
				viewerFS.subdirs[sampleDir+"/model"] = []string{studyName}
				viewerFS.subdirs[sampleDir+"/model/"+studyName] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				// Checkpoint discovery returns the training run using its canonical name.
				cpFS.safetensors["/checkpoints"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{
					ID:      studyID,
					Name:    "Test Study",
					Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
					Steps:   []int{20},
					CFGs:    []float64{7},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "normal"},
					},
					Seeds: []int64{42},
				}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				// Sample files in the scoped directory: {sampleDir}/model/{studyName}/{checkpoint}/
				scanFS.files[sampleDir+"/model/"+studyName+"/model-step00001000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}
				scanFS.files[sampleDir+"/model/"+studyName+"/model-step00002000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}

				sid := studyID
				result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 0, StudyID: &sid})

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints).To(HaveLen(2))
				Expect(result.Checkpoints[0].Verified).To(Equal(1))
				Expect(result.Checkpoints[0].Missing).To(Equal(0))
				Expect(result.Checkpoints[1].Verified).To(Equal(1))
				Expect(result.Checkpoints[1].Missing).To(Equal(0))
				Expect(result.TotalActual).To(Equal(2))
			})

			It("correctly validates when only some checkpoints have been generated", func() {
				// Only model-step00001000 has samples; model-step00002000 does not.
				// Samples are placed at {sampleDir}/model/{studyName}/{checkpoint}/
				cpFS.safetensors["/checkpoints"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{
					ID:      studyID,
					Name:    "Test Study",
					Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
					Steps:   []int{20},
					CFGs:    []float64{7},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "normal"},
					},
					Seeds: []int64{42},
				}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				// Only the first checkpoint's scoped directory exists with samples.
				// scopedStudyDir = "model/" + studyName → {sampleDir}/model/{studyName}/{checkpoint}/
				scanFS.files[sampleDir+"/model/Test Study/model-step00001000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}
				// model-step00002000 has no directory entry → verified=0

				sid := studyID
				result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 0, StudyID: &sid})

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints).To(HaveLen(2))
				// Sorted by step: step1000 first, step2000 second
				Expect(result.Checkpoints[0].Verified).To(Equal(1)) // model-step00001000 has 1 file
				Expect(result.Checkpoints[0].Missing).To(Equal(0))
				Expect(result.Checkpoints[1].Verified).To(Equal(0)) // model-step00002000 has no files
				Expect(result.Checkpoints[1].Missing).To(Equal(1))
			})

			It("returns not_found when study_id does not match any study", func() {
				cpFS.safetensors["/checkpoints"] = []string{"model.safetensors"}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				// studyGetter has no studies
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				sid := "nonexistent-study"
				_, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 0, StudyID: &sid})

				Expect(err).To(HaveOccurred())
			})

			It("returns not_found for out-of-range ID with checkpoint discovery", func() {
				cpFS.safetensors["/checkpoints"] = []string{"model.safetensors"}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{ID: studyID, Name: "Test Study"}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				sid := studyID
				_, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 5, StudyID: &sid})

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("not found"))
			})

			// B-078 UAT rework: training run names with slashes (e.g. "qwen/Qwen2-VL") must be
			// sanitized before being used as a filesystem path component. The validation endpoint
			// must look in "qwen_Qwen2-VL/{studyID}/" not "qwen/Qwen2-VL/{studyID}/".
			It("sanitizes forward slashes in training run name when constructing scoped study dir", func() {
				// Training run discovered via checkpoint source. Checkpoint files are at
				// qwen/Qwen2-VL-step*.safetensors so the run name is "qwen/Qwen2-VL".
				// Checkpoint filenames (basename only) are "Qwen2-VL-step*.safetensors".
				cpFS.safetensors["/checkpoints"] = []string{
					"qwen/Qwen2-VL-step00001000.safetensors",
					"qwen/Qwen2-VL-step00002000.safetensors",
				}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{
					ID:      studyID,
					Name:    "Test Study",
					Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
					Steps:   []int{20},
					CFGs:    []float64{7},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "normal"},
					},
					Seeds: []int64{42},
				}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				// The job executor writes samples to the sanitized path:
				// {sampleDir}/qwen_Qwen2-VL/{studyName}/{checkpoint_basename}/
				// Checkpoint basenames: "Qwen2-VL-step00001000.safetensors" etc.
				// Validation must look in the same sanitized path.
				sanitizedStudyDir := sampleDir + "/qwen_Qwen2-VL/Test Study"
				scanFS.files[sanitizedStudyDir+"/Qwen2-VL-step00001000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}
				scanFS.files[sanitizedStudyDir+"/Qwen2-VL-step00002000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}

				sid := studyID
				result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: 0, StudyID: &sid})

				Expect(err).NotTo(HaveOccurred())
				// Training run name is "qwen/Qwen2-VL" (slash kept in DB/API; sanitized only for FS)
				Expect(result.Checkpoints).To(HaveLen(2))
				// Both checkpoints should find their samples via the sanitized path
				Expect(result.Checkpoints[0].Verified).To(Equal(1))
				Expect(result.Checkpoints[0].Missing).To(Equal(0))
				Expect(result.Checkpoints[1].Verified).To(Equal(1))
				Expect(result.Checkpoints[1].Missing).To(Equal(0))
				Expect(result.TotalActual).To(Equal(2))
			})
		})
	})
})
