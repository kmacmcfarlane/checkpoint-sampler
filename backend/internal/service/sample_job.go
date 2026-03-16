package service

import (
	"database/sql"
	"fmt"
	"net/url"
	"path/filepath"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// SampleJobStore defines the persistence operations the sample job service needs.
type SampleJobStore interface {
	ListSampleJobs() ([]model.SampleJob, error)
	ListSampleJobsDesc() ([]model.SampleJob, error)
	GetSampleJob(id string) (model.SampleJob, error)
	HasRunningJob() (bool, error)
	CreateSampleJob(j model.SampleJob) error
	UpdateSampleJob(j model.SampleJob) error
	DeleteSampleJob(id string) error
	ListSampleJobItems(jobID string) ([]model.SampleJobItem, error)
	CreateSampleJobItem(i model.SampleJobItem) error
	UpdateSampleJobItem(i model.SampleJobItem) error
	GetStudy(id string) (model.Study, error)
}

// JobSampleDataRemover defines the interface for removing generated sample files for a job.
// It removes the per-checkpoint output directory under the job's study directory.
type JobSampleDataRemover interface {
	RemoveJobSampleDir(studyName string, checkpointFilename string) error
}

// PathMatcher defines the interface for matching checkpoint filenames to ComfyUI model paths.
type PathMatcher interface {
	MatchCheckpointPath(filename string) (string, error)
}

// SampleDirRemover defines the interface for removing sample directories for a checkpoint.
type SampleDirRemover interface {
	RemoveSampleDir(checkpointFilename string) error
}

// SampleJobExecutor defines the interface for coordinating job execution.
type SampleJobExecutor interface {
	RequestStop(jobID string) error
	RequestResume(jobID string) error
	IsConnected() bool
}

// OutputFileChecker defines the interface for checking if a sample output file exists on disk.
type OutputFileChecker interface {
	FileExists(path string) bool
}

// SampleJobService manages sample job creation, state transitions, and progress tracking.
type SampleJobService struct {
	store              SampleJobStore
	pathMatcher        PathMatcher
	dirRemover         SampleDirRemover
	jobDataRemover     JobSampleDataRemover
	fileChecker        OutputFileChecker
	sampleDir          string
	executor           SampleJobExecutor
	logger             *logrus.Entry
}

// NewSampleJobService creates a SampleJobService backed by the given store.
func NewSampleJobService(store SampleJobStore, pathMatcher PathMatcher, dirRemover SampleDirRemover, sampleDir string, logger *logrus.Logger) *SampleJobService {
	return &SampleJobService{
		store:       store,
		pathMatcher: pathMatcher,
		dirRemover:  dirRemover,
		sampleDir:   sampleDir,
		executor:    nil, // Set later via SetExecutor
		logger:      logger.WithField("component", "sample_job"),
	}
}

// SetJobDataRemover sets the remover used by Delete(deleteData=true).
// This is optional; if not set, Delete with deleteData=true will skip filesystem cleanup.
func (s *SampleJobService) SetJobDataRemover(remover JobSampleDataRemover) {
	s.jobDataRemover = remover
}

// SetFileChecker sets the output file checker (used for missing-only job creation).
func (s *SampleJobService) SetFileChecker(checker OutputFileChecker) {
	s.fileChecker = checker
}

// SetExecutor sets the job executor (called after construction to avoid circular dependencies).
func (s *SampleJobService) SetExecutor(executor SampleJobExecutor) {
	s.executor = executor
}

// List returns all sample jobs ordered by creation time (newest first) for UI display.
func (s *SampleJobService) List() ([]model.SampleJob, error) {
	s.logger.Trace("entering List")
	defer s.logger.Trace("returning from List")

	jobs, err := s.store.ListSampleJobsDesc()
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

// Create creates a new sample job by expanding study parameters across training run checkpoints.
// checkpointFilenames is an optional filter: when non-empty, only the listed checkpoints are included.
// clearExisting: when true, the sample directory for each selected checkpoint is removed before creating job items.
// missingOnly: when true, only items whose output file does not already exist on disk are included.
// Workflow template, VAE, text encoder, and shift are read from the study definition.
func (s *SampleJobService) Create(trainingRunName string, checkpoints []model.Checkpoint, studyID string, checkpointFilenames []string, clearExisting bool, missingOnly bool) (model.SampleJob, error) {
	s.logger.WithFields(logrus.Fields{
		"training_run_name":     trainingRunName,
		"study_id":              studyID,
		"checkpoint_filter_len": len(checkpointFilenames),
		"clear_existing":        clearExisting,
		"missing_only":          missingOnly,
	}).Trace("entering Create")
	defer s.logger.Trace("returning from Create")

	// Filter checkpoints when a specific list is provided
	if len(checkpointFilenames) > 0 {
		filterSet := make(map[string]struct{}, len(checkpointFilenames))
		for _, fn := range checkpointFilenames {
			filterSet[fn] = struct{}{}
		}
		filtered := checkpoints[:0:0]
		for _, cp := range checkpoints {
			if _, ok := filterSet[cp.Filename]; ok {
				filtered = append(filtered, cp)
			}
		}
		checkpoints = filtered
		s.logger.WithFields(logrus.Fields{
			"training_run_name": trainingRunName,
			"filtered_count":    len(checkpoints),
		}).Debug("filtered checkpoints by filename list")
	}

	// Clear existing sample directories when requested
	if clearExisting && s.dirRemover != nil {
		for _, cp := range checkpoints {
			if err := s.dirRemover.RemoveSampleDir(cp.Filename); err != nil {
				s.logger.WithFields(logrus.Fields{
					"checkpoint_filename": cp.Filename,
					"error":               err.Error(),
				}).Warn("failed to remove sample dir, continuing")
			} else {
				s.logger.WithFields(logrus.Fields{
					"checkpoint_filename": cp.Filename,
					"sample_dir":          filepath.Join(s.sampleDir, cp.Filename),
				}).Info("cleared existing sample directory")
			}
		}
	}

	// Fetch the study
	study, err := s.store.GetStudy(studyID)
	if err == sql.ErrNoRows {
		s.logger.WithField("study_id", studyID).Debug("study not found")
		return model.SampleJob{}, fmt.Errorf("study %s not found", studyID)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id": studyID,
			"error":    err.Error(),
		}).Error("failed to fetch study")
		return model.SampleJob{}, fmt.Errorf("fetching study: %w", err)
	}
	s.logger.WithField("study_id", studyID).Debug("fetched study from store")

	// B-104: Validate that the study has a workflow template configured.
	// Without a workflow template, the job executor cannot load a ComfyUI workflow,
	// resulting in every item failing with "workflow not found: .json".
	if study.WorkflowTemplate == "" {
		s.logger.WithField("study_id", studyID).Warn("study has no workflow template configured")
		return model.SampleJob{}, fmt.Errorf("study %q has no workflow template configured", study.Name)
	}

	// Calculate total items: checkpoints × images per checkpoint
	imagesPerCheckpoint := study.ImagesPerCheckpoint()
	totalItems := len(checkpoints) * imagesPerCheckpoint

	// Capture the checkpoint filenames selected for this job.
	selectedFilenames := make([]string, len(checkpoints))
	for i, cp := range checkpoints {
		selectedFilenames[i] = cp.Filename
	}

	// Create the job — workflow, VAE, text encoder, and shift come from the study definition.
	now := time.Now().UTC()
	jobID := uuid.New().String()
	job := model.SampleJob{
		ID:                  jobID,
		TrainingRunName:     trainingRunName,
		StudyID:             studyID,
		StudyName:           study.Name,
		WorkflowName:        study.WorkflowTemplate,
		VAE:                 study.VAE,
		CLIP:                study.TextEncoder,
		Shift:               study.Shift,
		CheckpointFilenames: selectedFilenames,
		Status:              model.SampleJobStatusPending,
		TotalItems:          totalItems,
		CompletedItems:      0,
		CreatedAt:           now,
		UpdatedAt:           now,
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
	items := s.expandJobItems(jobID, checkpoints, study)
	s.logger.WithFields(logrus.Fields{
		"sample_job_id": jobID,
		"item_count":    len(items),
	}).Debug("expanded job items")

	// When missingOnly is true, filter out items whose output file already exists on disk
	if missingOnly && s.fileChecker != nil {
		var filtered []model.SampleJobItem
		skipped := 0
		for _, item := range items {
			outputFilename := GenerateOutputFilename(item)
			outputPath := filepath.Join(s.sampleDir, study.Name, item.CheckpointFilename, outputFilename)
			if s.fileChecker.FileExists(outputPath) {
				skipped++
				continue
			}
			filtered = append(filtered, item)
		}
		s.logger.WithFields(logrus.Fields{
			"sample_job_id":    jobID,
			"total_expanded":   len(items),
			"skipped_existing": skipped,
			"remaining":        len(filtered),
		}).Info("filtered items for missing-only job")
		items = filtered
		// Update total items on the job to reflect the filtered count
		totalItems = len(items)
		job.TotalItems = totalItems
		if err := s.store.UpdateSampleJob(job); err != nil {
			s.logger.WithFields(logrus.Fields{
				"sample_job_id": jobID,
				"error":         err.Error(),
			}).Error("failed to update sample job total items")
			_ = s.store.DeleteSampleJob(jobID)
			return model.SampleJob{}, fmt.Errorf("updating sample job total items: %w", err)
		}
	}

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

// expandJobItems generates all work items for a job by expanding the study parameters across checkpoints.
func (s *SampleJobService) expandJobItems(jobID string, checkpoints []model.Checkpoint, study model.Study) []model.SampleJobItem {
	var items []model.SampleJobItem
	now := time.Now().UTC()

	for _, checkpoint := range checkpoints {
		// Iterate over all parameter combinations using sampler/scheduler pairs
		for _, prompt := range study.Prompts {
			// Apply prompt prefix using smart separator logic
			promptText := model.JoinPromptPrefix(study.PromptPrefix, prompt.Text)
			for _, steps := range study.Steps {
				for _, cfg := range study.CFGs {
					for _, pair := range study.SamplerSchedulerPairs {
						for _, seed := range study.Seeds {
							item := model.SampleJobItem{
								ID:                 uuid.New().String(),
								JobID:              jobID,
								CheckpointFilename: checkpoint.Filename,
								ComfyUIModelPath:   "", // Will be filled by path matching
								PromptName:         prompt.Name,
								PromptText:         promptText,
								NegativePrompt:     study.NegativePrompt,
								Steps:              steps,
								CFG:                cfg,
								SamplerName:        pair.Sampler,
								Scheduler:          pair.Scheduler,
								Seed:               seed,
								Width:              study.Width,
								Height:             study.Height,
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

	return items
}

// Start transitions a pending job to running status.
func (s *SampleJobService) Start(id string) (model.SampleJob, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering Start")
	defer s.logger.Trace("returning from Start")

	// Check if executor is available and connected
	if s.executor == nil || !s.executor.IsConnected() {
		s.logger.Warn("cannot start job: ComfyUI not connected")
		return model.SampleJob{}, fmt.Errorf("ComfyUI not connected")
	}

	// Guard: reject if another job is already running
	hasRunning, err := s.store.HasRunningJob()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to check for running jobs")
		return model.SampleJob{}, fmt.Errorf("checking for running jobs: %w", err)
	}
	if hasRunning {
		s.logger.WithField("sample_job_id", id).Warn("cannot start job: another job is already running")
		return model.SampleJob{}, fmt.Errorf("another job is already running")
	}

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
	if job.Status != model.SampleJobStatusPending {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id":  id,
			"current_status": job.Status,
		}).Warn("cannot start job: job is not pending")
		return model.SampleJob{}, fmt.Errorf("cannot start job in status %s", job.Status)
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
	s.logger.WithField("sample_job_id", id).Info("sample job started")
	return job, nil
}

// Stop transitions a running job to stopped status.
// The executor owns the DB status update to stopped (via RequestStop), so the service
// layer fetches the job for validation only and delegates the actual transition to
// the executor. This eliminates the window where the DB and executor state diverge.
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
			"sample_job_id":  id,
			"current_status": job.Status,
		}).Warn("cannot stop job: job is not running")
		return model.SampleJob{}, fmt.Errorf("cannot stop job in status %s", job.Status)
	}

	// Delegate to executor: it cancels the in-flight ComfyUI prompt and atomically
	// updates the DB status to stopped before clearing its own active state.
	// If the executor rejects the stop (e.g. the job is not actively tracked by the
	// executor because it hasn't been picked up yet or already finished), fall back
	// to a direct DB update so the user can always stop a running job.
	if s.executor != nil {
		if err := s.executor.RequestStop(id); err != nil {
			s.logger.WithError(err).Warn("executor stop request failed, falling back to direct DB update")
			// Fall through to direct DB update below
			job.Status = model.SampleJobStatusStopped
			job.UpdatedAt = time.Now().UTC()
			if err := s.store.UpdateSampleJob(job); err != nil {
				s.logger.WithFields(logrus.Fields{
					"sample_job_id": id,
					"error":         err.Error(),
				}).Error("failed to update sample job status")
				return model.SampleJob{}, fmt.Errorf("updating sample job: %w", err)
			}
		}
	} else {
		// No executor configured (e.g. tests without executor); update DB directly as fallback.
		job.Status = model.SampleJobStatusStopped
		job.UpdatedAt = time.Now().UTC()
		if err := s.store.UpdateSampleJob(job); err != nil {
			s.logger.WithFields(logrus.Fields{
				"sample_job_id": id,
				"error":         err.Error(),
			}).Error("failed to update sample job status")
			return model.SampleJob{}, fmt.Errorf("updating sample job: %w", err)
		}
	}

	// Re-fetch the job so the caller gets the post-stop state that the executor wrote.
	updatedJob, err := s.store.GetSampleJob(id)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Warn("failed to re-fetch job after stop, returning pre-stop snapshot")
		// Return a best-effort snapshot with the expected stopped status.
		job.Status = model.SampleJobStatusStopped
		s.logger.WithField("sample_job_id", id).Info("sample job stopped")
		return job, nil
	}

	s.logger.WithField("sample_job_id", id).Info("sample job stopped")
	return updatedJob, nil
}

// RetryFailed re-queues all failed and skipped items in a completed_with_errors job,
// resets the job status to running, and requests the executor to resume processing.
func (s *SampleJobService) RetryFailed(id string) (model.SampleJob, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering RetryFailed")
	defer s.logger.Trace("returning from RetryFailed")

	// Check if executor is available and connected
	if s.executor == nil || !s.executor.IsConnected() {
		s.logger.Warn("cannot retry job: ComfyUI not connected")
		return model.SampleJob{}, fmt.Errorf("ComfyUI not connected")
	}

	// Guard: reject if another job is already running
	hasRunning, err := s.store.HasRunningJob()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to check for running jobs")
		return model.SampleJob{}, fmt.Errorf("checking for running jobs: %w", err)
	}
	if hasRunning {
		s.logger.WithField("sample_job_id", id).Warn("cannot retry job: another job is already running")
		return model.SampleJob{}, fmt.Errorf("another job is already running")
	}

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

	// Validate state transition: only completed_with_errors jobs can be retried
	if job.Status != model.SampleJobStatusCompletedWithErrors {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id":  id,
			"current_status": job.Status,
		}).Warn("cannot retry job: job is not completed_with_errors")
		return model.SampleJob{}, fmt.Errorf("cannot retry job in status %s", job.Status)
	}

	// Fetch all items and reset failed/skipped ones to pending
	items, err := s.store.ListSampleJobItems(id)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to list sample job items")
		return model.SampleJob{}, fmt.Errorf("listing sample job items: %w", err)
	}

	retriedCount := 0
	now := time.Now().UTC()
	for _, item := range items {
		if item.Status == model.SampleJobItemStatusFailed || item.Status == model.SampleJobItemStatusSkipped {
			item.Status = model.SampleJobItemStatusPending
			item.ErrorMessage = ""
			item.ExceptionType = ""
			item.NodeType = ""
			item.Traceback = ""
			item.ComfyUIPromptID = ""
			item.UpdatedAt = now
			if updateErr := s.store.UpdateSampleJobItem(item); updateErr != nil {
				s.logger.WithFields(logrus.Fields{
					"sample_job_id":      id,
					"sample_job_item_id": item.ID,
					"error":              updateErr.Error(),
				}).Error("failed to reset item status to pending")
				return model.SampleJob{}, fmt.Errorf("resetting item %s: %w", item.ID, updateErr)
			}
			retriedCount++
		}
	}

	s.logger.WithFields(logrus.Fields{
		"sample_job_id": id,
		"retried_count": retriedCount,
	}).Info("reset failed/skipped items to pending")

	// Update job status to running
	job.Status = model.SampleJobStatusRunning
	job.UpdatedAt = now

	if err := s.store.UpdateSampleJob(job); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to update sample job status")
		return model.SampleJob{}, fmt.Errorf("updating sample job: %w", err)
	}

	// Request the executor to resume
	if s.executor != nil {
		if err := s.executor.RequestResume(id); err != nil {
			s.logger.WithError(err).Warn("executor resume request failed")
		}
	}

	s.logger.WithField("sample_job_id", id).Info("sample job retry started")
	return job, nil
}

