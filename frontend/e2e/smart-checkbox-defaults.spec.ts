import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  cancelAllJobs,
} from './helpers'

/**
 * E2E tests for S-115: Generate Samples dialog — smart checkbox defaults.
 *
 * ## What is tested
 *
 * AC1 (E2E partial): Smart defaults for the incomplete case require total_actual > 0 (some
 *   samples exist on disk). In the E2E test environment, new studies start with total_actual=0.
 *   The hasMissingSamples computed only fires when some-but-not-all samples exist. The
 *   incomplete-set behavior is fully covered by unit tests in JobLaunchDialog.test.ts.
 *   E2E coverage here focuses on the observable "missing-only visible + unchecked" for
 *   runs with complete validation, verifying the UI renders correctly.
 *
 * AC2 (E2E): When the sample set is complete (no missing), 'Clear existing samples' is
 *   unchecked by default. Uses the pre-seeded E2E Fixture Study (complete validation).
 *
 * AC3 (E2E): Manual checkbox changes are respected. Uses the fixture study (complete set)
 *   to verify that manually changing checkboxes after defaults are applied works correctly.
 *
 * ## Test data
 *
 * - Training run: "my-model" (has existing samples in test-fixtures/samples/)
 * - Complete validation: uses the pre-seeded E2E Fixture Study (2 prompts × 1 seed = 2 images/cp,
 *   matching the 2 PNG files in each fixture checkpoint directory → total_missing = 0).
 * - Note: Testing the incomplete set (hasMissingSamples=true) in E2E would require sample files
 *   on disk for a new study, which requires running a job. This is covered by unit tests instead.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURE_STUDY_NAME = 'E2E Fixture Study'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Selects a Naive UI NSelect option within a specific container (e.g. the dialog).
 * Avoids ambiguity when multiple elements share the same data-testid.
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
 * Sets up the Generate Samples dialog with a complete sample set (E2E Fixture Study).
 * Waits for validation to complete and the checkbox panel to appear.
 *
 * The fixture study has 2 images/checkpoint and matching sample dirs exist on disk,
 * so validation returns total_actual > 0, total_missing = 0 (complete set).
 */
async function setupDialogWithCompleteSet(
  page: Page,
): Promise<ReturnType<typeof page.locator>> {
  await openGenerateSamplesDialog(page)
  const dialog = getGenerateSamplesDialog(page)
  await expect(dialog).toBeVisible()

  await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')
  await selectNaiveOptionInContainer(page, dialog, 'study-select', FIXTURE_STUDY_NAME)

  // Wait for checkboxes to appear (validation complete + selectedRunHasSamples=true)
  await expect(page.locator('[data-testid="clear-existing-checkbox"]')).toBeVisible({ timeout: 15000 })

  return dialog
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('S-115: smart checkbox defaults in Generate Samples dialog', () => {
  // Allow extra time: setup + validation + UI interactions
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

  // AC1 (E2E observable behavior): When validation finds a COMPLETE set, both 'Generate
  // missing samples only' and 'Clear existing samples' are visible and unchecked by default.
  // The smart default for complete sets (AC2) is tested in this test.
  // Note: The smart default for incomplete sets (missingOnly=true) requires total_actual > 0
  // on disk, which is covered by unit tests (JobLaunchDialog.test.ts) since generating a
  // partial sample set in E2E requires running a job.
  // AC: open dialog for complete set — clear unchecked, missing-only visible and unchecked
  test('AC: open dialog for complete set — clear-existing unchecked, missing-only unchecked', async ({ page }) => {
    // AC2: Use the complete fixture study (2 images/cp, 2 PNGs exist → total_missing=0)
    await setupDialogWithCompleteSet(page)

    // AC2: 'Clear existing samples' should NOT be checked by default
    const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
    await expect(clearExistingCheckbox).toBeVisible()
    await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)

    // 'Generate missing samples only' should also be unchecked (no missing samples in complete set)
    const missingOnlyCheckbox = page.locator('[data-testid="missing-only-checkbox"]')
    await expect(missingOnlyCheckbox).toBeVisible()
    await expect(missingOnlyCheckbox).not.toHaveClass(/n-checkbox--checked/)
  })

  // AC3: Manual checkbox changes during the session are respected and not overridden.
  // Starting from a complete set (both checkboxes unchecked), manually check 'Clear existing'
  // and verify the change sticks without being overridden by smart defaults.
  test('AC3: manual checkbox changes are respected after dialog opens', async ({ page }) => {
    // Use complete fixture study (smart defaults: both checkboxes unchecked)
    await setupDialogWithCompleteSet(page)

    const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
    const missingOnlyCheckbox = page.locator('[data-testid="missing-only-checkbox"]')

    // Verify initial smart defaults: both unchecked
    await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)
    await expect(missingOnlyCheckbox).not.toHaveClass(/n-checkbox--checked/)

    // AC3: User manually checks 'Clear existing samples'
    await clearExistingCheckbox.click()
    await expect(clearExistingCheckbox).toHaveClass(/n-checkbox--checked/)

    // AC3: User manually checks 'Generate missing samples only' (unchecks clear-existing)
    await missingOnlyCheckbox.click()
    await expect(missingOnlyCheckbox).toHaveClass(/n-checkbox--checked/)
    // Enabling missing-only should uncheck clear-existing (they're mutually exclusive)
    await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)

    // AC3: User unchecks missing-only again
    await missingOnlyCheckbox.click()
    await expect(missingOnlyCheckbox).not.toHaveClass(/n-checkbox--checked/)

    // Verify: clear-existing is still unchecked (unchanged by the missing-only toggle)
    await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)
  })
})
