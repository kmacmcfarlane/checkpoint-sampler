package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// SeedJobRequest is the request body for the seed jobs endpoint.
// Each entry describes one sample job to be created.
type SeedJobRequest struct {
	// TrainingRunName is the name of the training run (used for display).
	TrainingRunName string `json:"training_run_name"`
	// StudyID is the ID of the study associated with the job.
	StudyID string `json:"study_id"`
	// StudyName is the human-readable name of the study.
	StudyName string `json:"study_name"`
	// WorkflowName is the workflow template filename.
	WorkflowName string `json:"workflow_name"`
	// Status is the job status to set (pending, running, stopped, completed, failed, etc.).
	Status string `json:"status"`
	// TotalItems is the total number of items in the job.
	TotalItems int `json:"total_items"`
	// CompletedItems is the number of completed items.
	CompletedItems int `json:"completed_items"`
}

// SeedJobsResponse is the response body for the seed jobs endpoint.
type SeedJobsResponse struct {
	JobIDs []string `json:"job_ids"`
}

// JobSeeder is the interface required by the seed jobs endpoint.
// It creates sample jobs directly in the store, bypassing service-layer validation.
type JobSeeder interface {
	SeedSampleJobs(jobs []model.SampleJob) error
}

// MountTestSeedJobsEndpoint conditionally registers POST /api/test/seed-jobs on the
// given mux. The endpoint is only mounted when the ENABLE_TEST_ENDPOINTS
// environment variable is set to "true". It creates sample jobs with the
// specified statuses directly in the database, bypassing the ComfyUI requirement.
//
// This is intended exclusively for E2E test infrastructure -- it must never be
// enabled in production.
func MountTestSeedJobsEndpoint(mux interface{ Handle(string, string, http.HandlerFunc) }, seeder JobSeeder, logger *logrus.Logger) {
	if os.Getenv("ENABLE_TEST_ENDPOINTS") != "true" {
		return
	}

	logger.Warn("test-only seed-jobs endpoint enabled (ENABLE_TEST_ENDPOINTS=true)")

	mux.Handle("POST", "/api/test/seed-jobs", func(w http.ResponseWriter, r *http.Request) {
		logger.Info("test seed-jobs endpoint called")

		body, err := io.ReadAll(r.Body)
		if err != nil {
			logger.WithError(err).Error("failed to read seed-jobs request body")
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		var requests []SeedJobRequest
		if err := json.Unmarshal(body, &requests); err != nil {
			logger.WithError(err).Error("failed to parse seed-jobs request body")
			http.Error(w, fmt.Sprintf("invalid request body: %s", err.Error()), http.StatusBadRequest)
			return
		}

		now := time.Now().UTC()
		jobs := make([]model.SampleJob, len(requests))
		jobIDs := make([]string, len(requests))
		for i, req := range requests {
			id := fmt.Sprintf("seed-job-%04d-%d", i+1, now.UnixNano())
			jobs[i] = model.SampleJob{
				ID:              id,
				TrainingRunName: req.TrainingRunName,
				StudyID:         req.StudyID,
				StudyName:       req.StudyName,
				WorkflowName:    req.WorkflowName,
				Status:          model.SampleJobStatus(req.Status),
				TotalItems:      req.TotalItems,
				CompletedItems:  req.CompletedItems,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
			jobIDs[i] = id
		}

		if err := seeder.SeedSampleJobs(jobs); err != nil {
			logger.WithError(err).Error("failed to seed sample jobs")
			http.Error(w, "failed to seed sample jobs", http.StatusInternalServerError)
			return
		}

		logger.WithField("job_count", len(jobs)).Info("sample jobs seeded successfully")

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		resp := SeedJobsResponse{JobIDs: jobIDs}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			logger.WithError(err).Error("failed to encode seed-jobs response")
		}
	})
}
