package service

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// failItem marks an item as failed with an error message (called without holding mutex).
// It performs blocking I/O and then re-acquires the lock to clear active state.
func (e *JobExecutor) failItem(itemID string, errorMsg string) {
	e.failItemWithDetails(itemID, errorMsg, "", "", "")
}

// failItemWithDetails marks an item as failed with structured error details
// from ComfyUI execution_error events (called without holding mutex).
func (e *JobExecutor) failItemWithDetails(itemID string, errorMsg string, exceptionType string, nodeType string, traceback string) {
	e.logger.WithFields(logrus.Fields{
		"item_id": itemID,
		"error":   errorMsg,
	}).Error("marking item as failed")

	// Capture jobID before any blocking operations
	e.mu.Lock()
	jobID := e.activeJobID
	e.mu.Unlock()

	items, err := e.store.ListSampleJobItems(jobID)
	if err != nil {
		e.logger.WithError(err).Error("failed to list job items")
		return
	}

	for i := range items {
		if items[i].ID == itemID {
			items[i].Status = model.SampleJobItemStatusFailed
			items[i].ErrorMessage = errorMsg
			items[i].ExceptionType = exceptionType
			items[i].NodeType = nodeType
			items[i].Traceback = traceback
			items[i].UpdatedAt = time.Now().UTC()
			if err := e.store.UpdateSampleJobItem(items[i]); err != nil {
				if err == sql.ErrNoRows {
					// Item was deleted between list and update (job cancelled during E2E teardown).
					// This is a benign race — log at warn, not error.
					e.logger.WithField("item_id", itemID).Warn("item row not found during status-to-failed update (job likely cancelled)")
				} else {
					e.logger.WithError(err).Error("failed to update item status to failed")
				}
			}
			break
		}
	}

	// Update job progress
	e.updateJobProgress(jobID)

	// Broadcast progress event
	e.broadcastJobProgress(jobID)

	// Clear active state so we can move to the next item
	e.mu.Lock()
	e.activeItemID = ""
	e.activePromptID = ""
	e.mu.Unlock()
}

// updateJobProgress updates the completed items count for a job.
//
// The counter is derived atomically inside a single UPDATE statement
// (RecalculateCompletedItems) rather than via a get-modify-write. Two concurrent
// item completions therefore cannot lose an update: the stored completed_items
// always equals the actual count of completed sample_job_items.
func (e *JobExecutor) updateJobProgress(jobID string) {
	completed, err := e.store.RecalculateCompletedItems(jobID)
	if err != nil {
		if err == sql.ErrNoRows {
			// Job was deleted between item completion and progress update (job cancelled during E2E teardown).
			// This is a benign race — log at warn, not error.
			e.logger.WithField("job_id", jobID).Warn("job row not found during progress update (job likely cancelled)")
		} else {
			e.logger.WithError(err).Error("failed to update job progress")
		}
		return
	}

	e.logger.WithFields(logrus.Fields{
		"job_id":          jobID,
		"completed_items": completed,
	}).Debug("job progress updated")
}

