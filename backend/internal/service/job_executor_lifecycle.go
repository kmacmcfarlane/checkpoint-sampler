package service

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// Start begins the background executor goroutine and resumes any running jobs.
// It attempts to connect to ComfyUI but does not fail if the connection is unavailable.
// The executor will retry the connection in the background.
func (e *JobExecutor) Start() error {
	e.logger.Trace("entering Start")
	defer e.logger.Trace("returning from Start")

	e.mu.Lock()
	if e.started {
		e.mu.Unlock()
		e.logger.Warn("job executor already started")
		return fmt.Errorf("job executor already started")
	}
	e.started = true
	e.mu.Unlock()

	// Register WebSocket event handler and disconnect handler (must be done before connection attempts)
	e.comfyuiWS.AddHandler(e.handleComfyUIEvent)
	e.comfyuiWS.SetDisconnectHandler(e.handleDisconnect)

	// Attempt initial connection to ComfyUI WebSocket
	if err := e.tryConnect(); err != nil {
		e.logger.WithError(err).Warn("initial ComfyUI connection failed, will retry in background")
		// Do NOT return error - continue starting the executor
	}

	// Resume any running jobs on startup
	if err := e.resumeRunningJobs(); err != nil {
		e.logger.WithError(err).Warn("failed to resume running jobs")
	}

	// Start the executor goroutine
	go e.run()

	e.logger.Info("job executor started")
	return nil
}

// Stop gracefully shuts down the executor.
// Safe to call even if Start() was not called or failed.
func (e *JobExecutor) Stop() {
	e.logger.Trace("entering Stop")
	defer e.logger.Trace("returning from Stop")

	e.mu.Lock()
	if !e.started {
		e.mu.Unlock()
		e.logger.Debug("job executor not started, nothing to stop")
		return
	}
	e.mu.Unlock()

	close(e.shutdownCh)
	e.cancel()

	// Wait for executor to complete
	<-e.shutdownComplete

	// Close WebSocket
	if err := e.comfyuiWS.Close(); err != nil {
		e.logger.WithError(err).Error("failed to close ComfyUI WebSocket")
	}

	e.logger.Info("job executor stopped")
}

// Pause temporarily suspends the executor's database polling loop.
// While paused, processNextItem returns immediately without querying the
// database. WebSocket event handling also skips completion processing while
// paused to prevent stale references to dropped database rows.
//
// This is used by the test reset endpoint to prevent SQL errors during table
// drop/recreate. Active state (job ID, item ID, prompt ID) is cleared so the
// executor does not get stuck referencing rows that no longer exist after the
// database is reset.
func (e *JobExecutor) Pause() {
	e.logger.Trace("entering Pause")
	defer e.logger.Trace("returning from Pause")

	e.mu.Lock()
	defer e.mu.Unlock()

	if e.paused {
		e.logger.Debug("job executor already paused")
		return
	}
	e.paused = true

	// Clear active state so the executor does not hold stale references to
	// database rows that will be dropped during the reset. Without this, the
	// executor could remain stuck waiting for WS events for a prompt that no
	// longer exists, or attempt to look up items in empty tables.
	if e.activeJobID != "" || e.activeItemID != "" {
		e.logger.WithFields(logrus.Fields{
			"active_job_id":  e.activeJobID,
			"active_item_id": e.activeItemID,
		}).Debug("clearing active state on pause")
	}
	e.activeJobID = ""
	e.activeItemID = ""
	e.activePromptID = ""
	e.checkpointCompleteness = make(map[string]model.CheckpointCompletenessInfo)
	e.sampleTiming.Reset()
	e.sampleStartTime = time.Time{}

	e.logger.Info("job executor paused")
}

// Resume restores the executor's database polling loop after a Pause.
func (e *JobExecutor) Resume() {
	e.logger.Trace("entering Resume")
	defer e.logger.Trace("returning from Resume")

	e.mu.Lock()
	defer e.mu.Unlock()

	if !e.paused {
		e.logger.Debug("job executor not paused, nothing to resume")
		return
	}
	e.paused = false
	e.logger.Info("job executor resumed")
}

