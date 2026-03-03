import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for viewer-driven discovery (S-081).
 *
 * Verifies that training runs are discovered from sample output directories
 * rather than checkpoint files, and that the 'Has Samples' filter has been removed.
 *
 * Test fixture data:
 *   - sample_dir contains:
 *       my-model-step00001000.safetensors/ (legacy root-level checkpoint dir)
 *       my-model-step00002000.safetensors/ (legacy root-level checkpoint dir)
 *   - Training run name: "my-model" (derived from directory names, not checkpoint files)
 */

test.describe('viewer-driven discovery (S-081)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: Scanner discovers viewable content from sample output directories
  // AC2: Training runs derived from directory structure under sample_dir
  test('training runs API returns directory-derived names with has_samples=true', async ({ request }) => {
    const response = await request.get('/api/training-runs')
    expect(response.ok()).toBeTruthy()

    const runs = await response.json()
    expect(runs.length).toBeGreaterThan(0)

    // The training run should be named "my-model" (derived from sample dir names)
    // not "test-run/my-model" (which was the old checkpoint-dir-based name)
    const run = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(run).toBeDefined()

    // AC1: All viewer-discovered runs have samples by definition
    expect(run.has_samples).toBe(true)
    expect(run.checkpoint_count).toBe(2)

    // Each checkpoint should also have has_samples=true
    for (const cp of run.checkpoints) {
      expect(cp.has_samples).toBe(true)
    }
  })

  // AC3: The 'Has Samples' filter on the main controls slideout is removed
  test('no has-samples checkbox exists in the training run selector', async ({ page }) => {
    await page.goto('/')

    // Wait for the drawer to be visible with the sample set selector (renamed from "Training Run" in S-083)
    await expect(page.getByText('Sample Set', { exact: true })).toBeVisible()

    // There should be no checkbox with "Has Samples" text or a has-samples data-testid
    await expect(page.locator('[data-testid="has-samples-checkbox"]')).toHaveCount(0)
    await expect(page.getByText('Has Samples')).toHaveCount(0)
  })

  // AC4: Existing grid, slider, and filter functionality works with directory-driven discovery
  test('training run is selectable and scan completes successfully', async ({ page }) => {
    await page.goto('/')

    // The training run selector should be visible
    const selectTrigger = page.locator('[data-testid="training-run-select"]')
    await expect(selectTrigger).toBeVisible()

    // Select the training run by its directory-derived name
    await selectTrigger.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('my-model', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // After selection, the app should scan and show the Dimensions panel
    await expect(page.getByText('Dimensions')).toBeVisible()

    // The placeholder text should be gone
    await expect(page.getByText('Select a training run to get started.')).not.toBeVisible()
  })

  // AC1: has_samples query parameter is no longer needed (API compatibility)
  test('training runs API works without has_samples query parameter', async ({ request }) => {
    // The API should return all runs without any filter parameter
    const response = await request.get('/api/training-runs')
    expect(response.ok()).toBeTruthy()

    const runs = await response.json()
    expect(runs.length).toBeGreaterThan(0)

    // Even with has_samples=true (old API compat), results should be the same
    const filteredResponse = await request.get('/api/training-runs?has_samples=true')
    expect(filteredResponse.ok()).toBeTruthy()

    const filteredRuns = await filteredResponse.json()
    // Same runs returned regardless of filter (all have samples by definition)
    expect(filteredRuns.length).toBe(runs.length)
  })
})
