import { test, expect } from '@playwright/test'

// AC: SampleJobsService methods return an empty result (or appropriate error)
//     when the inner SampleJobService is nil (ComfyUI not configured)
// AC: No panic occurs when /api/sample-jobs endpoints are called without ComfyUI configured

test.describe('sample-jobs API without ComfyUI configured', () => {
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
        sample_preset_id: 'nonexistent',
        workflow_name: 'test.json',
      },
    })
    // Should get an error response, not a 502/503 from a crashed backend
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(response.status()).toBeLessThan(500)
  })
})
