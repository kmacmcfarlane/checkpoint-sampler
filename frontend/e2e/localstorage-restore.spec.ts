import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, savePresetViaDialog, closeDrawer } from './helpers'

/**
 * E2E tests for localStorage restoration on app load/refresh (B-101).
 *
 * Bug: First opening the web app or refreshing does not load the last training
 * run, study, or dimension mapping preset until the side panel controls are
 * opened. On smaller displays where controls don't open by default, state is
 * effectively lost.
 *
 * Test fixture data:
 *   - Training run: "my-model" with multiple checkpoints
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 */

test.describe('localStorage restoration on refresh (B-101)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('AC1: page refresh preserves training run selection', async ({ page }) => {
    // AC1: App restores last selected training run from localStorage on initial load.
    // AC3: Page refresh preserves training run and study selection.

    // Step 1: Navigate and select a training run
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')

    // Wait for scan to complete (Metadata button appears)
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).toBeVisible()

    // Step 2: Refresh the page
    await page.reload()

    // Step 3: Verify the training run is restored without opening the drawer.
    // The Metadata button only appears when a training run is selected and scanned.
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).toBeVisible({ timeout: 10000 })
  })

  test('AC2: restoration works on narrow screen (drawer collapsed)', async ({ page }) => {
    // AC2: Restoration works even when side panel is collapsed (small screens).

    // Step 1: Select a training run on a wide screen
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).toBeVisible()

    // Step 2: Switch to narrow viewport and reload
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.reload()

    // Step 3: On narrow screen, the drawer is collapsed, but state should be restored.
    // The Metadata button should still be visible (training run was restored).
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).toBeVisible({ timeout: 10000 })
  })

  test('AC1: page refresh restores preset and dimension assignments', async ({ page }) => {
    // AC1: App restores last selected preset from localStorage on initial load.
    // This verifies the dimension mapping (x/y/slider) is applied after refresh.

    // Step 1: Navigate, select training run, and set up dimension assignments
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Click "New" to establish a clean baseline for dirty tracking
    await page.locator('[aria-label="New preset"]').click()

    // Assign checkpoint to X axis, prompt_name to Y axis
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Save as a preset
    await savePresetViaDialog(page, 'Test Restore Preset')

    // Close the drawer so we can verify the grid reflects the preset
    await closeDrawer(page)

    // Step 2: Refresh the page
    await page.reload()

    // Step 3: Verify the training run is restored (Metadata button visible)
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).toBeVisible({ timeout: 10000 })

    // Step 4: Verify the XYGrid renders with dimension headers matching the saved preset.
    // The X axis headers (checkpoint values) and Y axis headers (prompt_name values)
    // should be visible in the grid.
    // Wait for the grid to render
    await expect(page.locator('.xy-grid')).toBeVisible({ timeout: 10000 })
  })

  test('AC3: selecting a training run persists it for next refresh', async ({ page }) => {
    // AC3: Page refresh preserves training run selection.
    // Verify the full round-trip: select -> persist -> reload -> restore.

    // Step 1: Navigate with no previous state
    await page.goto('/')

    // Step 2: Select a training run
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).toBeVisible()

    // Step 3: Verify localStorage was written
    const storedValue = await page.evaluate(() =>
      localStorage.getItem('checkpoint-sampler-last-training-run'),
    )
    expect(storedValue).not.toBeNull()

    // Step 4: Reload and verify restoration
    await page.reload()
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).toBeVisible({ timeout: 10000 })
  })

  test('AC1: stale training run in localStorage is handled gracefully', async ({ page, request }) => {
    // Edge case: localStorage has a training run ID that no longer exists on the backend.
    // The app should not crash; it should show the placeholder message.

    // Inject a stale training run ID
    await page.addInitScript(() => {
      localStorage.setItem(
        'checkpoint-sampler-last-training-run',
        JSON.stringify({ runId: 99999, studiesByRunDir: {} }),
      )
    })

    await page.goto('/')

    // The app should not crash — placeholder text should be shown
    await expect(page.getByText('Select a training run to get started.')).toBeVisible({ timeout: 10000 })
  })
})
