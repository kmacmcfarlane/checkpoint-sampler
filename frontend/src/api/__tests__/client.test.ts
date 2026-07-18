import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiClient } from '../client'
import type { ApiError } from '../types'

describe('ApiClient', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.unstubAllEnvs()
  })

  function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> }) {
    const jsonFn = response.json || (() => Promise.resolve({}))
    const defaults = {
      ok: true,
      status: 200,
      json: jsonFn,
      text: async () => {
        try {
          const body = await jsonFn()
          return JSON.stringify(body)
        } catch {
          return ''
        }
      },
      ...response,
    }
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(defaults)
  }

  describe('request', () => {
    it('makes a GET request to the correct URL', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      mockFetch({ json: () => Promise.resolve({ items: [] }) })

      const result = await client.request<{ items: unknown[] }>('/training-runs')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/training-runs',
        undefined,
      )
      expect(result).toEqual({ items: [] })
    })

    it('passes RequestInit options through to fetch', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      mockFetch({ json: () => Promise.resolve({ id: '1' }) })

      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }
      await client.request('/presets', init)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/presets',
        init,
      )
    })

    it('uses /api/v1 as the default base URL', async () => {
      const client = new ApiClient()
      mockFetch({ json: () => Promise.resolve({}) })

      await client.request('/training-runs')

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/training-runs', undefined)
    })

    it('throws ApiError with backend error code on non-ok response', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ name: 'INVALID_NAME', message: 'Name is required', id: 'abc123', temporary: false, timeout: false, fault: false }),
      })

      let thrown: ApiError | undefined
      try {
        await client.request('/presets')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('INVALID_NAME')
      expect(thrown!.message).toBe('Name is required')
    })

    // R-016: the backend now uses one canonical code per failure class across all
    // services. normalizeError must pass each unified code through verbatim as
    // ApiError.code without any per-service special-casing.
    it.each([
      ['internal_error', 500, 'Internal server error'],
      ['not_found', 404, 'Sample job not found'],
      ['invalid_payload', 400, 'Invalid file path (traversal rejected)'],
      ['invalid_state', 400, 'Cannot start job in current state'],
      ['too_many_items', 422, 'Computed total work items exceeds the configured maximum'],
      ['service_unavailable', 503, 'ComfyUI service unavailable'],
    ])('normalizes the unified backend code %s to ApiError.code', async (code, status, message) => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status,
        json: () => Promise.resolve({ name: code, message, id: 'abc123', temporary: false, timeout: false, fault: false }),
      })

      let thrown: ApiError | undefined
      try {
        await client.request('/sample-jobs')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe(code)
      expect(thrown!.message).toBe(message)
    })

    it('throws UNKNOWN_ERROR when error response is not JSON (prod: no body in message)', async () => {
      // AC: production error messages never include raw response bodies
      vi.stubEnv('DEV', false)
      const client = new ApiClient()
      const mockResponse = {
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
        json: () => Promise.reject(new Error('not json')),
      }
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

      let thrown: ApiError | undefined
      try {
        await client.request('/presets')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('UNKNOWN_ERROR')
      expect(thrown!.message).toBe('Request failed with status 500')
    })

    it('throws UNKNOWN_ERROR when error response is not JSON (dev: truncated body in message)', async () => {
      // AC: dev builds may include a truncated body for debugging
      vi.stubEnv('DEV', true)
      const client = new ApiClient()
      const mockResponse = {
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
        json: () => Promise.reject(new Error('not json')),
      }
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

      let thrown: ApiError | undefined
      try {
        await client.request('/presets')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('UNKNOWN_ERROR')
      expect(thrown!.message).toBe('Request failed with status 500 (body: Internal Server Error)')
    })

    it('throws UNKNOWN_ERROR when error response JSON lacks name/message (prod: no body in message)', async () => {
      // AC: production error messages never include raw response bodies
      vi.stubEnv('DEV', false)
      const client = new ApiClient()
      const bodyContent = JSON.stringify({ error: 'something' })
      const mockResponse = {
        ok: false,
        status: 422,
        text: () => Promise.resolve(bodyContent),
      }
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

      let thrown: ApiError | undefined
      try {
        await client.request('/presets')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('UNKNOWN_ERROR')
      expect(thrown!.message).toBe('Request failed with status 422')
    })

    it('throws UNKNOWN_ERROR when error response JSON lacks name/message (dev: body in message)', async () => {
      // AC: dev builds may include a truncated body for debugging
      vi.stubEnv('DEV', true)
      const client = new ApiClient()
      const bodyContent = JSON.stringify({ error: 'something' })
      const mockResponse = {
        ok: false,
        status: 422,
        text: () => Promise.resolve(bodyContent),
      }
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

      let thrown: ApiError | undefined
      try {
        await client.request('/presets')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('UNKNOWN_ERROR')
      expect(thrown!.message).toBe(`Request failed with status 422 (body: ${bodyContent})`)
    })

    it('truncates body to 200 chars in dev mode when body is long', async () => {
      // AC: dev builds may include a truncated body for debugging
      vi.stubEnv('DEV', true)
      const client = new ApiClient()
      const longBody = 'x'.repeat(300)
      const mockResponse = {
        ok: false,
        status: 500,
        text: () => Promise.resolve(longBody),
        json: () => Promise.reject(new Error('not json')),
      }
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

      let thrown: ApiError | undefined
      try {
        await client.request('/presets')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('UNKNOWN_ERROR')
      expect(thrown!.message).toBe(`Request failed with status 500 (body: ${'x'.repeat(200)}…)`)
    })

    it('throws NETWORK_ERROR when fetch throws', async () => {
      const client = new ApiClient()
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to fetch'),
      )

      let thrown: ApiError | undefined
      try {
        await client.request('/training-runs')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('NETWORK_ERROR')
      expect(thrown!.message).toBe('Failed to fetch')
    })

    it('throws NETWORK_ERROR with generic message for non-Error thrown values', async () => {
      const client = new ApiClient()
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue('string error')

      let thrown: ApiError | undefined
      try {
        await client.request('/training-runs')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('NETWORK_ERROR')
      expect(thrown!.message).toBe('Network error')
    })
  })

  describe('getTrainingRuns', () => {
    it('fetches training runs from /api/v1/training-runs', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      const runs = [
        { id: 0, name: 'run-alpha', pattern: '^alpha/.+', dimensions: [] },
        {
          id: 1,
          name: 'run-beta',
          pattern: '^beta/.+',
          dimensions: [{ name: 'step', type: 'int', pattern: '-steps-(\\d+)-' }],
        },
      ]
      mockFetch({ json: () => Promise.resolve(runs) })

      const result = await client.getTrainingRuns()

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/training-runs',
        undefined,
      )
      expect(result).toEqual(runs)
    })

    it('throws on training runs fetch failure', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ name: 'INTERNAL_ERROR', message: 'server error', id: 'req1', temporary: false, timeout: false, fault: true }),
      })

      let thrown: ApiError | undefined
      try {
        await client.getTrainingRuns()
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('scanTrainingRun', () => {
    it('fetches scan results from /api/v1/training-runs/{id}/scan', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      const scanResult = {
        images: [{ relative_path: 'dir/img.png', dimensions: { seed: '42' } }],
        dimensions: [{ name: 'seed', type: 'int', values: ['42'] }],
      }
      mockFetch({ json: () => Promise.resolve(scanResult) })

      const result = await client.scanTrainingRun('run-abc')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/training-runs/run-abc/scan',
        undefined,
      )
      expect(result).toEqual(scanResult)
    })

    it('throws on scan failure', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ name: 'not_found', message: 'Training run not found', id: 'req2', temporary: false, timeout: false, fault: false }),
      })

      let thrown: ApiError | undefined
      try {
        await client.scanTrainingRun('run-99')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('not_found')
    })
  })

  describe('getPresets', () => {
    it('fetches presets from /api/v1/presets', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      const presets = [
        { id: 'p1', name: 'Config A', mapping: { combos: [] }, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
      ]
      mockFetch({ json: () => Promise.resolve(presets) })

      const result = await client.getPresets()

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/presets',
        undefined,
      )
      expect(result).toEqual(presets)
    })
  })

  describe('getConfig', () => {
    it('fetches UI config limits from /api/v1/config', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      mockFetch({ json: () => Promise.resolve({ max_study_items: 50000 }) })

      const result = await client.getConfig()

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/config',
        undefined,
      )
      expect(result).toEqual({ max_study_items: 50000 })
    })
  })

  describe('createPreset', () => {
    it('posts a new preset to /api/v1/presets', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      const created = { id: 'new', name: 'Test', mapping: { x: 'cfg', combos: [] }, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' }
      mockFetch({ json: () => Promise.resolve(created) })

      const result = await client.createPreset('Test', { x: 'cfg', combos: [] })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/presets',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test', mapping: { x: 'cfg', combos: [] } }),
        }),
      )
      expect(result).toEqual(created)
    })
  })

  describe('updatePreset', () => {
    it('puts an updated preset to /api/v1/presets/{id}', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      const updated = { id: 'p1', name: 'Renamed', mapping: { combos: ['seed'] }, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z' }
      mockFetch({ json: () => Promise.resolve(updated) })

      const result = await client.updatePreset('p1', 'Renamed', { combos: ['seed'] })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/presets/p1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Renamed', mapping: { combos: ['seed'] } }),
        }),
      )
      expect(result).toEqual(updated)
    })
  })

  describe('deletePreset', () => {
    it('sends DELETE to /api/v1/presets/{id}', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      mockFetch({ ok: true, status: 204, json: () => Promise.resolve(undefined) })

      await client.deletePreset('p1')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/presets/p1',
        { method: 'DELETE' },
      )
    })

    it('throws on delete failure', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ name: 'not_found', message: 'Preset not found', id: 'req3', temporary: false, timeout: false, fault: false }),
      })

      let thrown: ApiError | undefined
      try {
        await client.deletePreset('nonexistent')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('not_found')
    })
  })

  describe('getCheckpointMetadata', () => {
    it('fetches metadata from /api/v1/checkpoints/{filename}/metadata', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      const metadata = { metadata: { ss_output_name: 'test', ss_total_steps: '9000' } }
      mockFetch({ json: () => Promise.resolve(metadata) })

      const result = await client.getCheckpointMetadata('model-step00001000.safetensors')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/checkpoints/model-step00001000.safetensors/metadata',
        undefined,
      )
      expect(result).toEqual(metadata)
    })

    it('throws on metadata fetch failure', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ name: 'not_found', message: 'Checkpoint not found', id: 'req4', temporary: false, timeout: false, fault: false }),
      })

      let thrown: ApiError | undefined
      try {
        await client.getCheckpointMetadata('nonexistent.safetensors')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('not_found')
    })
  })

  describe('getImageMetadata', () => {
    it('fetches metadata from /api/v1/images/{filepath}/metadata', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      const metadata = {
        string_metadata: { prompt: '{"nodes": []}', workflow: '{"links": []}' },
        numeric_metadata: { seed: 42, steps: 20, cfg: 7.5 },
      }
      mockFetch({ json: () => Promise.resolve(metadata) })

      const result = await client.getImageMetadata('checkpoint.safetensors/image.png')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/images/checkpoint.safetensors/image.png/metadata',
        undefined,
      )
      expect(result).toEqual(metadata)
    })

    it('throws on image metadata fetch failure', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ name: 'not_found', message: 'Image not found', id: 'req5', temporary: false, timeout: false, fault: false }),
      })

      let thrown: ApiError | undefined
      try {
        await client.getImageMetadata('nonexistent/image.png')
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('not_found')
    })
  })

  describe('validateTrainingRun', () => {
    it('posts to /api/v1/training-runs/{id}/validate without query param when no studyId', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      const validationResult = {
        checkpoints: [{ checkpoint: 'model-step00001000.safetensors', expected: 2, verified: 2, missing: 0 }],
        expected_per_checkpoint: 0,
        total_expected: 2,
        total_verified: 2,
      }
      mockFetch({ json: () => Promise.resolve(validationResult) })

      const result = await client.validateTrainingRun('run-abc')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/training-runs/run-abc/validate',
        { method: 'POST' },
      )
      expect(result).toEqual(validationResult)
    })

    it('posts to /api/v1/training-runs/{id}/validate with study_id query param when studyId provided', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      const validationResult = {
        checkpoints: [{ checkpoint: 'model-step00001000.safetensors', expected: 4, verified: 4, missing: 0 }],
        expected_per_checkpoint: 4,
        total_expected: 4,
        total_verified: 4,
      }
      mockFetch({ json: () => Promise.resolve(validationResult) })

      const result = await client.validateTrainingRun('run-abc', 'study-abc-123')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/training-runs/run-abc/validate?study_id=study-abc-123',
        { method: 'POST' },
      )
      expect(result).toEqual(validationResult)
    })

    it('URL-encodes study_id in query param', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      mockFetch({ json: () => Promise.resolve({ checkpoints: [], expected_per_checkpoint: 0, total_expected: 0, total_verified: 0 }) })

      await client.validateTrainingRun('run-1', 'study with spaces & special=chars')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/training-runs/run-1/validate?study_id=study+with+spaces+%26+special%3Dchars',
        { method: 'POST' },
      )
    })
  })

  describe('getHealth', () => {
    it('fetches health from /health endpoint', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      mockFetch({ json: () => Promise.resolve({ status: 'ok' }) })

      const result = await client.getHealth()

      expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8080/health')
      expect(result).toEqual({ status: 'ok' })
    })

    it('throws on health check failure', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api/v1' })
      mockFetch({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ name: 'INTERNAL_ERROR', message: 'unhealthy', id: 'req6', temporary: false, timeout: false, fault: true }),
      })

      let thrown: ApiError | undefined
      try {
        await client.getHealth()
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('INTERNAL_ERROR')
    })
  })

  // S-170: paginated sample-jobs list. The body is the page array; the total
  // count comes from the X-Total-Count header.
  describe('listSampleJobsPage', () => {
    function mockJobsPage(jobs: unknown[], totalHeader: string | null) {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(jobs),
        headers: { get: (name: string) => (name === 'X-Total-Count' ? totalHeader : null) },
      })
    }

    it('sends limit and offset as query params', async () => {
      const client = new ApiClient({ baseUrl: '/api/v1' })
      mockJobsPage([], '0')

      await client.listSampleJobsPage(25, 50)

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/sample-jobs?limit=25&offset=50')
    })

    it('defaults to limit 50 and offset 0', async () => {
      const client = new ApiClient({ baseUrl: '/api/v1' })
      mockJobsPage([], '0')

      await client.listSampleJobsPage()

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/sample-jobs?limit=50&offset=0')
    })

    it('returns jobs from the body and total from the X-Total-Count header', async () => {
      const client = new ApiClient({ baseUrl: '/api/v1' })
      mockJobsPage([{ id: 'a' }, { id: 'b' }], '137')

      const result = await client.listSampleJobsPage(2, 0)

      expect(result.jobs).toHaveLength(2)
      expect(result.total).toBe(137)
    })

    it('falls back to page length when the X-Total-Count header is absent', async () => {
      const client = new ApiClient({ baseUrl: '/api/v1' })
      mockJobsPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], null)

      const result = await client.listSampleJobsPage()

      expect(result.total).toBe(3)
    })

    it('listSampleJobs returns the jobs array when everything fits in one page', async () => {
      const client = new ApiClient({ baseUrl: '/api/v1' })
      mockJobsPage([{ id: 'a' }], '1')

      const jobs = await client.listSampleJobs()

      expect(Array.isArray(jobs)).toBe(true)
      expect(jobs).toHaveLength(1)
    })

    // Regression (S-170 review): JobLaunchDialog reasons over the FULL job history
    // for per-run bead status and failed-bead navigation. listSampleJobs() must
    // therefore loop every page — a run whose newest job sits BEYOND the first
    // page must still appear, with its training_run_name and failed status intact.
    it('listSampleJobs loops all pages so beyond-first-page jobs are included (bead/failed-nav)', async () => {
      const client = new ApiClient({ baseUrl: '/api/v1' })
      const pageA = [{ id: 'job-a1', training_run_name: 'run-a', status: 'completed' }]
      // The target run's job is on a LATER page and is a failed job — exactly the
      // case that drives run-b's red bead and failed-bead navigation.
      const pageB = [{ id: 'job-b1', training_run_name: 'run-b', status: 'failed' }]
      const spy = vi
        .spyOn(client, 'listSampleJobsPage')
        .mockResolvedValueOnce({ jobs: pageA as never, total: 2 })
        .mockResolvedValueOnce({ jobs: pageB as never, total: 2 })

      const jobs = await client.listSampleJobs()

      // Two page fetches were needed to assemble the full history.
      expect(spy).toHaveBeenCalledTimes(2)
      expect(spy).toHaveBeenNthCalledWith(1, 200, 0)
      expect(spy).toHaveBeenNthCalledWith(2, 200, 1)
      // The later-page target-run failed job is present.
      expect(jobs).toHaveLength(2)
      const runB = jobs.find(j => j.training_run_name === 'run-b')
      expect(runB).toBeDefined()
      expect(runB!.status).toBe('failed')
    })

    it('listSampleJobs stops when a page returns empty (defensive, no infinite loop)', async () => {
      const client = new ApiClient({ baseUrl: '/api/v1' })
      const spy = vi
        .spyOn(client, 'listSampleJobsPage')
        // total claims 5 but the server returns fewer/empty — the loop must still terminate.
        .mockResolvedValueOnce({ jobs: [{ id: 'a' }] as never, total: 5 })
        .mockResolvedValueOnce({ jobs: [] as never, total: 5 })

      const jobs = await client.listSampleJobs()

      expect(spy).toHaveBeenCalledTimes(2)
      expect(jobs).toHaveLength(1)
    })
  })
})
