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

/** Dimension extraction configuration for a training run. */
export interface DimensionConfig {
  name: string
  type: 'int' | 'string'
  pattern: string
}

/** A configured training run. */
export interface TrainingRun {
  id: number
  name: string
  pattern: string
  dimensions: DimensionConfig[]
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
export type DimensionRole = 'x' | 'y' | 'slider' | 'combo'

/** Assignment of a dimension to a UI role. */
export interface DimensionAssignment {
  dimensionName: string
  role: DimensionRole
}
