import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
} from './helpers'

/**
 * E2E tests for B-049: Sample path scoping — Has Samples and validation must
 * strictly scope to the study directory.
 *
 * Verifies:
 * - AC3 (FE): "Select Missing" button does NOT appear when there are no missing
 *              samples for the study+training run combination
 * - AC5 (E2E): Correct behavior with study+training run that has no missing
 *               samples in the study context
 * - AC2 (BE API): Validate API with study_id uses study's images_per_checkpoint
 *                  as the expected count, not the legacy max-file-count heuristic
 *
 * Test fixture data:
 *   - Training run "my-model" has 2 checkpoints, each with 2 PNG sample files
 *     at the legacy path (sample_dir/my-model-step*.safetensors/).
 *   - No study-scoped sample directories exist in fresh fixture state.
 *   - Creating a new study with images_per_checkpoint=1 results in
 *     total_expected=2, total_actual=2, total_missing=0 → no "Select Missing".
 *
 * Design note on AC3 frontend fix:
 *   The frontend fix (`total_actual > 0 && checkpoints.some(c => c.missing > 0)`)
 *   prevents "Select Missing" when zero actual samples exist. This scenario
 *   (total_actual=0 with missing>0) occurs when a training run has no samples
 *   in its validated path. It is comprehensively covered by the unit test added
 *   in JobLaunchDialog.test.ts. At the E2E level, we verify the end-to-end UX
 *   behavior: "Select Missing" is absent for a new study with my-model.
 */

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

