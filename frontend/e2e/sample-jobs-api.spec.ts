import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

// AC: SampleJobsService methods return an empty result (or appropriate error)
//     when no jobs exist
// AC: No panic occurs when /api/sample-jobs endpoints are called
// Note: docker-compose.test.yml uses config-with-comfyui.yaml, so ComfyUI IS
//       configured in the test environment. These tests verify API behaviour
//       for empty/invalid requests, not the "no ComfyUI" code path.

test.describe('sample-jobs API (ComfyUI configured in test environment)', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('GET /api/sample-jobs returns 200 with empty array', async ({ request }) => {
    const response = await request.get('/api/sample-jobs')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  test('POST /api/sample-jobs returns error (not a panic)', async ({ request }) => {
    const response = await request.post('/api/sample-jobs', {
      data: {
        training_run_name: 'nonexistent',
        study_id: 'nonexistent',
        workflow_name: 'test.json',
      },
    })
    // Should get an error response, not a 502/503 from a crashed backend
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(response.status()).toBeLessThan(500)
  })
})
