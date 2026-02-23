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

// fakeDiscoveryFS implements service.CheckpointFileSystem for testing.
type fakeDiscoveryFS struct {
	files map[string][]string // root → list of relative file paths
	dirs  map[string]bool     // path → exists
}

func newFakeDiscoveryFS() *fakeDiscoveryFS {
	return &fakeDiscoveryFS{
		files: make(map[string][]string),
		dirs:  make(map[string]bool),
	}
}

func (f *fakeDiscoveryFS) ListSafetensorsFiles(root string) ([]string, error) {
	return f.files[root], nil
}

func (f *fakeDiscoveryFS) DirectoryExists(path string) bool {
	return f.dirs[path]
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

var _ = Describe("TrainingRunsService", func() {
	var (
		discoveryFS *fakeDiscoveryFS
		scanFS      *fakeScanFS
		discovery   *service.DiscoveryService
		scanner     *service.Scanner
		sampleDir   string
		logger      *logrus.Logger
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		discoveryFS = newFakeDiscoveryFS()
		scanFS = newFakeScanFS()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	Describe("List", func() {
		It("returns empty slice when no safetensors files found", func() {
			discoveryFS.files["/checkpoints"] = []string{}
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})

		It("returns auto-discovered training runs", func() {
			discoveryFS.files["/checkpoints"] = []string{
				"model-a.safetensors",
				"model-a-step00001000.safetensors",
				"model-b.safetensors",
			}
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
			// Sorted by name
			Expect(result[0].Name).To(Equal("model-a"))
			Expect(result[0].CheckpointCount).To(Equal(2))
			Expect(result[1].Name).To(Equal("model-b"))
			Expect(result[1].CheckpointCount).To(Equal(1))
		})

		It("includes checkpoint details in response", func() {
			discoveryFS.files["/checkpoints"] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			discoveryFS.dirs["/samples/model-step00001000.safetensors"] = true
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Checkpoints).To(HaveLen(2))
			Expect(result[0].Checkpoints[0].Filename).To(Equal("model-step00001000.safetensors"))
			Expect(result[0].Checkpoints[0].StepNumber).To(Equal(1000))
			Expect(result[0].Checkpoints[0].HasSamples).To(BeTrue())
			Expect(result[0].Checkpoints[1].Filename).To(Equal("model-step00002000.safetensors"))
			Expect(result[0].Checkpoints[1].HasSamples).To(BeFalse())
		})

		It("filters by has_samples when requested", func() {
			discoveryFS.files["/checkpoints"] = []string{
				"model-a.safetensors",
				"model-b.safetensors",
			}
			discoveryFS.dirs["/samples/model-a.safetensors"] = true
			// model-b has no samples
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: true})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Name).To(Equal("model-a"))
		})

		It("returns all runs when has_samples is false", func() {
			discoveryFS.files["/checkpoints"] = []string{
				"model-a.safetensors",
				"model-b.safetensors",
			}
			discoveryFS.dirs["/samples/model-a.safetensors"] = true
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{HasSamples: false})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
		})
	})

	Describe("Scan", func() {
		It("returns not_found for invalid training run ID", func() {
			discoveryFS.files["/checkpoints"] = []string{
				"model.safetensors",
			}
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 5})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns not_found for negative ID", func() {
			discoveryFS.files["/checkpoints"] = []string{
				"model.safetensors",
			}
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: -1})

			Expect(err).To(HaveOccurred())
		})

		It("returns scan results with images and dimensions", func() {
			discoveryFS.files["/checkpoints"] = []string{
				"model-step00001000.safetensors",
			}
			discoveryFS.dirs["/samples/model-step00001000.safetensors"] = true
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			scanFS.files["/samples/model-step00001000.safetensors"] = []string{
				"seed=1&cfg=3&_00001_.png",
				"seed=2&cfg=7&_00001_.png",
			}

			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 0})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(2))
			Expect(result.Dimensions).NotTo(BeEmpty())
		})

		It("returns scan_failed when scanner encounters an error", func() {
			discoveryFS.files["/checkpoints"] = []string{
				"model-step00001000.safetensors",
			}
			discoveryFS.dirs["/samples/model-step00001000.safetensors"] = true
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			scanFS.errs["/samples/model-step00001000.safetensors"] = fmt.Errorf("disk error")

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 0})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("disk error"))
		})

		It("maps model types to API response types correctly", func() {
			discoveryFS.files["/checkpoints"] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			discoveryFS.dirs["/samples/model-step00001000.safetensors"] = true
			discoveryFS.dirs["/samples/model-step00002000.safetensors"] = true
			discovery = service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(discovery, scanner, nil)

			scanFS.files["/samples/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}
			scanFS.files["/samples/model-step00002000.safetensors"] = []string{
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
})
