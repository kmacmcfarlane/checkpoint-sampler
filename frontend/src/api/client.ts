import type { ApiError, ApiErrorResponse, HealthStatus } from './types'

const DEFAULT_BASE_URL = '/api'

/** Options for creating an ApiClient. */
export interface ApiClientOptions {
  baseUrl?: string
}

/**
 * Normalizes an error from a failed API response into a consistent shape.
 * Attempts to parse the backend's ErrorWithCode JSON; falls back to a generic error.
 */
async function normalizeError(response: Response): Promise<ApiError> {
  try {
    const body: unknown = await response.json()
    if (isApiErrorResponse(body)) {
      return { code: body.Code, message: body.Message }
    }
  } catch {
    // response body wasn't JSON — fall through
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: `Request failed with status ${response.status}`,
  }
}

function isApiErrorResponse(body: unknown): body is ApiErrorResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as ApiErrorResponse).Code === 'string' &&
    typeof (body as ApiErrorResponse).Message === 'string'
  )
}

/**
 * Typed API client for the Checkpoint Sampler backend.
 *
 * All methods return the parsed response data on success or throw an ApiError
 * on failure, providing a single abstraction point for backend communication.
 */
export class ApiClient {
  private readonly baseUrl: string

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  }

  /** Generic fetch wrapper that handles JSON parsing and error normalization. */
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw { code: 'NETWORK_ERROR', message } satisfies ApiError
    }

    if (!response.ok) {
      throw await normalizeError(response)
    }

    return (await response.json()) as T
  }

  /** GET /health — check backend health. */
  async getHealth(): Promise<HealthStatus> {
    // Health endpoint is at /health, not under /api
    const baseOrigin = this.baseUrl.replace(/\/api$/, '')
    const url = `${baseOrigin}/health`
    let response: Response
    try {
      response = await fetch(url)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw { code: 'NETWORK_ERROR', message } satisfies ApiError
    }
    if (!response.ok) {
      throw await normalizeError(response)
    }
    return (await response.json()) as HealthStatus
  }
}

/** Singleton client instance for use across the app. */
export const apiClient = new ApiClient()
