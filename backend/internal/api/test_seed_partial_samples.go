package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/sirupsen/logrus"
)

// SeedPartialSamplesRequest is the request body for the seed-partial-samples endpoint.
// It describes a study and the subset of checkpoints that should have sample directories
// created, producing an incomplete (partial) set of samples for the study.
type SeedPartialSamplesRequest struct {
	// TrainingRunName is the name of the training run (used to derive the filesystem path).
	TrainingRunName string `json:"training_run_name"`
	// StudyID is the ID of the study whose sample directories will be seeded.
	StudyID string `json:"study_id"`
	// CheckpointFilenames is the subset of checkpoint filenames for which sample directories
	// should be created. Not all checkpoints in the training run need to be listed here —
	// the intent is to produce a partial set so that availability returns "partial".
	CheckpointFilenames []string `json:"checkpoint_filenames"`
}

// SeedPartialSamplesResponse is the response body for the seed-partial-samples endpoint.
type SeedPartialSamplesResponse struct {
	// CreatedDirs lists the sample directories that were created.
	CreatedDirs []string `json:"created_dirs"`
}

// PartialSampleSeeder is the interface required by the seed-partial-samples endpoint.
// It creates partial sample directory structures on disk, bypassing the job executor.
type PartialSampleSeeder interface {
	SeedPartialSamples(trainingRunName, studyID string, checkpointFilenames []string) ([]string, error)
}

// MountTestSeedPartialSamplesEndpoint conditionally registers
// POST /api/test/seed-partial-samples on the given mux. The endpoint is only
// mounted when the ENABLE_TEST_ENDPOINTS environment variable is set to "true".
// It creates sample subdirectories under
// {sample_dir}/{sanitized_run_name}/{study_id}/{checkpoint_filename}/
// for the specified subset of checkpoints, enabling E2E verification of the
// incomplete-set (partial sample_status) code path without running a generation job.
//
// This is intended exclusively for E2E test infrastructure -- it must never be
// enabled in production.
func MountTestSeedPartialSamplesEndpoint(mux interface{ Handle(string, string, http.HandlerFunc) }, seeder PartialSampleSeeder, logger *logrus.Logger) {
	if os.Getenv("ENABLE_TEST_ENDPOINTS") != "true" {
		return
	}

	logger.Warn("test-only seed-partial-samples endpoint enabled (ENABLE_TEST_ENDPOINTS=true)")

	mux.Handle("POST", "/api/test/seed-partial-samples", func(w http.ResponseWriter, r *http.Request) {
		logger.Info("test seed-partial-samples endpoint called")

		body, err := io.ReadAll(r.Body)
		if err != nil {
			logger.WithError(err).Error("failed to read seed-partial-samples request body")
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		var req SeedPartialSamplesRequest
		if err := json.Unmarshal(body, &req); err != nil {
			logger.WithError(err).Error("failed to parse seed-partial-samples request body")
			http.Error(w, fmt.Sprintf("invalid request body: %s", err.Error()), http.StatusBadRequest)
			return
		}

		if req.TrainingRunName == "" {
			http.Error(w, "training_run_name is required", http.StatusBadRequest)
			return
		}
		if req.StudyID == "" {
			http.Error(w, "study_id is required", http.StatusBadRequest)
			return
		}

		createdDirs, err := seeder.SeedPartialSamples(req.TrainingRunName, req.StudyID, req.CheckpointFilenames)
		if err != nil {
			logger.WithError(err).Error("failed to seed partial sample directories")
			http.Error(w, "failed to seed partial sample directories", http.StatusInternalServerError)
			return
		}

		logger.WithFields(logrus.Fields{
			"training_run_name": req.TrainingRunName,
			"study_id":          req.StudyID,
			"checkpoint_count":  len(req.CheckpointFilenames),
			"created_dirs":      len(createdDirs),
		}).Info("partial sample directories seeded successfully")

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		resp := SeedPartialSamplesResponse{CreatedDirs: createdDirs}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			logger.WithError(err).Error("failed to encode seed-partial-samples response")
		}
	})
}

// FilesystemPartialSampleSeeder implements PartialSampleSeeder using the real
// filesystem. It creates the sample directory structure under sampleDir.
type FilesystemPartialSampleSeeder struct {
	sampleDir string
	logger    *logrus.Entry
}

// NewFilesystemPartialSampleSeeder creates a FilesystemPartialSampleSeeder.
func NewFilesystemPartialSampleSeeder(sampleDir string, logger *logrus.Logger) *FilesystemPartialSampleSeeder {
	return &FilesystemPartialSampleSeeder{
		sampleDir: sampleDir,
		logger:    logger.WithField("component", "partial_sample_seeder"),
	}
}

// SeedPartialSamples creates sample directories and placeholder PNG files for
// the specified checkpoints under {sampleDir}/{sanitized_run_name}/{studyID}/.
// It returns the list of directory paths that were created.
func (s *FilesystemPartialSampleSeeder) SeedPartialSamples(trainingRunName, studyID string, checkpointFilenames []string) ([]string, error) {
	s.logger.WithFields(logrus.Fields{
		"training_run":     trainingRunName,
		"study_id":         studyID,
		"checkpoint_count": len(checkpointFilenames),
	}).Trace("entering SeedPartialSamples")
	defer s.logger.Trace("returning from SeedPartialSamples")

	sanitizedRunName := fileformat.SanitizeTrainingRunName(trainingRunName)
	createdDirs := make([]string, 0, len(checkpointFilenames))

	for _, cpFilename := range checkpointFilenames {
		cpDir := filepath.Join(s.sampleDir, sanitizedRunName, studyID, cpFilename)
		if err := os.MkdirAll(cpDir, 0755); err != nil {
			s.logger.WithFields(logrus.Fields{
				"checkpoint_dir": cpDir,
				"error":          err.Error(),
			}).Error("failed to create partial sample directory")
			return nil, fmt.Errorf("creating partial sample dir %s: %w", cpDir, err)
		}

		// Create a minimal placeholder PNG so directory scanning finds at least one image.
		pngPath := filepath.Join(cpDir, "seed=42&cfg=7&prompt_name=test&_00001_.png")
		if err := os.WriteFile(pngPath, partialSeedMinimalPNG(), 0644); err != nil {
			s.logger.WithFields(logrus.Fields{
				"png_path": pngPath,
				"error":    err.Error(),
			}).Error("failed to create placeholder PNG in partial sample directory")
			return nil, fmt.Errorf("creating placeholder PNG %s: %w", pngPath, err)
		}

		s.logger.WithFields(logrus.Fields{
			"checkpoint_dir": cpDir,
		}).Debug("partial sample directory seeded")

		createdDirs = append(createdDirs, cpDir)
	}

	s.logger.WithFields(logrus.Fields{
		"training_run": trainingRunName,
		"study_id":     studyID,
		"dirs_created": len(createdDirs),
	}).Info("partial sample directories seeded")

	return createdDirs, nil
}

// partialSeedMinimalPNG returns the bytes of a 1x1 transparent PNG image.
// Identical to store.minimalPNG() — kept here to avoid cross-package dependency.
func partialSeedMinimalPNG() []byte {
	return []byte{
		// PNG signature
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		// IHDR chunk: 1x1 px, 8-bit RGBA
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
		0x89,
		// IDAT chunk: compressed pixel data (1x1 transparent pixel)
		0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41, 0x54,
		0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00,
		0x01, 0xE5, 0x27, 0xDE, 0xFC,
		// IEND chunk
		0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
		0xAE, 0x42, 0x60, 0x82,
	}
}
