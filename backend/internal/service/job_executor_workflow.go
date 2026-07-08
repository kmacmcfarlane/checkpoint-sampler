package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/buildinfo"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

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
		// For LoRA jobs, the unet_loader receives the base model path from the job;
		// for checkpoint jobs, it receives the per-item ComfyUI model path.
		if job.BaseModel != "" {
			// B-143: job.BaseModel is a curated base_model_dir relative path,
			// which lives in the CheckpointLoaderSimple ckpt_name namespace, NOT
			// the unet_name namespace the UNETLoader node requires. Resolve it to
			// the authoritative unet_name ComfyUI exposes for the same file before
			// submitting, otherwise ComfyUI rejects the prompt with
			// value_not_in_list (HTTP 400).
			unetName, err := e.resolveBaseModelUNET(job.BaseModel)
			if err != nil {
				return fmt.Errorf("resolving base model to ComfyUI unet_name: %w", err)
			}
			inputs["unet_name"] = unetName
		} else {
			inputs["unet_name"] = item.ComfyUIModelPath
		}
	case model.CSRoleLoraLoader:
		// B-141: Validate that lora_name is non-empty before submitting to ComfyUI.
		// An empty LoraModelPath indicates path matching failed during job creation or retry.
		if item.LoraModelPath == "" {
			return fmt.Errorf("lora_name is empty for item %s (checkpoint %s) — path matching likely failed", item.ID, item.CheckpointFilename)
		}
		inputs["lora_name"] = item.LoraModelPath
		inputs["strength_model"] = item.StrengthModel
		inputs["strength_clip"] = item.StrengthClip
	case model.CSRoleCLIPLoader:
		// S-157: prefer the per-item text encoder (multi-value dimension); fall
		// back to the job-level value for backward compatibility.
		clip := item.TextEncoder
		if clip == "" {
			clip = job.CLIP
		}
		if clip != "" {
			inputs["clip_name"] = clip
		}
	case model.CSRoleVAELoader:
		// S-157: prefer the per-item VAE (multi-value dimension); fall back to the
		// job-level value for backward compatibility.
		vae := item.VAE
		if vae == "" {
			vae = job.VAE
		}
		if vae != "" {
			inputs["vae_name"] = vae
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
		// Inject negative prompt text when present; keep node default otherwise
		if item.NegativePrompt != "" {
			inputs["text"] = item.NegativePrompt
		}
	case model.CSRoleShift:
		// S-157: prefer the per-item shift (multi-value dimension); fall back to
		// the job-level value. This case only runs when the workflow declares the
		// shift role, so a workflow without a shift role never substitutes shift.
		shift := item.Shift
		if shift == nil {
			shift = job.Shift
		}
		if shift != nil {
			inputs["shift"] = *shift
		}
	case model.CSRoleLatentImage:
		inputs["width"] = item.Width
		inputs["height"] = item.Height
		inputs["batch_size"] = 1
	case model.CSRoleSaveImage:
		// Generate a prefix for the output filename, accounting for base model in LoRA jobs
		prefix := e.generateFilenamePrefixForJob(job, item)
		inputs["filename_prefix"] = prefix
	default:
		e.logger.WithFields(logrus.Fields{
			"node_id": nodeID,
			"role":    role,
		}).Debug("unknown cs_role, skipping substitution")
	}

	return nil
}

// resolveBaseModelUNET translates a curated base_model_dir relative path into
// the authoritative ComfyUI unet_name by matching it against the live
// UNETLoader (unet_name) list. When no models provider is configured, the raw
// base model is returned unchanged (legacy behavior).
func (e *JobExecutor) resolveBaseModelUNET(baseModel string) (string, error) {
	e.logger.WithField("base_model", baseModel).Trace("entering resolveBaseModelUNET")
	defer e.logger.Trace("returning from resolveBaseModelUNET")

	if e.baseModelMatcher == nil {
		e.logger.WithField("base_model", baseModel).Debug("no base model matcher configured, submitting raw base model path")
		return baseModel, nil
	}

	unetNames, err := e.baseModelMatcher.GetModels(e.ctx, ComfyUIModelTypeUNET)
	if err != nil {
		e.logger.WithFields(logrus.Fields{
			"base_model": baseModel,
			"error":      err.Error(),
		}).Error("failed to query ComfyUI for UNET models")
		return "", fmt.Errorf("querying ComfyUI UNET models: %w", err)
	}

	unetName, err := resolveBaseModelUNETName(baseModel, unetNames)
	if err != nil {
		e.logger.WithFields(logrus.Fields{
			"base_model": baseModel,
			"unet_count": len(unetNames),
			"error":      err.Error(),
		}).Error("failed to resolve base model to ComfyUI unet_name")
		return "", err
	}
	e.logger.WithFields(logrus.Fields{
		"base_model": baseModel,
		"unet_name":  unetName,
	}).Debug("resolved base model to ComfyUI unet_name")
	return unetName, nil
}

