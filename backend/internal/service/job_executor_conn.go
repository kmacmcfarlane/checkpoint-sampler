package service

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// tryConnect attempts to connect to ComfyUI WebSocket and updates the connected state.
// If this is a reconnect (not the initial connection), it triggers stuck-item recovery
// asynchronously so that jobs interrupted by the disconnect are not left in limbo.
func (e *JobExecutor) tryConnect() error {
	e.logger.Debug("attempting to connect to ComfyUI WebSocket")
	if err := e.comfyuiWS.Connect(e.ctx); err != nil {
		e.mu.Lock()
		e.connected = false
		e.mu.Unlock()
		return err
	}

	e.mu.Lock()
	isReconnect := e.everConnected
	e.connected = true
	e.everConnected = true
	e.mu.Unlock()

	e.logger.Info("ComfyUI WebSocket connected")

	// On reconnect (not the very first connection), poll the ComfyUI history API
	// to recover any job items that completed while the connection was down.
	if isReconnect {
		e.logger.Info("reconnected to ComfyUI WebSocket, triggering stuck-item recovery")
		go e.recoverStuckItems()
	}

	return nil
}

// recoverStuckItems is called after a successful reconnect to detect job items that
// completed in ComfyUI while the WebSocket connection was down.
//
// For each running job, it inspects every item in "running" status:
//   - If the item has a ComfyUI prompt ID and that prompt appears in the history API
//     with output images, the item is treated as already-completed and processed via
//     handleItemCompletionAsync.
//   - Otherwise (no prompt ID, not yet in history, or history call fails), the item
//     is reset to "pending" so the executor will re-submit it on the next tick.
//
// This makes the system resilient to ComfyUI restarts and mid-job network interruptions
// that would otherwise leave jobs permanently stuck in the running state.
func (e *JobExecutor) recoverStuckItems() {
	e.logger.Trace("entering recoverStuckItems")
	defer e.logger.Trace("returning from recoverStuckItems")

	jobs, err := e.store.ListSampleJobs()
	if err != nil {
		e.logger.WithError(err).Error("recoverStuckItems: failed to list jobs")
		return
	}

	for _, job := range jobs {
		if job.Status != model.SampleJobStatusRunning {
			continue
		}

		items, err := e.store.ListSampleJobItems(job.ID)
		if err != nil {
			e.logger.WithFields(logrus.Fields{
				"job_id": job.ID,
				"error":  err.Error(),
			}).Error("recoverStuckItems: failed to list items for job")
			continue
		}

		for i := range items {
			item := &items[i]
			if item.Status != model.SampleJobItemStatusRunning {
				continue
			}

			// snapshotPromptID is the prompt ID observed in this stale snapshot of the
			// item, taken before any history I/O below. Every mutation of this item is
			// guarded by a compare-and-act against this value under e.mu: the item is
			// only touched if its *current* stored prompt ID still matches the snapshot.
			// This prevents recovery from racing the executor ticker, which may clear the
			// active slot on disconnect, re-submit this same item with a fresh prompt ID,
			// and reconnect — all while this goroutine still holds the pre-disconnect view.
			snapshotPromptID := item.ComfyUIPromptID

			if snapshotPromptID == "" {
				// Item was set to running but no prompt was submitted yet (or prompt ID
				// was never persisted). Reset to pending so it gets re-submitted.
				e.logger.WithFields(logrus.Fields{
					"job_id":  job.ID,
					"item_id": item.ID,
				}).Warn("recoverStuckItems: item stuck in running with no prompt ID, resetting to pending")
				e.resetItemToPendingIfUnchanged(job.ID, item.ID, snapshotPromptID)
				continue
			}

			// Query ComfyUI history to see if the prompt already completed.
			history, err := e.comfyuiClient.GetHistory(e.ctx, snapshotPromptID)
			if err != nil {
				e.logger.WithFields(logrus.Fields{
					"job_id":    job.ID,
					"item_id":   item.ID,
					"prompt_id": snapshotPromptID,
					"error":     err.Error(),
				}).Warn("recoverStuckItems: failed to query history, resetting item to pending")
				e.resetItemToPendingIfUnchanged(job.ID, item.ID, snapshotPromptID)
				continue
			}

			entry, found := history[snapshotPromptID]
			if !found {
				// Prompt not in history — either it never ran or ComfyUI evicted it.
				// Reset to pending so it is re-submitted.
				e.logger.WithFields(logrus.Fields{
					"job_id":    job.ID,
					"item_id":   item.ID,
					"prompt_id": snapshotPromptID,
				}).Warn("recoverStuckItems: prompt not found in ComfyUI history, resetting item to pending")
				e.resetItemToPendingIfUnchanged(job.ID, item.ID, snapshotPromptID)
				continue
			}

			// Check if the entry has output images (indicates successful completion).
			if !historyEntryHasOutputImages(entry) {
				e.logger.WithFields(logrus.Fields{
					"job_id":    job.ID,
					"item_id":   item.ID,
					"prompt_id": snapshotPromptID,
				}).Warn("recoverStuckItems: prompt found in history but has no output images, resetting item to pending")
				e.resetItemToPendingIfUnchanged(job.ID, item.ID, snapshotPromptID)
				continue
			}

			// Prompt completed with output images — process the completion.
			e.logger.WithFields(logrus.Fields{
				"job_id":    job.ID,
				"item_id":   item.ID,
				"prompt_id": snapshotPromptID,
			}).Info("recoverStuckItems: recovering completed prompt from history")

			// Claim the active slot before calling handleItemCompletionAsync.
			// This is a compare-and-act under e.mu: we only claim if (a) no item is
			// genuinely in-flight, and (b) the item's *current* stored prompt ID still
			// matches the snapshot we recovered from history. If the ticker re-submitted
			// this item with a new prompt ID after the snapshot, the prompt IDs no longer
			// match and we skip recovery — the in-flight submission is left untouched and
			// will complete naturally via the executor loop.
			if !e.claimRecoveredItem(job.ID, item.ID, snapshotPromptID) {
				continue
			}

			e.handleItemCompletionAsync(job.ID, item.ID, snapshotPromptID)
		}
	}
}

