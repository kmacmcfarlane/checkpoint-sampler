package service

import (
	"database/sql"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// SampleJobStore defines the persistence operations the sample job service needs.
type SampleJobStore interface {
	ListSampleJobs() ([]model.SampleJob, error)
	GetSampleJob(id string) (model.SampleJob, error)
	CreateSampleJob(j model.SampleJob) error
	UpdateSampleJob(j model.SampleJob) error
	DeleteSampleJob(id string) error
	ListSampleJobItems(jobID string) ([]model.SampleJobItem, error)
	CreateSampleJobItem(i model.SampleJobItem) error
	UpdateSampleJobItem(i model.SampleJobItem) error
	GetSamplePreset(id string) (model.SamplePreset, error)
}

// PathMatcher defines the interface for matching checkpoint filenames to ComfyUI model paths.
type PathMatcher interface {
	MatchCheckpointPath(filename string) (string, error)
}

// SampleJobService manages sample job creation, state transitions, and progress tracking.
type SampleJobService struct {
	store       SampleJobStore
	pathMatcher PathMatcher
	logger      *logrus.Entry
}

// NewSampleJobService creates a SampleJobService backed by the given store.
func NewSampleJobService(store SampleJobStore, pathMatcher PathMatcher, logger *logrus.Logger) *SampleJobService {
	return &SampleJobService{
		store:       store,
		pathMatcher: pathMatcher,
		logger:      logger.WithField("component", "sample_job"),
	}
}

// List returns all sample jobs ordered by creation time (newest first).
func (s *SampleJobService) List() ([]model.SampleJob, error) {
	s.logger.Trace("entering List")
	defer s.logger.Trace("returning from List")

	jobs, err := s.store.ListSampleJobs()
	if err != nil {
		s.logger.WithError(err).Error("failed to list sample jobs")
		return nil, fmt.Errorf("listing sample jobs: %w", err)
	}
	s.logger.WithField("job_count", len(jobs)).Debug("sample jobs retrieved from store")
	if jobs == nil {
		jobs = []model.SampleJob{}
	}
	return jobs, nil
}

// Get returns a sample job by ID, or an error if not found.
func (s *SampleJobService) Get(id string) (model.SampleJob, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering Get")
	defer s.logger.Trace("returning from Get")

	job, err := s.store.GetSampleJob(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("sample_job_id", id).Debug("sample job not found")
		return model.SampleJob{}, fmt.Errorf("sample job %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to fetch sample job")
		return model.SampleJob{}, fmt.Errorf("fetching sample job: %w", err)
	}
	s.logger.WithField("sample_job_id", id).Debug("fetched sample job from store")
	return job, nil
}

// Create creates a new sample job by expanding preset parameters across training run checkpoints.
func (s *SampleJobService) Create(trainingRunName string, checkpoints []model.Checkpoint, samplePresetID string, workflowName string, vae string, clip string, shift *float64) (model.SampleJob, error) {
	s.logger.WithFields(logrus.Fields{
		"training_run_name": trainingRunName,
		"sample_preset_id":  samplePresetID,
		"workflow_name":     workflowName,
	}).Trace("entering Create")
	defer s.logger.Trace("returning from Create")

	// Fetch the sample preset
	preset, err := s.store.GetSamplePreset(samplePresetID)
	if err == sql.ErrNoRows {
		s.logger.WithField("sample_preset_id", samplePresetID).Debug("sample preset not found")
		return model.SampleJob{}, fmt.Errorf("sample preset %s not found", samplePresetID)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id": samplePresetID,
			"error":            err.Error(),
		}).Error("failed to fetch sample preset")
		return model.SampleJob{}, fmt.Errorf("fetching sample preset: %w", err)
	}
	s.logger.WithField("sample_preset_id", samplePresetID).Debug("fetched sample preset from store")

	// Calculate total items: checkpoints × images per checkpoint
	imagesPerCheckpoint := preset.ImagesPerCheckpoint()
	totalItems := len(checkpoints) * imagesPerCheckpoint

	// Create the job
	now := time.Now().UTC()
	jobID := uuid.New().String()
	job := model.SampleJob{
		ID:              jobID,
		TrainingRunName: trainingRunName,
		SamplePresetID:  samplePresetID,
		WorkflowName:    workflowName,
		VAE:             vae,
		CLIP:            clip,
		Shift:           shift,
		Status:          model.SampleJobStatusPending,
		TotalItems:      totalItems,
		CompletedItems:  0,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := s.store.CreateSampleJob(job); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id":     jobID,
			"training_run_name": trainingRunName,
			"error":             err.Error(),
		}).Error("failed to create sample job")
		return model.SampleJob{}, fmt.Errorf("creating sample job: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"sample_job_id":     jobID,
		"training_run_name": trainingRunName,
		"total_items":       totalItems,
	}).Info("sample job created")

	// Expand items: for each checkpoint, iterate over all parameter combinations
	items := s.expandJobItems(jobID, checkpoints, preset)
	s.logger.WithFields(logrus.Fields{
		"sample_job_id": jobID,
		"item_count":    len(items),
	}).Debug("expanded job items")

	// Match checkpoint filenames to ComfyUI model paths and create job items
	for _, item := range items {
		comfyuiPath, err := s.pathMatcher.MatchCheckpointPath(item.CheckpointFilename)
		if err != nil {
			s.logger.WithFields(logrus.Fields{
				"sample_job_id":        jobID,
				"checkpoint_filename":  item.CheckpointFilename,
				"error":                err.Error(),
			}).Warn("failed to match checkpoint to ComfyUI path, marking item as skipped")
			// Mark item as skipped if path matching fails
			item.Status = model.SampleJobItemStatusSkipped
			item.ErrorMessage = fmt.Sprintf("checkpoint not found in ComfyUI: %v", err)
			item.ComfyUIModelPath = ""
		} else {
			item.ComfyUIModelPath = comfyuiPath
			s.logger.WithFields(logrus.Fields{
				"checkpoint_filename": item.CheckpointFilename,
				"comfyui_path":        comfyuiPath,
			}).Debug("matched checkpoint to ComfyUI path")
		}

		if err := s.store.CreateSampleJobItem(item); err != nil {
			s.logger.WithFields(logrus.Fields{
				"sample_job_id":       jobID,
				"sample_job_item_id":  item.ID,
				"checkpoint_filename": item.CheckpointFilename,
				"error":               err.Error(),
			}).Error("failed to create sample job item")
			// Clean up: delete the job since item creation failed
			_ = s.store.DeleteSampleJob(jobID)
			return model.SampleJob{}, fmt.Errorf("creating sample job item: %w", err)
		}
	}

	s.logger.WithFields(logrus.Fields{
		"sample_job_id": jobID,
		"item_count":    len(items),
	}).Info("sample job items created")

	return job, nil
}

