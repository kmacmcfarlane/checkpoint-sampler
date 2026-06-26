package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	genbasemodels "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/base_models"
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

// newBodyLimitTestHandler creates a NewHTTPHandler with the given body limit and
// minimal service wiring, suitable for body-limit integration tests.
func newBodyLimitTestHandler(limitMB int) http.Handler {
	logger := logrus.New()
	logger.SetOutput(io.Discard)
	sampleDir := "/samples"
	viewerFS := newFakeViewerDiscoveryFS()
	scanFS := newFakeScanFS()

	viewerDiscoverySvc := service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
	discoverySvc := service.NewDiscoveryService(newFakeCheckpointFS(), []string{"/checkpoints"}, nil, sampleDir, logger)
	scannerSvc := service.NewScanner(scanFS, sampleDir, logger)
	presetSvc := service.NewPresetService(newFakePresetStore(), logger)
	studySvc := service.NewStudyService(newFakeStudyStoreAPI(), &fakeSampleCheckerAPI{}, logger)
	sampleJobSvc := service.NewSampleJobService(newFakeSampleJobStore(), &fakePathMatcher{}, &fakeSampleDirRemover{}, sampleDir, logger)
	checkpointMetadataSvc := service.NewCheckpointMetadataService(newFakeMetadataReader(), []string{"/checkpoints"}, nil, logger)
	imageMetadataSvc := service.NewImageMetadataService(&realFileReader{}, sampleDir, logger)
	hub := service.NewHub(logger)
	demoFS := newFakeViewerDiscoveryFS()
	fakePS := newFakePresetStore()
	demoSvc := service.NewDemoService(demoFS, fakePS, sampleDir, logger)
	baseModelSvc := service.NewBaseModelService(newFakeCheckpointFS(), "", []string{"/checkpoints"}, logger)

	return api.NewHTTPHandler(api.HTTPHandlerConfig{
		HealthEndpoints:      genhealth.NewEndpoints(api.NewHealthService()),
		DocsEndpoints:        gendocs.NewEndpoints(api.NewDocsService([]byte(`{}`))),
		TrainingRunEndpoints: gentrainingruns.NewEndpoints(api.NewTrainingRunsService(viewerDiscoverySvc, discoverySvc, scannerSvc, nil, nil, nil)),
		PresetsEndpoints:     genpresets.NewEndpoints(api.NewPresetsService(presetSvc)),
		StudiesEndpoints:     genstudies.NewEndpoints(api.NewStudiesService(studySvc, nil, nil)),
		SampleJobsEndpoints:  gensamplejobs.NewEndpoints(api.NewSampleJobsService(sampleJobSvc, discoverySvc)),
		BaseModelsEndpoints:  genbasemodels.NewEndpoints(api.NewBaseModelsService(baseModelSvc)),
		CheckpointsEndpoints: gencheckpoints.NewEndpoints(api.NewCheckpointsService(checkpointMetadataSvc)),
		ComfyUIEndpoints:     gencomfyui.NewEndpoints(api.NewComfyUIService(nil, nil)),
		WorkflowsEndpoints:   genworkflows.NewEndpoints(api.NewWorkflowService(nil)),
		ImagesEndpoints:      genimages.NewEndpoints(api.NewImagesService(sampleDir, imageMetadataSvc, logger)),
		WSEndpoints:          genws.NewEndpoints(api.NewWSService(hub)),
		DemoEndpoints:        gendemo.NewEndpoints(api.NewDemoAPIService(demoSvc)),
		SwaggerUIDir:         nil,
		Logger:               logger,
		Debug:                false,
		MaxRequestSizeMB:     limitMB,
	})
}

