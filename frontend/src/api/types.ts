/** Error shape returned by the backend API. */
export interface ApiErrorResponse {
  Code: string
  Message: string
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

/** WebSocket event types sent by the backend. */
export type FSEventType = 'image_added' | 'image_removed' | 'directory_added'

/** A filesystem change event received over WebSocket. */
export interface FSEventMessage {
  type: FSEventType
  path: string
}