// historyEntryHasOutputImages returns true if the ComfyUI history entry contains
// at least one output with an images array (indicating successful image generation).
func historyEntryHasOutputImages(entry model.HistoryEntry) bool {
	for _, outputData := range entry.Outputs {
		outputMap, ok := outputData.(map[string]interface{})
		if !ok {
			continue
		}
		images, ok := outputMap["images"].([]interface{})
		if ok && len(images) > 0 {
			return true
		}
	}
	return false
}

// resetItemToPendingIfUnchanged resets a stuck running item back to pending status
// so the executor will re-submit it on the next tick — but only if the item has not
// been re-submitted by the executor ticker in the meantime.
//
// This is a compare-and-act under e.mu. recoverStuckItems runs in its own goroutine
// from a stale snapshot taken before its history I/O. During that window the ticker
// (processNextItem) can clear the active slot on disconnect, re-submit this same item
// with a fresh prompt ID, and the item can reconnect. If recovery then blindly reset
// the item, it would orphan the in-flight prompt and cause a duplicate ComfyUI
// submission. To prevent this we re-read the item's *current* state under the lock and
// only reset when:
//   - the item is still in running status, and
//   - its current stored prompt ID equals snapshotPromptID (the value recovery acted
//     on — meaning the ticker has not re-submitted it with a new prompt ID), and
//   - the item is not the currently active in-flight item.
//
// The store read and write are both performed while holding e.mu so the compare and
// the act are atomic with respect to the ticker and the disconnect handler.
func (e *JobExecutor) resetItemToPendingIfUnchanged(jobID, itemID, snapshotPromptID string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	current, found := e.findItemLocked(jobID, itemID)
	if !found {
		e.logger.WithFields(logrus.Fields{
			"item_id": itemID,
			"job_id":  jobID,
		}).Debug("resetItemToPendingIfUnchanged: item no longer present, skipping reset")
		return
	}

	if current.Status != model.SampleJobItemStatusRunning ||
		current.ComfyUIPromptID != snapshotPromptID ||
		e.activeItemID == itemID {
		e.logger.WithFields(logrus.Fields{
			"item_id":            itemID,
			"job_id":             jobID,
			"snapshot_prompt_id": snapshotPromptID,
			"current_prompt_id":  current.ComfyUIPromptID,
			"current_status":     current.Status,
			"active_item_id":     e.activeItemID,
		}).Info("resetItemToPendingIfUnchanged: item changed since snapshot (re-submitted or active), skipping reset")
		return
	}

	e.logger.WithFields(logrus.Fields{
		"item_id": itemID,
		"job_id":  jobID,
	}).Info("resetItemToPendingIfUnchanged: resetting stuck item to pending for retry")

	current.Status = model.SampleJobItemStatusPending
	current.ComfyUIPromptID = ""
	current.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJobItem(current); err != nil {
		e.logger.WithFields(logrus.Fields{
			"item_id": itemID,
			"error":   err.Error(),
		}).Error("resetItemToPendingIfUnchanged: failed to reset item status to pending")
	}
}