// Resume transitions a stopped job back to running status.
func (s *SampleJobService) Resume(id string) (model.SampleJob, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering Resume")
	defer s.logger.Trace("returning from Resume")

	// Check if executor is available and connected
	if s.executor == nil || !s.executor.IsConnected() {
		s.logger.Warn("cannot resume job: ComfyUI not connected")
		return model.SampleJob{}, fmt.Errorf("ComfyUI not connected")
	}

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
	if job.Status != model.SampleJobStatusStopped {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id":  id,
			"current_status": job.Status,
		}).Warn("cannot resume job: job is not stopped")
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

	// Request the executor to resume
	if s.executor != nil {
		if err := s.executor.RequestResume(id); err != nil {
			s.logger.WithError(err).Warn("executor resume request failed")
		}
	}

	s.logger.WithField("sample_job_id", id).Info("sample job resumed")
	return job, nil
}

// Delete removes a sample job and all its items. When deleteData is true, also
// removes the generated sample files for each checkpoint covered by the job
// (if a JobSampleDataRemover has been configured).
func (s *SampleJobService) Delete(id string, deleteData bool) error {
	s.logger.WithFields(logrus.Fields{
		"sample_job_id": id,
		"delete_data":   deleteData,
	}).Trace("entering Delete")
	defer s.logger.Trace("returning from Delete")

	// Fetch the job first so we know its study name and can list its items for
	// filesystem cleanup before removing the database record.
	job, err := s.store.GetSampleJob(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("sample_job_id", id).Debug("sample job not found for deletion")
		return fmt.Errorf("sample job %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to fetch sample job for deletion")
		return fmt.Errorf("fetching sample job: %w", err)
	}

	// Remove generated sample files before deleting the database record so
	// a filesystem error does not leave a dangling database entry.
	if deleteData && s.jobDataRemover != nil {
		// Collect unique checkpoint filenames from job items
		items, err := s.store.ListSampleJobItems(id)
		if err != nil {
			s.logger.WithFields(logrus.Fields{
				"sample_job_id": id,
				"error":         err.Error(),
			}).Error("failed to list job items for data deletion")
			return fmt.Errorf("listing job items: %w", err)
		}

		seen := make(map[string]struct{})
		for _, item := range items {
			if _, ok := seen[item.CheckpointFilename]; ok {
				continue
			}
			seen[item.CheckpointFilename] = struct{}{}

			if removeErr := s.jobDataRemover.RemoveJobSampleDir(job.StudyName, item.CheckpointFilename); removeErr != nil {
				s.logger.WithFields(logrus.Fields{
					"sample_job_id":       id,
					"study_name":          job.StudyName,
					"checkpoint_filename": item.CheckpointFilename,
					"error":               removeErr.Error(),
				}).Error("failed to remove job sample directory")
				return fmt.Errorf("removing job sample directory: %w", removeErr)
			}
			s.logger.WithFields(logrus.Fields{
				"sample_job_id":       id,
				"study_name":          job.StudyName,
				"checkpoint_filename": item.CheckpointFilename,
			}).Info("job sample directory removed")
		}
	}

	if err := s.store.DeleteSampleJob(id); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to delete sample job")
		return fmt.Errorf("deleting sample job: %w", err)
	}
	s.logger.WithField("sample_job_id", id).Info("sample job deleted")
	return nil
}

