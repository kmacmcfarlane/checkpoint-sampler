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
