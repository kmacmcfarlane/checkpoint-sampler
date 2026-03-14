package api_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
	goahttp "goa.design/goa/v3/http"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
)

// fakePartialSampleSeeder is a test double for the PartialSampleSeeder interface.
type fakePartialSampleSeeder struct {
	calls []partialSeedCall
	dirs  []string
	err   error
}

type partialSeedCall struct {
	trainingRunName     string
	studyName           string
	checkpointFilenames []string
}

func (f *fakePartialSampleSeeder) SeedPartialSamples(trainingRunName, studyName string, checkpointFilenames []string) ([]string, error) {
	f.calls = append(f.calls, partialSeedCall{
		trainingRunName:     trainingRunName,
		studyName:           studyName,
		checkpointFilenames: checkpointFilenames,
	})
	return f.dirs, f.err
}

var _ = Describe("MountTestSeedPartialSamplesEndpoint", func() {
	var (
		mux    goahttp.Muxer
		seeder *fakePartialSampleSeeder
		logger *logrus.Logger
	)

	BeforeEach(func() {
		mux = goahttp.NewMuxer()
		seeder = &fakePartialSampleSeeder{
			dirs: []string{"/data/samples/my-model/study-001/cp1.safetensors"},
		}
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	// AC: BE: Endpoint is only available in test mode
	Context("when ENABLE_TEST_ENDPOINTS is not set", func() {
		BeforeEach(func() {
			os.Unsetenv("ENABLE_TEST_ENDPOINTS")
		})

		It("does not mount the endpoint", func() {
			// AC: BE: Endpoint is only available in test mode
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			body := bytes.NewBufferString(`{"training_run_name":"my-model","study_id":"study-001","checkpoint_filenames":[]}`)
			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", body)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			// The mux should return 405 or 404 since nothing is mounted
			Expect(resp.StatusCode).NotTo(Equal(http.StatusCreated))
			Expect(seeder.calls).To(BeEmpty())
		})
	})

	Context("when ENABLE_TEST_ENDPOINTS is set to a non-true value", func() {
		BeforeEach(func() {
			os.Setenv("ENABLE_TEST_ENDPOINTS", "false")
		})

		AfterEach(func() {
			os.Unsetenv("ENABLE_TEST_ENDPOINTS")
		})

		It("does not mount the endpoint", func() {
			// AC: BE: Endpoint is only available in test mode
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			body := bytes.NewBufferString(`{"training_run_name":"my-model","study_id":"study-001","checkpoint_filenames":[]}`)
			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", body)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).NotTo(Equal(http.StatusCreated))
			Expect(seeder.calls).To(BeEmpty())
		})
	})

	// AC: BE: Test-only API endpoint seeds partial sample directories for a study
	Context("when ENABLE_TEST_ENDPOINTS is true", func() {
		BeforeEach(func() {
			os.Setenv("ENABLE_TEST_ENDPOINTS", "true")
		})

		AfterEach(func() {
			os.Unsetenv("ENABLE_TEST_ENDPOINTS")
		})

		It("calls SeedPartialSamples with the provided parameters", func() {
			// AC: BE: Test-only API endpoint seeds partial sample directories for a study
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := api.SeedPartialSamplesRequest{
				TrainingRunName: "my-model",
				StudyID:         "study-abc",
				StudyName:       "My Study",
				CheckpointFilenames: []string{
					"my-model-step00001000.safetensors",
				},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated))
			Expect(seeder.calls).To(HaveLen(1))
			Expect(seeder.calls[0].trainingRunName).To(Equal("my-model"))
			Expect(seeder.calls[0].studyName).To(Equal("My Study"))
			Expect(seeder.calls[0].checkpointFilenames).To(ConsistOf("my-model-step00001000.safetensors"))
		})

		It("returns 201 with created_dirs in the response body", func() {
			// AC: BE: Test-only API endpoint seeds partial sample directories for a study
			seeder.dirs = []string{
				"/data/samples/my-model/study-abc/my-model-step00001000.safetensors",
			}
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := api.SeedPartialSamplesRequest{
				TrainingRunName:     "my-model",
				StudyID:             "study-abc",
				StudyName:           "My Study",
				CheckpointFilenames: []string{"my-model-step00001000.safetensors"},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated))

			var responseBody api.SeedPartialSamplesResponse
			err = json.NewDecoder(resp.Body).Decode(&responseBody)
			Expect(err).NotTo(HaveOccurred())
			Expect(responseBody.CreatedDirs).To(HaveLen(1))
			Expect(responseBody.CreatedDirs[0]).To(ContainSubstring("my-model-step00001000.safetensors"))
		})

		It("returns 400 when training_run_name is missing", func() {
			// AC: BE: Endpoint validates required fields
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := api.SeedPartialSamplesRequest{
				StudyID:             "study-abc",
				StudyName:           "My Study",
				CheckpointFilenames: []string{"cp.safetensors"},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusBadRequest))
			Expect(seeder.calls).To(BeEmpty())
		})

		It("returns 400 when study_name is missing", func() {
			// AC: BE: Endpoint validates required fields
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := api.SeedPartialSamplesRequest{
				TrainingRunName:     "my-model",
				CheckpointFilenames: []string{"cp.safetensors"},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusBadRequest))
			Expect(seeder.calls).To(BeEmpty())
		})

		It("returns 400 when request body is invalid JSON", func() {
			// AC: BE: Endpoint validates request body format
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", bytes.NewBufferString(`not valid json`))
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusBadRequest))
			Expect(seeder.calls).To(BeEmpty())
		})

		It("returns 500 when SeedPartialSamples fails", func() {
			// AC: BE: Endpoint propagates seeder errors
			seeder.err = fmt.Errorf("disk error")
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := api.SeedPartialSamplesRequest{
				TrainingRunName:     "my-model",
				StudyID:             "study-abc",
				StudyName:           "My Study",
				CheckpointFilenames: []string{"cp.safetensors"},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusInternalServerError))
		})

		It("seeds zero checkpoint dirs when checkpoint_filenames is empty", func() {
			// AC: BE: Endpoint handles empty checkpoint list gracefully
			seeder.dirs = []string{}
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := api.SeedPartialSamplesRequest{
				TrainingRunName:     "my-model",
				StudyID:             "study-abc",
				StudyName:           "My Study",
				CheckpointFilenames: []string{},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated))
			Expect(seeder.calls).To(HaveLen(1))
			Expect(seeder.calls[0].checkpointFilenames).To(BeEmpty())

			var responseBody api.SeedPartialSamplesResponse
			err = json.NewDecoder(resp.Body).Decode(&responseBody)
			Expect(err).NotTo(HaveOccurred())
			Expect(responseBody.CreatedDirs).To(BeEmpty())
		})

		It("seeds multiple checkpoint dirs when multiple filenames are provided", func() {
			// AC: BE: Test-only API endpoint seeds partial sample directories for a study
			seeder.dirs = []string{
				"/data/samples/my-model/study-abc/cp1.safetensors",
				"/data/samples/my-model/study-abc/cp2.safetensors",
			}
			api.MountTestSeedPartialSamplesEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := api.SeedPartialSamplesRequest{
				TrainingRunName: "my-model",
				StudyID:         "study-abc",
				StudyName:       "My Study",
				CheckpointFilenames: []string{
					"my-model-step00001000.safetensors",
					"my-model-step00002000.safetensors",
				},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-partial-samples", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated))
			Expect(seeder.calls[0].checkpointFilenames).To(HaveLen(2))

			var responseBody api.SeedPartialSamplesResponse
			err = json.NewDecoder(resp.Body).Decode(&responseBody)
			Expect(err).NotTo(HaveOccurred())
			Expect(responseBody.CreatedDirs).To(HaveLen(2))
		})
	})
})