// GetItemCounts computes item status counts for a job on-the-fly.
func (s *SampleJobService) GetItemCounts(id string) (model.ItemStatusCounts, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering GetItemCounts")
	defer s.logger.Trace("returning from GetItemCounts")

	items, err := s.store.ListSampleJobItems(id)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to list sample job items")
		return model.ItemStatusCounts{}, fmt.Errorf("listing sample job items: %w", err)
	}

	var counts model.ItemStatusCounts
	for _, item := range items {
		switch item.Status {
		case model.SampleJobItemStatusCompleted:
			counts.Completed++
		case model.SampleJobItemStatusFailed, model.SampleJobItemStatusSkipped:
			counts.Failed++
		case model.SampleJobItemStatusPending:
			counts.Pending++
		}
	}

	s.logger.WithFields(logrus.Fields{
		"sample_job_id": id,
		"completed":     counts.Completed,
		"failed":        counts.Failed,
		"pending":       counts.Pending,
	}).Debug("computed item status counts")

	return counts, nil
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

	// Group items by checkpoint and count by status
	type errorDetail struct {
		exceptionType string
		nodeType      string
		traceback     string
	}
	type checkpointStats struct {
		total     int
		completed int
		failed    int
		// Track unique error messages per checkpoint with their structured details
		errors map[string]errorDetail
	}
	checkpointProgress := make(map[string]*checkpointStats)

	// Compute on-the-fly item status counts
	var itemCounts model.ItemStatusCounts

	for _, item := range items {
		stats, ok := checkpointProgress[item.CheckpointFilename]
		if !ok {
			stats = &checkpointStats{errors: make(map[string]errorDetail)}
			checkpointProgress[item.CheckpointFilename] = stats
		}
		stats.total++
		switch item.Status {
		case model.SampleJobItemStatusCompleted:
			stats.completed++
			itemCounts.Completed++
		case model.SampleJobItemStatusFailed, model.SampleJobItemStatusSkipped:
			stats.failed++
			itemCounts.Failed++
			if item.ErrorMessage != "" {
				stats.errors[item.ErrorMessage] = errorDetail{
					exceptionType: item.ExceptionType,
					nodeType:      item.NodeType,
					traceback:     item.Traceback,
				}
			}
		case model.SampleJobItemStatusPending:
			itemCounts.Pending++
		}
	}

	// Count fully completed checkpoints and build failed item details
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

	var failedItemDetails []model.FailedItemDetail

	for _, checkpoint := range checkpointNames {
		stats := checkpointProgress[checkpoint]
		allDone := stats.completed+stats.failed == stats.total
		if allDone && stats.failed == 0 {
			checkpointsCompleted++
		} else if currentCheckpoint == "" && !allDone {
			// First incomplete checkpoint becomes the "current" one
			currentCheckpoint = checkpoint
			currentCheckpointProgress = stats.completed
			currentCheckpointTotal = stats.total
		}

		// A checkpoint is considered failed if ANY of its items have status=failed
		if stats.failed > 0 {
			// Collect unique error messages for this checkpoint with structured details
			for errMsg, detail := range stats.errors {
				failedItemDetails = append(failedItemDetails, model.FailedItemDetail{
					CheckpointFilename: checkpoint,
					ErrorMessage:       errMsg,
					ExceptionType:      detail.exceptionType,
					NodeType:           detail.nodeType,
					Traceback:          detail.traceback,
				})
			}
			// If there are failed items but no error messages recorded, still include the checkpoint
			if len(stats.errors) == 0 {
				failedItemDetails = append(failedItemDetails, model.FailedItemDetail{
					CheckpointFilename: checkpoint,
					ErrorMessage:       "unknown error",
				})
			}
		}
	}

	// Ensure empty slice rather than nil for consistent API responses
	if failedItemDetails == nil {
		failedItemDetails = []model.FailedItemDetail{}
	}

	// Estimated completion time: not implemented in this story
	var estimatedCompletion *time.Time

	progress := model.JobProgress{
		CheckpointsCompleted:      checkpointsCompleted,
		TotalCheckpoints:          totalCheckpoints,
		CurrentCheckpoint:         currentCheckpoint,
		CurrentCheckpointProgress: currentCheckpointProgress,
		CurrentCheckpointTotal:    currentCheckpointTotal,
		EstimatedCompletionTime:   estimatedCompletion,
		ItemCounts:                itemCounts,
		FailedItemDetails:         failedItemDetails,
	}

	s.logger.WithFields(logrus.Fields{
		"sample_job_id":         id,
		"checkpoints_completed": checkpointsCompleted,
		"total_checkpoints":     totalCheckpoints,
		"completed_items":       itemCounts.Completed,
		"failed_items":          itemCounts.Failed,
		"pending_items":         itemCounts.Pending,
	}).Debug("computed job progress")

	return progress, nil
}

// GenerateOutputFilename generates the query-encoded output filename for a sample job item.
// This is the canonical filename format used both during job execution and for
// missing-sample detection. The format matches what the job executor writes to disk.
func GenerateOutputFilename(item model.SampleJobItem) string {
	params := url.Values{}
	params.Set("prompt", item.PromptName)
	params.Set("steps", fmt.Sprintf("%d", item.Steps))
	params.Set("cfg", fmt.Sprintf("%.1f", item.CFG))
	params.Set("sampler", item.SamplerName)
	params.Set("scheduler", item.Scheduler)
	params.Set("seed", fmt.Sprintf("%d", item.Seed))
	return fmt.Sprintf("%s.png", params.Encode())
}
