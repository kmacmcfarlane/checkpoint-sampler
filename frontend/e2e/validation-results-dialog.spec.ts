import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { resetDatabase, cancelAllJobs, closeDrawer } from './helpers'

/**
 * E2E tests for the Validation Results Dialog (S-117).
 *
 * ## What is tested
 *
 * AC1: Validate button appears on each job in the job list
 * AC2: Validate button appears in the main controls slideout panel
 * AC3: Clicking Validate opens a dialog displaying validation results (not inline)
 * AC4: Regenerate button in validation dialog opens Generate Samples with pre-filled params
 * AC5: 'Generate missing samples only' is checked when launching from validation dialog
 * AC6: Validation dialog closes when Generate Samples dialog opens
 * AC7 (E2E): Click validate on job, verify results dialog, click regenerate, verify pre-filled dialog
 *
 * ## Test data
 *
 * - Training run "my-model" with 2 checkpoints in test-fixtures/
 * - A seeded completed job in the DB (uses /api/test/seed-jobs endpoint)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The fixed UUID of the E2E fixture study, seeded by the test reset endpoint.
 * Must match store.E2EFixtureStudyID in fixture_seeder.go.
 */
const FIXTURE_STUDY_ID = 'e2efixture-0000-0000-0000-000000000001'
const FIXTURE_STUDY_NAME = 'E2E Fixture Study'

/**
 * Seeds a completed sample job via the test-only endpoint.
 * Uses the fixture study ID (seeded by resetDatabase) so that applyPrefill
 * can find a matching study in the available studies list.
 * Returns the job ID.
 */
async function seedCompletedJob(request: APIRequestContext): Promise<string> {
  const payload = [
    {
      training_run_name: 'my-model',
      study_id: FIXTURE_STUDY_ID,
      study_name: FIXTURE_STUDY_NAME,
      workflow_name: 'test-workflow.json',
      status: 'completed',
      total_items: 4,
      completed_items: 4,
    },
  ]
  const response = await request.post('/api/test/seed-jobs', { data: payload })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return (body.job_ids as string[])[0]
}

/**
 * Opens the Job Progress Panel (the "Jobs" button in the header).
 */
async function openJobProgressPanel(page: Page): Promise<void> {
  await closeDrawer(page)

  const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
  await expect(jobsButton).toBeVisible()
  await jobsButton.click()

  const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  await expect(modal).toBeVisible()
}

/**
 * Closes the Jobs dialog if open by pressing Escape.
 */