// generateFilenamePrefixForJob generates a prefix for ComfyUI's save_image node.
// For LoRA jobs (where job.BaseModel is set), the base model name is embedded
// in the prefix so ComfyUI output files are scoped to the base model.
func (e *JobExecutor) generateFilenamePrefixForJob(job model.SampleJob, item model.SampleJobItem) string {
	checkpointBase := strings.TrimSuffix(item.CheckpointFilename, filepath.Ext(item.CheckpointFilename))
	if job.BaseModel != "" {
		baseModelName := strings.TrimSuffix(filepath.Base(job.BaseModel), filepath.Ext(job.BaseModel))
		return fmt.Sprintf("sample_%s_%s", baseModelName, checkpointBase)
	}
	return fmt.Sprintf("sample_%s", checkpointBase)
}

// generateOutputFilename generates the query-encoded output filename.
// Delegates to the shared GenerateOutputFilenameWithDims function. The dims
// select which S-157 swept dimensions are encoded so the executor produces the
// exact filename the job-creation missing-only check expects.
func (e *JobExecutor) generateOutputFilename(item model.SampleJobItem, dims FilenameDimensions) string {
	return GenerateOutputFilenameWithDims(item, dims)
}

// filenameDimsForJob loads the study for the given job and returns which
// promoted dimensions it sweeps. On error it returns the zero value (no extra
// dimensions encoded), matching legacy behavior.
func (e *JobExecutor) filenameDimsForJob(job model.SampleJob) FilenameDimensions {
	study, err := e.store.GetStudy(job.StudyID)
	if err != nil {
		e.logger.WithFields(logrus.Fields{
			"study_id": job.StudyID,
			"error":    err.Error(),
		}).Warn("failed to fetch study for filename dimensions, using none")
		return FilenameDimensions{}
	}
	return filenameDimensionsForStudy(study)
}