// claimRecoveredItem attempts to claim the executor's single active slot for an item
// whose prompt was found already-completed in ComfyUI history during recovery.
//
// It is a compare-and-act under e.mu and returns true only when the claim succeeds.
// The claim is rejected (returns false) when another item is genuinely in-flight, or
// when the item's current stored prompt ID no longer matches snapshotPromptID — which
// means the ticker re-submitted the item with a new prompt ID after the snapshot, so
// the completion recovery would otherwise act on a stale prompt and double-process the
// item. In that case the in-flight submission is left untouched.
func (e *JobExecutor) claimRecoveredItem(jobID, itemID, snapshotPromptID string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.activeItemID != "" {
		e.logger.WithFields(logrus.Fields{
			"job_id":         jobID,
			"item_id":        itemID,
			"active_item_id": e.activeItemID,
		}).Warn("recoverStuckItems: active slot already taken, skipping recovery for this item")
		return false
	}

	current, found := e.findItemLocked(jobID, itemID)
	if !found || current.Status != model.SampleJobItemStatusRunning || current.ComfyUIPromptID != snapshotPromptID {
		e.logger.WithFields(logrus.Fields{
			"job_id":             jobID,
			"item_id":            itemID,
			"snapshot_prompt_id": snapshotPromptID,
			"current_prompt_id":  current.ComfyUIPromptID,
			"current_status":     current.Status,
		}).Info("recoverStuckItems: item changed since snapshot (re-submitted or gone), skipping completion recovery")
		return false
	}

	e.activeJobID = jobID
	e.activeItemID = itemID
	e.activePromptID = snapshotPromptID
	return true
}

// findItemLocked re-reads the current state of a single job item from the store.
// Callers MUST hold e.mu so the read participates in the compare-and-act guarding the
// item against concurrent mutation by the executor ticker and disconnect handler.
func (e *JobExecutor) findItemLocked(jobID, itemID string) (model.SampleJobItem, bool) {
	items, err := e.store.ListSampleJobItems(jobID)
	if err != nil {
		e.logger.WithFields(logrus.Fields{
			"job_id": jobID,
			"error":  err.Error(),
		}).Error("findItemLocked: failed to re-read items")
		return model.SampleJobItem{}, false
	}
	for i := range items {
		if items[i].ID == itemID {
			return items[i], true
		}
	}
	return model.SampleJobItem{}, false
}

// handleDisconnect is called by the WebSocket client when the connection drops.
// It marks the executor as disconnected and clears stale active state so that
// (a) the reconnection ticker will attempt to re-establish the connection, and
// (b) the executor does not stay stuck waiting for WebSocket events that will
// never arrive.
func (e *JobExecutor) handleDisconnect() {
	e.mu.Lock()
	defer e.mu.Unlock()

	if !e.connected {
		return
	}

	e.logger.Warn("ComfyUI WebSocket connection lost, marking as disconnected")
	e.connected = false

	// If an item was in-flight (submitted to ComfyUI, waiting for WS completion event),
	// the event will never arrive. Clear the active prompt/item so the executor can
	// retry on the next tick once reconnected. The job remains tracked (activeJobID is
	// preserved) so the executor will resume from where it left off.
	if e.activeItemID != "" {
		e.logger.WithFields(logrus.Fields{
			"active_job_id":  e.activeJobID,
			"active_item_id": e.activeItemID,
		}).Warn("clearing stale in-flight item due to disconnect")
		e.activeItemID = ""
		e.activePromptID = ""
	}
}

