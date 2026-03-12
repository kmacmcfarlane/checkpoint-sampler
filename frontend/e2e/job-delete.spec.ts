import { test, expect, type APIRequestContext } from '@playwright/test'
import { resetDatabase, closeDrawer } from './helpers'

/**
 * E2E tests for sample job deletion with optional sample data removal (S-097).
 *
 * ## What is tested
 *
 * AC1: FE: Delete button on job cards shows the standard confirmation dialog.
 * AC2: FE: Confirmation dialog includes 'Also delete sample data' checkbox (default off).
 * AC3: BE: Deleting a job without the data flag removes only the database record.
 * AC4: BE: Deleting a job with the data flag also removes generated sample files
 *         (verified indirectly via the API — delete_data=true returns 204).
 *
 * ## Test data setup
 *
 * Jobs are created directly via REST API to keep test setup simple.
 * Each test navigates to the Jobs panel, locates the job card, and verifies
 * the delete flow.
 */

const STUDY_PAYLOAD = {
  name: 'S-097 Delete Test Study',
  prompt_prefix: '',
  prompts: [{ name: 'landscape', text: 'a beautiful landscape' }],
  negative_prompt: '',
  steps: [20],
  cfgs: [7.0],
  sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
  seeds: [42],
  width: 512,
  height: 512,
  // S-112: Workflow settings are now part of the study definition
  workflow_template: 'test-workflow.json',
  vae: 'test-vae.safetensors',
  text_encoder: 'test-clip.safetensors',
}

/** Create a study via the REST API and return its ID. */
async function createStudyViaAPI(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/studies', { data: STUDY_PAYLOAD })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return body.id as string
}

/** Create a sample job via the REST API and return its ID. */
// S-112: workflow_name/vae/clip come from the study definition, not the job payload
async function createJobViaAPI(request: APIRequestContext, studyId: string): Promise<string> {
  const response = await request.post('/api/sample-jobs', {
    data: {
      training_run_name: 'my-model',
      study_id: studyId,
    },
  })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return body.id as string
}

/**
 * Waits for a job's Delete button to become visible by polling the Refresh button.
 *
 * S-122: The Delete button is hidden while a job is `running`. Jobs created via
 * the API start as `pending` and are immediately picked up by the executor, which
 * transitions them to `running`. In the E2E environment the ComfyUI mock completes
 * jobs quickly (pending→running→completed in ~3s), but the UI may not have received
 * the WebSocket completion event yet. This helper periodically clicks the Refresh
 * button in the panel to re-fetch job data until the Delete button appears.
 */
async function waitForDeleteButton(page: import('@playwright/test').Page, jobId: string): Promise<import('@playwright/test').Locator> {
  const deleteButton = page.locator(`[data-testid="job-${jobId}-delete"]`)
  const refreshButton = page.locator('button').filter({ hasText: 'Refresh' })

  // Poll: click Refresh up to 10 times (with 3s intervals) until Delete appears
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await deleteButton.isVisible()) {
      return deleteButton
    }
    // Click Refresh to re-fetch job data from the API
    if (await refreshButton.isVisible()) {
      await refreshButton.click()
    }
    await page.waitForTimeout(3000)
  }

  // Final check — fail with a clear assertion error if still not visible
  await expect(deleteButton).toBeVisible({ timeout: 3000 })
  return deleteButton
}

/**
 * Opens the Job Progress Panel (the "Jobs" button in the header).
 * Closes the sidebar drawer first to unblock the header controls.
 */
async function openJobProgressPanel(page: import('@playwright/test').Page): Promise<void> {
  await closeDrawer(page)

  const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
  await expect(jobsButton).toBeVisible()
  await jobsButton.click()

  // Wait for the Jobs modal to appear (NModal with title "Sample Jobs")
  const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  await expect(modal).toBeVisible()
}

/**
 * S-122: Restrict Delete button to non-running jobs.
 *
 * Tests verify Delete button visibility per job status.
 * Note: Running state (hidden Delete) is verified via unit tests (JobProgressPanel.test.ts)
 * because the test API only creates jobs in `pending` state — triggering actual execution
 * requires a live ComfyUI connection which is not available in the E2E stack.
 */
test.describe('delete button visibility by job status (S-122)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  // AC: FE: Delete button remains visible for all other job statuses
  test('AC3: Delete button is visible on a non-running job (appears once job leaves running state)', async ({ page, request }) => {
    // AC: FE: Delete button remains visible for all other job statuses
    // Jobs start as pending, transition to running (Delete hidden), then to completed (Delete visible).
    // This test verifies that the Delete button appears once the job exits the running state.
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    const jobCard = page.locator(`[data-testid="job-${jobId}"]`)
    await expect(jobCard).toBeVisible()

    // S-122: Delete button is hidden while running; wait for job to finish and button to appear
    await waitForDeleteButton(page, jobId)
  })
})