async function closeJobsDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Validation Results Dialog (S-117)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC1: Validate button appears on each job in the job list
  test('AC1: Validate button appears on each job in the job list', async ({ page, request }) => {
    const jobId = await seedCompletedJob(request)

    await openJobProgressPanel(page)

    // The validate button should be visible for the seeded job
    const validateBtn = page.locator(`[data-testid="job-${jobId}-validate"]`)
    await expect(validateBtn).toBeVisible()
    await expect(validateBtn).toHaveText('Validate')
  })

  // AC2: Validate button appears in the main controls slideout panel
  test('AC2: Validate button appears in the main controls slideout after selecting a training run', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    // On wide screens, the drawer opens automatically. On narrow screens we need to open it.
    // Use selectTrainingRun helper which works correctly with the drawer state.
    // First, ensure the drawer is visible by waiting for the training-run-select.
    const selectTrigger = page.locator('[data-testid="training-run-select"]')
    await expect(selectTrigger).toBeVisible({ timeout: 10000 })
    await expect(selectTrigger.locator('.n-base-selection--disabled')).toHaveCount(0)

    // Click the select to open the dropdown
    const popupMenu = page.locator('.n-base-select-menu:visible')
    const MAX_RETRIES = 3
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await selectTrigger.click()
      try {
        await expect(popupMenu).toBeVisible({ timeout: 3000 })
        break
      } catch {
        if (attempt === MAX_RETRIES) throw new Error('Could not open training run select')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }
    }
    await popupMenu.getByText('my-model', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Wait for the scan to complete (Dimensions section appears)
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 10000 })

    // The slideout validate button should now be visible
    const slideoutValidateBtn = page.locator('[data-testid="slideout-validate-button"]')
    await expect(slideoutValidateBtn).toBeVisible()
    await expect(slideoutValidateBtn).toHaveText('Validate')
  })

  // AC3: Clicking Validate on a job opens a dialog (not inline results)
  test('AC3: Clicking Validate on a job opens a validation results dialog', async ({ page, request }) => {
    const jobId = await seedCompletedJob(request)

    await openJobProgressPanel(page)

    // Click the validate button
    const validateBtn = page.locator(`[data-testid="job-${jobId}-validate"]`)
    await expect(validateBtn).toBeVisible()
    await validateBtn.click()

    // AC3: A validation results dialog should open
    const validationDialog = page.locator('[data-testid="validation-results-dialog"]')
    await expect(validationDialog).toBeVisible({ timeout: 10000 })

    // The dialog should contain validation results
    const summary = validationDialog.locator('[data-testid="validation-dialog-summary"]')
    await expect(summary).toBeVisible({ timeout: 10000 })
  })

  // B-099 AC1+AC2: Only one validate button exists in the main controls slideout (no inline button)
  test('B-099: Exactly one validate button in the main controls slideout (no duplicate)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    // Ensure the drawer is visible
    const selectTrigger = page.locator('[data-testid="training-run-select"]')
    await expect(selectTrigger).toBeVisible({ timeout: 10000 })
    await expect(selectTrigger.locator('.n-base-selection--disabled')).toHaveCount(0)

    // Click the select to open dropdown
    const popupMenu = page.locator('.n-base-select-menu:visible')
    const MAX_RETRIES = 3
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await selectTrigger.click()
      try {
        await expect(popupMenu).toBeVisible({ timeout: 3000 })
        break
      } catch {
        if (attempt === MAX_RETRIES) throw new Error('Could not open training run select')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }
    }
    await popupMenu.getByText('my-model', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Wait for scan to complete
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 10000 })

    // AC1: Only one validate button exists in the slideout (slideout-validate-button)
    const slideoutValidateBtn = page.locator('[data-testid="slideout-validate-button"]')
    await expect(slideoutValidateBtn).toHaveCount(1)
    await expect(slideoutValidateBtn).toBeVisible()
    await expect(slideoutValidateBtn).toHaveText('Validate')

    // AC2: No inline validate button (validate-button testid removed by B-099)
    await expect(page.locator('[data-testid="validate-button"]')).toHaveCount(0)

    // AC2: No inline validation results display
    await expect(page.locator('[data-testid="validation-results"]')).toHaveCount(0)
  })

  // AC7 (E2E): Full flow: click validate, verify dialog, click regenerate, verify pre-filled
  test('AC7: Full flow - validate job → dialog → regenerate → pre-filled Generate Samples', async ({ page, request }) => {
    // Seed the fixture study into the DB so the job has a real study_id the dialog can find
    await resetDatabase(request)
    const jobId = await seedCompletedJob(request)

    await openJobProgressPanel(page)

    // Step 1: Click Validate on the job
    const validateBtn = page.locator(`[data-testid="job-${jobId}-validate"]`)
    await expect(validateBtn).toBeVisible()
    await validateBtn.click()

    // Step 2: Verify the validation results dialog opens
    const validationDialog = page.locator('[data-testid="validation-results-dialog"]')
    await expect(validationDialog).toBeVisible({ timeout: 10000 })

    // The dialog should show either results or a loading/error state
    // (for my-model, which has samples in test-fixtures)
    // Wait for loading to complete (spinner gone or summary visible)
    await expect(
      validationDialog.locator('[data-testid="validation-dialog-summary"], [data-testid="validation-dialog-error"]')
    ).toBeVisible({ timeout: 15000 })

    // Verify the Regenerate button is present in the dialog header
    const regenBtn = validationDialog.locator('[data-testid="validation-regenerate-button"]')
    // Note: the Regenerate button is in the header-extra slot, which may render outside the dialog locator.
    // Use page-level locator as fallback.
    const regenBtnGlobal = page.locator('[data-testid="validation-regenerate-button"]')
    await expect(regenBtnGlobal).toBeVisible()

    // Step 3: Click Regenerate
    await regenBtnGlobal.click()

    // AC6: Validation dialog should close
    await expect(validationDialog).not.toBeVisible({ timeout: 5000 })

    // AC4: Generate Samples dialog should open
    const generateDialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Generate Samples' })
    await expect(generateDialog).toBeVisible({ timeout: 5000 })

    // AC5: "Generate missing samples only" checkbox should be checked
    // The checkbox is present when missing_only is pre-enabled
    const missingOnlyCheckbox = page.locator('[data-testid="missing-only-checkbox"]')
    await expect(missingOnlyCheckbox).toBeVisible({ timeout: 5000 })
    await expect(missingOnlyCheckbox).toHaveClass(/n-checkbox--checked/, { timeout: 5000 })

    // AC4: Training run and study should be pre-filled
    // The training run select should contain "my-model"
    const trainingRunSelect = generateDialog.locator('[data-testid="training-run-select"]')
    await expect(trainingRunSelect).toContainText('my-model', { timeout: 5000 })
  })
})