// IsConnected returns whether the executor is currently connected to ComfyUI.
func (e *JobExecutor) IsConnected() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.connected
}

// handleComfyUIEvent processes WebSocket events from ComfyUI.
func (e *JobExecutor) handleComfyUIEvent(event model.ComfyUIEvent) {
	// Log all events at debug level for observability (regardless of active prompt)
	e.logger.WithFields(logrus.Fields{
		"event_type": event.Type,
		"event_data": event.Data,
	}).Debug("ComfyUI WebSocket event received")

	e.mu.Lock()

	// While paused (e.g. during a database reset), discard all events to avoid
	// acting on stale prompt/item IDs that reference rows in the old database.
	if e.paused {
		e.mu.Unlock()
		return
	}

	// Only handle events for the active prompt
	if e.activePromptID == "" {
		e.mu.Unlock()
		return
	}

	// Forward per-node inference progress events to WebSocket clients.
	// ComfyUI sends "progress" events with value/max as sampler steps complete.
	if event.Type == "progress" {
		data := event.Data
		promptID, _ := data["prompt_id"].(string)
		if promptID == "" {
			// Some ComfyUI versions nest prompt_id under a "prompt_id" key,
			// but it may also be absent; use the active prompt ID in that case.
			promptID = e.activePromptID
		}

		value, valueOK := toInt(data["value"])
		max, maxOK := toInt(data["max"])

		if valueOK && maxOK {
			// Compute per-sample ETA from step-based progress while the lock is held.
			// ETA = elapsed * (remaining_steps / completed_steps)
			startTime := e.sampleStartTime
			e.mu.Unlock()

			var sampleETASeconds float64
			if !startTime.IsZero() && value > 0 && max > value {
				elapsed := e.timeNow().Sub(startTime)
				remaining := elapsed * time.Duration(max-value) / time.Duration(value)
				sampleETASeconds = remaining.Seconds()
			}

			progressEvent := model.FSEvent{
				Type: model.EventInferenceProgress,
				Path: fmt.Sprintf("inference_progress/%s", promptID),
				InferenceProgressData: &model.InferenceProgressEventData{
					PromptID:         promptID,
					CurrentValue:     value,
					MaxValue:         max,
					SampleETASeconds: sampleETASeconds,
				},
			}
			e.hub.Broadcast(progressEvent)
			e.logger.WithFields(logrus.Fields{
				"prompt_id":          promptID,
				"value":              value,
				"max":                max,
				"sample_eta_seconds": sampleETASeconds,
			}).Trace("forwarded inference progress event")
			return
		}
		// If value/max are not present, fall through to other handlers
	}

	// Check for execution completion via "executing" event with null node.
	// ComfyUI sends this event for each node that begins executing; when node is
	// null (or absent), it signals that the entire prompt has finished.
	if event.Type == "executing" {
		data := event.Data
		promptID, _ := data["prompt_id"].(string)
		nodeID, ok := data["node"].(string)

		if promptID == e.activePromptID && (!ok || nodeID == "") {
			// Execution completed (node is null when done).
			// Clear activePromptID now (under the lock) to prevent a second completion
			// event (e.g. execution_success) from triggering a duplicate completion.
			capturedJobID := e.activeJobID
			capturedItemID := e.activeItemID
			capturedPromptID := e.activePromptID
			e.activePromptID = ""
			e.mu.Unlock()

			e.logger.WithFields(logrus.Fields{
				"prompt_id": capturedPromptID,
				"trigger":   "executing_null_node",
			}).Info("ComfyUI execution completed")
			e.handleItemCompletionAsync(capturedJobID, capturedItemID, capturedPromptID)
			return
		}
	}

	// Check for execution completion via "execution_success" event.
	// Newer ComfyUI versions (and some configurations) emit this event instead of
	// — or in addition to — the "executing" null-node event when a prompt finishes.
	if event.Type == "execution_success" {
		data := event.Data
		promptID, _ := data["prompt_id"].(string)

		if promptID == e.activePromptID {
			// Clear activePromptID now (under the lock) to prevent a duplicate
			// completion if both "executing" null-node and "execution_success" arrive.
			capturedJobID := e.activeJobID
			capturedItemID := e.activeItemID
			capturedPromptID := e.activePromptID
			e.activePromptID = ""
			e.mu.Unlock()

			e.logger.WithFields(logrus.Fields{
				"prompt_id": capturedPromptID,
				"trigger":   "execution_success",
			}).Info("ComfyUI execution completed")
			e.handleItemCompletionAsync(capturedJobID, capturedItemID, capturedPromptID)
			return
		}
	}

	// Check for errors
	if event.Type == "execution_error" {
		data := event.Data
		promptID, _ := data["prompt_id"].(string)
		if promptID == e.activePromptID {
			// Capture state and release lock before calling failItem
			capturedItemID := e.activeItemID
			e.mu.Unlock()

			// AC: BE: Parse execution_error fields from ComfyUI event
			exceptionMessage, _ := data["exception_message"].(string)
			exceptionType, _ := data["exception_type"].(string)
			nodeType, _ := data["node_type"].(string)

			// Build traceback string from the array
			var traceback string
			if tbArray, ok := data["traceback"].([]interface{}); ok {
				var lines []string
				for _, line := range tbArray {
					if s, ok := line.(string); ok {
						lines = append(lines, s)
					}
				}
				traceback = strings.Join(lines, "")
			}

			// Compose a rich error message from the structured fields
			errMsg := composeExecutionErrorMessage(exceptionType, nodeType, exceptionMessage)

			e.logger.WithFields(logrus.Fields{
				"prompt_id":         promptID,
				"exception_type":    exceptionType,
				"exception_message": exceptionMessage,
				"node_type":         nodeType,
			}).Error("ComfyUI execution error")

			e.failItemWithDetails(capturedItemID, errMsg, exceptionType, nodeType, traceback)
			return
		}
	}

	e.mu.Unlock()
}