// resumeRunningJobs adopts the first running job found in the database on startup
// by setting activeJobID so the executor loop picks it up. Only the first running
// job is adopted (the executor processes one job at a time). Additional running
// jobs (which should not normally exist) remain in their current state and would
// require a restart to be adopted.
func (e *JobExecutor) resumeRunningJobs() error {
	e.logger.Trace("entering resumeRunningJobs")
	defer e.logger.Trace("returning from resumeRunningJobs")

	// Check if connected
	e.mu.Lock()
	isConnected := e.connected
	e.mu.Unlock()

	jobs, err := e.store.ListSampleJobs()
	if err != nil {
		e.logger.WithError(err).Error("failed to list jobs")
		return fmt.Errorf("listing jobs: %w", err)
	}

	var adopted bool
	for _, job := range jobs {
		if job.Status == model.SampleJobStatusRunning {
			if !adopted {
				e.mu.Lock()
				e.activeJobID = job.ID
				e.mu.Unlock()
				adopted = true
				e.logger.WithField("job_id", job.ID).Info("adopted running job for resume")
			} else {
				e.logger.WithField("job_id", job.ID).Info("found additional running job (will be adopted after current job completes)")
			}
			if !isConnected {
				e.logger.WithField("job_id", job.ID).Warn("ComfyUI connection not available — will resume once connected")
			}
		}
	}

	return nil
}

// autoStartJob transitions a pending job to running status.
// It performs blocking I/O (a store write) without holding the mutex.
// Returns an error if the transition fails; on success the job's Status field is updated in place.
func (e *JobExecutor) autoStartJob(job *model.SampleJob) error {
	e.logger.WithField("job_id", job.ID).Info("auto-starting pending job")

	// B-131: Clear only the selected checkpoint output directories on first start (not on resume).
	// Only per-checkpoint subdirectories for job.CheckpointFilenames are removed;
	// samples for other checkpoints in the study are preserved.
	// The flag is reset to false before persisting so that a stopped/failed job
	// that is later resumed will not re-clear.
	if job.ClearExisting && e.dirRemover != nil {
		for _, checkpointFilename := range job.CheckpointFilenames {
			if err := e.dirRemover.RemoveCheckpointOutputDir(job.TrainingRunName, job.StudyName, checkpointFilename); err != nil {
				e.logger.WithFields(logrus.Fields{
					"job_id":              job.ID,
					"training_run_name":   job.TrainingRunName,
					"study_name":          job.StudyName,
					"checkpoint_filename": checkpointFilename,
					"error":               err.Error(),
				}).Warn("failed to remove checkpoint output directory during auto-start, continuing")
			} else {
				e.logger.WithFields(logrus.Fields{
					"job_id":              job.ID,
					"training_run_name":   job.TrainingRunName,
					"study_name":          job.StudyName,
					"checkpoint_filename": checkpointFilename,
				}).Info("cleared checkpoint output directory during auto-start")
			}
		}
	}

	job.Status = model.SampleJobStatusRunning
	job.ClearExisting = false // reset so resume never re-clears
	job.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJob(*job); err != nil {
		// sql.ErrNoRows means the row was deleted between the poll and the update
		// (e.g. database reset during E2E teardown). This is a benign race — log at
		// WARN rather than ERROR to avoid spurious noise in test output.
		if err == sql.ErrNoRows {
			e.logger.WithField("job_id", job.ID).Warn("job row not found during auto-start (deleted between poll and update)")
		} else {
			e.logger.WithFields(logrus.Fields{
				"job_id": job.ID,
				"error":  err.Error(),
			}).Error("failed to auto-start pending job")
		}
		return fmt.Errorf("auto-starting job: %w", err)
	}
	e.logger.WithField("job_id", job.ID).Info("pending job transitioned to running")
	return nil
}

// run is the main executor loop.
func (e *JobExecutor) run() {
	defer close(e.shutdownComplete)

	e.logger.Debug("executor loop started")
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	reconnectTicker := time.NewTicker(e.reconnectInterval)
	defer reconnectTicker.Stop()

	for {
		select {
		case <-e.shutdownCh:
			e.logger.Debug("executor loop shutting down")
			return
		case <-reconnectTicker.C:
			// Attempt to reconnect if not connected
			e.mu.Lock()
			isConnected := e.connected
			e.mu.Unlock()

			if !isConnected {
				if err := e.tryConnect(); err != nil {
					e.logger.WithError(err).Debug("ComfyUI reconnection attempt failed")
				}
			}
		case <-ticker.C:
			e.processNextItem()
		}
	}
}

