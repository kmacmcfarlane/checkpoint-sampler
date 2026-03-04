package api_test

import (
	"context"
	"fmt"
	"io"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
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

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false, Source: "samples"})

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

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false, Source: "samples"})

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

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false, Source: "samples"})

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
		It("returns all runs regardless of has_samples parameter", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-a.safetensors",
				"model-b.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			// has_samples=true should not filter anything — all runs have samples
			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: true, Source: "samples"})

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

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false, Source: "samples"})

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

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false, Source: "checkpoints"})

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

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false, Source: "checkpoints"})

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
			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false, Source: "samples"})

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
	})
})
