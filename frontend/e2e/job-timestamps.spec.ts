import { test, expect, type APIRequestContext } from '@playwright/test'
import { resetDatabase, closeDrawer } from './helpers'

/**
 * E2E tests for B-133: Job updated_at timestamps and list sort order.
 *
 * ## What is tested
 *
 * AC: FE: Job item view displays both created_at and updated_at timestamps.
 * AC: BE: Job list query sorts by updated_at DESC instead of created_at DESC
 *         (verified via the list API response; the UI sort follows this).
 */

/** Seeds sample jobs directly via the test endpoint. */
async function seedJobs(request: APIRequestContext, jobs: Array<{
  training_run_name?: string
  study_id?: string
  study_name?: string
  workflow_name?: string
  status: string
  total_items?: number
  completed_items?: number
  created_at?: string
  updated_at?: string
}>): Promise<string[]> {
  const payload = jobs.map((j, i) => ({
    training_run_name: j.training_run_name ?? 'my-model',
    study_id: j.study_id ?? `test-study-${i + 1}`,
    study_name: j.study_name ?? `Test Study ${i + 1}`,
    workflow_name: j.workflow_name ?? 'test-workflow.json',
    status: j.status,
    total_items: j.total_items ?? 4,
    completed_items: j.completed_items ?? 0,
    ...(j.created_at && { created_at: j.created_at }),
    ...(j.updated_at && { updated_at: j.updated_at }),
  }))

  const response = await request.post('/api/test/seed-jobs', { data: payload })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return body.job_ids as string[]
}

/** Opens the Job Progress Panel modal. */
async function openJobProgressPanel(page: import('@playwright/test').Page): Promise<void> {
  await closeDrawer(page)

  const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
  await expect(jobsButton).toBeVisible()
  await jobsButton.click()

  const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  await expect(modal).toBeVisible()
}

test.describe('job timestamps (B-133)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: FE: Job item view displays both created_at and updated_at timestamps.
  test('job card shows both Created and Updated timestamps', async ({ page, request }) => {
    await seedJobs(request, [
      { status: 'pending', training_run_name: 'ts-test-run', study_name: 'TS Study' },
    ])

    await page.goto('/')
    await openJobProgressPanel(page)

    const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })

    // AC: FE: Job item view displays both created_at and updated_at timestamps.
    // Both "Created:" and "Updated:" labels should appear in the job meta row.
    await expect(modal.locator('text=Created:')).toBeVisible()
    await expect(modal.locator('text=Updated:')).toBeVisible()
  })

  // AC: BE: Job list query sorts by updated_at DESC instead of created_at DESC.
  // Verified at the API level: two jobs with different updated_at values should be
  // returned in updated_at DESC order.
  test('list API returns jobs sorted by updated_at DESC', async ({ request }) => {
    // AC: BE: Job list query sorts by updated_at DESC instead of created_at DESC.
    // Seed two jobs: job A was created first but updated more recently,
    // job B was created more recently but not updated since creation.
    // The list should return job A first (most recently updated).
    const olderCreated = '2025-01-01T10:00:00Z'
    const newerUpdated = '2025-01-03T12:00:00Z' // A was updated most recently
    const newerCreated = '2025-01-02T08:00:00Z'
    const olderUpdated = '2025-01-02T08:00:00Z' // B was not updated after creation

    const jobIDs = await seedJobs(request, [
      {
        training_run_name: 'run-a',
        study_name: 'Study A',
        status: 'completed',
        created_at: olderCreated,
        updated_at: newerUpdated,
      },
      {
        training_run_name: 'run-b',
        study_name: 'Study B',
        status: 'pending',
        created_at: newerCreated,
        updated_at: olderUpdated,
      },
    ])

    // Fetch the list and verify sort order (updated_at DESC: job A before job B)
    const listResp = await request.get('/api/sample-jobs')
    expect(listResp.status()).toBe(200)
    const jobs = await listResp.json() as Array<{ id: string; training_run_name: string; updated_at: string }>

    expect(jobs).toHaveLength(2)
    // First item should be the one with the more recent updated_at (run-a)
    expect(jobs[0].training_run_name).toBe('run-a')
    expect(jobs[1].training_run_name).toBe('run-b')

    // Confirm the jobIDs are the ones we seeded (order may differ from API response)
    const returnedIDs = new Set(jobs.map(j => j.id))
    for (const id of jobIDs) {
      expect(returnedIDs).toContain(id)
    }
  })
})