// processNextItem finds the next pending item in a running job and processes it.
// If no running job exists, it auto-starts the first pending job (pending → running).
//
// Non-preemption guarantee: once a job is tracked via activeJobID, processNextItem
// exclusively works on that job until it completes. A new pending job is never
// auto-started while activeJobID is set, and a different running job is never
// substituted for the tracked job.
func (e *JobExecutor) processNextItem() {
	e.mu.Lock()

	// If paused (e.g. during database reset), skip processing to avoid
	// querying tables that may be dropped and not yet recreated.
	if e.paused {
		e.mu.Unlock()
		return
	}

	// If not connected to ComfyUI, skip processing
	if !e.connected {
		e.mu.Unlock()
		return
	}

	// If an item is currently in-flight (submitted to ComfyUI, awaiting WS completion),
	// don't start another one. This is the primary guard against double-submission.
	if e.activeItemID != "" {
		e.mu.Unlock()
		return
	}

	// Fetch all jobs to determine what to work on next.
	jobs, err := e.store.ListSampleJobs()
	if err != nil {
		e.mu.Unlock()
		e.logger.WithError(err).Error("failed to list jobs")
		return
	}

	var runningJob *model.SampleJob

	if e.activeJobID != "" {
		// We are already tracking a job. Look it up by ID so we never switch to a
		// different running job (preemption prevention).
		for i := range jobs {
			if jobs[i].ID == e.activeJobID {
				runningJob = &jobs[i]
				break
			}
		}
		if runningJob == nil {
			// Tracked job has disappeared from the store (should not happen in normal
			// operation). Clear stale state and bail out for this tick.
			e.logger.WithField("job_id", e.activeJobID).Warn("tracked job not found in store, clearing active state")
			e.activeJobID = ""
			e.activePromptID = ""
			e.mu.Unlock()
			return
		}
	} else {
		// AC: No explicit Start API call required — auto-start the first pending job.
		// Note: running-job discovery is intentionally omitted here for *job-level*
		// status. Jobs become running only through this executor (via autoStartJob),
		// and startup-time resumption is handled by resumeRunningJobs(). Scanning
		// for running jobs in the polling loop would cause externally-seeded test
		// jobs (which have no items) to be immediately completed.
		// Orphaned running *items* within an already-tracked job are handled
		// separately in the item-scanning section below.
		for i := range jobs {
			if jobs[i].Status == model.SampleJobStatusPending {
				runningJob = &jobs[i]
				break
			}
		}
		if runningJob == nil {
			e.mu.Unlock()
			return
		}

		// Transition pending → running (release lock before I/O, re-acquire after)
		e.mu.Unlock()
		if err := e.autoStartJob(runningJob); err != nil {
			return
		}
		// Re-acquire the lock to continue with item processing
		e.mu.Lock()
	}

	// Find the next pending item for the running job
	items, err := e.store.ListSampleJobItems(runningJob.ID)
	if err != nil {
		e.mu.Unlock()
		e.logger.WithError(err).Error("failed to list job items")
		return
	}

	var nextItem *model.SampleJobItem
	for i := range items {
		if items[i].Status == model.SampleJobItemStatusPending {
			nextItem = &items[i]
			break
		}
	}

	// If no pending items, check for orphaned running items. An item is orphaned
	// when it has status=running in the DB but activeItemID is empty (i.e. no item
	// is genuinely in-flight). This happens after stop/resume, server restart, or
	// any crash that leaves an item stuck in running status. The activeItemID guard
	// at the top of processNextItem ensures we only reach here when no item is
	// genuinely in-flight, so it is safe to reset the orphaned item to pending.
	if nextItem == nil {
		for i := range items {
			if items[i].Status == model.SampleJobItemStatusRunning {
				e.logger.WithFields(logrus.Fields{
					"job_id":  runningJob.ID,
					"item_id": items[i].ID,
				}).Info("found orphaned running item, resetting to pending for reprocessing")
				items[i].Status = model.SampleJobItemStatusPending
				items[i].UpdatedAt = time.Now().UTC()
				// Release lock before I/O, re-acquire after
				e.mu.Unlock()
				if err := e.store.UpdateSampleJobItem(items[i]); err != nil {
					e.logger.WithFields(logrus.Fields{
						"item_id": items[i].ID,
						"error":   err.Error(),
					}).Error("failed to reset orphaned running item to pending")
					return
				}
				e.mu.Lock()
				nextItem = &items[i]
				break
			}
		}
	}

	if nextItem == nil {
		// No pending or orphaned running items — mark job as completed
		jobID := runningJob.ID
		e.mu.Unlock()
		e.completeJob(jobID)
		return
	}

	// Set active state before releasing the lock
	e.activeJobID = runningJob.ID
	e.activeItemID = nextItem.ID

	// Release the lock before performing blocking I/O
	e.mu.Unlock()

	// Process the item (this does blocking I/O: workflow load, ComfyUI submit)
	e.processItem(*runningJob, *nextItem)
}

