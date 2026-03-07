import { test, expect, type Page } from '@playwright/test'
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
 * E2E tests for the regeneration confirmation dialog (S-093).
 *
 * ## What is tested
 *
 * AC1: Clicking Regenerate on a validated sample set shows a confirmation dialog.
 * AC2: Dialog explains that all expected samples already exist and regeneration will
 *      overwrite them.
 * AC3: Cancel aborts the operation; Confirm proceeds with regeneration.
 * AC4: No confirmation dialog when the sample set has missing samples (incomplete
 *      validation) — covered by unit tests only; the test environment fixture always
 *      produces a complete validation for my-model, so the negative path is exercised
 *      in unit tests.
 *
 * ## Test data
 *
 * - Training run: "my-model" (has existing samples in test-fixtures/samples/)
 * - Validation: both checkpoints have equal file counts → total_missing = 0 (complete)
 * - The confirm dialog appears only when all expected samples exist.
 *
 * ## Note on sample-generation tests
 *
 * The existing sample-generation.spec.ts tests deliberately uncheck "Clear existing
 * samples" to preserve test fixture images. This spec keeps the confirm dialog visible
 * without actually submitting the job (Cancel path) or uses a fresh study and confirms
 * then polls the API (Confirm path).
 */

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Selects a Naive UI NSelect option within a specific container (e.g. the dialog).
 * This avoids ambiguity when multiple elements share the same data-testid
 * (e.g. the sidebar and dialog both have data-testid="training-run-select").
 */
async function selectNaiveOptionInContainer(
  page: Page,
  container: ReturnType<typeof page.locator>,
  selectTestId: string,
  optionText: string,
): Promise<void> {
  const select = container.locator(`[data-testid="${selectTestId}"]`)
  await expect(select).toBeVisible()
  await select.click()
  // The popup menu renders outside the dialog (teleported), so query from page root
  const popup = page.locator('.n-base-select-menu:visible')
  await expect(popup).toBeVisible()
  await popup.getByText(optionText, { exact: true }).click()
  await expect(popup).not.toBeVisible()
}

/**
 * Sets up the Generate Samples dialog fully (training run, study, workflow, VAE, CLIP)
 * for a run that already has samples, then waits for validation to complete.
 * Returns the dialog locator.
 */
