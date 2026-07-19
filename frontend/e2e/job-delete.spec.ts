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
 * Tests that verify delete UI behaviour (AC1–AC3 frontend) use the seed endpoint to
 * create jobs directly in `completed` state. This avoids flakiness from the
 * pending→running→completed transition race (B-118): the Delete button is hidden while
 * a job is `running`, so tests that create real pending jobs must wait for the executor
 * to complete them before the button becomes visible.
 *
 * The transition test (S-122 AC3) still creates a real pending job and polls for the
 * Delete button to appear, verifying that the button becomes visible after execution.
 *
 * Jobs are deleted after each test via the API reset endpoint so no state leaks.
 */

// B-118: Use seed endpoint to create jobs in a known terminal state (completed),
// bypassing the executor. This eliminates the pending→running→completed race that
// caused the Delete button to be hidden when the panel first opened.
async function seedCompletedJob(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/test/seed-jobs', {
    data: [
      {
        training_run_name: 'my-model',
        study_id: 'seed-study-001',
        study_name: 'S-097 Delete Test Study',
        workflow_name: 'test-workflow.json',
        status: 'completed',
        total_items: 1,
        completed_items: 1,
      },
    ],
  })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return (body.job_ids as string[])[0]
}

const STUDY_PAYLOAD = {
  name: 'S-097 Delete Test Study',
  prompt_prefix: '',
  prompts: [{ name: 'landscape', text: 'a beautiful landscape' }],
  negative_prompt: '',
  steps: [20],
  cfgs: [7.0],
  sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
  seeds: [42],
  resolutions: [{ width: 512, height: 512 }],
  // S-112: Workflow settings are now part of the study definition
  // S-157: vae/text_encoder are multi-value list dimensions on the API
  workflow_template: 'test-workflow.json',
  vaes: ['test-vae.safetensors'],
  text_encoders: ['test-clip.safetensors'],
}

/** Create a study via the REST API and return its ID. */
async function createStudyViaAPI(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/v1/studies', { data: STUDY_PAYLOAD })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return body.id as string
}

