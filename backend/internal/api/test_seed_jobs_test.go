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
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// fakeJobSeeder is a test double for the JobSeeder interface.
type fakeJobSeeder struct {
	seededJobs []model.SampleJob
	err        error
}

func (f *fakeJobSeeder) SeedSampleJobs(jobs []model.SampleJob) error {
	f.seededJobs = append(f.seededJobs, jobs...)
	return f.err
}

var _ = Describe("MountTestSeedJobsEndpoint", func() {
	var (
		mux    goahttp.Muxer
		seeder *fakeJobSeeder
		logger *logrus.Logger
	)

	BeforeEach(func() {
		mux = goahttp.NewMuxer()
		seeder = &fakeJobSeeder{}
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
			api.MountTestSeedJobsEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			body := bytes.NewBufferString(`[]`)
			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-jobs", body)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			// The mux should return 405 or 404 since nothing is mounted
			Expect(resp.StatusCode).NotTo(Equal(http.StatusCreated))
			Expect(seeder.seededJobs).To(BeEmpty())
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
			api.MountTestSeedJobsEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			body := bytes.NewBufferString(`[]`)
			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-jobs", body)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).NotTo(Equal(http.StatusCreated))
			Expect(seeder.seededJobs).To(BeEmpty())
		})
	})

	// AC: BE: Test-only seed endpoint creates sample jobs with specified statuses
	Context("when ENABLE_TEST_ENDPOINTS is true", func() {
		BeforeEach(func() {
			os.Setenv("ENABLE_TEST_ENDPOINTS", "true")
		})

		AfterEach(func() {
			os.Unsetenv("ENABLE_TEST_ENDPOINTS")
		})

		It("creates sample jobs with the specified statuses", func() {
			// AC: BE: Test-only seed endpoint creates sample jobs with specified statuses
			api.MountTestSeedJobsEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := []api.SeedJobRequest{
				{
					TrainingRunName: "my-model",
					StudyID:         "study-001",
					StudyName:       "Test Study",
					WorkflowName:    "test-workflow.json",
					Status:          "pending",
					TotalItems:      5,
					CompletedItems:  0,
				},
				{
					TrainingRunName: "my-model",
					StudyID:         "study-001",
					StudyName:       "Test Study",
					WorkflowName:    "test-workflow.json",
					Status:          "completed",
					TotalItems:      10,
					CompletedItems:  10,
				},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-jobs", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated))
			Expect(seeder.seededJobs).To(HaveLen(2))
			Expect(string(seeder.seededJobs[0].Status)).To(Equal("pending"))
			Expect(seeder.seededJobs[0].TrainingRunName).To(Equal("my-model"))
			Expect(seeder.seededJobs[0].TotalItems).To(Equal(5))
			Expect(string(seeder.seededJobs[1].Status)).To(Equal("completed"))
			Expect(seeder.seededJobs[1].CompletedItems).To(Equal(10))
		})

		It("returns 201 with job IDs in the response body", func() {
			// AC: BE: Test-only seed endpoint creates sample jobs with specified statuses
			api.MountTestSeedJobsEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := []api.SeedJobRequest{
				{
					TrainingRunName: "my-model",
					StudyID:         "study-001",
					StudyName:       "Test Study",
					WorkflowName:    "test-workflow.json",
					Status:          "running",
					TotalItems:      3,
					CompletedItems:  1,
				},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-jobs", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated))

			var responseBody api.SeedJobsResponse
			err = json.NewDecoder(resp.Body).Decode(&responseBody)
			Expect(err).NotTo(HaveOccurred())
			Expect(responseBody.JobIDs).To(HaveLen(1))
			Expect(responseBody.JobIDs[0]).NotTo(BeEmpty())
		})

		It("seeds zero jobs when request body is an empty array", func() {
			// AC: BE: Test-only seed endpoint handles empty payload gracefully
			api.MountTestSeedJobsEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-jobs", bytes.NewBufferString(`[]`))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated))

			var responseBody api.SeedJobsResponse
			err = json.NewDecoder(resp.Body).Decode(&responseBody)
			Expect(err).NotTo(HaveOccurred())
			Expect(responseBody.JobIDs).To(BeEmpty())
			Expect(seeder.seededJobs).To(BeEmpty())
		})

		It("returns 400 when request body is invalid JSON", func() {
			// AC: BE: Test-only seed endpoint validates request body
			api.MountTestSeedJobsEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-jobs", bytes.NewBufferString(`not valid json`))
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusBadRequest))
			Expect(seeder.seededJobs).To(BeEmpty())
		})

		It("returns 500 when SeedSampleJobs fails", func() {
			// AC: BE: Test-only seed endpoint propagates seeder errors
			seeder.err = fmt.Errorf("db error")
			api.MountTestSeedJobsEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := []api.SeedJobRequest{
				{
					TrainingRunName: "my-model",
					StudyID:         "study-001",
					StudyName:       "Test Study",
					WorkflowName:    "test-workflow.json",
					Status:          "pending",
					TotalItems:      1,
					CompletedItems:  0,
				},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-jobs", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusInternalServerError))
		})

		DescribeTable("creates jobs with various valid statuses", func(status string) {
			// AC: BE: Test-only seed endpoint creates sample jobs with specified statuses
			api.MountTestSeedJobsEndpoint(mux, seeder, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			payload := []api.SeedJobRequest{
				{
					TrainingRunName: "my-model",
					StudyID:         "study-001",
					StudyName:       "Test Study",
					WorkflowName:    "test-workflow.json",
					Status:          status,
					TotalItems:      2,
					CompletedItems:  0,
				},
			}
			body, err := json.Marshal(payload)
			Expect(err).NotTo(HaveOccurred())

			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/test/seed-jobs", bytes.NewReader(body))
			Expect(err).NotTo(HaveOccurred())
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated))
			Expect(seeder.seededJobs).To(HaveLen(1))
			Expect(string(seeder.seededJobs[0].Status)).To(Equal(status))

			// Reset for next table entry
			seeder.seededJobs = nil
		},
			Entry("pending status", "pending"),
			Entry("running status", "running"),
			Entry("stopped status", "stopped"),
			Entry("completed status", "completed"),
			Entry("completed_with_errors status", "completed_with_errors"),
			Entry("failed status", "failed"),
		)
	})
})