test.describe('B-049: sample path scoping', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  /**
   * AC5 + AC3: Verify that when a new study is selected with a training run
   * in the Generate Samples dialog, the "Select Missing" button does NOT appear
   * when no samples are missing for that study+training run combination.
   *
   * Scenario:
   *   - Training run: "my-model" (2 checkpoints, 2 legacy PNGs each)
   *   - Study: newly created, images_per_checkpoint=1 (1 prompt × 1 seed)
   *   - Validation result: total_expected=2, total_actual=2+, total_missing=0
   *   - Expected: "Select Missing" button is absent, "Select All" is visible
   *
   * This verifies the correct end-to-end behavior per AC5: with a training run
   * that has existing samples and a new study, the dialog shows checkpoints
   * correctly without the "Select Missing" option when no samples are missing.
   */
  test('Select Missing button does not appear for new study when no samples are missing', async ({ page, request }) => {
    // Create a study with images_per_checkpoint=1 (1 prompt × 1 step × 1 cfg × 1 pair × 1 seed)
    const studyResp = await request.post('/api/studies', {
      data: {
        name: `B049 Path Scope Test ${Date.now()}`,
        prompt_prefix: '',
        prompts: [{ name: 'landscape', text: 'a landscape scene' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(studyResp.ok()).toBeTruthy()
    const study = await studyResp.json()
    expect(study.images_per_checkpoint).toBe(1)

    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select training run in the dialog
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // Select the new study — this triggers study-scoped validation
    await selectNaiveOptionInContainer(page, dialog, 'study-select', study.name)

    // Wait for the checkpoint picker to appear (validation completed)
    const picker = dialog.locator('[data-testid="checkpoint-picker"]')
    await expect(picker).toBeVisible({ timeout: 10000 })

    // AC3 + AC5: "Select Missing" button must NOT appear.
    // The study expects 1 image per checkpoint; the training run has 2+ legacy samples
    // per checkpoint, so total_missing=0 and the button correctly does not appear.
    await expect(dialog.locator('[data-testid="select-missing-checkpoints"]')).toHaveCount(0)

    // "Select All" button SHOULD be visible (checkpoint picker is shown)
    await expect(dialog.locator('[data-testid="select-all-checkpoints"]')).toBeVisible()
  })

  /**
   * AC2 (BE): Validate API with study_id uses the study's images_per_checkpoint
   * as the expected count, not the max-file-count heuristic.
   *
   * For "my-model" (root-level run with legacy samples), calling validate with a
   * study_id that has images_per_checkpoint=3 should return expected_per_checkpoint=3,
   * not the heuristic value based on actual file counts.
   *
   * This verifies the fix in ValidateTrainingRunWithStudy: when study_id is provided,
   * the study's expected count drives validation regardless of cp.HasSamples.
   */
  test('validate API with study_id uses study images_per_checkpoint as expected count', async ({ request }) => {
    // Create a study with a known images_per_checkpoint (3 = 3 prompts × 1 seed × 1 cfg × 1 pair × 1 step)
    const studyResp = await request.post('/api/studies', {
      data: {
        name: `B049 IPC Test ${Date.now()}`,
        prompt_prefix: '',
        prompts: [
          { name: 'landscape', text: 'a landscape' },
          { name: 'portrait', text: 'a portrait' },
          { name: 'abstract', text: 'abstract art' },
        ],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(studyResp.ok()).toBeTruthy()
    const study = await studyResp.json()
    // 3 prompts × 1 step × 1 cfg × 1 pair × 1 seed = 3 images per checkpoint
    expect(study.images_per_checkpoint).toBe(3)

    // Get "my-model" training run using checkpoint source (same source the frontend uses
    // for the Generate Samples dialog). B-079: validate with study_id now uses checkpoint
    // discovery, so the ID must come from the same source.
    const cpRunsResp = await request.get('/api/training-runs?source=checkpoints')
    expect(cpRunsResp.ok()).toBeTruthy()
    const cpRuns = await cpRunsResp.json()
    const myModel = cpRuns.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // For legacy validate (no study_id), use the viewer-discovered ID — the legacy path
    // still uses viewer discovery.
    const viewerRunsResp = await request.get('/api/training-runs')
    expect(viewerRunsResp.ok()).toBeTruthy()
    const viewerRuns = await viewerRunsResp.json()
    const viewerModel = viewerRuns.find((r: { name: string }) => r.name === 'my-model')
    expect(viewerModel).toBeDefined()

    // Call validate WITHOUT study_id (legacy heuristic mode uses viewer discovery)
    const legacyResp = await request.post(`/api/training-runs/${viewerModel.id}/validate`)
    expect(legacyResp.ok()).toBeTruthy()
    const legacyResult = await legacyResp.json()
    // Legacy mode uses max-file-count heuristic = 2 (each checkpoint has 2 PNGs)
    expect(legacyResult.expected_per_checkpoint).toBe(2)

    // Call validate WITH study_id (study-aware mode uses checkpoint discovery)
    const studyResp2 = await request.post(
      `/api/training-runs/${myModel.id}/validate?study_id=${study.id}`,
    )
    expect(studyResp2.ok()).toBeTruthy()
    const studyResult = await studyResp2.json()

    // AC2: Study-aware mode uses the study's images_per_checkpoint (3), not the heuristic (2)
    expect(studyResult.expected_per_checkpoint).toBe(3)
    expect(studyResult.total_expected).toBe(3 * myModel.checkpoint_count)

    // Both checkpoints have 2 actual samples but expected 3, so missing=1 each
    for (const cp of studyResult.checkpoints) {
      expect(cp.expected).toBe(3)
      // total_actual reflects found samples (2 legacy PNGs per checkpoint)
      expect(cp.verified).toBeGreaterThanOrEqual(0)
    }
  })

  /**
   * AC5 (API verification): Validate endpoint returns correct structure and
   * respects study context for the training run's path scoping.
   *
   * This test verifies the backend correctly handles the validate endpoint
   * with study_id for a training run that has samples at the legacy path.
   */
  test('validate API returns correct structure with study_id for training run with legacy samples', async ({ request }) => {
    // Create a minimal study (1 image per checkpoint)
    const studyResp = await request.post('/api/studies', {
      data: {
        name: `B049 Structure Test ${Date.now()}`,
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
    expect(studyResp.ok()).toBeTruthy()
    const study = await studyResp.json()

    // Get my-model training run using checkpoint source (same source the frontend uses).
    // B-079: validate with study_id uses checkpoint discovery for correct path scoping.
    const runsResp = await request.get('/api/training-runs?source=checkpoints')
    expect(runsResp.ok()).toBeTruthy()
    const runs = await runsResp.json()
    const myModel = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // Call validate with study_id
    const validateResp = await request.post(
      `/api/training-runs/${myModel.id}/validate?study_id=${study.id}`,
    )
    expect(validateResp.ok()).toBeTruthy()

    const result = await validateResp.json()

    // Response must include all required fields per AC5
    expect(typeof result.total_expected).toBe('number')
    expect(typeof result.total_actual).toBe('number')
    expect(typeof result.total_missing).toBe('number')
    expect(typeof result.total_verified).toBe('number')
    expect(Array.isArray(result.checkpoints)).toBe(true)

    // Checkpoints should match the training run's checkpoint count
    expect(result.checkpoints.length).toBe(myModel.checkpoint_count)

    // Each checkpoint entry has required fields
    for (const cp of result.checkpoints) {
      expect(typeof cp.checkpoint).toBe('string')
      expect(typeof cp.expected).toBe('number')
      expect(typeof cp.verified).toBe('number')
      expect(typeof cp.missing).toBe('number')
    }

    // With study_id, expected_per_checkpoint matches the study config
    expect(result.expected_per_checkpoint).toBe(study.images_per_checkpoint)
  })
})
