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
  })

  function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
    const defaults = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      ...response,
    }
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(defaults)
  }

  describe('request', () => {
    it('makes a GET request to the correct URL', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
      mockFetch({ json: () => Promise.resolve({ items: [] }) })

      const result = await client.request<{ items: unknown[] }>('/training-runs')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/training-runs',
        undefined,
      )
      expect(result).toEqual({ items: [] })
    })

    it('passes RequestInit options through to fetch', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
      mockFetch({ json: () => Promise.resolve({ id: '1' }) })

      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }
      await client.request('/presets', init)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/presets',
        init,
      )
    })

    it('uses /api as the default base URL', async () => {
      const client = new ApiClient()
      mockFetch({ json: () => Promise.resolve({}) })

      await client.request('/training-runs')

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/training-runs', undefined)
    })

    it('throws ApiError with backend error code on non-ok response', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ Code: 'INVALID_NAME', Message: 'Name is required' }),
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

    it('throws UNKNOWN_ERROR when error response is not JSON', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      })

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

    it('throws UNKNOWN_ERROR when error response JSON lacks Code/Message', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ error: 'something' }),
      })

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
    it('fetches training runs from /api/training-runs', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
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
        'http://localhost:8080/api/training-runs',
        undefined,
      )
      expect(result).toEqual(runs)
    })

    it('throws on training runs fetch failure', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ Code: 'INTERNAL_ERROR', Message: 'server error' }),
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
    it('fetches scan results from /api/training-runs/{id}/scan', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
      const scanResult = {
        images: [{ relative_path: 'dir/img.png', dimensions: { seed: '42' } }],
        dimensions: [{ name: 'seed', type: 'int', values: ['42'] }],
      }
      mockFetch({ json: () => Promise.resolve(scanResult) })

      const result = await client.scanTrainingRun(0)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/training-runs/0/scan',
        undefined,
      )
      expect(result).toEqual(scanResult)
    })

    it('throws on scan failure', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ Code: 'not_found', Message: 'Training run not found' }),
      })

      let thrown: ApiError | undefined
      try {
        await client.scanTrainingRun(99)
      } catch (err) {
        thrown = err as ApiError
      }

      expect(thrown).toBeDefined()
      expect(thrown!.code).toBe('not_found')
    })
  })

  describe('getPresets', () => {
    it('fetches presets from /api/presets', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
      const presets = [
        { id: 'p1', name: 'Config A', mapping: { combos: [] }, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
      ]
      mockFetch({ json: () => Promise.resolve(presets) })

      const result = await client.getPresets()

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/presets',
        undefined,
      )
      expect(result).toEqual(presets)
    })
  })

  describe('createPreset', () => {
    it('posts a new preset to /api/presets', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
      const created = { id: 'new', name: 'Test', mapping: { x: 'cfg', combos: [] }, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' }
      mockFetch({ json: () => Promise.resolve(created) })

      const result = await client.createPreset('Test', { x: 'cfg', combos: [] })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/presets',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test', mapping: { x: 'cfg', combos: [] } }),
        }),
      )
      expect(result).toEqual(created)
    })
  })

  describe('updatePreset', () => {
    it('puts an updated preset to /api/presets/{id}', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
      const updated = { id: 'p1', name: 'Renamed', mapping: { combos: ['seed'] }, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z' }
      mockFetch({ json: () => Promise.resolve(updated) })

      const result = await client.updatePreset('p1', 'Renamed', { combos: ['seed'] })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/presets/p1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Renamed', mapping: { combos: ['seed'] } }),
        }),
      )
      expect(result).toEqual(updated)
    })
  })

  describe('deletePreset', () => {
    it('sends DELETE to /api/presets/{id}', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
      mockFetch({ ok: true, status: 204, json: () => Promise.resolve(undefined) })

      await client.deletePreset('p1')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/presets/p1',
        { method: 'DELETE' },
      )
    })

    it('throws on delete failure', async () => {
      const client = new ApiClient()
      mockFetch({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ Code: 'not_found', Message: 'Preset not found' }),
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

  describe('getHealth', () => {
    it('fetches health from /health endpoint', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
      mockFetch({ json: () => Promise.resolve({ status: 'ok' }) })

      const result = await client.getHealth()

      expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8080/health')
      expect(result).toEqual({ status: 'ok' })
    })

    it('throws on health check failure', async () => {
      const client = new ApiClient({ baseUrl: 'http://localhost:8080/api' })
      mockFetch({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ Code: 'INTERNAL_ERROR', Message: 'unhealthy' }),
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
})
