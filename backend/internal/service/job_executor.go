package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// JobExecutorStore defines the persistence operations the job executor needs.
type JobExecutorStore interface {
	GetSampleJob(id string) (model.SampleJob, error)
	UpdateSampleJob(j model.SampleJob) error
	ListSampleJobItems(jobID string) ([]model.SampleJobItem, error)
	UpdateSampleJobItem(i model.SampleJobItem) error
	ListSampleJobs() ([]model.SampleJob, error)
}

// ComfyUIClient defines the interface for ComfyUI HTTP operations.
type ComfyUIClient interface {
	SubmitPrompt(ctx context.Context, req model.PromptRequest) (*model.PromptResponse, error)
	GetHistory(ctx context.Context, promptID string) (model.HistoryResponse, error)
	DownloadImage(ctx context.Context, filename string, subfolder string, folderType string) ([]byte, error)
	CancelPrompt(ctx context.Context, promptID string) error
}

// ComfyUIWS defines the interface for ComfyUI WebSocket operations.
type ComfyUIWS interface {
	AddHandler(handler model.ComfyUIEventHandler)
	Connect(ctx context.Context) error
	Close() error
}

// WorkflowLoaderService defines the interface for loading workflow templates.
type WorkflowLoaderService interface {
	Get(ctx context.Context, name string) (model.WorkflowTemplate, error)
}

// EventHub defines the interface for broadcasting events to clients.
type EventHub interface {
	Broadcast(event model.FSEvent)
}

// JobExecutor executes sample jobs in the background.
type JobExecutor struct {
	store          JobExecutorStore
	comfyuiClient  ComfyUIClient
	comfyuiWS      ComfyUIWS
	workflowLoader WorkflowLoaderService
	hub            EventHub
	sampleDir      string
	fsWriter       FileSystemWriter
	logger         *logrus.Entry

	mu               sync.Mutex
	activeJobID      string
	activeItemID     string
	activePromptID   string
	stopRequested    bool
	connected        bool
	ctx              context.Context
	cancel           context.CancelFunc
	shutdownCh       chan struct{}
	shutdownComplete chan struct{}
	started          bool
}

// NewJobExecutor creates a new job executor.
func NewJobExecutor(
	store JobExecutorStore,
	comfyuiClient ComfyUIClient,
	comfyuiWS ComfyUIWS,
	workflowLoader WorkflowLoaderService,
	hub EventHub,
	sampleDir string,
	fsWriter FileSystemWriter,
	logger *logrus.Logger,
) *JobExecutor {
	ctx, cancel := context.WithCancel(context.Background())
	return &JobExecutor{
		store:            store,
		comfyuiClient:    comfyuiClient,
		comfyuiWS:        comfyuiWS,
		workflowLoader:   workflowLoader,
		hub:              hub,
		sampleDir:        sampleDir,
		fsWriter:         fsWriter,
		logger:           logger.WithField("component", "job_executor"),
		ctx:              ctx,
		cancel:           cancel,
		shutdownCh:       make(chan struct{}),
		shutdownComplete: make(chan struct{}),
	}
}

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

	// Register WebSocket event handler (must be done before connection attempts)
	e.comfyuiWS.AddHandler(e.handleComfyUIEvent)

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

// tryConnect attempts to connect to ComfyUI WebSocket and updates the connected state.
func (e *JobExecutor) tryConnect() error {
	e.logger.Debug("attempting to connect to ComfyUI WebSocket")
	if err := e.comfyuiWS.Connect(e.ctx); err != nil {
		e.mu.Lock()
		e.connected = false
		e.mu.Unlock()
		return err
	}

	e.mu.Lock()
	e.connected = true
	e.mu.Unlock()
	e.logger.Info("ComfyUI WebSocket connected")
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

// resumeRunningJobs logs any jobs in 'running' state on startup.
// The executor loop will automatically pick them up.
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

	runningCount := 0
	for _, job := range jobs {
		if job.Status == model.SampleJobStatusRunning {
			runningCount++
			if isConnected {
				e.logger.WithField("job_id", job.ID).Info("found running job to resume")
			} else {
				e.logger.WithField("job_id", job.ID).Warn("found running job to resume but ComfyUI connection not available")
			}
		}
	}

	if runningCount > 0 {
		if isConnected {
			e.logger.WithField("count", runningCount).Info("will resume running jobs")
		} else {
			e.logger.WithField("count", runningCount).Warn("will resume running jobs once ComfyUI connection is established")
		}
	}

	return nil
}

