import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { resetDatabase, closeDrawer, cancelAllJobs } from './helpers'

/**
 * E2E tests for S-170: paginated GET /api/v1/sample-jobs with invisible lazy
 * loading in the UI, and traceback stripping from the list view.
 *
 * AC1: BE — list endpoint supports limit/offset with stable ordering
 * AC2: BE — list responses omit failed_item_details tracebacks (kept on show)
 * AC3: FE — job list lazy-loads older pages ahead of the scroll (no button)
 * AC4: FE+E2E — paging boundaries and seamless load-on-scroll
 */

/** Seeds N sample jobs via the test-only endpoint and returns their IDs. */
async function seedManyJobs(request: APIRequestContext, count: number, status = 'completed'): Promise<string[]> {
  const payload = Array.from({ length: count }, (_, i) => ({
    training_run_name: 'my-model',
    study_id: `test-study-${i + 1}`,
    study_name: `Study ${i + 1}`,
    workflow_name: 'test-workflow.json',
    status,
    total_items: 4,
    completed_items: status === 'completed' ? 4 : 0,
  }))
  const response = await request.post('/api/test/seed-jobs', { data: payload })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return body.job_ids as string[]
}

async function openJobProgressPanel(page: Page): Promise<void> {
  await closeDrawer(page)
  const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
  await expect(jobsButton).toBeVisible()
  await jobsButton.click()
  const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  await expect(modal).toBeVisible()
}

test.describe('sample-jobs pagination (S-170)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC1/AC4: limit + offset return disjoint, ordered pages and the total count
  // is surfaced in the X-Total-Count header.
  test('AC1: limit/offset return disjoint pages with X-Total-Count header', async ({ request }) => {
    await seedManyJobs(request, 5)

    // Page 1: first two jobs.
    const page1Resp = await request.get('/api/v1/sample-jobs?limit=2&offset=0')
    expect(page1Resp.status()).toBe(200)
    expect(page1Resp.headers()['x-total-count']).toBe('5')
    const page1 = await page1Resp.json() as Array<{ id: string }>
    expect(page1).toHaveLength(2)

    // Page 2: next two jobs.
    const page2Resp = await request.get('/api/v1/sample-jobs?limit=2&offset=2')
    expect(page2Resp.headers()['x-total-count']).toBe('5')
    const page2 = await page2Resp.json() as Array<{ id: string }>
    expect(page2).toHaveLength(2)

    // Final page: remaining single job (partial page, no overrun).
    const page3Resp = await request.get('/api/v1/sample-jobs?limit=2&offset=4')
    const page3 = await page3Resp.json() as Array<{ id: string }>
    expect(page3).toHaveLength(1)

    // Pages must be disjoint — no job appears twice across the three pages.
    const allIds = [...page1, ...page2, ...page3].map(j => j.id)
    expect(new Set(allIds).size).toBe(5)

    // Offset past the end yields an empty page (still 200, no error).
    const emptyResp = await request.get('/api/v1/sample-jobs?limit=2&offset=99')
    expect(emptyResp.status()).toBe(200)
    expect(await emptyResp.json()).toHaveLength(0)
  })

  // AC1: default (no params) request is backward compatible — returns an array.
  test('AC1: default list request returns a bare array (backward compatible)', async ({ request }) => {
    await seedManyJobs(request, 3)
    const resp = await request.get('/api/v1/sample-jobs')
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(3)
    expect(resp.headers()['x-total-count']).toBe('3')
  })

  // AC2: list entries never carry the per-item traceback blob.
  test('AC2: list responses omit failed_item_details tracebacks', async ({ request }) => {
    await seedManyJobs(request, 3)
    const resp = await request.get('/api/v1/sample-jobs')
    const jobs = await resp.json() as Array<{ failed_item_details?: Array<{ traceback?: string }> }>
    for (const job of jobs) {
      for (const detail of job.failed_item_details ?? []) {
        expect(detail.traceback).toBeUndefined()
      }
    }
  })

  // AC3/AC4: the UI loads the first page and then lazily appends older jobs as
  // the user scrolls the panel, with no manual "load more" button.
  test('AC3+AC4: older jobs load seamlessly on scroll (no load-more button)', async ({ page, request }) => {
    // Seed more than one page (page size is 50) so a second page exists.
    await seedManyJobs(request, 60)

    await page.goto('/', { waitUntil: 'networkidle' })
    await openJobProgressPanel(page)

    const cards = page.locator('.job-item')

    // First page fills the list with 50 cards.
    await expect.poll(async () => cards.count()).toBe(50)

    // There is no manual "Load more" button anywhere in the panel.
    await expect(page.getByRole('button', { name: /load more/i })).toHaveCount(0)

    // Scroll the panel's internal container to the bottom to trigger prefetch.
    const scroll = page.locator('[data-testid="jobs-scroll-container"]')
    await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })

    // The remaining 10 older jobs load in seamlessly, reaching the 60 total.
    await expect.poll(async () => cards.count(), { timeout: 10000 }).toBe(60)
  })
})