// completeJob marks a job as completed (or completed_with_errors) when all items are done.
// If any item is not in completed status (failed, skipped, or stuck in running),
// the job transitions to completed_with_errors. Only when every item completed
// successfully does the job transition to completed.
func (e *JobExecutor) completeJob(jobID string) {
	e.logger.WithField("job_id", jobID).Info("completing job")

	job, err := e.store.GetSampleJob(jobID)
	if err != nil {
		if err == sql.ErrNoRows {
			// Job was deleted between all-items-done detection and completion (job cancelled during E2E teardown).
			// This is a benign race — clear active state and return without error.
			e.logger.WithField("job_id", jobID).Warn("job row not found during completion (job likely cancelled)")
			e.mu.Lock()
			e.activeJobID = ""
			e.activeItemID = ""
			e.activePromptID = ""
			e.checkpointCompleteness = make(map[string]model.CheckpointCompletenessInfo)
			e.sampleTiming.Reset()
			e.sampleStartTime = time.Time{}
			e.mu.Unlock()
		} else {
			e.logger.WithError(err).Error("failed to get job for completion")
		}
		return
	}

	// Check if all items completed successfully to determine terminal status.
	// Any non-completed item (failed, skipped, stuck in running) means the job
	// should be marked as completed_with_errors.
	items, err := e.store.ListSampleJobItems(jobID)
	if err != nil {
		e.logger.WithError(err).Error("failed to list items for completion check")
		// Fall back to completed status
		job.Status = model.SampleJobStatusCompleted
	} else {
		allCompleted := true
		for _, item := range items {
			if item.Status != model.SampleJobItemStatusCompleted {
				allCompleted = false
				break
			}
		}
		if !allCompleted {
			job.Status = model.SampleJobStatusCompletedWithErrors
			e.logger.WithField("job_id", jobID).Info("job has non-completed items, transitioning to completed_with_errors")
		} else {
			job.Status = model.SampleJobStatusCompleted
		}
	}

	job.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJob(job); err != nil {
		if err == sql.ErrNoRows {
			// Job was deleted between get and update during completion (job cancelled during E2E teardown).
			// Clear active state and return without error.
			e.logger.WithField("job_id", jobID).Warn("job row not found during completion update (job likely cancelled)")
			e.mu.Lock()
			e.activeJobID = ""
			e.activeItemID = ""
			e.activePromptID = ""
			e.checkpointCompleteness = make(map[string]model.CheckpointCompletenessInfo)
			e.sampleTiming.Reset()
			e.sampleStartTime = time.Time{}
			e.mu.Unlock()
		} else {
			e.logger.WithError(err).Error("failed to mark job as completed")
		}
		return
	}

	// Write manifest file (non-fatal if it fails)
	if manifestErr := e.writeManifest(job, items); manifestErr != nil {
		e.logger.WithFields(logrus.Fields{
			"job_id": jobID,
			"error":  manifestErr.Error(),
		}).Warn("failed to write manifest, job completed but manifest missing")
	}

	// Broadcast completion event
	e.broadcastJobProgress(jobID)

	// Clear active state, completeness data, and timing data for the finished job
	e.mu.Lock()
	e.activeJobID = ""
	e.activeItemID = ""
	e.activePromptID = ""
	e.checkpointCompleteness = make(map[string]model.CheckpointCompletenessInfo)
	e.sampleTiming.Reset()
	e.sampleStartTime = time.Time{}
	e.mu.Unlock()

	e.logger.WithFields(logrus.Fields{
		"job_id": jobID,
		"status": job.Status,
	}).Info("job completed")
}

// verifyCheckpointCompleteness validates that all expected images exist on disk for a completed checkpoint.
// It compares expected filenames (derived from the completed items) against actual PNG files in the checkpoint's
// sample directory. Results are stored in e.checkpointCompleteness and reported as warnings (not failures).
// studyOutputDir is the versioned study output directory (e.g. "My Study/v1").
func (e *JobExecutor) verifyCheckpointCompleteness(jobID string, studyOutputDir string, checkpoint string, items []model.SampleJobItem, fnDims FilenameDimensions) {
	e.logger.WithFields(logrus.Fields{
		"job_id":     jobID,
		"checkpoint": checkpoint,
	}).Trace("entering verifyCheckpointCompleteness")
	defer e.logger.Trace("returning from verifyCheckpointCompleteness")

	// Build set of expected filenames from completed items for this checkpoint
	var expectedFiles []string
	for _, item := range items {
		if item.CheckpointFilename == checkpoint && item.Status == model.SampleJobItemStatusCompleted {
			filename := e.generateOutputFilename(item, fnDims)
			expectedFiles = append(expectedFiles, filename)
		}
	}

	expected := len(expectedFiles)
	if expected == 0 {
		// No completed items for this checkpoint — nothing to verify
		return
	}

	// Check the checkpoint's sample directory on disk
	// B-115: use filepath.Base to ensure only the filename is used as directory name
	checkpointDir := filepath.Join(e.sampleDir, studyOutputDir, filepath.Base(checkpoint))
	if !e.fsReader.DirectoryExists(checkpointDir) {
		e.logger.WithFields(logrus.Fields{
			"job_id":         jobID,
			"checkpoint":     checkpoint,
			"checkpoint_dir": checkpointDir,
		}).Warn("checkpoint sample directory does not exist during completeness check")

		e.mu.Lock()
		e.checkpointCompleteness[checkpoint] = model.CheckpointCompletenessInfo{
			Checkpoint: checkpoint,
			Expected:   expected,
			Verified:   0,
			Missing:    expected,
		}
		e.mu.Unlock()
		return
	}

	actualFiles, err := e.fsReader.ListPNGFiles(checkpointDir)
	if err != nil {
		e.logger.WithFields(logrus.Fields{
			"job_id":         jobID,
			"checkpoint":     checkpoint,
			"checkpoint_dir": checkpointDir,
			"error":          err.Error(),
		}).Warn("failed to list PNG files during completeness check")

		e.mu.Lock()
		e.checkpointCompleteness[checkpoint] = model.CheckpointCompletenessInfo{
			Checkpoint: checkpoint,
			Expected:   expected,
			Verified:   0,
			Missing:    expected,
		}
		e.mu.Unlock()
		return
	}

	// Build a set of actual files on disk for O(1) lookup
	actualSet := make(map[string]struct{}, len(actualFiles))
	for _, f := range actualFiles {
		actualSet[f] = struct{}{}
	}

	// Count how many expected files are present on disk
	verified := 0
	var missingFiles []string
	for _, expectedFile := range expectedFiles {
		if _, found := actualSet[expectedFile]; found {
			verified++
		} else {
			missingFiles = append(missingFiles, expectedFile)
		}
	}

	missing := expected - verified

	if missing > 0 {
		e.logger.WithFields(logrus.Fields{
			"job_id":        jobID,
			"checkpoint":    checkpoint,
			"expected":      expected,
			"verified":      verified,
			"missing":       missing,
			"missing_files": missingFiles,
		}).Warn("completeness check found missing files")
	} else {
		e.logger.WithFields(logrus.Fields{
			"job_id":     jobID,
			"checkpoint": checkpoint,
			"expected":   expected,
			"verified":   verified,
		}).Info("completeness check passed — all expected files present")
	}

	e.mu.Lock()
	e.checkpointCompleteness[checkpoint] = model.CheckpointCompletenessInfo{
		Checkpoint: checkpoint,
		Expected:   expected,
		Verified:   verified,
		Missing:    missing,
	}
	e.mu.Unlock()
}