async function setupDialogForRegenerateWithCompleteValidation(
  page: Page,
  studyName: string,
): Promise<ReturnType<typeof page.locator>> {
  await openGenerateSamplesDialog(page)
  const dialog = getGenerateSamplesDialog(page)
  await expect(dialog).toBeVisible()

  // Select the training run that already has samples
  await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

  // Create a study
  const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
  await expect(manageStudiesButton).toBeVisible()
  await manageStudiesButton.click()
  await expect(getManageStudiesDialog(page)).toBeVisible()

  await page.locator('[data-testid="new-study-button"]').click()
  await fillStudyName(page, studyName)
  await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
  await addSamplerSchedulerPair(page, 'euler', 'normal')

  const saveButton = page.locator('[data-testid="save-study-button"]')
  await expect(saveButton).not.toBeDisabled()
  await saveButton.click()
  await expect(getManageStudiesDialog(page)).not.toBeVisible()
  await expect(dialog).toBeVisible()

  // Select workflow and models
  await selectNaiveOption(page, 'workflow-select', 'test-workflow.json')
  await selectNaiveOption(page, 'vae-select', 'test-vae.safetensors')
  await selectNaiveOption(page, 'clip-select', 'test-clip.safetensors')

  // Wait for the "Clear existing samples" checkbox — it only appears after
  // validation completes (requires both training run + study selected and
  // selectedRunHasSamples=true). When this checkbox is visible, validation
  // has run and returned results. For my-model with equal sample counts across
  // checkpoints, total_missing = 0 (complete validation → confirm dialog will appear).
  const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
  await expect(clearExistingCheckbox).toBeVisible({ timeout: 10000 })

  // Uncheck "Clear existing samples" to preserve the test fixture directories in
  // the shared samples volume. Without this, the confirmed regeneration job deletes
  // the my-model-step*.safetensors directories, breaking all subsequent E2E tests
  // that rely on those fixture images being present (cross-test contamination).
  const isChecked = await clearExistingCheckbox.evaluate(el => el.classList.contains('n-checkbox--checked'))
  if (isChecked) {
    await clearExistingCheckbox.click()
    await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)
  }

  return dialog
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('regeneration confirmation dialog (S-093)', () => {
  // Allow extra time: setup (~5s) + study creation (~5s) + validation (~3s) + UI interactions
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

  // AC1: Clicking Regenerate on a validated (complete) sample set shows a
  // confirmation dialog instead of immediately submitting.
  test('AC1: shows confirmation dialog when all expected samples exist (complete validation)', async ({ page }) => {
    const studyName = `E2E S-093 Confirm ${Date.now()}`
    const dialog = await setupDialogForRegenerateWithCompleteValidation(page, studyName)

    // The submit button should read "Regenerate Samples" for a run with has_samples=true
    const submitButton = dialog.locator('button').filter({ hasText: 'Regenerate Samples' }).first()
    await expect(submitButton).not.toBeDisabled()

    // Click Regenerate — should show the confirmation dialog, NOT submit immediately
    await submitButton.click()

    // AC1: Confirmation dialog appears
    const confirmDialog = page.locator('[data-testid="confirm-regen-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // The main Generate Samples dialog should still be visible (not closed)
    await expect(dialog).toBeVisible()
  })

  // AC2: Dialog explains that all expected samples already exist and regeneration
  // will overwrite them.
  test('AC2: confirmation dialog explains that samples exist and will be overwritten', async ({ page }) => {
    const studyName = `E2E S-093 Text ${Date.now()}`
    const dialog = await setupDialogForRegenerateWithCompleteValidation(page, studyName)

    const submitButton = dialog.locator('button').filter({ hasText: 'Regenerate Samples' }).first()
    await submitButton.click()

    const confirmDialog = page.locator('[data-testid="confirm-regen-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // AC2: Dialog message must mention samples already exist and overwrite
    const description = page.locator('[data-testid="confirm-regen-description"]')
    await expect(description).toBeVisible()
    await expect(description).toContainText('All expected samples already exist')
    await expect(description).toContainText('overwrite')
  })

  // AC3 (Cancel path): Clicking Cancel aborts the operation — no job is created
  // and the dialog closes.
  test('AC3 (cancel): clicking Cancel closes the confirmation dialog without creating a job', async ({ page, request }) => {
    const studyName = `E2E S-093 Cancel ${Date.now()}`
    const dialog = await setupDialogForRegenerateWithCompleteValidation(page, studyName)

    const submitButton = dialog.locator('button').filter({ hasText: 'Regenerate Samples' }).first()
    await submitButton.click()

    const confirmDialog = page.locator('[data-testid="confirm-regen-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // AC3: Click Cancel
    const cancelButton = page.locator('[data-testid="confirm-regen-cancel-button"]')
    await expect(cancelButton).toBeVisible()
    await cancelButton.click()

    // Confirmation dialog should close
    await expect(confirmDialog).not.toBeVisible()

    // No job created
    const jobsResponse = await request.get('/api/sample-jobs')
    expect(jobsResponse.status()).toBe(200)
    const jobs = await jobsResponse.json()
    expect(jobs).toHaveLength(0)
  })

  // AC3 (Confirm path): Clicking Confirm proceeds with regeneration — a job is created.
  test('AC3 (confirm): clicking Confirm proceeds with sample job creation', async ({ page, request }) => {
    const studyName = `E2E S-093 Confirm Submit ${Date.now()}`
    const dialog = await setupDialogForRegenerateWithCompleteValidation(page, studyName)

    const submitButton = dialog.locator('button').filter({ hasText: 'Regenerate Samples' }).first()
    await submitButton.click()

    const confirmDialog = page.locator('[data-testid="confirm-regen-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // AC3: Click Confirm ("Yes, Regenerate")
    const confirmButton = page.locator('[data-testid="confirm-regen-button"]')
    await expect(confirmButton).toBeVisible()
    await confirmButton.click()

    // Both dialogs should close after job submission
    await expect(confirmDialog).not.toBeVisible({ timeout: 5000 })
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // AC3: Job was actually created
    const jobsResponse = await request.get('/api/sample-jobs')
    expect(jobsResponse.status()).toBe(200)
    const jobs = await jobsResponse.json()
    expect(jobs.length).toBeGreaterThan(0)
    expect(jobs[0].training_run_name).toBe('my-model')
  })
})
