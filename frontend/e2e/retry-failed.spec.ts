import { test, expect, type APIRequestContext } from '@playwright/test'
import { resetDatabase, cancelAllJobs, closeDrawer } from './helpers'

// AC: BE: POST /api/sample-jobs/{id}/retry-failed re-queues only failed items in the same job
// AC: FE: 'Retry failed' button appears on completed_with_errors jobs in the job progress panel

/**
 * Seeds a single sample job via the test-only endpoint and returns the job ID.
 */
async function seedJob(
  request: APIRequestContext,
  status: string,
  opts: { study_name?: string; total_items?: number; completed_items?: number } = {},
): Promise<string> {
  const payload = [
    {
      training_run_name: 'my-model',
      study_id: 'seed-study-001',
      study_name: opts.study_name ?? 'Retry Failed Test Study',
      workflow_name: 'test-workflow.json',
      status,
      total_items: opts.total_items ?? 4,
      completed_items: opts.completed_items ?? 0,
    },
  ]
  const response = await request.post('/api/test/seed-jobs', { data: payload })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return (body.job_ids as string[])[0]
}

/**
 * Opens the Job Progress Panel (the "Jobs" button in the header).
 */
async function openJobProgressPanel(page: import('@playwright/test').Page): Promise<void> {
  await closeDrawer(page)

  const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
  await expect(jobsButton).toBeVisible()
  await jobsButton.click()

  const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  await expect(modal).toBeVisible()
}

test.describe('retry-failed endpoint (S-110)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC: BE: POST /api/sample-jobs/{id}/retry-failed returns 400 for a job not in completed_with_errors state
  test('POST /api/sample-jobs/{id}/retry-failed returns 400 for non-completed_with_errors job', async ({ request }) => {
    // Create a study and job to get a real job ID in a different state
    const studyPayload = {
      name: 'Retry Test Study',
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'a test prompt' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 512,
      height: 512,
      workflow_template: 'test-workflow.json',
      vae: 'test-vae.safetensors',
      text_encoder: 'test-clip.safetensors',
    }
    const studyResp = await request.post('/api/studies', { data: studyPayload })
    expect(studyResp.status()).toBe(201)
    const study = await studyResp.json()

    const jobResp = await request.post('/api/sample-jobs', {
      data: { training_run_name: 'my-model', study_id: study.id },
    })
    expect(jobResp.status()).toBe(201)
    const job = await jobResp.json()

    // The job is pending or running — retry-failed should return 400 (invalid_state)
    const retryResp = await request.post(`/api/sample-jobs/${job.id}/retry-failed`)
    expect(retryResp.status()).toBe(400)
  })

  // AC: BE: POST /api/sample-jobs/{id}/retry-failed returns 404 for a non-existent job
  test('POST /api/sample-jobs/{id}/retry-failed returns 404 for unknown job', async ({ request }) => {
    const retryResp = await request.post('/api/sample-jobs/nonexistent-id/retry-failed')
    expect(retryResp.status()).toBe(404)
  })

  // AC: FE: 'Retry failed' button is visible in the job progress panel for completed_with_errors jobs
  test('retry failed button is visible for completed_with_errors job in UI', async ({ page, request }) => {
    // AC: FE: 'Retry failed' button appears on completed_with_errors jobs in the job progress panel
    // Seed a completed_with_errors job via the test seed endpoint
    const jobId = await seedJob(request, 'completed_with_errors', {
      study_name: 'Errored Study',
      total_items: 4,
      completed_items: 3,
    })

    // Navigate to the main page and open the job progress panel
    await page.goto('/', { waitUntil: 'networkidle' })
    await openJobProgressPanel(page)

    // The job card should be visible
    const jobCard = page.locator(`[data-testid="job-${jobId}"]`)
    await expect(jobCard).toBeVisible()

    // The retry failed button should be visible for the completed_with_errors job
    const retryBtn = page.locator(`[data-testid="job-${jobId}-retry-failed"]`)
    await expect(retryBtn).toBeVisible()
  })

  // AC: FE: 'Retry failed' button is NOT visible for completed jobs (only for completed_with_errors)
  test('retry failed button is NOT visible for a completed job', async ({ page, request }) => {
    // AC: FE: 'Retry failed' button only appears on completed_with_errors jobs
    const jobId = await seedJob(request, 'completed', {
      study_name: 'Completed Study',
      total_items: 4,
      completed_items: 4,
    })

    await page.goto('/', { waitUntil: 'networkidle' })
    await openJobProgressPanel(page)

    const jobCard = page.locator(`[data-testid="job-${jobId}"]`)
    await expect(jobCard).toBeVisible()

    // The retry failed button should NOT be present for a completed (not errored) job
    const retryBtn = page.locator(`[data-testid="job-${jobId}-retry-failed"]`)
    await expect(retryBtn).not.toBeVisible()
  })
})