// getOutputPath constructs the full output path for an image.
// The path is: {sampleDir}/{studyOutputDir}/{checkpointFilename}/{filename}
// where studyOutputDir is typically "{sanitizedRunName}/{studyName}" and
// checkpointFilename is the bare filename (no directory components).
// Returns an error if the path would escape the sample directory (path traversal protection).
func (e *JobExecutor) getOutputPath(studyOutputDir string, checkpointFilename string, filename string) (string, error) {
	// B-115 fix: strip any directory components from the checkpoint filename.
	// Discovery sets Filename = path.Base(relPath), but defensive coding ensures
	// that even if a relative path leaks through, only the basename is used as
	// the per-checkpoint subdirectory name.
	checkpointDir := filepath.Join(e.sampleDir, studyOutputDir, filepath.Base(checkpointFilename))
	outputPath := filepath.Join(checkpointDir, filename)

	// Path traversal protection: use separator-bounded prefix check so that a
	// sibling directory (e.g. /data/samples-evil) cannot pass the check by
	// sharing a bare string prefix with /data/samples.  Mirror the pattern used
	// by the READ-path checks in images_service.go and image_metadata.go.
	cleanPath := filepath.Clean(outputPath)
	cleanSampleDir := filepath.Clean(e.sampleDir)
	if cleanPath != cleanSampleDir && !strings.HasPrefix(cleanPath, cleanSampleDir+string(filepath.Separator)) {
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

	// Look up the prompt_prefix from the study (best-effort; empty on error)
	var promptPrefix string
	if study, err := e.store.GetStudy(job.StudyID); err == nil {
		promptPrefix = study.PromptPrefix
	} else {
		e.logger.WithFields(logrus.Fields{
			"study_id": job.StudyID,
			"error":    err.Error(),
		}).Warn("failed to fetch study for sidecar prompt_prefix, continuing without it")
	}

	meta := fileformat.SidecarMetadata{
		Checkpoint:     item.CheckpointFilename,
		PromptPrefix:   promptPrefix,
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
		VAE:            sidecarVAE(item, job),
		CLIP:           sidecarCLIP(item, job),
		Shift:          sidecarShift(item, job),
		WorkflowName:   job.WorkflowName,
		JobID:          job.ID,
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		CommitSHA:      buildinfo.CommitSHA,
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

// sidecarVAE returns the VAE recorded in an image's sidecar: the per-item value
// (S-157 multi-value dimension) when present, else the job-level value.
func sidecarVAE(item model.SampleJobItem, job model.SampleJob) string {
	if item.VAE != "" {
		return item.VAE
	}
	return job.VAE
}

// sidecarCLIP returns the text encoder recorded in an image's sidecar.
func sidecarCLIP(item model.SampleJobItem, job model.SampleJob) string {
	if item.TextEncoder != "" {
		return item.TextEncoder
	}
	return job.CLIP
}

// sidecarShift returns the shift recorded in an image's sidecar.
func sidecarShift(item model.SampleJobItem, job model.SampleJob) *float64 {
	if item.Shift != nil {
		return item.Shift
	}
	return job.Shift
}

// writeManifest writes a JSON manifest file to the study version directory.
// It captures the complete study configuration and job parameters that produced
// the samples. The manifest is written atomically (temp file + rename).
//
// AC1: Each generation job outputs a JSON manifest file containing all job params.
func (e *JobExecutor) writeManifest(job model.SampleJob, items []model.SampleJobItem) error {
	e.logger.WithField("job_id", job.ID).Trace("entering writeManifest")
	defer e.logger.Trace("returning from writeManifest")

	// Fetch the study for the full config snapshot
	study, err := e.store.GetStudy(job.StudyID)
	if err != nil {
		return fmt.Errorf("fetching study for manifest: %w", err)
	}

	// Extract unique checkpoint filenames from the job items (preserving order)
	seen := make(map[string]struct{})
	var checkpoints []string
	for _, item := range items {
		if _, ok := seen[item.CheckpointFilename]; !ok {
			seen[item.CheckpointFilename] = struct{}{}
			checkpoints = append(checkpoints, item.CheckpointFilename)
		}
	}

	// Build the manifest
	manifest := fileformat.NewJobManifest(job, study, checkpoints)

	data, err := fileformat.MarshalManifest(manifest)
	if err != nil {
		return fmt.Errorf("marshaling manifest: %w", err)
	}

	// Write to study output directory: {sampleDir}/{sanitized_training_run_name}/{study_name}/manifest.json
	// The training run name is sanitized (slashes → underscores) to ensure a single directory
	// level. This matches the per-training-run layout used for sample images.
	studyOutputDir := fileformat.SanitizeTrainingRunName(job.TrainingRunName) + "/" + job.StudyName
	dir := filepath.Join(e.sampleDir, studyOutputDir)
	manifestPath := filepath.Join(dir, fileformat.ManifestFilename)
	tempPath := manifestPath + ".tmp"

	// Ensure directory exists
	if err := e.ensureDir(dir); err != nil {
		return fmt.Errorf("ensuring manifest directory: %w", err)
	}

	// Write to temp file first
	if err := e.fsWriter.WriteFile(tempPath, data, 0644); err != nil {
		return fmt.Errorf("writing manifest temp file: %w", err)
	}

	// Atomically rename temp file to final destination
	if err := e.fsWriter.RenameFile(tempPath, manifestPath); err != nil {
		return fmt.Errorf("renaming manifest file: %w", err)
	}

	e.logger.WithFields(logrus.Fields{
		"job_id":        job.ID,
		"manifest_path": manifestPath,
	}).Info("manifest file written")
	return nil
}

// ensureDir creates a directory if it doesn't exist.
// If a regular file exists at the path, it is removed first to allow
// directory creation (B-115: handles stale files from old layouts or
// checkpoint files that collide with expected directory names).
func (e *JobExecutor) ensureDir(path string) error {
	info, err := e.fsWriter.Stat(path)
	if err == nil {
		if info.IsDir() {
			return nil
		}
		// A regular file exists where we need a directory. Remove it so
		// MkdirAll can create the directory tree.
		e.logger.WithField("path", path).Warn("removing regular file that conflicts with expected directory")
		if removeErr := os.Remove(path); removeErr != nil {
			return fmt.Errorf("removing conflicting file at %s: %w", path, removeErr)
		}
	}
	return e.fsWriter.MkdirAll(path, 0755)
}
