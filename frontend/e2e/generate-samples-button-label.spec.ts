import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  getManageStudiesDialog,
  selectNaiveOptionInContainer,
  selectNaiveOption,
  selectNaiveMultiOption,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
  cancelAllJobs,
} from './helpers'

/**
 * E2E tests for the Generate Samples button label (B-125).
 *
 * ## What is tested
 *
 * AC1: Button shows "Generate Samples" when the selected study has no existing samples.
 * AC2: Button shows "Regenerate Samples" when the selected study has existing samples.
 *
 * ## Test data
 *
 * - Training run: "my-model" (has existing samples in test-fixtures/samples/)
 * - For AC1: A newly created study (no samples on disk) → label = "Generate Samples"
 * - For AC2: The pre-seeded fixture study (samples on disk) → label = "Regenerate Samples"
 *
 * ## Design note
 *
 * The button label is driven by `selectedStudyHasSamples` (study-scoped), not
 * `selectedRunHasSamples` (run-scoped). This ensures that selecting a study with
 * no samples shows "Generate Samples" even when the training run has samples for
 * a different study.
 */

// The fixture study name matches what the backend seeds via the test reset endpoint.
// This study has matching sample directories on disk, so validation returns
// total_actual > 0 and total_missing = 0 → "Regenerate Samples".
const FIXTURE_STUDY_NAME = 'E2E Fixture Study'

/**
 * Creates a brand-new study via the Manage Studies editor and returns its name.
 * The study has no sample directories on disk, so the button label should be
 * "Generate Samples" when this study is selected.
 */
async function createNewStudy(page: Page, studyName: string): Promise<void> {
  const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
  await expect(manageStudiesButton).toBeVisible()
  await manageStudiesButton.click()
  await expect(getManageStudiesDialog(page)).toBeVisible()

  const newStudyButton = page.locator('[data-testid="new-study-button"]')
  await expect(newStudyButton).toBeVisible()
  await newStudyButton.click()

  await fillStudyName(page, studyName)
  await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
  await addSamplerSchedulerPair(page, 'euler', 'normal')
  // Wait for sampler/scheduler pair popup animations to fully complete
  await page.waitForTimeout(500)

  await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')
  await selectNaiveMultiOption(page, 'study-vae-select', 'test-vae.safetensors')
  await selectNaiveMultiOption(page, 'study-clip-select', 'test-clip.safetensors')

  const saveButton = page.locator('[data-testid="save-study-button"]')
  await expect(saveButton).not.toBeDisabled()
  await saveButton.click()
  // Wait for dialog to close
  await expect(getManageStudiesDialog(page)).not.toBeVisible({ timeout: 10000 })
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Generate Samples button label (B-125)', () => {
  test.setTimeout(90000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC1: Button shows "Generate Samples" when the selected study has no existing samples.
  test('AC1: shows "Generate Samples" when selected study has no existing samples', async ({ page }) => {
    const studyName = `B125 New Study ${Date.now()}`

    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the training run that has samples for the fixture study.
    // This training run has samples for the fixture study, but NOT for the new study we create below.
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // Create a brand-new study with no samples on disk.
    // createNewStudy opens the Manage Studies sub-dialog (inside the Generate Samples dialog),
    // fills in study details, saves, and closes the Manage Studies dialog.
    // The Generate Samples dialog itself remains open throughout.
    await createNewStudy(page, studyName)

    // The dialog is still open — the Manage Studies sub-dialog closed, not the main one.
    await expect(dialog).toBeVisible()

    // Select the new study (no samples on disk for this study).
    // This is the core of the B-125 fix: even though the training run has samples for the
    // fixture study, selecting this new study (no samples) should show "Generate Samples".
    await selectNaiveOptionInContainer(page, dialog, 'study-select', studyName)

    // AC1: Button must read "Generate Samples" (not "Regenerate Samples")
    const submitButton = dialog.locator('button[type="button"]').filter({ hasText: 'Generate Samples' }).first()
    await expect(submitButton).toBeVisible({ timeout: 10000 })

    // Ensure "Regenerate Samples" text is NOT present in the submit button.
    // Use strict text matching: "Regenerate Samples" starts with "Regenerate" (not just "Generate").
    const regenButton = dialog.locator('button[type="button"]').filter({ hasText: 'Regenerate Samples' })
    await expect(regenButton).not.toBeVisible()
  })

  // AC2: Button shows "Regenerate Samples" when the selected study has existing samples.
  test('AC2: shows "Regenerate Samples" when selected study has existing samples', async ({ page }) => {
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the training run
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // Select the fixture study that already has samples on disk
    await selectNaiveOptionInContainer(page, dialog, 'study-select', FIXTURE_STUDY_NAME)

    // The "Clear existing samples" checkbox appears when the run has samples and
    // validation has completed. Wait for it as a signal that validation has run.
    const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
    await expect(clearExistingCheckbox).toBeVisible({ timeout: 15000 })

    // AC2: Button must read "Regenerate Samples" (study has samples on disk).
    // This is the core of the B-125 bug fix: the button label must be study-scoped.
    const submitButton = dialog.locator('button[type="button"]').filter({ hasText: 'Regenerate Samples' }).first()
    await expect(submitButton).toBeVisible({ timeout: 10000 })

    // The button label test only checks the label text; whether it is enabled or disabled
    // depends on checkpoint selection state (S-129), which is out of scope for B-125.
  })
})
