import { test, expect, type APIRequestContext } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for the GET /api/base-models endpoint (B-143).
 *
 * This endpoint scans base_model_dir (or falls back to checkpoint_dirs[0])
 * for .safetensors files. It does NOT depend on ComfyUI being online.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://frontend:3000'

test.describe('GET /api/base-models (B-143)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: BE: New GET /api/base-models endpoint scans base_model_dir for .safetensors files
  test('returns base model .safetensors files from the configured directory', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/base-models`)
    expect(resp.ok()).toBe(true)
    const body = await resp.json()
    expect(body).toHaveProperty('models')
    expect(Array.isArray(body.models)).toBe(true)
    // The test fixture has checkpoint files in checkpoint_dirs[0] (fallback),
    // so we expect at least one model file to be listed.
    expect(body.models.length).toBeGreaterThan(0)
    // All entries should end with .safetensors
    for (const model of body.models) {
      expect(model).toMatch(/\.safetensors$/i)
    }
  })

  // AC: FE: Base model dropdown populates correctly when ComfyUI is offline
  // The endpoint reads from the filesystem, not ComfyUI, so it works regardless
  // of ComfyUI status. Verify by calling the endpoint directly.
  test('returns models independently of ComfyUI status', async ({ request }) => {
    // Check that ComfyUI status endpoint shows the current connection state
    const statusResp = await request.get(`${BASE_URL}/api/comfyui/status`)
    // Regardless of ComfyUI status, base-models should still return data
    const modelsResp = await request.get(`${BASE_URL}/api/base-models`)
    expect(modelsResp.ok()).toBe(true)
    const body = await modelsResp.json()
    expect(body.models.length).toBeGreaterThan(0)

    // Sanity: status endpoint should also succeed (even if ComfyUI is offline)
    expect(statusResp.ok()).toBe(true)
  })
})
