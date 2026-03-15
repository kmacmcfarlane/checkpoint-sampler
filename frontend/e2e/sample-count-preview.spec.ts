import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  cancelAllJobs,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
} from './helpers'

/**
 * E2E tests for S-084: Sample count preview and missing-sample generation.
 *
 * Verifies:
 * - AC1: Generate Samples dialog shows validation preview with expected sample counts
 * - AC2: Main controls side-panel shows validation totals and "Generate Missing"
 *         button when validation reveals missing samples
 * - AC3: Validate API returns total_expected, total_actual, total_missing fields
 * - AC4: API supports missing_only parameter in create-sample-job payload
 *
 * Test fixture data:
 *   - Training run "my-model" has 2 checkpoints, each with 2 PNG sample files
 *     in the initial fixtures. However, other E2E tests in the same suite
 *     (sample-generation.spec.ts) may generate additional images on the shared
 *     writable volume. Because both checkpoints always have equal PNG counts,
 *     validation consistently shows 0 missing -- but the exact total varies.
 *   - For missing-sample scenarios, we test the negative case (no missing)
 *     at the E2E level; the positive case is covered by unit tests.
 *
 * Study selection for dialog tests (AC1):
 *   Tests that open the Generate Samples dialog and trigger validation MUST use
 *   the pre-seeded fixture study ("E2E Fixture Study") rather than creating a
 *   new study dynamically. Validation looks for samples at the scoped path
 *   {sampleDir}/{trainingRunName}/{studyID}/{checkpoint}/. Only the fixture study
 *   has pre-created sample directories on disk (seeded by the test reset endpoint
 *   via FixtureSeeder). A dynamically-created study has a different ID with no
 *   matching directories, so validation returns 0/0 and the checkpoint-picker
 *   UI elements never appear. This pattern was established in B-081 for
 *   regen-confirmation.spec.ts.
 */

/**
 * The fixture study name seeded into the DB by the test reset endpoint.
 * Must match store.E2EFixtureStudyName in the backend fixture_seeder.go.
 * This study has 2 prompts × 1 step × 1 cfg × 1 sampler/scheduler pair × 1 seed = 2 images/checkpoint,
 * and matching sample directories exist under samples/my-model/<fixture-study-id>/.
 */
const FIXTURE_STUDY_NAME = 'E2E Fixture Study'

