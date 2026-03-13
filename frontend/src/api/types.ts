/** Error shape returned by the backend API (Goa error format). */
export interface ApiErrorResponse {
  name: string
  message: string
  id: string
  temporary: boolean
  timeout: boolean
  fault: boolean
}

/** Normalized error used throughout the frontend. */
export interface ApiError {
  code: string
  message: string
}

/** Health check response. */
export interface HealthStatus {
  status: string
}

/** A checkpoint file within a training run. */
export interface CheckpointInfo {
  filename: string
  step_number: number
  has_samples: boolean
}

/** An auto-discovered training run. */
export interface TrainingRun {
  id: number
  name: string
  checkpoint_count: number
  has_samples: boolean
  checkpoints: CheckpointInfo[]
  /** Top-level sample directory name (viewer source only). */
  training_run_dir?: string
  /** Study directory name (viewer source only). */
  study_label?: string
  /** Full study output directory prefix for scan/validation scoping (viewer source only). */
  study_output_dir?: string
}

/** An image returned from a scan. */
export interface ScanImage {
  relative_path: string
  dimensions: Record<string, string>
  /** Relative path to the pre-generated JPEG thumbnail, or empty string when unavailable. */
  thumbnail_path: string
}

/** A discovered dimension with its unique sorted values. */
export interface ScanDimension {
  name: string
  type: 'int' | 'string'
  values: string[]
}

/** Result of scanning a training run's directories. */
export interface ScanResult {
  images: ScanImage[]
  dimensions: ScanDimension[]
}

/** UI role a dimension can be assigned to. */
export type DimensionRole = 'x' | 'y' | 'slider' | 'none'

/** Filter mode for a dimension's value filter. */
export type FilterMode = 'hide' | 'single' | 'multi'

/**
 * Unified dimension mode combining axis assignment and filter mode into a single selector.
 * - 'x', 'y', 'slider': Assigns the dimension to that axis role (filter mode is implicitly 'multi').
 * - 'single', 'multi', 'hide': Dimension is not assigned to an axis; uses the specified filter mode.
 */
export type UnifiedDimensionMode = 'x' | 'y' | 'slider' | 'single' | 'multi' | 'hide'

/** Assignment of a dimension to a UI role. */
export interface DimensionAssignment {
  dimensionName: string
  role: DimensionRole
}

/** Dimension-to-role mapping stored in a preset. */
export interface PresetMapping {
  x?: string
  y?: string
  slider?: string
  combos: string[]
}

/** A saved dimension mapping preset. */
export interface Preset {
  id: string
  name: string
  mapping: PresetMapping
  created_at: string
  updated_at: string
}

/** Checkpoint metadata response from safetensors header parsing. */
export interface CheckpointMetadata {
  metadata: Record<string, string>
}

/** Image metadata response with string and numeric fields differentiated. */
export interface ImageMetadata {
  /** Text-valued metadata fields (e.g. prompt_name, sampler_name, workflow_name). */
  string_metadata: Record<string, string>
  /** Quantitative metadata fields (seed, steps, cfg) represented as numbers. */
  numeric_metadata: Record<string, number>
}

/** A filesystem change event received over WebSocket. */
export interface FSEventMessage {
  type: 'image_added' | 'image_removed' | 'directory_added'
  path: string
}

/** ComfyUI connection status response. */
export interface ComfyUIStatus {
  connected: boolean
  enabled: boolean
}

/** ComfyUI available models response. */
export interface ComfyUIModels {
  models: string[]
}

/** Valid ComfyUI model types. */
export type ComfyUIModelType = 'vae' | 'clip' | 'unet' | 'sampler' | 'scheduler'

/** A named prompt with a name and text. */
export interface NamedPrompt {
  name: string
  text: string
}

/** A sampler and scheduler combination. */
export interface SamplerSchedulerPair {
  sampler: string
  scheduler: string
}

/** A saved study (generation parameter set). */
export interface Study {
  id: string
  name: string
  prompt_prefix: string
  prompts: NamedPrompt[]
  negative_prompt: string
  steps: number[]
  cfgs: number[]
  sampler_scheduler_pairs: SamplerSchedulerPair[]
  seeds: number[]
  width: number
  height: number
  /** ComfyUI workflow template filename (optional). */
  workflow_template: string
  /** ComfyUI VAE model path (optional). */
  vae: string
  /** ComfyUI CLIP/text encoder model path (optional). */
  text_encoder: string
  /** AuraFlow shift value (optional, nullable). */
  shift?: number
  images_per_checkpoint: number
  created_at: string
  updated_at: string
}

/** Payload for creating a new study. */
export interface CreateStudyPayload {
  name: string
  prompt_prefix: string
  prompts: NamedPrompt[]
  negative_prompt: string
  steps: number[]
  cfgs: number[]
  sampler_scheduler_pairs: SamplerSchedulerPair[]
  seeds: number[]
  width: number
  height: number
  workflow_template?: string
  vae?: string
  text_encoder?: string
  shift?: number
}

/** Payload for updating a study. */
export interface UpdateStudyPayload {
  id: string
  name: string
  prompt_prefix: string
  prompts: NamedPrompt[]
  negative_prompt: string
  steps: number[]
  cfgs: number[]
  sampler_scheduler_pairs: SamplerSchedulerPair[]
  seeds: number[]
  width: number
  height: number
  workflow_template?: string
  vae?: string
  text_encoder?: string
  shift?: number
}

/** Payload for forking a study (creating a new study from an existing one). */
export interface ForkStudyPayload {
  source_id: string
  name: string
  prompt_prefix: string
  prompts: NamedPrompt[]
  negative_prompt: string
  steps: number[]
  cfgs: number[]
  sampler_scheduler_pairs: SamplerSchedulerPair[]
  seeds: number[]
  width: number
  height: number
  workflow_template?: string
  vae?: string
  text_encoder?: string
  shift?: number
}