// autoStartJob transitions a pending job to running status.
// It performs blocking I/O (a store write) without holding the mutex.
// Returns an error if the transition fails; on success the job's Status field is updated in place.
func (e *JobExecutor) autoStartJob(job *model.SampleJob) error {
	e.logger.WithField("job_id", job.ID).Info("auto-starting pending job")
	job.Status = model.SampleJobStatusRunning
	job.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJob(*job); err != nil {
		e.logger.WithFields(logrus.Fields{
			"job_id": job.ID,
			"error":  err.Error(),
		}).Error("failed to auto-start pending job")
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

	reconnectTicker := time.NewTicker(10 * time.Second)
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
func (e *JobExecutor) processNextItem() {
	e.mu.Lock()

	// If stop was requested, don't start new items
	if e.stopRequested {
		e.mu.Unlock()
		e.logger.Debug("stop requested, skipping item processing")
		return
	}

	// If not connected to ComfyUI, skip processing
	if !e.connected {
		e.mu.Unlock()
		return
	}

	// Find a running job (or auto-start the first pending job)
	jobs, err := e.store.ListSampleJobs()
	if err != nil {
		e.mu.Unlock()
		e.logger.WithError(err).Error("failed to list jobs")
		return
	}

	var runningJob *model.SampleJob
	for i := range jobs {
		if jobs[i].Status == model.SampleJobStatusRunning {
			runningJob = &jobs[i]
			break
		}
	}

	// AC: No explicit Start API call required — auto-start the first pending job
	if runningJob == nil {
		// Look for a pending job to auto-start (note: ListSampleJobs returns newest-first; FIFO ordering improvement tracked in agent/ideas/enhancements.md)
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

	// Already processing an item for this job
	if e.activeJobID == runningJob.ID && e.activeItemID != "" {
		e.mu.Unlock()
		return
	}

	// Find the next pending item
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

	if nextItem == nil {
		// No more pending items, mark job as completed
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

	// Process the item (this does blocking I/O)
	e.processItem(*runningJob, *nextItem)
}

// processItem processes a single work item.
func (e *JobExecutor) processItem(job model.SampleJob, item model.SampleJobItem) {
	e.logger.WithFields(logrus.Fields{
		"job_id":              job.ID,
		"item_id":             item.ID,
		"checkpoint_filename": item.CheckpointFilename,
	}).Info("processing job item")

	// Update item status to running
	item.Status = model.SampleJobItemStatusRunning
	item.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJobItem(item); err != nil {
		e.logger.WithError(err).Error("failed to update item status to running")
		e.failItem(item.ID, "failed to update item status")
		return
	}

	// Load workflow template
	workflow, err := e.workflowLoader.Get(e.ctx, job.WorkflowName)
	if err != nil {
		e.logger.WithError(err).Error("failed to load workflow template")
		e.failItem(item.ID, fmt.Sprintf("failed to load workflow: %v", err))
		return
	}

	// Clone and substitute workflow
	substituted, err := e.substituteWorkflow(workflow, job, item)
	if err != nil {
		e.logger.WithError(err).Error("failed to substitute workflow")
		e.failItem(item.ID, fmt.Sprintf("workflow substitution failed: %v", err))
		return
	}

	// Submit to ComfyUI
	promptReq := model.PromptRequest{
		Prompt: substituted,
	}
	promptResp, err := e.comfyuiClient.SubmitPrompt(e.ctx, promptReq)
	if err != nil {
		e.logger.WithError(err).Error("failed to submit prompt to ComfyUI")
		// Check if this is a connection error and mark as disconnected to trigger reconnect
		if isConnectionError(err) {
			e.logger.Warn("detected ComfyUI connection error, marking as disconnected")
			e.mu.Lock()
			e.connected = false
			e.mu.Unlock()
		}
		e.failItem(item.ID, fmt.Sprintf("ComfyUI prompt submission failed: %v", err))
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
		e.logger.WithError(err).Error("failed to update item with prompt ID")
	}

	// Monitoring is handled via WebSocket events in handleComfyUIEvent
}

// handleComfyUIEvent processes WebSocket events from ComfyUI.
func (e *JobExecutor) handleComfyUIEvent(event model.ComfyUIEvent) {
	e.mu.Lock()

	// Only handle events for the active prompt
	if e.activePromptID == "" {
		e.mu.Unlock()
		return
	}

	// Check for execution completion
	if event.Type == "executing" {
		data := event.Data
		promptID, _ := data["prompt_id"].(string)
		nodeID, ok := data["node"].(string)

		if promptID == e.activePromptID && (!ok || nodeID == "") {
			// Execution completed (node is null when done)
			// Capture state and release lock before blocking I/O
			capturedJobID := e.activeJobID
			capturedItemID := e.activeItemID
			capturedPromptID := e.activePromptID
			e.mu.Unlock()

			e.logger.WithField("prompt_id", capturedPromptID).Info("ComfyUI execution completed")
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

			e.logger.WithField("prompt_id", promptID).Error("ComfyUI execution error")
			e.failItem(capturedItemID, "ComfyUI execution error")
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
		e.logger.WithField("item_id", itemID).Error("item not found")
		return
	}

	// Download output image from ComfyUI
	imageData, err := e.downloadOutputImage(promptID)
	if err != nil {
		e.logger.WithError(err).Error("failed to download output image")
		e.failItem(itemID, fmt.Sprintf("failed to download image: %v", err))
		return
	}

	// Generate output filename
	filename := e.generateOutputFilename(*item)
	outputPath, err := e.getOutputPath(item.CheckpointFilename, filename)
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

	// Fetch the job to get job-level metadata for the sidecar
	job, err := e.store.GetSampleJob(jobID)
	if err != nil {
		e.logger.WithError(err).Warn("failed to fetch job for sidecar metadata, continuing without sidecar")
	} else {
		// Write sidecar JSON alongside the image (non-fatal if it fails)
		if sidecarErr := e.writeSidecar(outputPath, job, *item); sidecarErr != nil {
			e.logger.WithError(sidecarErr).Warn("failed to write sidecar, image saved but metadata sidecar missing")
		}
	}

	// Update item status to completed
	item.Status = model.SampleJobItemStatusCompleted
	item.OutputPath = outputPath
	item.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJobItem(*item); err != nil {
		e.logger.WithError(err).Error("failed to update item status to completed")
	}

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

// substituteWorkflow clones a workflow and substitutes tagged node values.
func (e *JobExecutor) substituteWorkflow(template model.WorkflowTemplate, job model.SampleJob, item model.SampleJobItem) (map[string]interface{}, error) {
	e.logger.Trace("entering substituteWorkflow")
	defer e.logger.Trace("returning from substituteWorkflow")

	// Deep clone the workflow
	cloned, err := deepCloneWorkflow(template.Workflow)
	if err != nil {
		return nil, fmt.Errorf("cloning workflow: %w", err)
	}

	// Substitute values for each cs_role
	for role, nodeIDs := range template.Roles {
		for _, nodeID := range nodeIDs {
			if err := e.substituteNode(cloned, nodeID, role, job, item); err != nil {
				return nil, fmt.Errorf("substituting node %s (role %s): %w", nodeID, role, err)
			}
		}
	}

	return cloned, nil
}

// substituteNode substitutes values in a workflow node based on its cs_role.
func (e *JobExecutor) substituteNode(workflow map[string]interface{}, nodeID string, role string, job model.SampleJob, item model.SampleJobItem) error {
	node, ok := workflow[nodeID].(map[string]interface{})
	if !ok {
		return fmt.Errorf("node %s is not a map", nodeID)
	}

	inputs, ok := node["inputs"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("node %s has no inputs", nodeID)
	}

	switch model.CSRole(role) {
	case model.CSRoleUNETLoader:
		inputs["unet_name"] = item.ComfyUIModelPath
	case model.CSRoleCLIPLoader:
		if job.CLIP != "" {
			inputs["clip_name"] = job.CLIP
		}
	case model.CSRoleVAELoader:
		if job.VAE != "" {
			inputs["vae_name"] = job.VAE
		}
	case model.CSRoleSampler:
		inputs["seed"] = item.Seed
		inputs["steps"] = item.Steps
		inputs["cfg"] = item.CFG
		inputs["sampler_name"] = item.SamplerName
		inputs["scheduler"] = item.Scheduler
	case model.CSRolePositivePrompt:
		inputs["text"] = item.PromptText
	case model.CSRoleNegativePrompt:
		// Keep default or set empty
		if _, exists := inputs["text"]; !exists {
			inputs["text"] = ""
		}
	case model.CSRoleShift:
		if job.Shift != nil {
			inputs["shift"] = *job.Shift
		}
	case model.CSRoleLatentImage:
		inputs["width"] = item.Width
		inputs["height"] = item.Height
		inputs["batch_size"] = 1
	case model.CSRoleSaveImage:
		// Generate a prefix for the output filename
		prefix := e.generateFilenamePrefix(item)
		inputs["filename_prefix"] = prefix
	default:
		e.logger.WithFields(logrus.Fields{
			"node_id": nodeID,
			"role":    role,
		}).Debug("unknown cs_role, skipping substitution")
	}

	return nil
}

// generateFilenamePrefix generates a prefix for ComfyUI's save_image node.
func (e *JobExecutor) generateFilenamePrefix(item model.SampleJobItem) string {
	// Use a simple prefix that includes the checkpoint filename
	// ComfyUI will append a counter and timestamp
	checkpointBase := strings.TrimSuffix(item.CheckpointFilename, filepath.Ext(item.CheckpointFilename))
	return fmt.Sprintf("sample_%s", checkpointBase)
}

// generateOutputFilename generates the query-encoded output filename.
func (e *JobExecutor) generateOutputFilename(item model.SampleJobItem) string {
	// Query-encoded filename includes: prompt_name, steps, cfg, sampler_name, scheduler, seed
	params := url.Values{}
	params.Set("prompt", item.PromptName)
	params.Set("steps", fmt.Sprintf("%d", item.Steps))
	params.Set("cfg", fmt.Sprintf("%.1f", item.CFG))
	params.Set("sampler", item.SamplerName)
	params.Set("scheduler", item.Scheduler)
	params.Set("seed", fmt.Sprintf("%d", item.Seed))

	encoded := params.Encode()
	return fmt.Sprintf("%s.png", encoded)
}

// getOutputPath constructs the full output path for an image.
// Returns an error if the path would escape the sample directory (path traversal protection).
func (e *JobExecutor) getOutputPath(checkpointFilename string, filename string) (string, error) {
	checkpointDir := filepath.Join(e.sampleDir, checkpointFilename)
	outputPath := filepath.Join(checkpointDir, filename)

	// Path traversal protection
	cleanPath := filepath.Clean(outputPath)
	cleanSampleDir := filepath.Clean(e.sampleDir)
	if !strings.HasPrefix(cleanPath, cleanSampleDir) {
		return "", fmt.Errorf("path traversal detected: %s", cleanPath)
	}

	return outputPath, nil
}

// downloadOutputImage downloads the generated image from ComfyUI.
func (e *JobExecutor) downloadOutputImage(promptID string) ([]byte, error) {
	e.logger.WithField("prompt_id", promptID).Trace("entering downloadOutputImage")
	defer e.logger.Trace("returning from downloadOutputImage")

	// Fetch history to find the output filename
	history, err := e.comfyuiClient.GetHistory(e.ctx, promptID)
	if err != nil {
		e.logger.WithError(err).Error("failed to get history from ComfyUI")
		return nil, fmt.Errorf("getting history: %w", err)
	}

	entry, ok := history[promptID]
	if !ok {
		return nil, fmt.Errorf("prompt %s not found in history", promptID)
	}

	// Find the save_image output
	var filename, subfolder, folderType string
	for _, outputData := range entry.Outputs {
		outputMap, ok := outputData.(map[string]interface{})
		if !ok {
			continue
		}
		images, ok := outputMap["images"].([]interface{})
		if !ok || len(images) == 0 {
			continue
		}
		imageInfo, ok := images[0].(map[string]interface{})
		if !ok {
			continue
		}
		if fname, ok := imageInfo["filename"].(string); ok {
			filename = fname
		}
		if sf, ok := imageInfo["subfolder"].(string); ok {
			subfolder = sf
		}
		if ft, ok := imageInfo["type"].(string); ok {
			folderType = ft
		}
		if filename != "" {
			break
		}
	}

	if filename == "" {
		return nil, fmt.Errorf("no output image found in history for prompt %s", promptID)
	}

	e.logger.WithFields(logrus.Fields{
		"filename":    filename,
		"subfolder":   subfolder,
		"folder_type": folderType,
	}).Debug("downloading image from ComfyUI")

	return e.comfyuiClient.DownloadImage(e.ctx, filename, subfolder, folderType)
}

// saveImage saves image data to disk.
func (e *JobExecutor) saveImage(path string, data []byte) error {
	e.logger.WithField("path", path).Trace("entering saveImage")
	defer e.logger.Trace("returning from saveImage")

	// Ensure the directory exists
	dir := filepath.Dir(path)
	if err := e.ensureDir(dir); err != nil {
		return fmt.Errorf("ensuring directory: %w", err)
	}

	// Write the file
	if err := e.fsWriter.WriteFile(path, data, 0644); err != nil {
		e.logger.WithError(err).Error("failed to write image file")
		return fmt.Errorf("writing file: %w", err)
	}

	e.logger.WithField("path", path).Info("image file written")
	return nil
}

// writeSidecar writes a JSON sidecar file alongside the image at imagePath.
// The sidecar file has the same base name as the image but with a .json extension.
// The write is atomic: data is written to a temp file in the same directory, then
// renamed over the final destination.
func (e *JobExecutor) writeSidecar(imagePath string, job model.SampleJob, item model.SampleJobItem) error {
	e.logger.WithField("image_path", imagePath).Trace("entering writeSidecar")
	defer e.logger.Trace("returning from writeSidecar")

	// Derive sidecar path from image path
	ext := filepath.Ext(imagePath)
	sidecarPath := imagePath[:len(imagePath)-len(ext)] + ".json"
	dir := filepath.Dir(imagePath)
	tempPath := sidecarPath + ".tmp"

	meta := fileformat.SidecarMetadata{
		Checkpoint:     item.CheckpointFilename,
		PromptName:     item.PromptName,
		PromptText:     item.PromptText,
		Seed:           item.Seed,
		CFG:            item.CFG,
		Steps:          item.Steps,
		SamplerName:    item.SamplerName,
		Scheduler:      item.Scheduler,
		Width:          item.Width,
		Height:         item.Height,
		NegativePrompt: item.NegativePrompt,
		VAE:            job.VAE,
		CLIP:           job.CLIP,
		Shift:          job.Shift,
		WorkflowName:   job.WorkflowName,
		JobID:          job.ID,
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
	}

	data, err := json.Marshal(meta)
	if err != nil {
		return fmt.Errorf("marshaling sidecar metadata: %w", err)
	}

	// Ensure directory exists (should already exist from saveImage, but be safe)
	if err := e.ensureDir(dir); err != nil {
		return fmt.Errorf("ensuring sidecar directory: %w", err)
	}

	// Write to temp file first
	if err := e.fsWriter.WriteFile(tempPath, data, 0644); err != nil {
		e.logger.WithError(err).Error("failed to write sidecar temp file")
		return fmt.Errorf("writing sidecar temp file: %w", err)
	}

	// Atomically rename temp file to final destination
	if err := e.fsWriter.RenameFile(tempPath, sidecarPath); err != nil {
		e.logger.WithError(err).Error("failed to rename sidecar temp file")
		return fmt.Errorf("renaming sidecar file: %w", err)
	}

	e.logger.WithField("sidecar_path", sidecarPath).Info("sidecar file written")
	return nil
}

// ensureDir creates a directory if it doesn't exist.
func (e *JobExecutor) ensureDir(path string) error {
	info, err := e.fsWriter.Stat(path)
	if err == nil && info.IsDir() {
		return nil
	}
	return e.fsWriter.MkdirAll(path, 0755)
}

// failItem marks an item as failed with an error message (called without holding mutex).
// It performs blocking I/O and then re-acquires the lock to clear active state.
func (e *JobExecutor) failItem(itemID string, errorMsg string) {
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
			items[i].UpdatedAt = time.Now().UTC()
			if err := e.store.UpdateSampleJobItem(items[i]); err != nil {
				e.logger.WithError(err).Error("failed to update item status to failed")
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
func (e *JobExecutor) updateJobProgress(jobID string) {
	job, err := e.store.GetSampleJob(jobID)
	if err != nil {
		e.logger.WithError(err).Error("failed to get job for progress update")
		return
	}

	items, err := e.store.ListSampleJobItems(jobID)
	if err != nil {
		e.logger.WithError(err).Error("failed to list items for progress update")
		return
	}

	completed := 0
	for _, item := range items {
		if item.Status == model.SampleJobItemStatusCompleted {
			completed++
		}
	}

	job.CompletedItems = completed
	job.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJob(job); err != nil {
		e.logger.WithError(err).Error("failed to update job progress")
	}

	e.logger.WithFields(logrus.Fields{
		"job_id":          jobID,
		"completed_items": completed,
		"total_items":     job.TotalItems,
	}).Debug("job progress updated")
}

// completeJob marks a job as completed when all items are done.
func (e *JobExecutor) completeJob(jobID string) {
	e.logger.WithField("job_id", jobID).Info("completing job")

	job, err := e.store.GetSampleJob(jobID)
	if err != nil {
		e.logger.WithError(err).Error("failed to get job for completion")
		return
	}

	job.Status = model.SampleJobStatusCompleted
	job.UpdatedAt = time.Now().UTC()
	if err := e.store.UpdateSampleJob(job); err != nil {
		e.logger.WithError(err).Error("failed to mark job as completed")
		return
	}

	// Broadcast completion event
	e.broadcastJobProgress(jobID)

	// Clear active state
	e.mu.Lock()
	e.activeJobID = ""
	e.activeItemID = ""
	e.activePromptID = ""
	e.mu.Unlock()

	e.logger.WithField("job_id", jobID).Info("job completed successfully")
}

// broadcastJobProgress broadcasts a job progress event to WebSocket clients.
func (e *JobExecutor) broadcastJobProgress(jobID string) {
	// Broadcast a filesystem event to trigger frontend refresh
	// We use the job ID as the path
	event := model.FSEvent{
		Type: model.EventImageAdded,
		Path: fmt.Sprintf("job_progress/%s", jobID),
	}
	e.hub.Broadcast(event)
	e.logger.WithField("job_id", jobID).Debug("broadcasted job progress event")
}

// RequestStop requests the executor to stop after the current item completes.
// If there is an active ComfyUI prompt, it will be canceled.
func (e *JobExecutor) RequestStop(jobID string) error {
	e.mu.Lock()

	e.logger.WithField("job_id", jobID).Info("stop requested for job")

	if e.activeJobID != jobID {
		e.mu.Unlock()
		return fmt.Errorf("job %s is not currently running", jobID)
	}

	e.stopRequested = true

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

	return nil
}

// RequestResume clears the stop flag and allows processing to continue.
func (e *JobExecutor) RequestResume(jobID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.logger.WithField("job_id", jobID).Info("resume requested for job")

	if e.activeJobID != jobID {
		return fmt.Errorf("job %s is not currently active", jobID)
	}

	e.stopRequested = false
	return nil
}

// IsConnected returns whether the executor is currently connected to ComfyUI.
func (e *JobExecutor) IsConnected() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.connected
}

// deepCloneWorkflow performs a deep clone of a workflow map.
func deepCloneWorkflow(workflow map[string]interface{}) (map[string]interface{}, error) {
	data, err := json.Marshal(workflow)
	if err != nil {
		return nil, fmt.Errorf("marshaling workflow for cloning: %w", err)
	}
	var cloned map[string]interface{}
	if err := json.Unmarshal(data, &cloned); err != nil {
		return nil, fmt.Errorf("unmarshaling cloned workflow: %w", err)
	}
	return cloned, nil
}

// isConnectionError detects if an error is a connection-related failure.
func isConnectionError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "eof") ||
		strings.Contains(msg, "broken pipe") ||
		strings.Contains(msg, "network") ||
		strings.Contains(msg, "dial") ||
		strings.Contains(msg, "timeout")
}