// resolveItemModelPaths lazily resolves the ComfyUI model path for an item whose
// path was left unresolved at job creation (S-161). It returns the item with the
// resolved path populated in memory (the caller persists it via the subsequent
// status-to-running write), a retryable flag, and an error.
//
// retryable is true only when the failure is a ComfyUI *connection* error: the
// caller must leave the item pending so it is retried once ComfyUI returns. When
// retryable is false and err is non-nil, the checkpoint is genuinely absent from
// ComfyUI (or another non-transient failure occurred) and the item should fail.
//
// Resolution is a no-op (returns the item unchanged, err nil) when the path is
// already set or the relevant matcher is not configured, preserving legacy
// behavior for tests and ComfyUI-disabled setups.
func (e *JobExecutor) resolveItemModelPaths(job model.SampleJob, item model.SampleJobItem) (model.SampleJobItem, bool, error) {
	isLoRA := job.BaseModel != ""

	if isLoRA {
		if item.LoraModelPath != "" || e.loraMatcher == nil {
			return item, false, nil
		}
		path, err := e.loraMatcher.MatchCheckpointPath(item.CheckpointFilename)
		if err != nil {
			return item, isConnectionError(err), err
		}
		item.LoraModelPath = path
		return item, false, nil
	}

	if item.ComfyUIModelPath != "" || e.checkpointMatcher == nil {
		return item, false, nil
	}
	path, err := e.checkpointMatcher.MatchCheckpointPath(item.CheckpointFilename)
	if err != nil {
		return item, isConnectionError(err), err
	}
	item.ComfyUIModelPath = path
	return item, false, nil
}