/** Response for checking if a study has generated samples. */
export interface HasSamplesResponse {
  has_samples: boolean
}

/** Sample job status. */
export type SampleJobStatus = 'pending' | 'running' | 'stopped' | 'completed' | 'completed_with_errors' | 'failed'

/** Details of a failed checkpoint within a job. */
export interface FailedItemDetail {
  checkpoint_filename: string
  error_message: string
  exception_type?: string
  node_type?: string
  traceback?: string
}

/** A sample job. */
export interface SampleJob {
  id: string
  training_run_name: string
  study_id: string
  study_name: string
  workflow_name: string
  vae: string
  clip: string
  shift?: number
  /** List of checkpoint filenames selected at job creation. Empty means all checkpoints were included. */
  checkpoint_filenames: string[]
  status: SampleJobStatus
  total_items: number
  completed_items: number
  failed_items: number
  pending_items: number
  failed_item_details?: FailedItemDetail[]
  error_message?: string
  created_at: string
  updated_at: string
}

/** Job progress metrics. */
export interface JobProgress {
  checkpoints_completed: number
  total_checkpoints: number
  current_checkpoint?: string
  current_checkpoint_progress?: number
  current_checkpoint_total?: number
  estimated_completion_time?: string
}

/** Sample job with progress metrics. */
export interface SampleJobDetail {
  job: SampleJob
  progress: JobProgress
}

/** Payload for creating a new sample job. Workflow template, VAE, text encoder, and shift come from the study definition. */
export interface CreateSampleJobPayload {
  training_run_name: string
  study_id: string
  /** Optional list of checkpoint filenames to include; omit to include all checkpoints. */
  checkpoint_filenames?: string[]
  /** When true, delete existing sample directories for selected checkpoints before creating job items. */
  clear_existing?: boolean
  /** When true, only generate samples that are missing on disk (skips items whose output file already exists). */
  missing_only?: boolean
}

/** Workflow template summary. */
export interface WorkflowSummary {
  name: string
  validation_state: 'valid' | 'invalid'
  roles: Record<string, string[]>
  warnings: string[]
}

/** Workflow template details. */
export interface WorkflowDetail {
  name: string
  validation_state: 'valid' | 'invalid'
  roles: Record<string, string[]>
  warnings: string[]
  workflow: unknown
}

/** Result of verifying expected images exist on disk for a completed checkpoint. */
export interface CheckpointCompletenessInfo {
  checkpoint: string
  expected: number
  verified: number
  missing: number
}

/** Result of validating sample set completeness for a training run. */
export interface ValidationResult {
  checkpoints: CheckpointCompletenessInfo[]
  /** Study-derived expected images per checkpoint (0 when no study context). */
  expected_per_checkpoint: number
  /** Total expected images across all checkpoints. */
  total_expected: number
  /** Total verified images across all checkpoints. */
  total_verified: number
  /** Total sample images found on disk across all checkpoints. */
  total_actual: number
  /** Total missing sample images across all checkpoints (total_expected - total_actual). */
  total_missing: number
}

/** Sample completeness status for a study relative to a training run. */
export type StudySampleStatus = 'none' | 'partial' | 'complete'

/** Per-study sample availability for a training run. */
export interface StudyAvailability {
  study_id: string
  study_name: string
  has_samples: boolean
  /** Completeness status: 'none' = no samples, 'partial' = some checkpoints have samples, 'complete' = all checkpoints have samples */
  sample_status: StudySampleStatus
  /** Number of training run checkpoints that have a matching sample directory for this study. */
  checkpoints_with_samples: number
  /** Total number of checkpoints in the training run. */
  total_checkpoints: number
}

/** Demo dataset status response. */
export interface DemoStatus {
  installed: boolean
}

/** Generation parameters for the sample currently being generated. Present only when a sample is actively running. */
export interface CurrentSampleParams {
  /** Checkpoint filename being sampled (e.g. step-000010.safetensors). */
  checkpoint_filename: string
  /** Named prompt slot in use (e.g. forest). */
  prompt_name: string
  /** Classifier-free guidance scale (floating-point). */
  cfg: number
  /** Number of sampler steps (integer). */
  steps: number
  /** ComfyUI sampler name (e.g. euler). */
  sampler_name: string
  /** ComfyUI scheduler name (e.g. normal). */
  scheduler: string
  /** Generation seed. */
  seed: number
  /** Output image width in pixels. */
  width: number
  /** Output image height in pixels. */
  height: number
}

/** WebSocket inference progress event (per-node progress from ComfyUI). */
export interface InferenceProgressMessage {
  type: 'inference_progress'
  prompt_id: string
  current_value: number
  max_value: number
  /** Estimated seconds remaining for the current sample, computed from step-based progress. */
  sample_eta_seconds?: number
}

/** WebSocket job progress event. */
export interface JobProgressMessage {
  type: 'job_progress'
  job_id: string
  status: SampleJobStatus
  total_items: number
  completed_items: number
  failed_items: number
  pending_items: number
  checkpoints_completed: number
  total_checkpoints: number
  current_checkpoint?: string
  current_checkpoint_progress?: number
  current_checkpoint_total?: number
  checkpoint_completeness?: CheckpointCompletenessInfo[]
  failed_item_details?: FailedItemDetail[]
  /** Estimated seconds remaining for the current sample (0 if unavailable). */
  sample_eta_seconds?: number
  /** Estimated seconds remaining for the entire job (0 if unavailable). */
  job_eta_seconds?: number
  /** Generation parameters for the currently generating sample. Present only when a sample is actively running. */
  current_sample_params?: CurrentSampleParams
}
