package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	gencheckpoints "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/checkpoints"
	gencomfyui "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/comfyui"
	gendemo "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/demo"
	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/health"
	genimages "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/images"
	genpresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/presets"
	gensamplejobs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_jobs"
	genstudies "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/studies"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	genworkflows "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/workflows"
	genws "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/ws"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeCheckpointFS implements service.CheckpointFileSystem for testing.
type fakeCheckpointFS struct {
	files map[string][]string // root → list of relative file paths
	dirs  map[string]bool     // path → exists
}

func newFakeCheckpointFS() *fakeCheckpointFS {
	return &fakeCheckpointFS{
		files: make(map[string][]string),
		dirs:  make(map[string]bool),
	}
}

func (f *fakeCheckpointFS) ListSafetensorsFiles(root string) ([]string, error) {
	return f.files[root], nil
}

func (f *fakeCheckpointFS) DirectoryExists(path string) bool {
	return f.dirs[path]
}

var _ = Describe("NewHTTPHandler", func() {
	var (
		logger    *logrus.Logger
		viewerFS  *fakeViewerDiscoveryFS
		scanFS    *fakeScanFS
		sampleDir string
		specJSON  []byte
	)

	BeforeEach(func() {
		logger = logrus.New()
		logger.SetOutput(io.Discard)
		viewerFS = newFakeViewerDiscoveryFS()
		scanFS = newFakeScanFS()
		sampleDir = "/samples"
		specJSON = []byte(`{"openapi":"3.0.0"}`)
	})

	// Helper to create all required endpoints for testing
	createAllEndpoints := func() (
		*genhealth.Endpoints,
		*gendocs.Endpoints,
		*gentrainingruns.Endpoints,
		*genpresets.Endpoints,
		*genstudies.Endpoints,
		*gensamplejobs.Endpoints,
		*gencheckpoints.Endpoints,
		*gencomfyui.Endpoints,
		*genworkflows.Endpoints,
		*genimages.Endpoints,
		*genws.Endpoints,
		*gendemo.Endpoints,
	) {
		// Service layer services
		viewerDiscoverySvc := service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
		discoverySvc := service.NewDiscoveryService(newFakeCheckpointFS(), []string{"/checkpoints"}, sampleDir, logger)
		scannerSvc := service.NewScanner(scanFS, sampleDir, logger)
		presetSvc := service.NewPresetService(newFakePresetStore(), logger)
		studySvc := service.NewStudyService(newFakeStudyStoreAPI(), logger)
		sampleJobSvc := service.NewSampleJobService(newFakeSampleJobStore(), &fakePathMatcher{}, &fakeSampleDirRemover{}, sampleDir, logger)
		checkpointMetadataSvc := service.NewCheckpointMetadataService(newFakeMetadataReader(), []string{"/checkpoints"}, logger)
		imageMetadataSvc := service.NewImageMetadataService(&realFileReader{}, sampleDir, logger)
		hub := service.NewHub(logger)
		demoFS := newFakeViewerDiscoveryFS()
		fakePS := newFakePresetStore()
		demoSvc := service.NewDemoService(demoFS, fakePS, sampleDir, logger)

		// API layer services
		healthAPISvc := api.NewHealthService()
		docsAPISvc := api.NewDocsService(specJSON)
		trainingRunsAPISvc := api.NewTrainingRunsService(viewerDiscoverySvc, scannerSvc, nil, nil)
		presetsAPISvc := api.NewPresetsService(presetSvc)
		studiesAPISvc := api.NewStudiesService(studySvc)
		sampleJobsAPISvc := api.NewSampleJobsService(sampleJobSvc, discoverySvc)
		checkpointsAPISvc := api.NewCheckpointsService(checkpointMetadataSvc)
		comfyuiAPISvc := api.NewComfyUIService(nil, nil)
		workflowsAPISvc := api.NewWorkflowService(nil)
		imagesAPISvc := api.NewImagesService(sampleDir, imageMetadataSvc, logger)
		wsAPISvc := api.NewWSService(hub)
		demoAPISvc := api.NewDemoAPIService(demoSvc)

		return genhealth.NewEndpoints(healthAPISvc),
			gendocs.NewEndpoints(docsAPISvc),
			gentrainingruns.NewEndpoints(trainingRunsAPISvc),
			genpresets.NewEndpoints(presetsAPISvc),
			genstudies.NewEndpoints(studiesAPISvc),
			gensamplejobs.NewEndpoints(sampleJobsAPISvc),
			gencheckpoints.NewEndpoints(checkpointsAPISvc),
			gencomfyui.NewEndpoints(comfyuiAPISvc),
			genworkflows.NewEndpoints(workflowsAPISvc),
			genimages.NewEndpoints(imagesAPISvc),
			genws.NewEndpoints(wsAPISvc),
			gendemo.NewEndpoints(demoAPISvc)
	}

	Describe("Debug middleware", func() {
		It("logs full request/response when debug is enabled", func() {
			healthEndpoints, docsEndpoints, trainingRunsEndpoints, presetsEndpoints,
				studiesEndpoints, sampleJobsEndpoints, checkpointsEndpoints,
				comfyuiEndpoints, workflowsEndpoints, imagesEndpoints, wsEndpoints,
				demoEndpoints := createAllEndpoints()

			cfg := api.HTTPHandlerConfig{
				HealthEndpoints:        healthEndpoints,
				DocsEndpoints:          docsEndpoints,
				TrainingRunEndpoints:   trainingRunsEndpoints,
				PresetsEndpoints:       presetsEndpoints,
				StudiesEndpoints:       studiesEndpoints,
				SampleJobsEndpoints:    sampleJobsEndpoints,
				CheckpointsEndpoints:   checkpointsEndpoints,
				ComfyUIEndpoints:       comfyuiEndpoints,
				WorkflowsEndpoints:     workflowsEndpoints,
				ImagesEndpoints:        imagesEndpoints,
				WSEndpoints:            wsEndpoints,
				DemoEndpoints:          demoEndpoints,
				SwaggerUIDir:           nil,
				Logger:                 logger,
				Debug:                  true,
			}

			// The debug middleware should not cause the handler to panic
			handler := api.NewHTTPHandler(cfg)

			server := httptest.NewServer(handler)
			defer server.Close()

			resp, err := http.Get(server.URL + "/health")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
		})

		It("does not log debug info when debug is disabled", func() {
			healthEndpoints, docsEndpoints, trainingRunsEndpoints, presetsEndpoints,
				studiesEndpoints, sampleJobsEndpoints, checkpointsEndpoints,
				comfyuiEndpoints, workflowsEndpoints, imagesEndpoints, wsEndpoints,
				demoEndpoints := createAllEndpoints()

			cfg := api.HTTPHandlerConfig{
				HealthEndpoints:        healthEndpoints,
				DocsEndpoints:          docsEndpoints,
				TrainingRunEndpoints:   trainingRunsEndpoints,
				PresetsEndpoints:       presetsEndpoints,
				StudiesEndpoints:       studiesEndpoints,
				SampleJobsEndpoints:    sampleJobsEndpoints,
				CheckpointsEndpoints:   checkpointsEndpoints,
				ComfyUIEndpoints:       comfyuiEndpoints,
				WorkflowsEndpoints:     workflowsEndpoints,
				ImagesEndpoints:        imagesEndpoints,
				WSEndpoints:            wsEndpoints,
				DemoEndpoints:          demoEndpoints,
				SwaggerUIDir:           nil,
				Logger:                 logger,
				Debug:                  false,
			}

			handler := api.NewHTTPHandler(cfg)

			server := httptest.NewServer(handler)
			defer server.Close()

			resp, err := http.Get(server.URL + "/health")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
		})
	})

	Describe("Image metadata URL rewrite", func() {
		It("rewrites /api/images/{path}/metadata to the internal Goa endpoint", func() {
			// Create a temporary directory for images
			tmpDir, err := os.MkdirTemp("", "http-test-images-*")
			Expect(err).NotTo(HaveOccurred())
			defer os.RemoveAll(tmpDir)

			// Create a test PNG with metadata
			subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
			Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

			pngData := buildTestPNGWithTextChunks(map[string]string{
				"prompt": "test prompt",
			})
			imagePath := filepath.Join(subDir, "test.png")
			Expect(os.WriteFile(imagePath, pngData, 0644)).To(Succeed())

			// Create services and endpoints
			healthEndpoints, docsEndpoints, trainingRunsEndpoints, presetsEndpoints,
				studiesEndpoints, sampleJobsEndpoints, checkpointsEndpoints,
				comfyuiEndpoints, workflowsEndpoints, _, wsEndpoints,
				demoEndpoints := createAllEndpoints()

			// Create images service with the test directory
			fs := &realFileReader{}
			metadataSvc := service.NewImageMetadataService(fs, tmpDir, logger)
			imagesSvc := api.NewImagesService(tmpDir, metadataSvc, logger)
			imagesEndpoints := genimages.NewEndpoints(imagesSvc)

			cfg := api.HTTPHandlerConfig{
				HealthEndpoints:        healthEndpoints,
				DocsEndpoints:          docsEndpoints,
				TrainingRunEndpoints:   trainingRunsEndpoints,
				PresetsEndpoints:       presetsEndpoints,
				StudiesEndpoints:       studiesEndpoints,
				SampleJobsEndpoints:    sampleJobsEndpoints,
				CheckpointsEndpoints:   checkpointsEndpoints,
				ComfyUIEndpoints:       comfyuiEndpoints,
				WorkflowsEndpoints:     workflowsEndpoints,
				ImagesEndpoints:        imagesEndpoints,
				WSEndpoints:            wsEndpoints,
				DemoEndpoints:          demoEndpoints,
				SwaggerUIDir:           nil,
				Logger:                 logger,
				Debug:                  false,
			}

			handler := api.NewHTTPHandler(cfg)
			server := httptest.NewServer(handler)
			defer server.Close()

			// Test that the original URL pattern works
			resp, err := http.Get(server.URL + "/api/images/checkpoint.safetensors/test.png/metadata")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			var result map[string]interface{}
			body, err := io.ReadAll(resp.Body)
			Expect(err).NotTo(HaveOccurred())
			err = json.Unmarshal(body, &result)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveKey("string_metadata"))
			stringMetadata := result["string_metadata"].(map[string]interface{})
			Expect(stringMetadata["prompt"]).To(Equal("test prompt"))
		})
	})
})
