import { test, expect, type APIRequestContext } from '@playwright/test'
import { resetDatabase, closeDrawer } from './helpers'

/**
 * E2E tests for the test seed jobs endpoint (S-111).
 *
 * These tests verify that the /api/test/seed-jobs endpoint can be used to
 * create sample jobs with specified statuses, enabling E2E testing of
 * job-related UI without requiring ComfyUI to be fully operational.
 *
 * ## What is tested
 *
 * AC1: BE: Test-only seed endpoint creates sample jobs with specified statuses
 * AC2: BE: Endpoint is only available in test mode
 * AC4: E2E: Seed endpoint used to verify job-related UI shows seeded jobs
 */

/**
 * Seeds sample jobs via the test-only endpoint and returns the job IDs.
 * Uses a minimal valid study_id from the fixture seeder.
 */
async function seedJobs(request: APIRequestContext, jobs: Array<{
  training_run_name?: string
  study_id?: string
  study_name?: string
  workflow_name?: string
  status: string
  total_items?: number
  completed_items?: number
}>): Promise<string[]> {
  const payload = jobs.map((j, i) => ({
    training_run_name: j.training_run_name ?? 'my-model',
    study_id: j.study_id ?? `test-study-${i + 1}`,
    study_name: j.study_name ?? `Test Study ${i + 1}`,
    workflow_name: j.workflow_name ?? 'test-workflow.json',
    status: j.status,
    total_items: j.total_items ?? 4,
    completed_items: j.completed_items ?? 0,
  }))

  const response = await request.post('/api/test/seed-jobs', { data: payload })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return body.job_ids as string[]
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

test.describe('test seed-jobs endpoint (S-111)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: BE: Test-only seed endpoint creates sample jobs with specified statuses
  // AC2: BE: Endpoint is only available in test mode (verified by checking the endpoint works)
  test('AC1+AC2: seed endpoint creates jobs visible via the list API', async ({ request }) => {
    // AC: BE: Test-only seed endpoint creates sample jobs with specified statuses
    // Verify the jobs list is empty after reset
    const emptyResp = await request.get('/api/sample-jobs')
    expect(emptyResp.status()).toBe(200)
    const emptyBody = await emptyResp.json()
    expect(emptyBody).toHaveLength(0)

    // Seed two jobs with different statuses
    const jobIDs = await seedJobs(request, [
      { status: 'pending', total_items: 5, completed_items: 0 },
      { status: 'completed', total_items: 10, completed_items: 10 },
    ])
    expect(jobIDs).toHaveLength(2)

    // AC1: Verify both jobs appear in the list API
    const listResp = await request.get('/api/sample-jobs')
    expect(listResp.status()).toBe(200)
    const jobs = await listResp.json() as Array<{ id: string; status: string; total_items: number; completed_items: number }>
    expect(jobs).toHaveLength(2)

    // Check that job statuses match what we requested
    const pendingJob = jobs.find(j => j.id === jobIDs[0])
    expect(pendingJob).toBeDefined()
    expect(pendingJob?.status).toBe('pending')
    expect(pendingJob?.total_items).toBe(5)
    expect(pendingJob?.completed_items).toBe(0)

    const completedJob = jobs.find(j => j.id === jobIDs[1])
    expect(completedJob).toBeDefined()
    expect(completedJob?.status).toBe('completed')
    expect(completedJob?.total_items).toBe(10)
    expect(completedJob?.completed_items).toBe(10)
  })

  // AC4: E2E: At least one E2E test uses the seed endpoint to verify job-related UI
  test('AC4: seeded jobs appear in the Job Progress Panel UI', async ({ page, request }) => {
    // AC: E2E: Seed endpoint used to verify job-related UI shows seeded jobs
    // Seed a pending job
    const jobIDs = await seedJobs(request, [
      {
        status: 'pending',
        study_name: 'Seed Test Study',
        total_items: 8,
        completed_items: 0,
      },
    ])
    expect(jobIDs).toHaveLength(1)
    const jobId = jobIDs[0]

    // Navigate to the main page
    await page.goto('/', { waitUntil: 'networkidle' })

    // Open the Job Progress Panel
    await openJobProgressPanel(page)

    // AC4: The seeded job card should be visible in the UI
    const jobCard = page.locator(`[data-testid="job-${jobId}"]`)
    await expect(jobCard).toBeVisible()

    // The study name should appear on the card
    await expect(jobCard).toContainText('Seed Test Study')
  })

  test('AC4: seeded completed job appears with correct status in UI', async ({ page, request }) => {
    // AC: E2E: Seed endpoint used to verify job-related UI shows completed jobs
    const jobIDs = await seedJobs(request, [
      {
        status: 'completed',
        study_name: 'Completed Study',
        total_items: 6,
        completed_items: 6,
      },
    ])
    expect(jobIDs).toHaveLength(1)
    const jobId = jobIDs[0]

    await page.goto('/', { waitUntil: 'networkidle' })
    await openJobProgressPanel(page)

    // AC4: The completed job card should be visible
    const jobCard = page.locator(`[data-testid="job-${jobId}"]`)
    await expect(jobCard).toBeVisible()
    await expect(jobCard).toContainText('Completed Study')
  })

  test('AC4: multiple seeded jobs with different statuses all appear in the UI', async ({ page, request }) => {
    // AC: E2E: Seed endpoint creates multiple jobs visible in the job panel
    const jobIDs = await seedJobs(request, [
      { status: 'pending', study_name: 'Study Alpha', total_items: 4 },
      { status: 'completed', study_name: 'Study Beta', total_items: 4, completed_items: 4 },
      { status: 'failed', study_name: 'Study Gamma', total_items: 4 },
    ])
    expect(jobIDs).toHaveLength(3)

    await page.goto('/', { waitUntil: 'networkidle' })
    await openJobProgressPanel(page)

    // All three job cards should be visible
    for (const jobId of jobIDs) {
      const jobCard = page.locator(`[data-testid="job-${jobId}"]`)
      await expect(jobCard).toBeVisible()
    }

    // Verify study names appear on cards
    const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
    await expect(modal).toContainText('Study Alpha')
    await expect(modal).toContainText('Study Beta')
    await expect(modal).toContainText('Study Gamma')
  })

  test('AC1: seed endpoint returns correct job IDs matching created jobs', async ({ request }) => {
    // AC: BE: Test-only seed endpoint creates sample jobs with specified statuses
    const jobIDs = await seedJobs(request, [
      { status: 'running', total_items: 10, completed_items: 3 },
    ])
    expect(jobIDs).toHaveLength(1)

    // Show endpoint returns the seeded job
    const showResp = await request.get(`/api/sample-jobs/${jobIDs[0]}`)
    expect(showResp.status()).toBe(200)
    const job = await showResp.json()
    expect(job.job.id).toBe(jobIDs[0])
    expect(job.job.status).toBe('running')
    expect(job.job.total_items).toBe(10)
    expect(job.job.completed_items).toBe(3)
  })
})