var _ = Describe("FilesystemPartialSampleSeeder", func() {
	var (
		tmpDir string
		logger *logrus.Logger
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "partial-sample-seeder-test-*")
		Expect(err).NotTo(HaveOccurred())
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	It("creates checkpoint directories under {sampleDir}/{sanitized_run_name}/{studyID}/", func() {
		// AC: BE: Test-only API endpoint seeds partial sample directories for a study
		fss := api.NewFilesystemPartialSampleSeeder(tmpDir, logger)

		createdDirs, err := fss.SeedPartialSamples(
			"my-model",
			"study-123",
			[]string{"my-model-step00001000.safetensors"},
		)
		Expect(err).NotTo(HaveOccurred())
		Expect(createdDirs).To(HaveLen(1))

		expectedDir := tmpDir + "/my-model/study-123/my-model-step00001000.safetensors"
		Expect(createdDirs[0]).To(Equal(expectedDir))

		// Directory should exist on disk
		info, err := os.Stat(expectedDir)
		Expect(err).NotTo(HaveOccurred())
		Expect(info.IsDir()).To(BeTrue())
	})

	It("creates a placeholder PNG file inside each checkpoint directory", func() {
		// AC: BE: Test-only API endpoint seeds partial sample directories for a study
		fss := api.NewFilesystemPartialSampleSeeder(tmpDir, logger)

		createdDirs, err := fss.SeedPartialSamples(
			"my-model",
			"study-123",
			[]string{"my-model-step00001000.safetensors"},
		)
		Expect(err).NotTo(HaveOccurred())
		Expect(createdDirs).To(HaveLen(1))

		// At least one PNG file should exist inside the checkpoint dir
		entries, err := os.ReadDir(createdDirs[0])
		Expect(err).NotTo(HaveOccurred())
		Expect(len(entries)).To(BeNumerically(">=", 1))

		found := false
		for _, e := range entries {
			if !e.IsDir() {
				found = true
				break
			}
		}
		Expect(found).To(BeTrue(), "expected at least one file inside the seeded checkpoint directory")
	})

	It("sanitizes training run names with slashes", func() {
		// AC: BE: Sanitization of training run name ensures correct filesystem path
		fss := api.NewFilesystemPartialSampleSeeder(tmpDir, logger)

		createdDirs, err := fss.SeedPartialSamples(
			"test-run/my-model",
			"study-xyz",
			[]string{"my-model-step00001000.safetensors"},
		)
		Expect(err).NotTo(HaveOccurred())
		Expect(createdDirs).To(HaveLen(1))

		// Slash should be replaced with underscore in the path
		expectedDir := tmpDir + "/test-run_my-model/study-xyz/my-model-step00001000.safetensors"
		Expect(createdDirs[0]).To(Equal(expectedDir))

		_, err = os.Stat(expectedDir)
		Expect(err).NotTo(HaveOccurred())
	})

	It("creates multiple checkpoint directories when multiple filenames are provided", func() {
		// AC: BE: Test-only API endpoint seeds partial (not full) sample directories
		fss := api.NewFilesystemPartialSampleSeeder(tmpDir, logger)

		createdDirs, err := fss.SeedPartialSamples(
			"my-model",
			"study-123",
			[]string{
				"my-model-step00001000.safetensors",
				"my-model-step00002000.safetensors",
			},
		)
		Expect(err).NotTo(HaveOccurred())
		Expect(createdDirs).To(HaveLen(2))

		for _, dir := range createdDirs {
			_, err := os.Stat(dir)
			Expect(err).NotTo(HaveOccurred())
		}
	})

	It("returns empty slice and no error when checkpoint_filenames is empty", func() {
		// AC: BE: Handles empty checkpoint list gracefully
		fss := api.NewFilesystemPartialSampleSeeder(tmpDir, logger)

		createdDirs, err := fss.SeedPartialSamples("my-model", "study-123", []string{})
		Expect(err).NotTo(HaveOccurred())
		Expect(createdDirs).To(BeEmpty())
	})

	It("is idempotent — calling twice does not return an error", func() {
		// AC: BE: Seeder is safe to call multiple times
		fss := api.NewFilesystemPartialSampleSeeder(tmpDir, logger)

		_, err := fss.SeedPartialSamples("my-model", "study-123", []string{"cp.safetensors"})
		Expect(err).NotTo(HaveOccurred())

		_, err = fss.SeedPartialSamples("my-model", "study-123", []string{"cp.safetensors"})
		Expect(err).NotTo(HaveOccurred())
	})
})