// expandJobItems generates all work items for a job by expanding the preset parameters across checkpoints.
func (s *SampleJobService) expandJobItems(jobID string, checkpoints []model.Checkpoint, preset model.SamplePreset) []model.SampleJobItem {
	var items []model.SampleJobItem
	now := time.Now().UTC()

	for _, checkpoint := range checkpoints {
		// Iterate over all parameter combinations
		for _, prompt := range preset.Prompts {
			for _, steps := range preset.Steps {
				for _, cfg := range preset.CFGs {
					for _, sampler := range preset.Samplers {
						for _, scheduler := range preset.Schedulers {
							for _, seed := range preset.Seeds {
								item := model.SampleJobItem{
									ID:                 uuid.New().String(),
									JobID:              jobID,
									CheckpointFilename: checkpoint.Filename,
									ComfyUIModelPath:   "", // Will be filled by path matching
									PromptName:         prompt.Name,
									PromptText:         prompt.Text,
									Steps:              steps,
									CFG:                cfg,
									SamplerName:        sampler,
									Scheduler:          scheduler,
									Seed:               seed,
									Status:             model.SampleJobItemStatusPending,
									CreatedAt:          now,
									UpdatedAt:          now,
								}
								items = append(items, item)
							}
						}
					}
				}
			}
		}
	}

	return items
}

// Stop transitions a running job to paused status.
func (s *SampleJobService) Stop(id string) (model.SampleJob, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering Stop")
	defer s.logger.Trace("returning from Stop")

	job, err := s.store.GetSampleJob(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("sample_job_id", id).Debug("sample job not found")
		return model.SampleJob{}, fmt.Errorf("sample job %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to fetch sample job")
		return model.SampleJob{}, fmt.Errorf("fetching sample job: %w", err)
	}
	s.logger.WithField("sample_job_id", id).Debug("fetched sample job from store")

	// Validate state transition
	if job.Status != model.SampleJobStatusRunning {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"current_status": job.Status,
		}).Warn("cannot stop job: job is not running")
		return model.SampleJob{}, fmt.Errorf("cannot stop job in status %s", job.Status)
	}

	// Update status to paused
	job.Status = model.SampleJobStatusPaused
	job.UpdatedAt = time.Now().UTC()

	if err := s.store.UpdateSampleJob(job); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to update sample job status")
		return model.SampleJob{}, fmt.Errorf("updating sample job: %w", err)
	}
	s.logger.WithField("sample_job_id", id).Info("sample job stopped (paused)")
	return job, nil
}

