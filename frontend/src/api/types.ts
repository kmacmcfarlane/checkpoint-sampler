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
