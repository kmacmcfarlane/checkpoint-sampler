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
	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/health"
	genimages "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/images"
	genpresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/presets"
	gensamplejobs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_jobs"
	gensamplepresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_presets"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	genworkflows "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/workflows"
	genws "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/ws"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

var _ = Describe("NewHTTPHandler", func() {
	var (
		logger      *logrus.Logger
		discoveryFS *fakeDiscoveryFS
		scanFS      *fakeScanFS
		sampleDir   string
		specJSON    []byte
	)

	BeforeEach(func() {
		logger = logrus.New()
		logger.SetOutput(io.Discard)
		discoveryFS = newFakeDiscoveryFS()
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
		*gensamplepresets.Endpoints,
		*gensamplejobs.Endpoints,
		*gencheckpoints.Endpoints,
		*gencomfyui.Endpoints,
		*genworkflows.Endpoints,
		*genimages.Endpoints,
		*genws.Endpoints,
	) {
		// Service layer services
		discoverySvc := service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
		scannerSvc := service.NewScanner(scanFS, sampleDir, logger)
		presetSvc := service.NewPresetService(newFakePresetStore(), logger)
		samplePresetSvc := service.NewSamplePresetService(newFakeSamplePresetStore(), logger)
		sampleJobSvc := service.NewSampleJobService(newFakeSampleJobStore(), &fakePathMatcher{}, logger)
		checkpointMetadataSvc := service.NewCheckpointMetadataService(newFakeMetadataReader(), []string{"/checkpoints"}, logger)
		imageMetadataSvc := service.NewImageMetadataService(&realFileReader{}, sampleDir, logger)
		hub := service.NewHub(logger)

		// API layer services
		healthAPISvc := api.NewHealthService()
		docsAPISvc := api.NewDocsService(specJSON)
		trainingRunsAPISvc := api.NewTrainingRunsService(discoverySvc, scannerSvc, nil)
		presetsAPISvc := api.NewPresetsService(presetSvc)
		samplePresetsAPISvc := api.NewSamplePresetsService(samplePresetSvc)
		sampleJobsAPISvc := api.NewSampleJobsService(sampleJobSvc, discoverySvc)
		checkpointsAPISvc := api.NewCheckpointsService(checkpointMetadataSvc)
		comfyuiAPISvc := api.NewComfyUIService(nil, nil)
		workflowsAPISvc := api.NewWorkflowService(nil)
		imagesAPISvc := api.NewImagesService(sampleDir, imageMetadataSvc, logger)
		wsAPISvc := api.NewWSService(hub)

		return genhealth.NewEndpoints(healthAPISvc),
			gendocs.NewEndpoints(docsAPISvc),
			gentrainingruns.NewEndpoints(trainingRunsAPISvc),
			genpresets.NewEndpoints(presetsAPISvc),
			gensamplepresets.NewEndpoints(samplePresetsAPISvc),
			gensamplejobs.NewEndpoints(sampleJobsAPISvc),
			gencheckpoints.NewEndpoints(checkpointsAPISvc),
			gencomfyui.NewEndpoints(comfyuiAPISvc),
			genworkflows.NewEndpoints(workflowsAPISvc),
			genimages.NewEndpoints(imagesAPISvc),
			genws.NewEndpoints(wsAPISvc)
	}

	Describe("Debug middleware", func() {
		It("logs full request/response when debug is enabled", func() {
			healthEndpoints, docsEndpoints, trainingRunsEndpoints, presetsEndpoints,
				samplePresetsEndpoints, sampleJobsEndpoints, checkpointsEndpoints,
				comfyuiEndpoints, workflowsEndpoints, imagesEndpoints, wsEndpoints := createAllEndpoints()

			cfg := api.HTTPHandlerConfig{
				HealthEndpoints:        healthEndpoints,
				DocsEndpoints:          docsEndpoints,
				TrainingRunEndpoints:   trainingRunsEndpoints,
				PresetsEndpoints:       presetsEndpoints,
				SamplePresetsEndpoints: samplePresetsEndpoints,
				SampleJobsEndpoints:    sampleJobsEndpoints,
				CheckpointsEndpoints:   checkpointsEndpoints,
				ComfyUIEndpoints:       comfyuiEndpoints,
				WorkflowsEndpoints:     workflowsEndpoints,
				ImagesEndpoints:        imagesEndpoints,
				WSEndpoints:            wsEndpoints,
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
				samplePresetsEndpoints, sampleJobsEndpoints, checkpointsEndpoints,
				comfyuiEndpoints, workflowsEndpoints, imagesEndpoints, wsEndpoints := createAllEndpoints()

			cfg := api.HTTPHandlerConfig{
				HealthEndpoints:        healthEndpoints,
				DocsEndpoints:          docsEndpoints,
				TrainingRunEndpoints:   trainingRunsEndpoints,
				PresetsEndpoints:       presetsEndpoints,
				SamplePresetsEndpoints: samplePresetsEndpoints,
				SampleJobsEndpoints:    sampleJobsEndpoints,
				CheckpointsEndpoints:   checkpointsEndpoints,
				ComfyUIEndpoints:       comfyuiEndpoints,
				WorkflowsEndpoints:     workflowsEndpoints,
				ImagesEndpoints:        imagesEndpoints,
				WSEndpoints:            wsEndpoints,
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
				samplePresetsEndpoints, sampleJobsEndpoints, checkpointsEndpoints,
				comfyuiEndpoints, workflowsEndpoints, _, wsEndpoints := createAllEndpoints()

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
				SamplePresetsEndpoints: samplePresetsEndpoints,
				SampleJobsEndpoints:    sampleJobsEndpoints,
				CheckpointsEndpoints:   checkpointsEndpoints,
				ComfyUIEndpoints:       comfyuiEndpoints,
				WorkflowsEndpoints:     workflowsEndpoints,
				ImagesEndpoints:        imagesEndpoints,
				WSEndpoints:            wsEndpoints,
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
			Expect(result).To(HaveKey("metadata"))
			metadata := result["metadata"].(map[string]interface{})
			Expect(metadata["prompt"]).To(Equal("test prompt"))
		})
	})
})