// processItem processes a single work item.
func (e *JobExecutor) processItem(job model.SampleJob, item model.SampleJobItem) {
	e.logger.WithFields(logrus.Fields{
		"job_id":              job.ID,
		"item_id":             item.ID,
		"checkpoint_filename": item.CheckpointFilename,
	}).Info("processing job item")

	// S-161: resolve the ComfyUI model path lazily. Jobs are queued with unresolved
	// paths so creation never depends on ComfyUI being reachable. A connection error
	// here means ComfyUI is (still) unreachable: leave the item pending, mark the
	// connection dead so the reconnect ticker re-establishes it, and clear active
	// state so the item is re-selected on a later tick once ComfyUI returns. A
	// genuine miss (ComfyUI up, checkpoint absent) fails only this item; the job then
	// finishes as completed_with_errors.
	resolvedItem, retryable, err := e.resolveItemModelPaths(job, item)
	if err != nil {
		if retryable {
			e.logger.WithFields(logrus.Fields{
				"job_id":              job.ID,
				"item_id":             item.ID,
				"checkpoint_filename": item.CheckpointFilename,
				"error":               err.Error(),
			}).Warn("ComfyUI unreachable during path resolution, leaving item pending for retry")
			e.mu.Lock()
			e.connected = false
			e.activeItemID = ""
			e.activePromptID = ""
			e.mu.Unlock()
			return
		}
		e.logger.WithFields(logrus.Fields{
			"job_id":              job.ID,
			"item_id":             item.ID,
			"checkpoint_filename": item.CheckpointFilename,
			"error":               err.Error(),
		}).Warn("checkpoint could not be resolved in ComfyUI, failing item")
		e.failItem(job.ID, item.ID, fmt.Sprintf("checkpoint not found in ComfyUI: %v", err))
		return
	}
	item = resolvedItem

	// Record sample start time for ETA calculation
	e.mu.Lock()
	e.sampleStartTime = e.timeNow()
	e.mu.Unlock()

	// Update item status to running
	item.Status = model.SampleJobItemStatusRunning
	item.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJobItem(item); err != nil {
		if err == sql.ErrNoRows {
			// Item was deleted between poll and update (e.g. job cancelled during E2E teardown).
			// This is a benign race — clear active state and return without error.
			e.logger.WithField("item_id", item.ID).Warn("item row not found during status-to-running update (job likely cancelled)")
			e.mu.Lock()
			e.activeItemID = ""
			e.activePromptID = ""
			e.mu.Unlock()
		} else {
			e.logger.WithError(err).Error("failed to update item status to running")
			e.failItem(job.ID, item.ID, "failed to update item status")
		}
		return
	}

	// Load workflow template
	workflow, err := e.workflowLoader.Get(e.ctx, job.WorkflowName)
	if err != nil {
		e.logger.WithError(err).Error("failed to load workflow template")
		e.failItem(job.ID, item.ID, fmt.Sprintf("failed to load workflow: %v", err))
		return
	}

	// Clone and substitute workflow
	substituted, err := e.substituteWorkflow(workflow, job, item)
	if err != nil {
		e.logger.WithError(err).Error("failed to substitute workflow")
		e.failItem(job.ID, item.ID, fmt.Sprintf("workflow substitution failed: %v", err))
		return
	}

	// Submit to ComfyUI with the WebSocket client_id so that ComfyUI routes
	// prompt-specific events (executing, executed, execution_error) to our WS connection.
	promptReq := model.PromptRequest{
		Prompt:   substituted,
		ClientID: e.comfyuiWS.GetClientID(),
	}
	promptResp, err := e.comfyuiClient.SubmitPrompt(e.ctx, promptReq)
	if err != nil {
		// A connection error here mirrors the path-resolution branch above: ComfyUI is
		// (still) unreachable, so leave the item pending, mark the connection dead so
		// the reconnect ticker re-establishes it, and clear active state so the item is
		// re-selected on a later tick once ComfyUI returns. A genuine submit rejection
		// (ComfyUI up, prompt invalid) fails only this item.
		if isConnectionError(err) {
			e.logger.WithFields(logrus.Fields{
				"job_id":              job.ID,
				"item_id":             item.ID,
				"checkpoint_filename": item.CheckpointFilename,
				"error":               err.Error(),
			}).Warn("ComfyUI unreachable during prompt submission, leaving item pending for retry")
			e.mu.Lock()
			e.connected = false
			e.activeItemID = ""
			e.activePromptID = ""
			e.mu.Unlock()
			return
		}
		e.logger.WithError(err).Error("failed to submit prompt to ComfyUI")
		e.failItem(job.ID, item.ID, fmt.Sprintf("ComfyUI prompt submission failed: %v", err))
		return
	}

	e.logger.WithField("prompt_id", promptResp.PromptID).Info("prompt submitted to ComfyUI")

	// Store the prompt ID (acquire mutex for write)
	e.mu.Lock()
	e.activePromptID = promptResp.PromptID
	e.mu.Unlock()

	item.ComfyUIPromptID = promptResp.PromptID
	item.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJobItem(item); err != nil {
		if err == sql.ErrNoRows {
			// Item was deleted between prompt submission and prompt-ID update (job cancelled).
			// This is a benign race — log at warn, not error.
			e.logger.WithField("item_id", item.ID).Warn("item row not found during prompt-ID update (job likely cancelled)")
		} else {
			e.logger.WithError(err).Error("failed to update item with prompt ID")
		}
	}

	// Broadcast an initial job_progress event so WebSocket clients see the current
	// sample's generation parameters immediately when a new item starts, rather
	// than waiting for the item to complete.  This ensures current_sample_params
	// is populated from the very first sample (not only from subsequent ones).
	e.broadcastJobProgress(job.ID)

	// Monitoring is handled via WebSocket events in handleComfyUIEvent
}

