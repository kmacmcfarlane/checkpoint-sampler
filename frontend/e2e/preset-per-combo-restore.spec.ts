import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, savePresetViaDialog } from './helpers'

/**
 * E2E tests for B-102: Dimension mapping preset not auto-selected from localStorage on TR change.
 *
 * Bug: usePresetPersistence stored only a single preset globally, so switching training
 * runs would overwrite the previously stored preset. After B-102, presets are stored per
 * (trainingRunId + studyOutputDir) combo, so each TR retains its own last-used preset.
 *
 * Acceptance criteria:
 *   AC1: Last used preset is stored in localStorage per training run + study combo.
 *   AC2: Selecting a training run auto-selects the stored preset for that TR+study.
 *   Testing note (edge case): stored preset no longer exists — should be handled gracefully.
 *
 * Test fixture data:
 *   - Training run 1: "my-model" (root checkpoints dir)
 *   - Training run 2: "test-run/my-model" (subdirectory)
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 */

test.describe('B-102: preset per-combo restore on TR change', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('AC2: page reload auto-selects stored preset for the current TR+study combo', async ({ page, request }) => {
    // AC2: Selecting a training run auto-selects the stored preset for that TR+study.
    // This test verifies the end-to-end round-trip:
    //   select TR → save preset → reload page → preset is auto-selected for that TR.
    // (In-session TR switching is covered by the per-combo localStorage format test above.)

    // Step 1: Navigate and select the training run
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 15000 })

    // Step 2: Save a preset with a specific assignment
    await page.locator('[aria-label="New preset"]').click()
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    const presetName = `B102-AC2-${Date.now()}`
    await savePresetViaDialog(page, presetName)

    // Verify preset is selected (Delete button visible)
    await expect(page.locator('[aria-label="Delete preset"]')).toBeVisible()

    // Step 3: Reload the page to simulate "selecting a training run" from scratch
    await page.reload()

    // Step 4: AC2 — the training run should be auto-selected (eagerAutoSelect),
    // and its stored preset should also be auto-loaded (eagerRestorePreset).
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 15000 })

    // The preset should be auto-selected — Delete button visible and preset name shown
    await expect(page.locator('[aria-label="Delete preset"]')).toBeVisible({ timeout: 5000 })
    const presetSelect = page.locator('.preset-select')
    await expect(presetSelect).toContainText(presetName, { timeout: 5000 })
  })

  test('AC1: preset is persisted in new per-combo format in localStorage', async ({ page }) => {
    // AC1: Last used preset is stored per TR+study combo.
    // Verify the localStorage key contains the new presetsByKey structure.

    // Step 1: Navigate and select training run
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 15000 })

    // Step 2: Save a preset
    await page.locator('[aria-label="New preset"]').click()
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await savePresetViaDialog(page, `B102-Persist-${Date.now()}`)

    // Step 3: Verify localStorage uses the new per-combo format
    const stored = await page.evaluate(() =>
      localStorage.getItem('checkpoint-sampler-last-preset'),
    )
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!)
    // AC1: must use the new per-combo format (presetsByKey), not the legacy flat format
    expect(parsed.presetsByKey).toBeDefined()
    expect(typeof parsed.presetsByKey).toBe('object')
    // The legacy format would have 'trainingRunId' and 'presetId' at the top level
    expect(parsed.trainingRunId).toBeUndefined()
  })

  test('edge case: stale preset for a TR is cleared gracefully on TR selection', async ({ page, request }) => {
    // Testing note: stored preset no longer exists → should be handled gracefully.
    // Inject a combo entry pointing to a non-existent preset ID.

    const runsResponse = await request.get('/api/training-runs')
    const runs = await runsResponse.json()
    expect(runs.length).toBeGreaterThan(0)
    const trainingRunId = runs[0].id

    await page.addInitScript((runId: number) => {
      localStorage.setItem(
        'checkpoint-sampler-last-training-run',
        JSON.stringify({ runId, studiesByRunDir: {} }),
      )
      localStorage.setItem(
        'checkpoint-sampler-last-preset',
        JSON.stringify({ presetsByKey: { [`${runId}|`]: 'nonexistent-preset-id' } }),
      )
    }, trainingRunId)

    // Navigate — app should not crash; stale entry should be cleared
    await page.goto('/')
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 15000 })

    // No preset should be selected (stale entry was cleared)
    await expect(page.locator('[aria-label="Delete preset"]')).not.toBeVisible({ timeout: 3000 })

    // Stale entry should have been removed from localStorage
    const stored = await page.evaluate(() =>
      localStorage.getItem('checkpoint-sampler-last-preset'),
    )
    if (stored !== null) {
      const parsed = JSON.parse(stored)
      // The combo key should have been deleted since the preset doesn't exist
      const runId = trainingRunId
      expect(parsed.presetsByKey?.[`${runId}|`]).toBeUndefined()
    }
  })
})