// Resume transitions a paused job back to running status.
func (s *SampleJobService) Resume(id string) (model.SampleJob, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering Resume")
	defer s.logger.Trace("returning from Resume")

	job, err := s.store.GetSampleJob(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("sample_job_id", id).Debug("sample job not found")
		return model.SampleJob{}, fmt.Errorf("sample job %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to fetch sample job")
		return model.SampleJob{}, fmt.Errorf("fetching sample job: %w", err)
	}
	s.logger.WithField("sample_job_id", id).Debug("fetched sample job from store")

	// Validate state transition
	if job.Status != model.SampleJobStatusPaused {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"current_status": job.Status,
		}).Warn("cannot resume job: job is not paused")
		return model.SampleJob{}, fmt.Errorf("cannot resume job in status %s", job.Status)
	}

	// Update status to running
	job.Status = model.SampleJobStatusRunning
	job.UpdatedAt = time.Now().UTC()

	if err := s.store.UpdateSampleJob(job); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to update sample job status")
		return model.SampleJob{}, fmt.Errorf("updating sample job: %w", err)
	}
	s.logger.WithField("sample_job_id", id).Info("sample job resumed")
	return job, nil
}

// Delete removes a sample job and all its items.
func (s *SampleJobService) Delete(id string) error {
	s.logger.WithField("sample_job_id", id).Trace("entering Delete")
	defer s.logger.Trace("returning from Delete")

	err := s.store.DeleteSampleJob(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("sample_job_id", id).Debug("sample job not found for deletion")
		return fmt.Errorf("sample job %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to delete sample job")
		return fmt.Errorf("deleting sample job: %w", err)
	}
	s.logger.WithField("sample_job_id", id).Info("sample job deleted")
	return nil
}

// GetProgress computes the current progress metrics for a job.
func (s *SampleJobService) GetProgress(id string) (model.JobProgress, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering GetProgress")
	defer s.logger.Trace("returning from GetProgress")

	_, err := s.store.GetSampleJob(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("sample_job_id", id).Debug("sample job not found")
		return model.JobProgress{}, fmt.Errorf("sample job %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to fetch sample job")
		return model.JobProgress{}, fmt.Errorf("fetching sample job: %w", err)
	}
	s.logger.WithField("sample_job_id", id).Debug("fetched sample job from store")

	items, err := s.store.ListSampleJobItems(id)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to list sample job items")
		return model.JobProgress{}, fmt.Errorf("listing sample job items: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"sample_job_id": id,
		"item_count":    len(items),
	}).Debug("fetched sample job items from store")

	// Group items by checkpoint and count completed
	checkpointProgress := make(map[string]struct {
		total     int
		completed int
	})

	for _, item := range items {
		stats := checkpointProgress[item.CheckpointFilename]
		stats.total++
		if item.Status == model.SampleJobItemStatusCompleted {
			stats.completed++
		}
		checkpointProgress[item.CheckpointFilename] = stats
	}

	// Count fully completed checkpoints
	checkpointsCompleted := 0
	totalCheckpoints := len(checkpointProgress)
	var currentCheckpoint string
	currentCheckpointProgress := 0
	currentCheckpointTotal := 0

	// Sort checkpoint filenames for deterministic iteration order
	checkpointNames := make([]string, 0, len(checkpointProgress))
	for checkpoint := range checkpointProgress {
		checkpointNames = append(checkpointNames, checkpoint)
	}
	sort.Strings(checkpointNames)

	for _, checkpoint := range checkpointNames {
		stats := checkpointProgress[checkpoint]
		if stats.completed == stats.total {
			checkpointsCompleted++
		} else if currentCheckpoint == "" {
			// First incomplete checkpoint becomes the "current" one
			currentCheckpoint = checkpoint
			currentCheckpointProgress = stats.completed
			currentCheckpointTotal = stats.total
		}
	}

	// Estimated completion time: not implemented in this story (S-034 will handle execution)
	var estimatedCompletion *time.Time

	progress := model.JobProgress{
		CheckpointsCompleted:      checkpointsCompleted,
		TotalCheckpoints:          totalCheckpoints,
		CurrentCheckpoint:         currentCheckpoint,
		CurrentCheckpointProgress: currentCheckpointProgress,
		CurrentCheckpointTotal:    currentCheckpointTotal,
		EstimatedCompletionTime:   estimatedCompletion,
	}

	s.logger.WithFields(logrus.Fields{
		"sample_job_id":         id,
		"checkpoints_completed": checkpointsCompleted,
		"total_checkpoints":     totalCheckpoints,
	}).Debug("computed job progress")

	return progress, nil
}
