package api_test

import (
	"io"
	"net/http"
	"net/http/httptest"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	gencheckpoints "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/checkpoints"
	gencomfyui "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/comfyui"
	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/health"
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
		*genws.Endpoints,
	) {
		// Service layer services
		discoverySvc := service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir, logger)
		scannerSvc := service.NewScanner(scanFS, sampleDir, logger)
		presetSvc := service.NewPresetService(newFakePresetStore(), logger)
		samplePresetSvc := service.NewSamplePresetService(newFakeSamplePresetStore(), logger)
		sampleJobSvc := service.NewSampleJobService(newFakeSampleJobStore(), &fakePathMatcher{}, logger)
		checkpointMetadataSvc := service.NewCheckpointMetadataService(newFakeMetadataReader(), []string{"/checkpoints"}, logger)
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
			genws.NewEndpoints(wsAPISvc)
	}

	Describe("Debug middleware", func() {
		It("logs full request/response when debug is enabled", func() {
			healthEndpoints, docsEndpoints, trainingRunsEndpoints, presetsEndpoints,
				samplePresetsEndpoints, sampleJobsEndpoints, checkpointsEndpoints,
				comfyuiEndpoints, workflowsEndpoints, wsEndpoints := createAllEndpoints()

			imageHandler := api.NewImageHandler(sampleDir)

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
				WSEndpoints:            wsEndpoints,
				ImageHandler:           imageHandler,
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
				comfyuiEndpoints, workflowsEndpoints, wsEndpoints := createAllEndpoints()

			imageHandler := api.NewImageHandler(sampleDir)

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
				WSEndpoints:            wsEndpoints,
				ImageHandler:           imageHandler,
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
})
