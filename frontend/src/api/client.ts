import type { ApiError, ApiErrorResponse, CheckpointMetadata, ComfyUIModelType, ComfyUIModels, ComfyUIStatus, CreateSampleJobPayload, CreateStudyPayload, DemoStatus, ForkStudyPayload, HasSamplesResponse, HealthStatus, ImageMetadata, Preset, PresetMapping, SampleJob, SampleJobDetail, Study, StudyAvailability, ScanResult, TrainingRun, UpdateStudyPayload, ValidationResult, WorkflowSummary } from './types'

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

  /** GET /api/training-runs — list auto-discovered training runs (viewer: sample-directory-based). */
  async getTrainingRuns(): Promise<TrainingRun[]> {
    return this.request<TrainingRun[]>('/training-runs')
  }

  /** GET /api/training-runs?source=checkpoints — list checkpoint-file-based training runs (for Generate Samples). */
  async getCheckpointTrainingRuns(): Promise<TrainingRun[]> {
    return this.request<TrainingRun[]>('/training-runs?source=checkpoints')
  }

  /** GET /api/training-runs/{id}/scan — scan directories and return image metadata. */
  async scanTrainingRun(id: number): Promise<ScanResult> {
    return this.request<ScanResult>(`/training-runs/${id}/scan`)
  }

  /** POST /api/training-runs/{id}/validate — validate sample set completeness. */
  async validateTrainingRun(id: number, studyId?: string): Promise<ValidationResult> {
    const query = studyId ? `?study_id=${encodeURIComponent(studyId)}` : ''
    return this.request<ValidationResult>(`/training-runs/${id}/validate${query}`, {
      method: 'POST',
    })
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

  /** GET /api/studies — list all studies. */
  async listStudies(): Promise<Study[]> {
    return this.request<Study[]>('/studies')
  }

  /** POST /api/studies — create a new study. */
  async createStudy(payload: CreateStudyPayload): Promise<Study> {
    return this.request<Study>('/studies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  /** PUT /api/studies/{id} — update an existing study. */
  async updateStudy(payload: UpdateStudyPayload): Promise<Study> {
    return this.request<Study>(`/studies/${payload.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  /** POST /api/studies/{source_id}/fork — fork a study. */
  async forkStudy(payload: ForkStudyPayload): Promise<Study> {
    return this.request<Study>(`/studies/${payload.source_id}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  /** GET /api/studies/{id}/has-samples — check if a study has generated samples. */
  async studyHasSamples(id: string): Promise<HasSamplesResponse> {
    return this.request<HasSamplesResponse>(`/studies/${id}/has-samples`)
  }

  /** GET /api/studies/availability?training_run_id={id} — get per-study sample availability for a training run. */
  async getStudyAvailability(trainingRunId: number): Promise<StudyAvailability[]> {
    return this.request<StudyAvailability[]>(`/studies/availability?training_run_id=${trainingRunId}`)
  }

  /** DELETE /api/studies/{id} — delete a study. */
  async deleteStudy(id: string): Promise<void> {
    const url = `${this.baseUrl}/studies/${id}`
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

  /** GET /api/demo/status — check whether the demo dataset is installed. */
  async getDemoStatus(): Promise<DemoStatus> {
    return this.request<DemoStatus>('/demo/status')
  }

  /** POST /api/demo/install — install the demo dataset and seed the demo preset. */
  async installDemo(): Promise<DemoStatus> {
    return this.request<DemoStatus>('/demo/install', {
      method: 'POST',
    })
  }

  /** DELETE /api/demo — remove the demo dataset and demo preset. */
  async uninstallDemo(): Promise<DemoStatus> {
    const url = `${this.baseUrl}/demo`
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
    return (await response.json()) as DemoStatus
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
