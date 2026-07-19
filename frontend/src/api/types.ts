/** Error shape returned by the backend API (Goa error format). */
export interface ApiErrorResponse {
  name: string
  message: string
  id: string
  temporary: boolean
  timeout: boolean
  fault: boolean
}

/**
 * Canonical backend error codes (R-016). The backend exposes one stable code
 * per failure class across every service (see docs/api.md §5.3 and
 * backend/internal/api/design/errors.go), so the frontend can branch on these
 * without per-service special-casing.
 *
 *   internal_error       — 500: unexpected server-side failure.
 *   not_found            — 404: the requested entity does not exist.
 *   invalid_payload      — 400: malformed request data or rejected path/filename.
 *   invalid_state        — 400: operation invalid for the entity's current state.
 *   too_many_items       — 422: computed work exceeds the configured maximum.
 *   service_unavailable  — 503: a required dependency (ComfyUI) is unavailable.
 *
 * In addition to these, normalizeError emits two client-side codes:
 *   NETWORK_ERROR — the request never reached the server (fetch threw).
 *   UNKNOWN_ERROR — a non-ok response whose body was not a Goa error envelope.
 */
export type ApiErrorCode =
  | 'internal_error'
  | 'not_found'
  | 'invalid_payload'
  | 'invalid_state'
  | 'too_many_items'
  | 'service_unavailable'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'

/** Normalized error used throughout the frontend. */
export interface ApiError {
  /** Stable error code: a canonical backend code (ApiErrorCode) or any other string the backend returns. */
  code: ApiErrorCode | string
  message: string
}

/** Health check response. */
export interface HealthStatus {
  status: string
}

/** UI-relevant configuration limits exposed by the backend. */
export interface AppConfig {
  /** Maximum total work items allowed per study/job. */
  max_study_items: number
  /** Configured checkpoint directories, used to name paths in empty states. */
  checkpoint_dirs: string[]
}

/** A checkpoint file within a training run. */
export interface CheckpointInfo {
  filename: string
  step_number: number
  has_samples: boolean
}

/** Training run kind: checkpoint (full model) or lora (LoRA adapter). */
export type TrainingRunKind = 'checkpoint' | 'lora'