// RequestStop requests the executor to stop the given job immediately.
// If there is an active ComfyUI prompt, it is canceled.
// The executor owns the DB status update to stopped (mirroring how completeJob owns
// the completed transition), so there is no window where the DB and executor state
// diverge. After this call the executor state is cleared so that pending jobs can
// be picked up on the next tick.
func (e *JobExecutor) RequestStop(jobID string) error {
	e.mu.Lock()

	e.logger.WithField("job_id", jobID).Info("stop requested for job")

	if e.activeJobID != jobID {
		e.mu.Unlock()
		return fmt.Errorf("job %s is not currently running", jobID)
	}

	// Capture prompt ID under lock, then release before blocking call
	promptID := e.activePromptID
	e.mu.Unlock()

	// Cancel the active ComfyUI prompt if there is one (outside the lock)
	if promptID != "" {
		e.logger.WithField("prompt_id", promptID).Info("canceling active ComfyUI prompt")
		if err := e.comfyuiClient.CancelPrompt(e.ctx, promptID); err != nil {
			e.logger.WithError(err).Warn("failed to cancel ComfyUI prompt")
			// Don't return error - we still want to stop the job even if cancellation fails
		}
	}

	// Update the DB status to stopped before clearing executor state.
	// This ensures the DB and executor state are never out of sync: the DB is updated
	// to stopped atomically with the executor clearing its active tracking state.
	job, err := e.store.GetSampleJob(jobID)
	if err != nil {
		if err == sql.ErrNoRows {
			e.logger.WithField("job_id", jobID).Warn("job row not found during stop (job likely deleted)")
		} else {
			e.logger.WithFields(logrus.Fields{
				"job_id": jobID,
				"error":  err.Error(),
			}).Error("failed to fetch job for stop transition")
		}
		// Even if the DB update fails, clear executor state so we don't stay stuck.
	} else {
		job.Status = model.SampleJobStatusStopped
		job.UpdatedAt = time.Now().UTC()
		if err := e.store.UpdateSampleJob(job); err != nil {
			if err == sql.ErrNoRows {
				e.logger.WithField("job_id", jobID).Warn("job row not found during stop update (job likely deleted)")
			} else {
				e.logger.WithFields(logrus.Fields{
					"job_id": jobID,
					"error":  err.Error(),
				}).Error("failed to update job status to stopped")
			}
			// Even if the DB update fails, clear executor state so we don't stay stuck.
		} else {
			e.logger.WithField("job_id", jobID).Info("job status updated to stopped in DB")
		}
	}

	// Clear all active state so the executor can pick up pending jobs on the next tick.
	// Any in-flight WebSocket event (e.g. execution_error) will see activePromptID == ""
	// and be safely ignored.
	e.mu.Lock()
	e.activeJobID = ""
	e.activeItemID = ""
	e.activePromptID = ""
	e.mu.Unlock()

	e.logger.WithField("job_id", jobID).Info("job stop completed, executor state cleared")
	return nil
}

// RequestResume allows processing to continue for a stopped or retried job.
// If the executor has no active job, it adopts the requested job so the
// executor loop will pick it up on the next tick. This is essential for
// retry-failed flows where the job transitions from completed_with_errors
// to running — without setting activeJobID, the executor loop would never
// find it (it only auto-starts pending jobs, not running ones).
func (e *JobExecutor) RequestResume(jobID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.logger.WithField("job_id", jobID).Info("resume requested for job")

	// If another job is already active, reject the request.
	if e.activeJobID != "" && e.activeJobID != jobID {
		return fmt.Errorf("job %s is not currently active", jobID)
	}

	// If no job is active, adopt this one so processNextItem finds it.
	if e.activeJobID == "" {
		e.activeJobID = jobID
		e.logger.WithField("job_id", jobID).Info("adopted job for resume processing")
	}

	return nil
}