/**
 * Selects a Naive UI NSelect option within a specific container.
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
  const popup = page.locator('.n-base-select-menu:visible')
  await expect(popup).toBeVisible()
  await popup.getByText(optionText, { exact: true }).click()
  await expect(popup).not.toBeVisible()
}

test.describe('S-084: sample count preview and missing-sample generation', () => {
  // Allow extra time: setup (~5s) + validation (~5s) + UI interactions + dialog animations
  test.setTimeout(60000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // Cancel any running/pending jobs after each test. One test in this spec
  // creates a sample job via the API; cancelling ensures the executor does
  // not continue background processing into subsequent tests.
  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC3: Validate API returns total_expected, total_actual, total_missing fields
  test('validate API returns total_expected, total_actual, total_missing fields', async ({ request }) => {
    // Get training runs to find the ID for "my-model"
    const runsResponse = await request.get('/api/training-runs')
    expect(runsResponse.ok()).toBeTruthy()
    const runs = await runsResponse.json()
    const myModel = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // Call the validate endpoint
    const validateResponse = await request.post(`/api/training-runs/${myModel.id}/validate`)
    expect(validateResponse.ok()).toBeTruthy()

    const result = await validateResponse.json()

    // AC3: API returns total fields with correct types
    expect(typeof result.total_expected).toBe('number')
    expect(typeof result.total_actual).toBe('number')
    expect(typeof result.total_missing).toBe('number')

    // Both checkpoints have equal PNG counts (at least 2 from fixtures, possibly
    // more from other E2E tests in this suite), so expected = actual, missing = 0.
    expect(result.total_expected).toBeGreaterThanOrEqual(4)
    expect(result.total_actual).toBe(result.total_expected)
    expect(result.total_missing).toBe(0)
  })

  // AC1: Generate Samples dialog shows validation preview after selecting a training run AND study.
  // S-086 changed the validation trigger to require both training run and study selection.
  // Uses the pre-seeded fixture study so that validation finds sample files on disk.
  // (A dynamically-created study has no matching sample directories after B-078's path restructure.)
  test('Generate Samples dialog shows validation preview with sample counts', async ({ page }) => {
    // AC1: Use the pre-seeded fixture study (seeded by test reset endpoint via FixtureSeeder).
    // The fixture study has known sample directories under samples/my-model/<fixture-study-id>/,
    // so validation returns actual > 0 and the checkpoint-picker UI elements appear.

    await page.goto('/')

    // Select a training run so the "Generate Samples" button appears
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Open the Generate Samples dialog
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the training run in the dialog
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // S-086: Select the pre-seeded fixture study — validation preview now requires both training run + study.
    // The fixture study has matching sample directories, so validation returns actual > 0.
    await selectNaiveOptionInContainer(page, dialog, 'study-select', FIXTURE_STUDY_NAME)

    // Wait for the checkpoint-picker section to appear (S-084 UAT rework:
    // replaced validation-preview with unified per-checkpoint validation status display)
    const picker = dialog.locator('[data-testid="checkpoint-picker"]')
    await expect(picker).toBeVisible({ timeout: 10000 })

    // Verify the validation totals summary shows the "X / Y samples" format.
    // Both checkpoints have equal PNG counts, so actual = expected (no missing).
    // Exact count varies because other E2E tests may generate additional images.
    const totals = picker.locator('[data-testid="validation-totals"]')
    await expect(totals).toBeVisible({ timeout: 5000 })
    await expect(totals).toContainText(/\d+ \/ \d+ samples/)

    // No missing samples, so "missing" text should not appear in the totals
    await expect(totals).not.toContainText('missing')
  })

  // AC2: Validation results appear in the dialog after clicking the slideout Validate button.
  // B-099: The inline validation totals in the sidebar were removed. Validation is now shown
  // in the ValidationResultsDialog, opened by the slideout-validate-button.
  test('slideout Validate button opens validation results dialog', async ({ page }) => {
    await page.goto('/')

    // Select a training run
    await selectTrainingRun(page, 'my-model')

    // Click the slideout Validate button
    const validateBtn = page.locator('[data-testid="slideout-validate-button"]')
    await expect(validateBtn).toBeVisible()
    await validateBtn.click()

    // The validation results dialog should open
    const validationDialog = page.locator('[data-testid="validation-results-dialog"]')
    await expect(validationDialog).toBeVisible({ timeout: 10000 })

    // The dialog should show a summary section
    const summary = validationDialog.locator('[data-testid="validation-dialog-summary"]')
    await expect(summary).toBeVisible({ timeout: 10000 })

    // Inline sidebar validation results should NOT exist (removed by B-099)
    await expect(page.locator('[data-testid="validation-results"]')).toHaveCount(0)
  })

  // AC2: "Generate Missing" button is not shown in the sidebar (B-099: removed from inline view).
  // The regenerate flow now goes through the ValidationResultsDialog → Regenerate button.
  test('"Generate Missing" button does not appear in sidebar after validate', async ({ page }) => {
    await page.goto('/')

    // Select a training run
    await selectTrainingRun(page, 'my-model')

    // The generate-missing-button should never appear in the sidebar (removed by B-099)
    await expect(page.locator('[data-testid="generate-missing-button"]')).toHaveCount(0)

    // Even after opening the slideout validate dialog, the sidebar should have no generate-missing
    const validateBtn = page.locator('[data-testid="slideout-validate-button"]')
    await expect(validateBtn).toBeVisible()
    await validateBtn.click()

    const validationDialog = page.locator('[data-testid="validation-results-dialog"]')
    await expect(validationDialog).toBeVisible({ timeout: 10000 })

    // generate-missing-button should still not appear outside the dialog
    await expect(page.locator('[data-testid="generate-missing-button"]')).toHaveCount(0)
  })

  // AC4: API accepts missing_only parameter in create-sample-job payload
  test('create-sample-job API accepts missing_only parameter', async ({ request }) => {
    // First create a study to use in the payload
    const createStudyResponse = await request.post('/api/studies', {
      data: {
        name: `E2E Missing Only Test ${Date.now()}`,
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test image' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 1024,
        height: 1024,
        workflow_template: 'test-workflow.json',
        vae: 'test-vae.safetensors',
        text_encoder: 'test-clip.safetensors',
      },
    })
    expect(createStudyResponse.ok()).toBeTruthy()
    const study = await createStudyResponse.json()

    // Get training runs to find the name for "my-model"
    const runsResponse = await request.get('/api/training-runs?source=checkpoints')
    expect(runsResponse.ok()).toBeTruthy()
    const runs = await runsResponse.json()
    const myModel = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // Create a sample job with missing_only=true
    // S-112: workflow_name/vae/clip come from the study definition, not the job payload
    const createJobResponse = await request.post('/api/sample-jobs', {
      data: {
        training_run_name: myModel.name,
        study_id: study.id,
        missing_only: true,
      },
    })

    // The API should accept the payload (200 OK).
    // Since all samples already exist on disk (fixture has 2 PNGs per checkpoint),
    // the missing_only filter would skip items whose output files exist.
    // The job is still created (may have 0 items if all exist, or the full set if
    // the output filenames don't match the fixture file naming convention).
    expect(createJobResponse.ok()).toBeTruthy()
    const job = await createJobResponse.json()
    expect(job.id).toBeDefined()
    expect(job.status).toBe('pending')
  })

  // AC1 (UAT rework): Dialog shows per-checkpoint validation status rows matching main controls style
  // Each row shows checkmark/warning icon, checkpoint filename, and found/expected count.
  // Uses the pre-seeded fixture study so that validation finds sample files on disk and
  // checkpoint rows render with sample counts (not 0/N with warning icons).
  test('Generate Samples dialog shows per-checkpoint validation status rows', async ({ page }) => {
    // AC1: Use the pre-seeded fixture study (seeded by test reset endpoint via FixtureSeeder).
    // The fixture study has known sample directories under samples/my-model/<fixture-study-id>/,
    // so validation returns actual > 0 and per-checkpoint rows show checkmarks.

    await page.goto('/')

    // Select a training run so the "Generate Samples" button appears
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Open the Generate Samples dialog
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select training run then the pre-seeded fixture study to trigger auto-validation.
    // The fixture study has matching sample dirs, so validation returns actual > 0.
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')
    await selectNaiveOptionInContainer(page, dialog, 'study-select', FIXTURE_STUDY_NAME)

    // Wait for validation results list to appear
    const results = dialog.locator('[data-testid="validation-results"]')
    await expect(results).toBeVisible({ timeout: 10000 })

    // Verify per-checkpoint rows are present (my-model has 2 checkpoints)
    const rows = results.locator('[data-testid^="checkpoint-row-"]')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThanOrEqual(1)

    // Each row should contain the found/expected count in N/N format
    const firstRow = rows.first()
    await expect(firstRow).toContainText(/\d+\/\d+/)

    // With all samples present, rows should show green checkmark (no warning icon)
    // The checkmark character is ✓ (U+2713)
    await expect(firstRow).toContainText('\u2713')
  })

  // AC1: Validation preview clears when dialog is closed and reopened without a selection
  test('validation preview is not shown when no training run is selected in dialog', async ({ page }) => {
    await page.goto('/')

    // Select a training run so the "Generate Samples" button appears
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Open the Generate Samples dialog
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Before selecting a training run in the dialog, no checkpoint-picker section should be visible
    // (S-084 UAT rework: the section requires both training run + study to be selected)
    const picker = dialog.locator('[data-testid="checkpoint-picker"]')
    await expect(picker).toHaveCount(0)
  })
})
