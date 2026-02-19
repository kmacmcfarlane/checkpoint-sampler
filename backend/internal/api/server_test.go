package api_test

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
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
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
	goahttp "goa.design/goa/v3/http"
)

var _ = Describe("Server integration", func() {
	var (
		server *httptest.Server
		client *http.Client
	)

	specJSON := []byte(`{"openapi":"3.0.0","info":{"title":"Checkpoint Sampler","version":"0.1.0"}}`)

	testTrainingRuns := []model.TrainingRunConfig{
		{
			Name:    "test-run",
			Pattern: regexp.MustCompile(`^test/.+`),
			Dimensions: []model.DimensionConfig{
				{
					Name:    "step",
					Type:    model.DimensionTypeInt,
					Pattern: regexp.MustCompile(`-steps-(\d+)-`),
				},
			},
		},
	}

	BeforeEach(func() {
		healthSvc := api.NewHealthService()
		docsSvc := api.NewDocsService(specJSON)
		trainingRunsSvc := api.NewTrainingRunsService(testTrainingRuns)

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
			Expect(result[0]["pattern"]).To(Equal(`^test/.+`))

			dims, ok := result[0]["dimensions"].([]interface{})
			Expect(ok).To(BeTrue())
			Expect(dims).To(HaveLen(1))

			dim, ok := dims[0].(map[string]interface{})
			Expect(ok).To(BeTrue())
			Expect(dim["name"]).To(Equal("step"))
			Expect(dim["type"]).To(Equal("int"))
		})

		It("includes CORS headers", func() {
			resp, err := client.Get(server.URL + "/api/training-runs")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.Header.Get("Access-Control-Allow-Origin")).To(Equal("*"))
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
