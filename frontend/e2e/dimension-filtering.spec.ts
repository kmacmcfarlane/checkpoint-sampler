import { test, expect } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  selectNaiveOptionByLabel,
  closeDrawer,
  openFiltersDrawer,
  closeFiltersDrawer,
} from './helpers'

/**
 * E2E tests for dimension configuration and combo filter workflows:
 *   - Open dimension panel and change X/Y axis assignments
 *   - Verify grid updates to reflect new axis dimensions
 *   - Apply combo filter (deselect a value) and verify grid reduces
 *   - Clear the filter and verify grid returns to full state
 *
 * Filters are accessed via the right-side Filters drawer (opened by the
 * "Filters" button in the header). Individual dimension filters are always
 * expanded inside the drawer (no per-dimension toggle).
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Checkpoints: step 1000, step 2000
 *   - Images per checkpoint: prompt_name=landscape, prompt_name=portrait (seed=42, cfg=7)
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 */

test.describe('dimension filtering and combo filters', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('opens dimension panel and changes X/Y axis assignments', async ({ page }) => {
    await page.goto('/')

    // Select the fixture training run
    await selectTrainingRun(page, 'my-model')

    // Wait for dimension panel to appear (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign "checkpoint" dimension to X axis
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')

    // Verify the role select for checkpoint now shows "X Axis"
    const checkpointRoleSelect = page.locator('[aria-label="Mode for checkpoint"]')
    await expect(checkpointRoleSelect).toBeVisible()
    await expect(checkpointRoleSelect).toContainText('X Axis')

    // Assign "prompt_name" dimension to Y axis
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Verify the role select for prompt_name now shows "Y Axis"
    const promptRoleSelect = page.locator('[aria-label="Mode for prompt_name"]')
    await expect(promptRoleSelect).toBeVisible()
    await expect(promptRoleSelect).toContainText('Y Axis')
  })

  test('grid updates to reflect new X/Y axis assignments', async ({ page }) => {
    await page.goto('/')

    // Select the fixture training run
    await selectTrainingRun(page, 'my-model')

    // Wait for dimension panel to appear (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Initially no grid should be present (no axes assigned yet)
    await expect(page.locator('.xy-grid-container')).not.toBeVisible()

    // Assign "checkpoint" to X axis
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')

    // Close the drawer so we can see the grid
    await closeDrawer(page)

    // After assigning X, a grid container should appear
    const gridContainer = page.locator('.xy-grid-container')
    await expect(gridContainer).toBeVisible()

    // Column headers for checkpoint values (step 1000 and step 2000) should be visible
    await expect(page.locator('.xy-grid__col-header').filter({ hasText: '1000' })).toBeVisible()
    await expect(page.locator('.xy-grid__col-header').filter({ hasText: '2000' })).toBeVisible()

    // Re-open drawer to assign Y axis
    await page.getByRole('button', { name: 'Toggle controls drawer' }).click()
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign "prompt_name" to Y axis
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Close the drawer again
    await closeDrawer(page)

    // Row headers for prompt_name values should now be visible
    await expect(page.locator('.xy-grid__row-header').filter({ hasText: 'landscape' })).toBeVisible()
    await expect(page.locator('.xy-grid__row-header').filter({ hasText: 'portrait' })).toBeVisible()
  })

  test('applies combo filter (deselects a value) and verifies grid columns reduce', async ({ page }) => {
    await page.goto('/')

    // Select the fixture training run
    await selectTrainingRun(page, 'my-model')

    // Wait for dimension panel to appear
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign axes
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Close sidebar drawer to interact with main area
    await closeDrawer(page)

    // Verify we start with 2 column headers (1000 and 2000)
    const colHeaders = page.locator('.xy-grid__col-header')
    await expect(colHeaders).toHaveCount(2)
    await expect(colHeaders.filter({ hasText: '1000' })).toBeVisible()
    await expect(colHeaders.filter({ hasText: '2000' })).toBeVisible()

    // Open the Filters drawer (right-side slideout)
    await openFiltersDrawer(page)

    // Filters are always expanded in the drawer -- no per-dimension toggle needed.
    // Deselect checkpoint step 1000
    const checkpoint1000Checkbox = page.locator('[aria-label="Toggle checkpoint 1000"]')
    await checkpoint1000Checkbox.first().click()

    // Close the filters drawer to verify grid state
    await closeFiltersDrawer(page)

    // After deselecting step 1000, only step 2000 column should be visible
    await expect(colHeaders.filter({ hasText: '1000' })).not.toBeVisible()
    await expect(colHeaders.filter({ hasText: '2000' })).toBeVisible()

    // Grid should now have only 1 column header
    await expect(colHeaders).toHaveCount(1)
  })

  test('clears combo filter and verifies grid returns to full state', async ({ page }) => {
    await page.goto('/')

    // Select the fixture training run
    await selectTrainingRun(page, 'my-model')

    // Wait for dimension panel to appear
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign axes
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Close sidebar drawer to interact with main area
    await closeDrawer(page)

    // Open the Filters drawer
    await openFiltersDrawer(page)

    // Deselect step 1000 to reduce to 1 column
    const checkpoint1000Checkbox = page.locator('[aria-label="Toggle checkpoint 1000"]')
    await checkpoint1000Checkbox.first().click()

    // Verify filtered state: only 1 column header
    const colHeaders = page.locator('.xy-grid__col-header')
    await expect(colHeaders).toHaveCount(1)
    await expect(page.locator('.xy-grid__col-header').filter({ hasText: '1000' })).not.toBeVisible()

    // Clear the filter by clicking "All" for the checkpoint dimension
    const selectAllButton = page.getByRole('button', { name: 'Select all checkpoint' })
    await expect(selectAllButton).toBeVisible()
    await selectAllButton.click()

    // Close filters drawer to verify grid
    await closeFiltersDrawer(page)

    // Verify the grid returns to full state: both columns visible
    await expect(colHeaders).toHaveCount(2)
    await expect(page.locator('.xy-grid__col-header').filter({ hasText: '1000' })).toBeVisible()
    await expect(page.locator('.xy-grid__col-header').filter({ hasText: '2000' })).toBeVisible()

    // Both row headers should still be visible
    await expect(page.locator('.xy-grid__row-header').filter({ hasText: 'landscape' })).toBeVisible()
    await expect(page.locator('.xy-grid__row-header').filter({ hasText: 'portrait' })).toBeVisible()
  })
})