// currentSampleParams returns the generation parameters for the currently active
// sample job item, or nil if no item is currently running.
// Must NOT be called while holding e.mu.
func (e *JobExecutor) currentSampleParams(items []model.SampleJobItem) *model.CurrentSampleParams {
	e.mu.Lock()
	activeItemID := e.activeItemID
	e.mu.Unlock()

	if activeItemID == "" {
		return nil
	}
	for _, item := range items {
		if item.ID == activeItemID {
			return &model.CurrentSampleParams{
				CheckpointFilename: item.CheckpointFilename,
				PromptName:         item.PromptName,
				CFG:                item.CFG,
				Steps:              item.Steps,
				SamplerName:        item.SamplerName,
				Scheduler:          item.Scheduler,
				Seed:               item.Seed,
				Width:              item.Width,
				Height:             item.Height,
			}
		}
	}
	return nil
}

// broadcastJobProgress broadcasts a job progress event to WebSocket clients.
// It computes the current item counts and checkpoint progress and sends them
// as a structured job_progress event. When a checkpoint batch completes,
// it also runs a completeness check to verify expected images exist on disk.
func (e *JobExecutor) broadcastJobProgress(jobID string) {
	job, err := e.store.GetSampleJob(jobID)
	if err != nil {
		// sql.ErrNoRows means the job was deleted between the trigger and this
		// broadcast (e.g. during E2E teardown). This is a benign race — log at
		// WARN rather than ERROR to avoid spurious noise in test output.
		if err == sql.ErrNoRows {
			e.logger.WithField("job_id", jobID).Warn("job row not found during progress broadcast (deleted between trigger and broadcast)")
		} else {
			e.logger.WithError(err).Error("failed to get job for progress broadcast")
		}
		return
	}

	items, err := e.store.ListSampleJobItems(jobID)
	if err != nil {
		e.logger.WithError(err).Error("failed to list items for progress broadcast")
		return
	}

	// Resolve the study output directory using the shared helper (B-162) so this
	// matches the directory that images and the manifest were actually written to,
	// including the base_model level for LoRA jobs.
	studyOutputDir := fileformat.StudyOutputDir(job.TrainingRunName, job.StudyName, job.BaseModel)

	// S-157: swept dimensions control filename encoding; compute once per broadcast.
	fnDims := e.filenameDimsForJob(job)

	// Compute on-the-fly item counts by status and collect failed item details
	type errorDetailInfo struct {
		exceptionType string
		nodeType      string
		traceback     string
	}
	type cpStats struct {
		total     int
		completed int
		failed    int
		errors    map[string]errorDetailInfo
	}
	var completed, failed, pending int
	checkpointStatsMap := make(map[string]*cpStats)

	for _, item := range items {
		stats, ok := checkpointStatsMap[item.CheckpointFilename]
		if !ok {
			stats = &cpStats{errors: make(map[string]errorDetailInfo)}
			checkpointStatsMap[item.CheckpointFilename] = stats
		}
		stats.total++
		switch item.Status {
		case model.SampleJobItemStatusCompleted:
			completed++
			stats.completed++
		case model.SampleJobItemStatusFailed, model.SampleJobItemStatusSkipped:
			failed++
			stats.failed++
			if item.ErrorMessage != "" {
				stats.errors[item.ErrorMessage] = errorDetailInfo{
					exceptionType: item.ExceptionType,
					nodeType:      item.NodeType,
					traceback:     item.Traceback,
				}
			}
		case model.SampleJobItemStatusPending:
			pending++
		}
	}

	// Count fully completed checkpoints, find current, and run completeness checks
	checkpointsCompleted := 0
	totalCheckpoints := len(checkpointStatsMap)
	var currentCheckpoint string
	var currentCheckpointProgress, currentCheckpointTotal int

	// Build failed item details for the progress broadcast
	var failedItemDetails []model.FailedItemDetail

	for checkpoint, stats := range checkpointStatsMap {
		if stats.completed+stats.failed == stats.total && stats.failed == 0 {
			checkpointsCompleted++

			// AC: After each checkpoint's samples are generated, validate completeness
			e.mu.Lock()
			_, alreadyChecked := e.checkpointCompleteness[checkpoint]
			e.mu.Unlock()

			if !alreadyChecked {
				e.verifyCheckpointCompleteness(jobID, studyOutputDir, checkpoint, items, fnDims)
			}
		} else if currentCheckpoint == "" && stats.completed+stats.failed < stats.total {
			currentCheckpoint = checkpoint
			currentCheckpointProgress = stats.completed
			currentCheckpointTotal = stats.total
		}

		if stats.failed > 0 {
			for errMsg, detail := range stats.errors {
				failedItemDetails = append(failedItemDetails, model.FailedItemDetail{
					CheckpointFilename: checkpoint,
					ErrorMessage:       errMsg,
					ExceptionType:      detail.exceptionType,
					NodeType:           detail.nodeType,
					Traceback:          detail.traceback,
				})
			}
			if len(stats.errors) == 0 {
				failedItemDetails = append(failedItemDetails, model.FailedItemDetail{
					CheckpointFilename: checkpoint,
					ErrorMessage:       "unknown error",
				})
			}
		}
	}
	if failedItemDetails == nil {
		failedItemDetails = []model.FailedItemDetail{}
	}

	// Collect completeness info for the broadcast
	e.mu.Lock()
	var completeness []model.CheckpointCompletenessInfo
	for _, info := range e.checkpointCompleteness {
		completeness = append(completeness, info)
	}
	e.mu.Unlock()

	// Compute ETA based on the moving average of sample generation times
	e.mu.Lock()
	avgDuration := e.sampleTiming.Average()
	startTime := e.sampleStartTime
	e.mu.Unlock()

	var sampleETASeconds, jobETASeconds float64
	if avgDuration > 0 {
		// Per-sample ETA: estimated time remaining for the current in-flight sample.
		// If a sample is currently being processed, subtract the elapsed time.
		// If the elapsed time already exceeds the historical average (e.g. this sample
		// is taking longer than usual, or setup overhead ate into the estimate), fall
		// back to the full avgDuration so that the field is always populated while a
		// sample is actively running. Inference-progress events will override this with
		// a step-based ETA once they start arriving.
		if !startTime.IsZero() {
			elapsed := e.timeNow().Sub(startTime)
			remaining := avgDuration - elapsed
			if remaining > 0 {
				sampleETASeconds = remaining.Seconds()
			} else {
				sampleETASeconds = avgDuration.Seconds()
			}
		}

		// Per-job ETA: remaining items * average duration, plus the current sample's remaining time.
		// "remaining" means pending items (samples not yet started).
		remainingItems := pending
		jobETASeconds = float64(remainingItems)*avgDuration.Seconds() + sampleETASeconds
	}

	// Collect current sample parameters for the active item (if any)
	currentParams := e.currentSampleParams(items)

	event := model.FSEvent{
		Type: model.EventJobProgress,
		Path: fmt.Sprintf("job_progress/%s", jobID),
		JobProgressData: &model.JobProgressEventData{
			JobID:                     jobID,
			Status:                    string(job.Status),
			TotalItems:                job.TotalItems,
			CompletedItems:            completed,
			FailedItems:               failed,
			PendingItems:              pending,
			CheckpointsCompleted:      checkpointsCompleted,
			TotalCheckpoints:          totalCheckpoints,
			CurrentCheckpoint:         currentCheckpoint,
			CurrentCheckpointProgress: currentCheckpointProgress,
			CurrentCheckpointTotal:    currentCheckpointTotal,
			CheckpointCompleteness:    completeness,
			FailedItemDetails:         failedItemDetails,
			SampleETASeconds:          sampleETASeconds,
			JobETASeconds:             jobETASeconds,
			CurrentSampleParams:       currentParams,
		},
	}
	e.hub.Broadcast(event)
	e.logger.WithFields(logrus.Fields{
		"job_id":    jobID,
		"completed": completed,
		"failed":    failed,
		"pending":   pending,
	}).Debug("broadcasted job progress event")
}
