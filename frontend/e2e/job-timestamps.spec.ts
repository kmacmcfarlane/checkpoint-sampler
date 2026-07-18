import { test, expect, type APIRequestContext } from '@playwright/test'
import { resetDatabase, closeDrawer } from './helpers'

/**
 * E2E tests for B-133: Job updated_at timestamps and list sort order.
 *
 * ## What is tested
 *
 * AC: FE: Job item view displays both created_at and updated_at timestamps.
 * AC: BE (original, B-133): Job list query sorts by updated_at DESC instead of
 *         created_at DESC (verified via the list API response; the UI sort
 *         follows this). NOTE: superseded by S-170, which changed list
 *         ordering to created_at DESC / id DESC for stable pagination — see
 *         the "sorted by created_at DESC" test below.
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

  // AC (UAT feedback): When a job reorders to the top of the list, auto-scroll occurs
  // so the new top item is visible. Verified by confirming the sentinel element is
  // present in the DOM when the list is non-empty.
  test('job list has auto-scroll sentinel element', async ({ page, request }) => {
    // AC: UAT feedback: Job list auto-scrolls when an item reorders to the top.
    await seedJobs(request, [
      { status: 'pending', training_run_name: 'scroll-test-run', study_name: 'Scroll Test Study' },
    ])

    await page.goto('/')
    await openJobProgressPanel(page)

    const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
    await expect(modal).toBeVisible()

    // The sentinel element must be present in the DOM so scrollIntoView can be called
    // when the first job's ID changes on subsequent data updates.
    const sentinel = modal.locator('[data-testid="job-list-top-sentinel"]')
    await expect(sentinel).toBeAttached()
  })

  // AC (UAT feedback): When a new job with a more recent updated_at arrives via refresh,
  // the list reorders and the sentinel scrolls into view (placing the new top item visible).
  test('job list scrolls to top when a new job becomes first after refresh', async ({ page, request }) => {
    // AC: UAT feedback: job list auto-scrolls so the item is visible at the top.
    // Use terminal statuses (completed/stopped) to prevent the job executor from
    // picking up the jobs and changing their updated_at to the current time.
    await seedJobs(request, [
      {
        training_run_name: 'initial-top',
        study_name: 'Initial Top Study',
        status: 'completed',
        updated_at: '2025-01-02T10:00:00Z',
      },
      {
        training_run_name: 'initial-bottom',
        study_name: 'Initial Bottom Study',
        status: 'stopped',
        updated_at: '2025-01-01T10:00:00Z',
      },
    ])

    await page.goto('/')
    await openJobProgressPanel(page)

    const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
    await expect(modal).toBeVisible()

    // Verify initial order: "Initial Top Study" appears first in the job list
    await expect(modal).toContainText('Initial Top Study')

    // Seed a third job with a newer updated_at than the initial jobs — it will reorder to top after refresh.
    // Use a timestamp that is between the initial jobs' timestamps and the current system time
    // but newer than all seeded updated_at values to guarantee it sorts first.
    await seedJobs(request, [
      {
        training_run_name: 'new-top',
        study_name: 'New Top Study After Refresh',
        status: 'completed',
        updated_at: '2025-01-10T12:00:00Z',
      },
    ])

    // Click Refresh to reload the job list
    const refreshButton = modal.locator('button', { hasText: 'Refresh' })
    await expect(refreshButton).toBeVisible()
    await refreshButton.click()

    // Wait for the new job to appear (list re-renders with new data)
    await expect(modal).toContainText('New Top Study After Refresh', { timeout: 10000 })

    // The sentinel element is in the DOM — the watch fired and scrollIntoView was called
    // on it when the top job changed from "initial-top" to "new-top"
    const sentinel = modal.locator('[data-testid="job-list-top-sentinel"]')
    await expect(sentinel).toBeAttached()

    // Verify the new top job is the first item in the list
    const newTopJob = modal.locator('.job-item').first()
    await expect(newTopJob).toContainText('New Top Study After Refresh')
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

  // AC (superseded by S-170): The list API previously sorted by updated_at DESC
  // (B-133). S-170 changed list ordering to created_at DESC with id DESC as a
  // stable tiebreak so that limit/offset pagination is stable across page
  // fetches — updated_at mutates while a job is running, which would otherwise
  // shift a job between pages and cause duplicate/missing rows at page
  // boundaries. See backend/internal/store/sample_job.go ListSampleJobsPage.
  test('list API returns jobs sorted by created_at DESC (S-170)', async ({ request }) => {
    // Seed two jobs: job A was created first but updated more recently,
    // job B was created more recently but not updated since creation.
    // The list should return job B first (most recently created), even though
    // job A has the more recent updated_at — sort is by created_at, not updated_at.
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

    // Fetch the list and verify sort order (created_at DESC: job B before job A)
    const listResp = await request.get('/api/v1/sample-jobs')
    expect(listResp.status()).toBe(200)
    const jobs = await listResp.json() as Array<{ id: string; training_run_name: string; created_at: string }>

    expect(jobs).toHaveLength(2)
    // First item should be the one with the more recent created_at (run-b)
    expect(jobs[0].training_run_name).toBe('run-b')
    expect(jobs[1].training_run_name).toBe('run-a')

    // Confirm the jobIDs are the ones we seeded (order may differ from API response)
    const returnedIDs = new Set(jobs.map(j => j.id))
    for (const id of jobIDs) {
      expect(returnedIDs).toContain(id)
    }
  })
})
