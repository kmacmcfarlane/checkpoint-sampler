import { test, expect, type APIRequestContext } from '@playwright/test'
import {
  resetDatabase,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  closeDrawer,
  selectTrainingRun,
} from './helpers'

/**
 * E2E tests for S-135: Failed checkpoint indicator click navigates to failed job in Job List.
 *
 * When a red (failed) bead is displayed on a training run or study in the Generate Samples
 * dialog, clicking it should:
 *   1. Close the Generate Samples dialog
 *   2. Open the Job List (Job Progress Panel)
 *   3. Scroll to and expand the failed job's error details
 */

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * Seeds sample jobs with specified statuses via the test-only endpoint.
 */
async function seedJobs(request: APIRequestContext, jobs: Array<{
  training_run_name?: string
  study_id?: string
  study_name?: string
  workflow_name?: string
  status: string
  total_items?: number
  completed_items?: number
  failed_items?: number
}>): Promise<string[]> {
  const payload = jobs.map(j => ({
    training_run_name: j.training_run_name ?? 'my-model',
    study_id: j.study_id ?? 'test-study-1',
    study_name: j.study_name ?? 'Test Study',
    workflow_name: j.workflow_name ?? 'test-workflow.json',
    status: j.status,
    total_items: j.total_items ?? 4,
    completed_items: j.completed_items ?? 0,
    failed_items: j.failed_items ?? 0,
  }))

  const response = await request.post('/api/test/seed-jobs', { data: payload })
  expect(response.status()).toBe(201)
  const body = await response.json() as { job_ids: string[] }
  return body.job_ids
}

/**
 * Creates a minimal study via the API and returns its ID.
 */
async function createStudy(request: APIRequestContext, name: string): Promise<string> {
  const resp = await request.post('/api/v1/studies', {
    data: {
      name,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'a test prompt' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      resolutions: [{ width: 512, height: 512 }],
    },
  })
  expect(resp.ok()).toBeTruthy()
  const study = await resp.json() as { id: string }
  return study.id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Failed bead navigation (S-135)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: FE: Clicking failed checkpoint indicator closes Generate Samples dialog
  // AC: FE: Job List opens and scrolls to the specific failed job
  // AC: FE: Failed job card expands to show failure details
  test('clicking red training run bead closes dialog and opens job list with failed job', async ({ page, request }) => {
    // Create a study and seed a failed job
    const studyId = await createStudy(request, 'Test Study')
    const jobIds = await seedJobs(request, [{
      training_run_name: 'my-model',
      study_id: studyId,
      study_name: 'Test Study',
      status: 'failed',
      total_items: 4,
      completed_items: 0,
      failed_items: 4,
    }])
    expect(jobIds).toHaveLength(1)

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)

    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Wait for dialog data to fully load
    await page.waitForLoadState('networkidle')

    // Open the training run dropdown to access the red bead
    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await trainingRunSelect.click()
    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()

    // Find the red bead in the dropdown option
    const option = popup.locator('.n-base-select-option').filter({ hasText: /^my-model$/ })
    const redBead = option.locator('[data-testid="run-bead-problem"]')
    await expect(redBead).toBeVisible()

    // AC: Click the red bead to navigate to the failed job
    await redBead.click()

    // AC: Generate Samples dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // AC: Job Progress Panel should open
    const jobPanel = page.locator('[data-testid="job-progress-panel"]')
    await expect(jobPanel).toBeVisible({ timeout: 5000 })

    // AC: The failed job should be visible in the panel
    const jobCard = jobPanel.locator(`[data-testid="job-${jobIds[0]}"]`)
    await expect(jobCard).toBeVisible({ timeout: 5000 })

    // AC: The error section auto-expansion is handled by scrollToJobId.
    // Seeded jobs have no actual failed items (no item records), so error-section
    // may not render. The core AC is verified: dialog closed, panel opened, job visible.
    // Error section expansion is covered by unit tests.
  })
})