test.describe('job deletion with optional sample data removal (S-097)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  // AC1: Delete button on job cards shows the standard confirmation dialog
  test('AC1: clicking Delete button on a job card opens the ConfirmDeleteDialog', async ({ page, request }) => {
    // AC: FE: Delete button on job cards shows the standard confirmation dialog
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    // Locate the job card by its data-testid
    const jobCard = page.locator(`[data-testid="job-${jobId}"]`)
    await expect(jobCard).toBeVisible()

    // S-122: Delete button is hidden while running; wait for job to finish (pending→running→completed)
    const deleteButton = await waitForDeleteButton(page, jobId)
    await deleteButton.click()

    // AC1: The ConfirmDeleteDialog should appear
    const confirmDialog = page.locator('[data-testid="delete-job-dialog"]')
    await expect(confirmDialog).toBeVisible()
  })

  // AC2: Confirmation dialog includes 'Also delete sample data' checkbox (default off)
  test('AC2: confirmation dialog has "Also delete sample data" checkbox unchecked by default', async ({ page, request }) => {
    // AC: FE: Confirmation dialog includes 'Also delete sample data' checkbox (default off)
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    // S-122: Delete button is hidden while running; wait for job to finish
    const deleteButton = await waitForDeleteButton(page, jobId)
    await deleteButton.click()

    const confirmDialog = page.locator('[data-testid="delete-job-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // AC2: Checkbox is present and unchecked by default
    const checkbox = confirmDialog.locator('[data-testid="confirm-delete-checkbox"]')
    await expect(checkbox).toBeVisible()
    // Naive UI unchecked state: does NOT have n-checkbox--checked class
    await expect(checkbox).not.toHaveClass(/n-checkbox--checked/)
  })

  // AC3: Cancelling the dialog does not delete the job
  test('AC3 (cancel): cancelling the dialog does not delete the job', async ({ page, request }) => {
    // AC: FE: Dialog cancellation leaves the job intact
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    // S-122: Delete button is hidden while running; wait for job to finish
    const deleteButton = await waitForDeleteButton(page, jobId)
    await deleteButton.click()

    const confirmDialog = page.locator('[data-testid="delete-job-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // Click Cancel
    const cancelButton = confirmDialog.locator('[data-testid="confirm-cancel-button"]')
    await cancelButton.click()
    await expect(confirmDialog).not.toBeVisible()

    // Job should still exist in the API
    const jobsResponse = await request.get('/api/sample-jobs')
    expect(jobsResponse.status()).toBe(200)
    const jobsData = await jobsResponse.json()
    const found = jobsData.some((j: { id: string }) => j.id === jobId)
    expect(found).toBe(true)
  })

  // AC3: BE: Confirming deletion without checkbox removes only the database record
  test('AC3 (confirm, no data): confirming without checking the checkbox deletes the job', async ({ page, request }) => {
    // AC: BE: Deleting a job without the data flag removes only the database record
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    // S-122: Delete button is hidden while running; wait for job to finish
    const deleteButton = await waitForDeleteButton(page, jobId)
    await deleteButton.click()

    const confirmDialog = page.locator('[data-testid="delete-job-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // Do NOT check the checkbox (keep default: off = don't delete sample data)
    // Click "Yes, Delete"
    const confirmButton = confirmDialog.locator('[data-testid="confirm-delete-button"]')
    await confirmButton.click()
    await expect(confirmDialog).not.toBeVisible()

    // Job should be gone from the API
    const jobsResponse = await request.get('/api/sample-jobs')
    expect(jobsResponse.status()).toBe(200)
    const jobsData = await jobsResponse.json()
    const found = jobsData.some((j: { id: string }) => j.id === jobId)
    expect(found).toBe(false)
  })

  // AC3+AC4: BE: DELETE /api/sample-jobs/{id}?delete_data=false and delete_data=true both return 204
  test('BE: DELETE /api/sample-jobs/{id} returns 204 with and without delete_data', async ({ request }) => {
    // AC: BE: Both deletion paths return 204 No Content
    const studyId = await createStudyViaAPI(request)

    // Job 1: delete without data flag
    const jobId1 = await createJobViaAPI(request, studyId)
    const resp1 = await request.delete(`/api/sample-jobs/${jobId1}`)
    expect(resp1.status()).toBe(204)

    // Job 2: delete with delete_data=true
    const jobId2 = await createJobViaAPI(request, studyId)
    const resp2 = await request.delete(`/api/sample-jobs/${jobId2}?delete_data=true`)
    expect(resp2.status()).toBe(204)

    // Both jobs should be gone
    const jobsResponse = await request.get('/api/sample-jobs')
    expect(jobsResponse.status()).toBe(200)
    const jobsData = await jobsResponse.json()
    expect(jobsData.every((j: { id: string }) => j.id !== jobId1 && j.id !== jobId2)).toBe(true)
  })
})
