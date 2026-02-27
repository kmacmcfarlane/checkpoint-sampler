import type { ApiError, ApiErrorResponse, CheckpointMetadata, ComfyUIModelType, ComfyUIModels, ComfyUIStatus, CreateSampleJobPayload, CreateSamplePresetPayload, HealthStatus, ImageMetadata, Preset, PresetMapping, SampleJob, SampleJobDetail, SamplePreset, ScanResult, TrainingRun, UpdateSamplePresetPayload, WorkflowSummary } from './types'

const DEFAULT_BASE_URL = '/api'

/** Options for creating an ApiClient. */
export interface ApiClientOptions {
  baseUrl?: string
}

/**
 * Normalizes an error from a failed API response into a consistent shape.
 * Attempts to parse the backend's Goa error JSON; falls back to a generic error.
 */
async function normalizeError(response: Response): Promise<ApiError> {
  let bodyText: string | undefined
  try {
    bodyText = await response.text()
    const body: unknown = JSON.parse(bodyText)
    if (isApiErrorResponse(body)) {
      return { code: body.name, message: body.message }
    }
  } catch {
    // response body wasn't JSON — fall through
  }
  // Include body in error message for debugging unknown errors
  const bodyInfo = bodyText ? ` (body: ${bodyText})` : ''
  return {
    code: 'UNKNOWN_ERROR',
    message: `Request failed with status ${response.status}${bodyInfo}`,
  }
}

function isApiErrorResponse(body: unknown): body is ApiErrorResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as ApiErrorResponse).name === 'string' &&
    typeof (body as ApiErrorResponse).message === 'string'
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

  /** GET /api/training-runs — list auto-discovered training runs. */
  async getTrainingRuns(hasSamples?: boolean): Promise<TrainingRun[]> {
    const params = hasSamples !== undefined ? `?has_samples=${hasSamples}` : ''
    return this.request<TrainingRun[]>(`/training-runs${params}`)
  }

  /** GET /api/training-runs/{id}/scan — scan directories and return image metadata. */
  async scanTrainingRun(id: number): Promise<ScanResult> {
    return this.request<ScanResult>(`/training-runs/${id}/scan`)
  }

  /** GET /api/presets — list all saved presets. */
  async getPresets(): Promise<Preset[]> {
    return this.request<Preset[]>('/presets')
  }

  /** POST /api/presets — create a new preset. */
  async createPreset(name: string, mapping: PresetMapping): Promise<Preset> {
    return this.request<Preset>('/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mapping }),
    })
  }

  /** PUT /api/presets/{id} — update an existing preset. */
  async updatePreset(id: string, name: string, mapping: PresetMapping): Promise<Preset> {
    return this.request<Preset>(`/presets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mapping }),
    })
  }

  /** GET /api/checkpoints/{filename}/metadata — get checkpoint training metadata. */
  async getCheckpointMetadata(filename: string): Promise<CheckpointMetadata> {
    return this.request<CheckpointMetadata>(`/checkpoints/${encodeURIComponent(filename)}/metadata`)
  }

  /** GET /api/images/{filepath}/metadata — get PNG embedded metadata. */
  async getImageMetadata(filepath: string): Promise<ImageMetadata> {
    return this.request<ImageMetadata>(`/images/${filepath}/metadata`)
  }

  /** DELETE /api/presets/{id} — delete a preset. */
  async deletePreset(id: string): Promise<void> {
    const url = `${this.baseUrl}/presets/${id}`
    let response: Response
    try {
      response = await fetch(url, { method: 'DELETE' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw { code: 'NETWORK_ERROR', message } satisfies ApiError
    }
    if (!response.ok) {
      throw await normalizeError(response)
    }
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

  /** GET /api/comfyui/status — check ComfyUI connection status. */
  async getComfyUIStatus(): Promise<ComfyUIStatus> {
    return this.request<ComfyUIStatus>('/comfyui/status')
  }

  /** GET /api/comfyui/models — get available models by type. */
  async getComfyUIModels(type: ComfyUIModelType): Promise<ComfyUIModels> {
    return this.request<ComfyUIModels>(`/comfyui/models?type=${type}`)
  }

  /** GET /api/sample-presets — list all sample presets. */
  async listSamplePresets(): Promise<SamplePreset[]> {
    return this.request<SamplePreset[]>('/sample-presets')
  }

  /** POST /api/sample-presets — create a new sample preset. */
  async createSamplePreset(payload: CreateSamplePresetPayload): Promise<SamplePreset> {
    return this.request<SamplePreset>('/sample-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  /** PUT /api/sample-presets/{id} — update an existing sample preset. */
  async updateSamplePreset(payload: UpdateSamplePresetPayload): Promise<SamplePreset> {
    return this.request<SamplePreset>(`/sample-presets/${payload.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  /** DELETE /api/sample-presets/{id} — delete a sample preset. */
  async deleteSamplePreset(id: string): Promise<void> {
    const url = `${this.baseUrl}/sample-presets/${id}`
    let response: Response
    try {
      response = await fetch(url, { method: 'DELETE' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw { code: 'NETWORK_ERROR', message } satisfies ApiError
    }
    if (!response.ok) {
      throw await normalizeError(response)
    }
  }

  /** GET /api/workflows — list all workflow templates. */
  async listWorkflows(): Promise<WorkflowSummary[]> {
    return this.request<WorkflowSummary[]>('/workflows')
  }

  /** GET /api/sample-jobs — list all sample jobs. */
  async listSampleJobs(): Promise<SampleJob[]> {
    return this.request<SampleJob[]>('/sample-jobs')
  }

  /** GET /api/sample-jobs/{id} — get sample job details with progress metrics. */
  async getSampleJob(id: string): Promise<SampleJobDetail> {
    return this.request<SampleJobDetail>(`/sample-jobs/${id}`)
  }

  /** POST /api/sample-jobs — create and start a new sample job. */
  async createSampleJob(payload: CreateSampleJobPayload): Promise<SampleJob> {
    return this.request<SampleJob>('/sample-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  /** POST /api/sample-jobs/{id}/stop — stop a running sample job. */
  async stopSampleJob(id: string): Promise<SampleJob> {
    return this.request<SampleJob>(`/sample-jobs/${id}/stop`, {
      method: 'POST',
    })
  }

  /** POST /api/sample-jobs/{id}/resume — resume a stopped sample job. */
  async resumeSampleJob(id: string): Promise<SampleJob> {
    return this.request<SampleJob>(`/sample-jobs/${id}/resume`, {
      method: 'POST',
    })
  }

  /** DELETE /api/sample-jobs/{id} — delete a sample job. */
  async deleteSampleJob(id: string): Promise<void> {
    const url = `${this.baseUrl}/sample-jobs/${id}`
    let response: Response
    try {
      response = await fetch(url, { method: 'DELETE' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw { code: 'NETWORK_ERROR', message } satisfies ApiError
    }
    if (!response.ok) {
      throw await normalizeError(response)
    }
  }
}

/** Singleton client instance for use across the app. */
export const apiClient = new ApiClient()
