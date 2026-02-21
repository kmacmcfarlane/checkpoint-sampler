package api_test

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api"
	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/health"
	gendocssvr "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/http/docs/server"
	genhealthsvr "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/http/health/server"
	gentrainingrunssvr "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/http/training_runs/server"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/training_runs"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
	goahttp "goa.design/goa/v3/http"
)

var _ = Describe("Server integration", func() {
	var (
		server      *httptest.Server
		client      *http.Client
		discoveryFS *fakeDiscoveryFS
		scanFS      *fakeScanFS
		sampleDir   string
	)

	specJSON := []byte(`{"openapi":"3.0.0","info":{"title":"Checkpoint Sampler","version":"0.1.0"}}`)

	BeforeEach(func() {
		sampleDir = "/samples"
		discoveryFS = newFakeDiscoveryFS()
		scanFS = newFakeScanFS()

		// Set up a default training run for integration tests
		discoveryFS.files["/checkpoints"] = []string{
			"test-run-step00001000.safetensors",
		}
		discoveryFS.dirs["/samples/test-run-step00001000.safetensors"] = true

		discovery := service.NewDiscoveryService(discoveryFS, []string{"/checkpoints"}, sampleDir)
		scanner := service.NewScanner(scanFS, sampleDir)

		healthSvc := api.NewHealthService()
		docsSvc := api.NewDocsService(specJSON)
		trainingRunsSvc := api.NewTrainingRunsService(discovery, scanner)

		healthEndpoints := genhealth.NewEndpoints(healthSvc)
		docsEndpoints := gendocs.NewEndpoints(docsSvc)
		trainingRunsEndpoints := gentrainingruns.NewEndpoints(trainingRunsSvc)

		mux := goahttp.NewMuxer()
		dec := goahttp.RequestDecoder
		enc := goahttp.ResponseEncoder

		healthServer := genhealthsvr.New(healthEndpoints, mux, dec, enc, nil, nil)
		docsServer := gendocssvr.New(docsEndpoints, mux, dec, enc, nil, nil, nil)
		trainingRunsServer := gentrainingrunssvr.New(trainingRunsEndpoints, mux, dec, enc, nil, nil)

		healthServer.Mount(mux)
		docsServer.Mount(mux)
		trainingRunsServer.Mount(mux)

		var handler http.Handler = mux
		handler = api.CORSMiddleware("*")(handler)

		server = httptest.NewServer(handler)
		client = server.Client()
	})

	AfterEach(func() {
		server.Close()
	})

	Describe("GET /health", func() {
		It("returns 200 with status ok", func() {
			resp, err := client.Get(server.URL + "/health")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			var result map[string]string
			body, err := io.ReadAll(resp.Body)
			Expect(err).NotTo(HaveOccurred())
			err = json.Unmarshal(body, &result)
			Expect(err).NotTo(HaveOccurred())
			Expect(result["status"]).To(Equal("ok"))
		})

		It("includes CORS headers", func() {
			resp, err := client.Get(server.URL + "/health")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.Header.Get("Access-Control-Allow-Origin")).To(Equal("*"))
		})
	})

	Describe("GET /docs/openapi3.json", func() {
		It("returns the OpenAPI spec", func() {
			resp, err := client.Get(server.URL + "/docs/openapi3.json")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			body, err := io.ReadAll(resp.Body)
			Expect(err).NotTo(HaveOccurred())

			// Goa encodes Bytes result as a JSON base64 string
			trimmed := strings.TrimSpace(string(body))
			// Remove surrounding quotes from JSON string
			var b64 string
			err = json.Unmarshal([]byte(trimmed), &b64)
			Expect(err).NotTo(HaveOccurred())
			decoded, err := base64.StdEncoding.DecodeString(b64)
			Expect(err).NotTo(HaveOccurred())
			Expect(decoded).To(Equal(specJSON))
		})
	})

	Describe("GET /api/training-runs", func() {
		It("returns 200 with training runs list", func() {
			resp, err := client.Get(server.URL + "/api/training-runs")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			body, err := io.ReadAll(resp.Body)
			Expect(err).NotTo(HaveOccurred())

			var result []map[string]interface{}
			err = json.Unmarshal(body, &result)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0]["name"]).To(Equal("test-run"))
			Expect(result[0]["has_samples"]).To(BeTrue())
			Expect(result[0]["checkpoint_count"]).To(BeNumerically("==", 1))
		})

		It("includes CORS headers", func() {
			resp, err := client.Get(server.URL + "/api/training-runs")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.Header.Get("Access-Control-Allow-Origin")).To(Equal("*"))
		})
	})

	Describe("GET /api/training-runs/{id}/scan", func() {
		It("returns 200 with scan results", func() {
			scanFS.files["/samples/test-run-step00001000.safetensors"] = []string{
				"seed=1&cfg=3&_00001_.png",
			}

			resp, err := client.Get(server.URL + "/api/training-runs/0/scan")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			body, err := io.ReadAll(resp.Body)
			Expect(err).NotTo(HaveOccurred())

			var result map[string]interface{}
			err = json.Unmarshal(body, &result)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveKey("images"))
			Expect(result).To(HaveKey("dimensions"))
		})

		It("returns 404 for invalid training run ID", func() {
			resp, err := client.Get(server.URL + "/api/training-runs/99/scan")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusNotFound))
		})
	})

	Describe("OPTIONS preflight", func() {
		It("returns CORS headers for preflight requests", func() {
			req, err := http.NewRequest(http.MethodOptions, server.URL+"/health", nil)
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Origin", "http://localhost:3000")
			req.Header.Set("Access-Control-Request-Method", "GET")

			resp, err := client.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.Header.Get("Access-Control-Allow-Origin")).To(Equal("*"))
			Expect(resp.Header.Get("Access-Control-Allow-Methods")).To(ContainSubstring("GET"))
		})
	})
})

