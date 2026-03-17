import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  cancelAllJobs,
} from './helpers'

/**
 * E2E tests for S-129: Complete checkpoints not auto-checked in Generate Samples
 * validation selector.
 *
 * ## What is tested
 *
 * AC1: Complete checkpoints are unchecked by default in the validation selector.
 * AC2: Incomplete checkpoints remain checked by default.
 * AC3: User can still manually check complete checkpoints for regeneration.
 *
 * ## Test data
 *
 * - Training run: "my-model" (has existing samples in test-fixtures/samples/)
 * - Complete validation: E2E Fixture Study has 2 prompts × 1 cfg × 1 step × 1 pair × 1 seed
 *   = 2 images per checkpoint, and both fixture checkpoints have matching sample dirs.
 * - Partial validation: created via the seed-partial-samples API endpoint — only
 *   my-model-step00001000.safetensors gets a sample directory; step00002000 remains empty.
 *   The new study has 1 image per checkpoint expected, so step00001000 is "complete"
 *   (1 seeded file ≥ 1 expected) while step00002000 is "incomplete" (0 files, 1 expected).
 *
 * ## Note on incomplete-set detection
 *
 * "Complete" means: verified > 0 AND missing <= 0.
 * "Incomplete or unstarted" means: NOT (verified > 0 AND missing <= 0).
 *
 * This ensures that checkpoints with zero samples on disk are treated as unstarted
 * (needing generation) rather than "complete", even though missing=0 when expected=0.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURE_STUDY_NAME = 'E2E Fixture Study'

// Checkpoint filenames in the "my-model" training run
const STEP1_CHECKPOINT = 'my-model-step00001000.safetensors'
const STEP2_CHECKPOINT = 'my-model-step00002000.safetensors'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

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

/**
 * Creates a minimal study via the API and returns its ID.
 */
async function createStudy(request: APIRequestContext, name: string): Promise<string> {
  const resp = await request.post('/api/studies', {
    data: {
      name,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'a test prompt' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 512,
      height: 512,
    },
  })
  expect(resp.ok()).toBeTruthy()
  const study = await resp.json() as { id: string }
  return study.id
}

/**
 * Seeds a sample directory for a single checkpoint via the test-only endpoint.
 * This makes that checkpoint appear "complete" in validation (has samples on disk).
 */
async function seedSamplesForCheckpoint(
  request: APIRequestContext,
  studyId: string,
  studyName: string,
  checkpointFilename: string,
): Promise<void> {
  const resp = await request.post('/api/test/seed-partial-samples', {
    data: {
      training_run_name: 'my-model',
      study_id: studyId,
      study_name: studyName,
      checkpoint_filenames: [checkpointFilename],
    },
  })
  expect(resp.status()).toBe(201)
}

/**
 * Opens Generate Samples dialog, selects "my-model" and a study, then waits for
 * validation to complete (clear-existing-checkbox becomes visible).
 */
async function openDialogAndSelectStudy(
  page: Page,
  studyName: string,
): Promise<ReturnType<typeof page.locator>> {
  await openGenerateSamplesDialog(page)
  const dialog = getGenerateSamplesDialog(page)
  await expect(dialog).toBeVisible()

  await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')
  await selectNaiveOptionInContainer(page, dialog, 'study-select', studyName)

  // Wait for validation to complete (clear-existing-checkbox appears when
  // selectedRunHasSamples=true and validation has returned)
  const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
  await expect(clearExistingCheckbox).toBeVisible({ timeout: 15000 })

  return dialog
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('S-129: checkpoint default selection based on completion status', () => {
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

  // AC1: Complete checkpoints are unchecked by default.
  // The E2E Fixture Study produces a complete validation (all checkpoint sample dirs exist),
  // so all checkpoints should be unchecked after validation defaults are applied.
  test('AC1: complete checkpoints are unchecked by default for a fully-complete sample set', async ({ page }) => {
    // AC1: Use the fixture study which has all checkpoints complete
    await openDialogAndSelectStudy(page, FIXTURE_STUDY_NAME)

    // AC1: Both checkpoints are complete → both should be unchecked by default
    const step1Row = page.locator(`[data-testid="checkpoint-row-${STEP1_CHECKPOINT}"]`)
    const step2Row = page.locator(`[data-testid="checkpoint-row-${STEP2_CHECKPOINT}"]`)

    await expect(step1Row).toBeVisible()
    await expect(step2Row).toBeVisible()

    // Checkboxes should NOT have the checked class
    const step1Checkbox = step1Row.locator('.n-checkbox')
    const step2Checkbox = step2Row.locator('.n-checkbox')
    await expect(step1Checkbox).not.toHaveClass(/n-checkbox--checked/)
    await expect(step2Checkbox).not.toHaveClass(/n-checkbox--checked/)
  })

  // AC2: Incomplete checkpoints remain checked by default.
  // Seeds samples for only step1 checkpoint, leaving step2 without samples.
  // Step1 has verified=1, missing=0 → complete (unchecked).
  // Step2 has verified=0, missing=1 → incomplete (checked).
  test('AC2: incomplete checkpoints are checked by default when some checkpoints are missing', async ({ page, request }) => {
    // Create a new study with 1 image per checkpoint
    const studyName = `S-129 Partial Test ${Date.now()}`
    const studyId = await createStudy(request, studyName)

    // Seed samples for step1 only — step1 becomes complete, step2 remains incomplete
    await seedSamplesForCheckpoint(request, studyId, studyName, STEP1_CHECKPOINT)

    // Reload to pick up new study in the dialog
    await page.reload({ waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openDialogAndSelectStudy(page, studyName)

    const step1Row = page.locator(`[data-testid="checkpoint-row-${STEP1_CHECKPOINT}"]`)
    const step2Row = page.locator(`[data-testid="checkpoint-row-${STEP2_CHECKPOINT}"]`)

    await expect(step1Row).toBeVisible()
    await expect(step2Row).toBeVisible()

    const step1Checkbox = step1Row.locator('.n-checkbox')
    const step2Checkbox = step2Row.locator('.n-checkbox')

    // AC1: step1 is complete (verified>0, missing<=0) → unchecked by default
    await expect(step1Checkbox).not.toHaveClass(/n-checkbox--checked/)
    // AC2: step2 is incomplete (verified=0, missing=1) → checked by default
    await expect(step2Checkbox).toHaveClass(/n-checkbox--checked/)
  })

  // AC3: User can still manually check a complete checkpoint for regeneration.
  // After defaults are applied (all unchecked for complete set), verify the user
  // can check a complete checkpoint and the submit button becomes enabled.
  test('AC3: user can manually check a complete checkpoint for regeneration', async ({ page }) => {
    // AC3: Use the fixture study (all complete → all unchecked by default)
    await openDialogAndSelectStudy(page, FIXTURE_STUDY_NAME)

    const step1Row = page.locator(`[data-testid="checkpoint-row-${STEP1_CHECKPOINT}"]`)
    await expect(step1Row).toBeVisible()

    const step1Checkbox = step1Row.locator('.n-checkbox')
    // Verify initially unchecked (complete checkpoint)
    await expect(step1Checkbox).not.toHaveClass(/n-checkbox--checked/)

    // AC3: Manually click to check the complete checkpoint
    await step1Row.locator('.n-checkbox').click()
    await expect(step1Checkbox).toHaveClass(/n-checkbox--checked/)

    // The submit button should now be enabled (at least one checkpoint selected)
    const submitButton = getGenerateSamplesDialog(page).locator('button').filter({ hasText: 'Regenerate Samples' }).first()
    await expect(submitButton).not.toBeDisabled()
  })
})