var _ = Describe("RequestBodyLimitMiddleware", func() {
	var (
		server *httptest.Server
		client *http.Client
	)

	// buildHandler creates a test HTTP handler wrapped in RequestBodyLimitMiddleware
	// with the given limit in MB, and a simple inner handler that reads the
	// full body and echoes 200 OK.
	buildHandler := func(limitMB int) http.Handler {
		inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.ReadAll(r.Body)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		})
		return api.RequestBodyLimitMiddleware(limitMB)(inner)
	}

	AfterEach(func() {
		if server != nil {
			server.Close()
		}
	})

	Describe("middleware standalone", func() {
		BeforeEach(func() {
			// Use 1 MB limit for fast tests.
			server = httptest.NewServer(buildHandler(1))
			client = server.Client()
		})

		It("accepts a request body just under the limit", func() {
			// Just under 1 MB: limit is 1*1024*1024 = 1048576 bytes; send 1048575.
			// Content-Length will be 1048575 which is not > 1048576, so MaxBytesReader
			// path is taken and the body is read successfully.
			body := strings.Repeat("x", 1024*1024-1)
			req, err := http.NewRequest(http.MethodPost, server.URL+"/anything", strings.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/octet-stream")

			resp, err := client.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
		})

		It("rejects via Content-Length fast-path when body size exceeds limit", func() {
			// Go's http.NewRequest sets Content-Length from strings.Reader.
			// 1048577 > 1048576 triggers the fast-path: 413 before any bytes are read.
			body := strings.Repeat("x", 1024*1024+1)
			req, err := http.NewRequest(http.MethodPost, server.URL+"/anything", strings.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/octet-stream")

			resp, err := client.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusRequestEntityTooLarge))

			// Verify JSON error envelope matches Goa's ErrorResponse format.
			respBody, err := io.ReadAll(resp.Body)
			Expect(err).NotTo(HaveOccurred())
			var errResp map[string]any
			Expect(json.Unmarshal(respBody, &errResp)).To(Succeed())
			Expect(errResp).To(HaveKey("name"))
			Expect(errResp).To(HaveKey("message"))
			Expect(errResp).To(HaveKey("temporary"))
			Expect(errResp).To(HaveKey("timeout"))
			Expect(errResp).To(HaveKey("fault"))
			Expect(errResp["name"]).To(Equal("request_entity_too_large"))
			Expect(errResp["message"]).To(ContainSubstring("too large"))
		})

		It("rejects via Content-Length fast-path using httptest.NewRequest", func() {
			// httptest.NewRequest lets us set an arbitrary ContentLength without
			// the Go client enforcing body-size consistency.
			req := httptest.NewRequest(http.MethodPost, "/anything", strings.NewReader("small body"))
			req.ContentLength = int64(2 * 1024 * 1024) // 2 MB > 1 MB limit

			w := httptest.NewRecorder()
			buildHandler(1).ServeHTTP(w, req)

			Expect(w.Code).To(Equal(http.StatusRequestEntityTooLarge))

			var errResp map[string]any
			Expect(json.Unmarshal(w.Body.Bytes(), &errResp)).To(Succeed())
			Expect(errResp["name"]).To(Equal("request_entity_too_large"))
		})
	})

	Describe("integration with NewHTTPHandler", func() {
		BeforeEach(func() {
			// Use a 1 MB limit so tests are fast.
			server = httptest.NewServer(newBodyLimitTestHandler(1))
			client = server.Client()
		})

		It("returns 413 with JSON error body for oversized POST to a Goa endpoint", func() {
			// POST to /api/presets with body larger than the 1 MB limit.
			// Go's http.NewRequest sets Content-Length from strings.Reader, so the
			// middleware Content-Length fast-path fires and returns 413 before Goa
			// ever sees the request body.
			body := strings.Repeat("x", 1024*1024+1)
			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/presets", strings.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := client.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusRequestEntityTooLarge))

			respBody, err := io.ReadAll(resp.Body)
			Expect(err).NotTo(HaveOccurred())
			var errResp map[string]any
			Expect(json.Unmarshal(respBody, &errResp)).To(Succeed())
			Expect(errResp["name"]).To(Equal("request_entity_too_large"))
		})

		It("allows a small request body to pass through to a Goa endpoint", func() {
			// GET /health sends no body and should succeed normally.
			resp, err := client.Get(server.URL + "/health")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
		})
	})
})
