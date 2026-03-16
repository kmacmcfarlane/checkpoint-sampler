import { test, expect, type APIRequestContext } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  closeDrawer,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  getManageStudiesDialog,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
  selectNaiveOption,
  cancelAllJobs,
} from './helpers'

/**
 * E2E tests for B-106: Manage Study regeneration auto-opens job progress panel.
 *
 * ## What is tested
 *
 * AC3 (FE): After job creation (including the regeneration path), the job progress
 *           panel auto-opens so the user sees job activity immediately.
 *
 * This test verifies the B-106 AC3 fix in `App.vue`'s `onJobCreated()`:
 *   - Before B-106: job creation closed the dialog, but the jobs panel stayed closed
 *   - After B-106: job creation closes the dialog AND auto-opens the jobs panel
 *
 * The test creates a sample job via the standard Generate Samples flow (which triggers
 * `onJobCreated()` via the `@success` event from `JobLaunchDialog`). This covers the
 * same `onJobCreated()` code path used by the regeneration flow.
 *
 * ## Note on the immutability dialog path
 *
 * The `StudyEditor.saveStudy()` triggers the immutability dialog via `studyHasSamples()`,
 * which checks `{sampleDir}/{studyName}/`. The job executor writes samples to
 * `{sampleDir}/{runName}/{studyName}/`. These paths differ, so the immutability dialog
 * cannot be reliably triggered in the E2E environment via normal job generation.
 * Unit tests cover that specific path (StudyEditor.test.ts, JobLaunchDialog.test.ts).
 * This E2E test covers the common code path: `onJobCreated()` auto-opening the panel.
 *
 * ## Test data
 *
 * - Training run: "my-model" (has checkpoint fixtures in test-fixtures/)
 * - ComfyUI mock: handles job submission (test-workflow.json)
 */

async function pollJobStatus(
  request: APIRequestContext,
  predicate: (jobs: Array<{ id: string; status: string; training_run_name: string }>) => boolean,
  options: { timeout?: number; interval?: number } = {},
): Promise<Array<{ id: string; status: string; training_run_name: string }> | null> {
  const timeout = options.timeout ?? 10000
  const interval = options.interval ?? 500
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const resp = await request.get('/api/sample-jobs')
    if (resp.status() === 200) {
      const jobs = await resp.json()
      if (predicate(jobs)) return jobs
    }
    await new Promise(r => setTimeout(r, interval))
  }
  return null
}

test.describe('manage study regenerate (B-106)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC3: After job creation (including the regeneration path), the job progress panel
  // auto-opens so the user sees job activity. This tests the onJobCreated() fix.
  test('AC3: job progress panel auto-opens after successful job creation', async ({ page, request }) => {
    const studyName = `B-106 Regen Test ${Date.now()}`

    // Step 1: Create a study and submit a job via the Generate Samples dialog.
    // This triggers JobLaunchDialog → emit('success') → App.vue onJobCreated().
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the training run in the dialog
    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await expect(trainingRunSelect).toBeVisible()
    await trainingRunSelect.click()
    const runPopup = page.locator('.n-base-select-menu:visible')
    await expect(runPopup).toBeVisible()
    await runPopup.getByText('my-model', { exact: true }).click()
    await expect(runPopup).not.toBeVisible()

    // Step 2: Create a study via the Manage Studies editor
    const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
    await expect(manageStudiesButton).toBeVisible()
    await manageStudiesButton.click()
    await expect(getManageStudiesDialog(page)).toBeVisible()

    await page.locator('[data-testid="new-study-button"]').click()
    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'test', 'a test image')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    await page.waitForTimeout(500)
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')
    await selectNaiveOption(page, 'study-vae-select', 'test-vae.safetensors')
    await selectNaiveOption(page, 'study-clip-select', 'test-clip.safetensors')

    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // Step 3: Uncheck "Clear existing samples" if auto-checked (preserve fixture images)
    const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
    // Wait for validation to complete — checkbox only appears after validation
    await expect(clearExistingCheckbox).toBeVisible({ timeout: 10000 })
    const isChecked = await clearExistingCheckbox.evaluate(el => el.classList.contains('n-checkbox--checked'))
    if (isChecked) {
      await clearExistingCheckbox.click()
      await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)
    }

    // Step 4: Submit the job. After success, onJobCreated() is called.
    const submitButton = dialog.locator('button').filter({ hasText: /Generate Samples|Regenerate Samples/ }).first()
    await expect(submitButton).not.toBeDisabled()
    await submitButton.click()

    // Handle the regeneration confirmation dialog if it appears (S-093)
    const confirmDialog = page.locator('[data-testid="confirm-regen-dialog"]')
    if (await confirmDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.locator('[data-testid="confirm-regen-button"]').click()
      await expect(confirmDialog).not.toBeVisible()
    }

    // Step 5: The Generate Samples dialog should close after job creation
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // Step 6: AC3 — The job progress panel should auto-open after job creation.
    // B-106 adds `jobProgressPanelOpen.value = true` to `onJobCreated()`.
    const jobProgressPanel = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
    await expect(jobProgressPanel).toBeVisible({ timeout: 5000 })

    // Step 7: Verify a job was actually created
    const jobs = await pollJobStatus(
      request,
      jobs => jobs.length > 0 && jobs.some(j => j.training_run_name === 'my-model'),
      { timeout: 5000 },
    )
    expect(jobs).not.toBeNull()
    expect(jobs![0].training_run_name).toBe('my-model')
  })
})