var _ = Describe("ImageHandler", func() {
	var (
		server  *httptest.Server
		client  *http.Client
		rootDir string
	)

	BeforeEach(func() {
		var err error
		rootDir, err = os.MkdirTemp("", "image-handler-test")
		Expect(err).NotTo(HaveOccurred())

		// Create test image file
		subDir := filepath.Join(rootDir, "test", "run1")
		err = os.MkdirAll(subDir, 0755)
		Expect(err).NotTo(HaveOccurred())

		// Write a minimal PNG file (8-byte header is enough for the test)
		pngData := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
		err = os.WriteFile(filepath.Join(subDir, "test.png"), pngData, 0644)
		Expect(err).NotTo(HaveOccurred())

		imageHandler := api.NewImageHandler(rootDir)
		mux := http.NewServeMux()
		mux.Handle("/api/images/", imageHandler)

		server = httptest.NewServer(mux)
		client = server.Client()
	})

	AfterEach(func() {
		server.Close()
		os.RemoveAll(rootDir)
	})

	Describe("GET /api/images/{filepath}", func() {
		It("serves an existing image file", func() {
			resp, err := client.Get(server.URL + "/api/images/test/run1/test.png")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			Expect(resp.Header.Get("Content-Type")).To(Equal("image/png"))
		})

		It("includes immutable cache headers", func() {
			resp, err := client.Get(server.URL + "/api/images/test/run1/test.png")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.Header.Get("Cache-Control")).To(Equal("max-age=31536000, immutable"))
		})

		It("returns 404 for non-existent files", func() {
			resp, err := client.Get(server.URL + "/api/images/test/run1/missing.png")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusNotFound))
		})

		It("rejects path traversal with ..", func() {
			// Note: Go's http.Client normalizes ../.. in the URL path,
			// so we test that the result is not a 200 (i.e., not serving content)
			resp, err := client.Get(server.URL + "/api/images/../../../etc/passwd")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).NotTo(Equal(http.StatusOK))
		})

		It("rejects path traversal with encoded ..", func() {
			resp, err := client.Get(server.URL + "/api/images/test/..%2F..%2Fetc/passwd")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			// Should be either 400 or 404, not 200
			Expect(resp.StatusCode).NotTo(Equal(http.StatusOK))
		})

		It("rejects empty filepath", func() {
			resp, err := client.Get(server.URL + "/api/images/")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusBadRequest))
		})

		It("returns 404 for directories", func() {
			resp, err := client.Get(server.URL + "/api/images/test/run1")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusNotFound))
		})
	})
})