/** Create a sample job via the REST API and return its ID. */
// S-112: workflow_name/vae/clip come from the study definition, not the job payload
async function createJobViaAPI(request: APIRequestContext, studyId: string): Promise<string> {
  const response = await request.post('/api/v1/sample-jobs', {
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
 *
 * B-118: Only used by the transition test (S-122 AC3). All other tests use
 * seedCompletedJob() to create jobs directly in completed state.
 */
async function waitForDeleteButton(page: import('@playwright/test').Page, jobId: string): Promise<import('@playwright/test').Locator> {
  const deleteButton = page.locator(`[data-testid="job-${jobId}-delete"]`)
  const refreshButton = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' }).locator('button').filter({ hasText: 'Refresh' })

  // Poll on the actual awaited state (Delete button visible), clicking Refresh
  // between polls to re-fetch job data from the API. expect.poll retries on its
  // own schedule and stops as soon as the condition holds — no fixed sleeps.
  await expect
    .poll(
      async () => {
        if (await deleteButton.isVisible()) {
          return true
        }
        if (await refreshButton.isVisible()) {
          await refreshButton.click()
        }
        return false
      },
      { timeout: 30000, intervals: [250, 500, 1000, 2000] },
    )
    .toBe(true)

  await expect(deleteButton).toBeVisible()
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
    // B-118: Use seed endpoint to create a completed job so the Delete button is
    // immediately visible without waiting for the executor transition.
    const jobId = await seedCompletedJob(request)

    await openJobProgressPanel(page)

    // Locate the job card by its data-testid
    const jobCard = page.locator(`[data-testid="job-${jobId}"]`)
    await expect(jobCard).toBeVisible()

    // The Delete button should be immediately visible for a completed job
    const deleteButton = page.locator(`[data-testid="job-${jobId}-delete"]`)
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    // AC1: The ConfirmDeleteDialog should appear.
    // The data-testid="delete-job-dialog" is set on the <ConfirmDeleteDialog> component
    // in JobProgressPanel.vue. Naive UI NModal forwards fallthrough attributes from
    // parent components to the teleported card element, so this testid IS in the DOM.
    const confirmDialog = page.locator('[data-testid="delete-job-dialog"]')
    await expect(confirmDialog).toBeVisible()
  })

  // AC2: Confirmation dialog includes 'Also delete sample data' checkbox (default off)
  test('AC2: confirmation dialog has "Also delete sample data" checkbox unchecked by default', async ({ page, request }) => {
    // AC: FE: Confirmation dialog includes 'Also delete sample data' checkbox (default off)
    // B-118: Use seed endpoint to create a completed job so the Delete button is immediately visible.
    const jobId = await seedCompletedJob(request)

    await openJobProgressPanel(page)

    const deleteButton = page.locator(`[data-testid="job-${jobId}-delete"]`)
    await expect(deleteButton).toBeVisible()
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
    // B-118: Use seed endpoint to create a completed job so the Delete button is immediately visible.
    const jobId = await seedCompletedJob(request)

    await openJobProgressPanel(page)

    const deleteButton = page.locator(`[data-testid="job-${jobId}-delete"]`)
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    const confirmDialog = page.locator('[data-testid="delete-job-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // Click Cancel
    const cancelButton = confirmDialog.locator('[data-testid="confirm-cancel-button"]')
    await cancelButton.click()
    await expect(confirmDialog).not.toBeVisible()

    // Job should still exist in the API
    const jobsResponse = await request.get('/api/v1/sample-jobs')
    expect(jobsResponse.status()).toBe(200)
    const jobsData = await jobsResponse.json()
    const found = jobsData.some((j: { id: string }) => j.id === jobId)
    expect(found).toBe(true)
  })

  // AC3: BE: Confirming deletion without checkbox removes only the database record
  test('AC3 (confirm, no data): confirming without checking the checkbox deletes the job', async ({ page, request }) => {
    // AC: BE: Deleting a job without the data flag removes only the database record
    // B-118: Use seed endpoint to create a completed job so the Delete button is immediately visible.
    const jobId = await seedCompletedJob(request)

    await openJobProgressPanel(page)

    const deleteButton = page.locator(`[data-testid="job-${jobId}-delete"]`)
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    const confirmDialog = page.locator('[data-testid="delete-job-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // Do NOT check the checkbox (keep default: off = don't delete sample data)
    // Click "Yes, Delete" — register the waitForResponse BEFORE clicking to avoid a race
    // where the DELETE response arrives before the listener is set up.
    const confirmButton = confirmDialog.locator('[data-testid="confirm-delete-button"]')
    // B-116: wait for the DELETE API response before checking GET /api/v1/sample-jobs,
    // otherwise the GET can race against the in-flight DELETE and see the job still present.
    await Promise.all([
      page.waitForResponse(
        resp =>
          resp.url().includes(`/api/v1/sample-jobs/${jobId}`) &&
          resp.request().method() === 'DELETE' &&
          resp.status() === 204,
      ),
      confirmButton.click(),
    ])
    await expect(confirmDialog).not.toBeVisible()

    // Job should be gone from the API
    const jobsResponse = await request.get('/api/v1/sample-jobs')
    expect(jobsResponse.status()).toBe(200)
    const jobsData = await jobsResponse.json()
    const found = jobsData.some((j: { id: string }) => j.id === jobId)
    expect(found).toBe(false)
  })

  // B-164: BE: delete_data=true must remove the actual on-disk output files, not just
  // return 204. This seeds real files via /api/test/seed-partial-samples (checkpoint
  // layout: {sampleDir}/{run}/{study}/{checkpoint}/), creates a real job for the same
  // training run/study/checkpoints, deletes with delete_data=true, and asserts via the
  // availability API that sample_status drops back to 'none' — i.e. the files are gone.
  test('B-164: DELETE with delete_data=true removes the actual sample files on disk', async ({ request }) => {
    // AC: BE: RemoveJobSampleDir resolves the deletion root via fileformat.StudyOutputDir
    // so delete-with-data removes the actual output files (checkpoint layout)
    const studyName = STUDY_PAYLOAD.name
    const studyId = await createStudyViaAPI(request)

    // Seed real files on disk for both checkpoints in the "my-model" training run,
    // matching the layout the real job executor writes into.
    const seedResp = await request.post('/api/test/seed-partial-samples', {
      data: {
        training_run_name: 'my-model',
        study_id: studyId,
        study_name: studyName,
        checkpoint_filenames: [
          'my-model-step00001000.safetensors',
          'my-model-step00002000.safetensors',
        ],
      },
    })
    expect(seedResp.status()).toBe(201)

    const runsResp = await request.get('/api/v1/training-runs?source=checkpoints')
    expect(runsResp.ok()).toBeTruthy()
    const runs = await runsResp.json() as Array<{ id: number; name: string }>
    const run = runs.find(r => r.name === 'my-model')
    expect(run).toBeDefined()

    // Confirm the seed produced a fully-sampled study (sanity check before delete).
    const beforeResp = await request.get(`/api/v1/studies/availability?training_run_id=${run!.id}`)
    expect(beforeResp.ok()).toBeTruthy()
    const beforeAvailabilities = await beforeResp.json() as Array<{ study_id: string; sample_status: string }>
    expect(beforeAvailabilities.find(a => a.study_id === studyId)?.sample_status).toBe('complete')

    // Create a real job for the same training run/study (items cover both checkpoints).
    const jobId = await createJobViaAPI(request, studyId)

    // Delete with delete_data=true.
    const deleteResp = await request.delete(`/api/v1/sample-jobs/${jobId}?delete_data=true`)
    expect(deleteResp.status()).toBe(204)

    // AC: the actual output files must be gone — availability must report 'none'.
    const afterResp = await request.get(`/api/v1/studies/availability?training_run_id=${run!.id}`)
    expect(afterResp.ok()).toBeTruthy()
    const afterAvailabilities = await afterResp.json() as Array<{ study_id: string; sample_status: string; has_samples: boolean }>
    const afterStudyAvail = afterAvailabilities.find(a => a.study_id === studyId)
    expect(afterStudyAvail).toBeDefined()
    expect(afterStudyAvail!.sample_status).toBe('none')
    expect(afterStudyAvail!.has_samples).toBe(false)
  })

  // AC3+AC4: BE: DELETE /api/v1/sample-jobs/{id}?delete_data=false and delete_data=true both return 204
  test('BE: DELETE /api/v1/sample-jobs/{id} returns 204 with and without delete_data', async ({ request }) => {
    // AC: BE: Both deletion paths return 204 No Content
    const studyId = await createStudyViaAPI(request)

    // Job 1: delete without data flag
    const jobId1 = await createJobViaAPI(request, studyId)
    const resp1 = await request.delete(`/api/v1/sample-jobs/${jobId1}`)
    expect(resp1.status()).toBe(204)

    // Job 2: delete with delete_data=true
    const jobId2 = await createJobViaAPI(request, studyId)
    const resp2 = await request.delete(`/api/v1/sample-jobs/${jobId2}?delete_data=true`)
    expect(resp2.status()).toBe(204)

    // Both jobs should be gone
    const jobsResponse = await request.get('/api/v1/sample-jobs')
    expect(jobsResponse.status()).toBe(200)
    const jobsData = await jobsResponse.json()
    expect(jobsData.every((j: { id: string }) => j.id !== jobId1 && j.id !== jobId2)).toBe(true)
  })
})