/** An auto-discovered training run. */
export interface TrainingRun {
  /**
   * Stable opaque identifier (URL-safe base64 of the run's relative path).
   * S-155: survives rescans/reordering — treat as an opaque string, never
   * assume it is numeric or positional.
   */
  id: string
  name: string
  kind: TrainingRunKind
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
export type DimensionRole = 'x' | 'y' | 'slider' | 'x_slider' | 'y_slider' | 'none'

/** Filter mode for a dimension's value filter. */
export type FilterMode = 'hide' | 'single' | 'multi'

/**
 * Unified dimension mode combining axis assignment and filter mode into a single selector.
 * - 'x', 'y': Assigns the dimension to a grid axis role (filter mode is implicitly 'multi').
 * - 'x_slider', 'y_slider': Assigns the dimension to an edge slider role (filter mode is implicitly 'multi').
 * - 'slider': Assigns the dimension to the per-cell slider role (filter mode is implicitly 'multi').
 * - 'single', 'multi', 'hide': Dimension is not assigned to an axis; uses the specified filter mode.
 */
export type UnifiedDimensionMode = 'x' | 'y' | 'slider' | 'x_slider' | 'y_slider' | 'single' | 'multi' | 'hide'

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
  x_slider?: string
  y_slider?: string
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

/** Base models list response from /api/v1/base-models. */
export interface BaseModelsResult {
  models: string[]
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
export type ComfyUIModelType = 'vae' | 'clip' | 'unet' | 'lora' | 'sampler' | 'scheduler'

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

/** A LoRA strength pair for model and CLIP weights. */
export interface LoraStrengthPair {
  strength_model: number
  strength_clip: number
}

/** An image resolution as a width/height pair (S-157). */
export interface ResolutionPair {
  width: number
  height: number
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
  /** Resolution pairs to iterate (S-157). */
  resolutions: ResolutionPair[]
  /** ComfyUI workflow template filename (optional). */
  workflow_template: string
  /** ComfyUI VAE model paths to iterate (S-157; gated by the workflow's vae_loader role). */
  vaes: string[]
  /** ComfyUI CLIP/text encoder model paths to iterate (S-157; gated by the workflow's clip_loader role). */
  text_encoders: string[]
  /** AuraFlow shift values to iterate (S-157; gated by the workflow's shift role). */
  shifts: number[]
  /** LoRA strength pairs for model and CLIP weights. */
  lora_strength_pairs: LoraStrengthPair[]
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
  resolutions: ResolutionPair[]
  workflow_template?: string
  vaes?: string[]
  text_encoders?: string[]
  shifts?: number[]
  lora_strength_pairs?: LoraStrengthPair[]
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
  resolutions: ResolutionPair[]
  workflow_template?: string
  vaes?: string[]
  text_encoders?: string[]
  shifts?: number[]
  lora_strength_pairs?: LoraStrengthPair[]
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
  resolutions: ResolutionPair[]
  workflow_template?: string
  vaes?: string[]
  text_encoders?: string[]
  shifts?: number[]
  lora_strength_pairs?: LoraStrengthPair[]
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
  /** Base model path for LoRA jobs (empty for checkpoint jobs). */
  base_model?: string
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

/**
 * A page of sample jobs returned by the paginated list endpoint.
 * `jobs` is the page (newest first, created_at DESC); `total` is the total
 * number of jobs across all pages, used by the UI to lazily prefetch more.
 * List entries omit per-item tracebacks (retained on the show endpoint).
 */
export interface SampleJobPage {
  jobs: SampleJob[]
  total: number
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
  /** Base model path for LoRA jobs (required when training run kind is 'lora'). */
  base_model?: string
}

/** Workflow template summary. */
export interface WorkflowSummary {
  name: string
  validation_state: 'valid' | 'invalid'
  roles: Record<string, string[]>
  warnings: string[]
  /** True when the workflow contains a lora_loader cs_role node. */
  lora_capable: boolean
}

/** Workflow template details. */
export interface WorkflowDetail {
  name: string
  validation_state: 'valid' | 'invalid'
  roles: Record<string, string[]>
  warnings: string[]
  /** True when the workflow contains a lora_loader cs_role node. */
  lora_capable: boolean
  workflow: unknown
}

/** Result of verifying expected images exist on disk for a completed checkpoint. */
export interface CheckpointCompletenessInfo {
  checkpoint: string
  expected: number
  verified: number
  missing: number
  /** Number of sample images beyond the expected count (verified - expected when verified > expected). */
  extra: number
  /** Number of sample images whose sidecar params do not match the manifest. */
  invalid_params: number
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
  /** Total sample images beyond the expected count across all checkpoints. */
  total_extra: number
  /** Total sample images whose sidecar params do not match the manifest. */
  total_invalid_params: number
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
  /**
   * Base-model directory names (base model filename without extension) that
   * produced existing LoRA samples for this study. Empty for checkpoint runs
   * or when no LoRA samples exist. Used to pre-select the remembered base model
   * in the Generate Samples dialog (B-145).
   */
  base_models?: string[]
}

/** A training run that has generated samples for a study. */
export interface AffectedRun {
  training_run_name: string
  checkpoints_with_samples: number
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

/**
 * Per-checkpoint completeness verification result carried on WebSocket
 * job_progress events. Unlike {@link CheckpointCompletenessInfo} (the HTTP
 * validation result), the WS serializer only ever populates these four
 * fields (see backend/internal/api/ws.go) — it never sends `extra` or
 * `invalid_params`.
 */
export interface WSCheckpointCompletenessInfo {
  checkpoint: string
  expected: number
  verified: number
  missing: number
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
  checkpoint_completeness?: WSCheckpointCompletenessInfo[]
  failed_item_details?: FailedItemDetail[]
  /** Estimated seconds remaining for the current sample (0 if unavailable). */
  sample_eta_seconds?: number
  /** Estimated seconds remaining for the entire job (0 if unavailable). */
  job_eta_seconds?: number
  /** Generation parameters for the currently generating sample. Present only when a sample is actively running. */
  current_sample_params?: CurrentSampleParams
}
