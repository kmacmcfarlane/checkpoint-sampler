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
}

/** An image returned from a scan. */
export interface ScanImage {
  relative_path: string
  dimensions: Record<string, string>
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

/** Image metadata response from PNG tEXt chunk parsing. */
export interface ImageMetadata {
  metadata: Record<string, string>
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

/** A saved sample setting preset. */
export interface SamplePreset {
  id: string
  name: string
  prompts: NamedPrompt[]
  negative_prompt: string
  steps: number[]
  cfgs: number[]
  samplers: string[]
  schedulers: string[]
  seeds: number[]
  width: number
  height: number
  images_per_checkpoint: number
  created_at: string
  updated_at: string
}

/** Payload for creating a new sample preset. */
export interface CreateSamplePresetPayload {
  name: string
  prompts: NamedPrompt[]
  negative_prompt: string
  steps: number[]
  cfgs: number[]
  samplers: string[]
  schedulers: string[]
  seeds: number[]
  width: number
  height: number
}

/** Payload for updating a sample preset. */
export interface UpdateSamplePresetPayload {
  id: string
  name: string
  prompts: NamedPrompt[]
  negative_prompt: string
  steps: number[]
  cfgs: number[]
  samplers: string[]
  schedulers: string[]
  seeds: number[]
  width: number
  height: number
}

/** Sample job status. */
export type SampleJobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed'

/** A sample job. */
export interface SampleJob {
  id: string
  training_run_name: string
  sample_preset_id: string
  workflow_name: string
  vae: string
  clip: string
  shift?: number
  status: SampleJobStatus
  total_items: number
  completed_items: number
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

/** Payload for creating a new sample job. */
export interface CreateSampleJobPayload {
  training_run_name: string
  sample_preset_id: string
  workflow_name: string
  vae?: string
  clip?: string
  shift?: number
  /** Optional list of checkpoint filenames to include; omit to include all checkpoints. */
  checkpoint_filenames?: string[]
  /** When true, delete existing sample directories for selected checkpoints before creating job items. */
  clear_existing?: boolean
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

/** WebSocket job progress event. */
export interface JobProgressMessage {
  type: 'job_progress'
  job_id: string
  status: SampleJobStatus
  total_items: number
  completed_items: number
  checkpoints_completed: number
  total_checkpoints: number
  current_checkpoint?: string
  current_checkpoint_progress?: number
  current_checkpoint_total?: number
}
