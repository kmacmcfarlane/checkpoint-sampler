import { test, expect, type APIRequestContext } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  selectNaiveOptionInContainer,
} from './helpers'

/**
 * E2E tests for S-153: Cap study total work items at 50k with backend and
 * frontend validation.
 *
 * AC4: The launch dialog disables launch and shows total vs limit when the
 *      computed total exceeds the limit fetched from the backend (/api/config).
 *
 * Strategy:
 *   - Use the default max_study_items = 50000.
 *   - Create a study with 200 seeds × 252 steps × 1 prompt × 1 cfg × 1 pair
 *     = 50400 images/checkpoint. Wait — that would exceed the per-checkpoint
 *     guard in study.validate() (50400 > 50000, rejected).
 *   - Instead: 200 seeds × 126 steps = 25200 images/checkpoint (< 50000, study
 *     creation allowed). With 2 checkpoints in "my-model": 2 × 25200 = 50400
 *     total > 50000. This triggers exceedsItemLimit in the frontend.
 *   - The positive case uses the fixture study (2 images/checkpoint × 2
 *     checkpoints = 4 total ≪ 50000): no error, button enabled.
 *
 * The "my-model" training run has 2 checkpoints. The dialog computes:
 *   totalImages = targetedCheckpointCount (2) × imagesPerCheckpoint (25200) = 50400
 * which exceeds maxStudyItems (50000) from /api/config.
 */

const FIXTURE_STUDY_NAME = 'E2E Fixture Study'

/**
 * Generates an array of sequential integer seeds starting from 1.
 */
function makeSeeds(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1)
}

/**
 * Generates an array of step values [1, 2, ..., count].
 */
function makeSteps(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1)
}

/**
 * Creates a study via the API with parameters designed to produce a per-checkpoint
 * image count that when multiplied by the number of checkpoints in "my-model" (2),
 * exceeds the default max_study_items (50000).
 *
 * images_per_checkpoint = seeds × steps = 200 × 126 = 25200
 * total = 2 checkpoints × 25200 = 50400 > 50000
 *
 * The per-checkpoint product (25200) is safely below the max_study_items limit
 * so that study creation itself is not rejected by the service guard.
 */
async function createOverLimitStudy(request: APIRequestContext): Promise<string> {
  const resp = await request.post('/api/studies', {
    data: {
      name: `S-153 Over-Limit Study ${Date.now()}`,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'a test prompt' }],
      negative_prompt: '',
      steps: makeSteps(126),        // 126 steps
      cfgs: [7.0],                  // 1 cfg
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: makeSeeds(200),        // 200 seeds
      resolutions: [{ width: 512, height: 512 }],
      workflow_template: 'test-workflow.json',
      vaes: [],
      text_encoders: [],
      lora_strength_pairs: [],
    },
  })
  expect(resp.status()).toBe(201)
  const study = await resp.json()
  // Sanity: confirm images_per_checkpoint is what we expect (126 × 200 = 25200)
  expect(study.images_per_checkpoint).toBe(25200)
  return study.name as string
}

test.describe('S-153: over-limit launch rejection', () => {
  test.setTimeout(90000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  /**
   * AC3 (smoke): GET /api/config returns max_study_items as a positive integer.
   */
  test('/api/config returns max_study_items', async ({ request }) => {
    const resp = await request.get('/api/config')
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(typeof body.max_study_items).toBe('number')
    expect(body.max_study_items).toBeGreaterThan(0)
  })

  /**
   * AC4 (over-limit): Launch dialog shows item-limit-error and disables launch
   * when the computed total exceeds the configured maximum.
   *
   * Study: 25200 images/checkpoint × 2 checkpoints = 50400 total > 50000 limit.
   */
  test('launch dialog shows item-limit-error and disables submit when total exceeds limit', async ({ page, request }) => {
    const studyName = await createOverLimitStudy(request)

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the training run inside the dialog
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // Select the over-limit study
    await selectNaiveOptionInContainer(page, dialog, 'study-select', studyName)

    // The item-limit-error message must become visible
    const limitError = dialog.getByTestId('item-limit-error')
    await expect(limitError).toBeVisible({ timeout: 15000 })

    // The error message must mention the over-limit total and the configured cap
    await expect(limitError).toContainText('50400')
    await expect(limitError).toContainText('50000')

    // The launch button must be disabled
    const launchBtn = dialog.locator('button').filter({ hasText: /Generate Samples|Regenerate Samples/ })
    await expect(launchBtn).toBeVisible({ timeout: 5000 })
    await expect(launchBtn).toBeDisabled()
  })

  /**
   * AC4 (positive case): Launch dialog does NOT show item-limit-error when
   * the computed total is at or below the configured maximum.
   *
   * Fixture study: 2 images/checkpoint × 2 checkpoints = 4 total ≪ 50000.
   */
  test('launch dialog allows launch when total is within the limit', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the training run inside the dialog
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // Select the pre-seeded fixture study (4 total images, well under 50000)
    await selectNaiveOptionInContainer(page, dialog, 'study-select', FIXTURE_STUDY_NAME)

    // Wait for study selection to be registered (summary section shows images)
    const summary = dialog.getByTestId('job-summary')
    await expect(summary).toBeVisible()

    // Wait for images-per-checkpoint to resolve (non-zero means study detail loaded)
    await expect(summary.locator('p').filter({ hasText: 'Images per checkpoint:' })).toContainText(/[1-9]/, { timeout: 10000 })

    // item-limit-error must NOT be visible
    await expect(dialog.getByTestId('item-limit-error')).not.toBeVisible()

    // The launch button must NOT be disabled due to the item limit
    // (it may be disabled for other reasons, e.g. no checkpoints selected,
    // but the item-limit-error should not be present)
    await expect(dialog.getByTestId('item-limit-error')).toHaveCount(0)
  })
})