// handleItemCompletionAsync processes the completion of a job item without holding the mutex.
// It performs blocking I/O operations and then re-acquires the lock to update active state.
func (e *JobExecutor) handleItemCompletionAsync(jobID, itemID, promptID string) {
	if itemID == "" {
		return
	}

	e.logger.WithField("item_id", itemID).Debug("handling item completion")

	// Fetch the item
	items, err := e.store.ListSampleJobItems(jobID)
	if err != nil {
		e.logger.WithError(err).Error("failed to list job items")
		e.failItem(itemID, "failed to fetch item for completion")
		return
	}

	var item *model.SampleJobItem
	for i := range items {
		if items[i].ID == itemID {
			item = &items[i]
			break
		}
	}

	if item == nil {
		// This can happen during a database reset (e.g. E2E test isolation) when
		// the executor holds a stale item ID from a previous test cycle. The WS
		// completion event arrives after the tables have been dropped and recreated,
		// so the item no longer exists. Log at warn level because this is a known,
		// benign race condition -- not a data integrity error.
		e.logger.WithField("item_id", itemID).Warn("item not found (likely cleared by database reset)")

		// Clear active state so the executor is free to pick up new work.
		e.mu.Lock()
		e.activeItemID = ""
		e.activePromptID = ""
		e.mu.Unlock()
		return
	}

	// Download output image from ComfyUI
	imageData, err := e.downloadOutputImage(promptID)
	if err != nil {
		e.logger.WithError(err).Error("failed to download output image")
		e.failItem(itemID, fmt.Sprintf("failed to download image: %v", err))
		return
	}

	// Fetch the job and study for the output path
	job, err := e.store.GetSampleJob(jobID)
	if err != nil {
		e.logger.WithError(err).Error("failed to fetch job for output path")
		e.failItem(itemID, fmt.Sprintf("failed to fetch job: %v", err))
		return
	}

	// Compute the study output directory prefix for the new per-training-run layout:
	// {sanitized_training_run_name}/{study_name}
	// The training run name is sanitized (slashes replaced with underscores) to ensure
	// it forms a single directory level regardless of whether the name contains path
	// separators (e.g. "qwen/Qwen2-VL" → "qwen_Qwen2-VL"). This scopes samples to both
	// the selected training run and the selected study, fixing the 36/1 count bug where
	// all training runs shared the same study directory.
	//
	// For LoRA jobs, an additional base model directory level is inserted:
	// {sanitized_training_run_name}/{study_name}/{base_model_name}
	// where base_model_name is the filename of the base model without its extension.
	studyOutputDir := fileformat.SanitizeTrainingRunName(job.TrainingRunName) + "/" + job.StudyName
	if job.BaseModel != "" {
		baseModelName := strings.TrimSuffix(filepath.Base(job.BaseModel), filepath.Ext(job.BaseModel))
		studyOutputDir = studyOutputDir + "/" + baseModelName
	}

	// Generate output filename
	filename := e.generateOutputFilename(*item)
	outputPath, err := e.getOutputPath(studyOutputDir, item.CheckpointFilename, filename)
	if err != nil {
		e.logger.WithError(err).Error("invalid output path")
		e.failItem(itemID, fmt.Sprintf("invalid output path: %v", err))
		return
	}

	// Save image to disk
	if err := e.saveImage(outputPath, imageData); err != nil {
		e.logger.WithError(err).Error("failed to save image")
		e.failItem(itemID, fmt.Sprintf("failed to save image: %v", err))
		return
	}

	e.logger.WithField("output_path", outputPath).Info("image saved successfully")

	// Generate thumbnail if enabled (non-fatal if it fails)
	if e.thumbGen != nil {
		if thumbErr := e.thumbGen.GenerateAndSave(outputPath, imageData, e.fsWriter); thumbErr != nil {
			e.logger.WithError(thumbErr).Warn("failed to generate thumbnail, image saved but thumbnail missing")
		}
	}

	// Write sidecar JSON alongside the image (non-fatal if it fails)
	if sidecarErr := e.writeSidecar(outputPath, job, *item); sidecarErr != nil {
		e.logger.WithError(sidecarErr).Warn("failed to write sidecar, image saved but metadata sidecar missing")
	}

	// Update item status to completed
	item.Status = model.SampleJobItemStatusCompleted
	item.OutputPath = outputPath
	item.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJobItem(*item); err != nil {
		if err == sql.ErrNoRows {
			// Item was deleted between image download and status update (job cancelled during E2E teardown).
			// This is the primary benign race condition — log at warn, not error.
			e.logger.WithField("item_id", item.ID).Warn("item row not found during status-to-completed update (job likely cancelled)")
		} else {
			e.logger.WithError(err).Error("failed to update item status to completed")
		}
	}

	// Record sample duration for ETA calculation
	e.mu.Lock()
	if !e.sampleStartTime.IsZero() {
		duration := e.timeNow().Sub(e.sampleStartTime)
		e.sampleTiming.Add(duration)
		e.sampleStartTime = time.Time{}
		e.logger.WithFields(logrus.Fields{
			"item_id":         itemID,
			"sample_duration": duration.String(),
			"moving_avg":      e.sampleTiming.Average().String(),
			"sample_count":    e.sampleTiming.Count(),
		}).Debug("recorded sample duration for ETA")
	}
	e.mu.Unlock()

	// Update job progress
	e.updateJobProgress(jobID)

	// Broadcast progress event to WebSocket clients
	e.broadcastJobProgress(jobID)

	// Clear active state
	e.mu.Lock()
	e.activeItemID = ""
	e.activePromptID = ""
	e.mu.Unlock()
}
