import { test, expect, type Page } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for the core user journey:
 * open app → select training run → configure axes → see XY grid with images.
 *
 * These tests run against the self-contained E2E stack (docker-compose.e2e.yml)
 * which mounts test-fixtures/ as the checkpoint and sample data sources.
 *
 * Expected test fixture data:
 *   - Training run: "test-run/my-model" with 2 checkpoints (step 1000, step 2000)
 *   - Each checkpoint has 2 sample images: prompt_name=landscape and prompt_name=portrait
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 */

/**
 * Opens a Naive UI NSelect dropdown identified by aria-label, waits for the
 * popup to appear, then clicks the option matching optionText.
 */
async function selectNaiveOption(page: Page, selectAriaLabel: string, optionText: string): Promise<void> {
  const select = page.locator(`[aria-label="${selectAriaLabel}"]`)
  await select.click()
  // Naive UI renders the popup menu as .n-base-select-menu — wait for it to be visible
  const popupMenu = page.locator('.n-base-select-menu:visible')
  await expect(popupMenu).toBeVisible()
  await popupMenu.getByText(optionText, { exact: true }).click()
  // Wait for popup to close after selection
  await expect(popupMenu).not.toBeVisible()
}

/**
 * Selects a training run from the sidebar NSelect dropdown.
 * Waits for the training runs to load and the option to appear.
 */
async function selectTrainingRun(page: Page, runName: string): Promise<void> {
  const selectTrigger = page.locator('.training-run-selector .n-select')
  await expect(selectTrigger).toBeVisible()
  await selectTrigger.click()
  const popupMenu = page.locator('.n-base-select-menu:visible')
  await expect(popupMenu).toBeVisible()
  await popupMenu.getByText(runName, { exact: true }).click()
  await expect(popupMenu).not.toBeVisible()
}

test.describe('training run selection and XY grid display', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('selects a training run from the sidebar dropdown', async ({ page }) => {
    await page.goto('/')

    // The drawer opens automatically on wide screens (>= 1024px).
    // Ensure the Training Run label is visible in the drawer.
    await expect(page.getByText('Training Run', { exact: true })).toBeVisible()

    // Select the fixture training run
    await selectTrainingRun(page, 'test-run/my-model')

    // After selection, the main content should no longer show the "get started" prompt
    await expect(page.getByText('Select a training run to get started.')).not.toBeVisible()

    // The app scans the run (briefly shows "Scanning...") then renders the Dimensions panel
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test('XY grid renders with dimension axis labels after assigning axes', async ({ page }) => {
    await page.goto('/')

    // Select the training run
    await selectTrainingRun(page, 'test-run/my-model')

    // Wait for dimension panel to appear (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign "checkpoint" dimension to X axis
    await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')

    // Assign "prompt_name" dimension to Y axis
    await selectNaiveOption(page, 'Role for prompt_name', 'Y Axis')

    // The XY grid container should now be visible
    const gridContainer = page.locator('.xy-grid-container')
    await expect(gridContainer).toBeVisible()

    // Verify column headers (checkpoint values: 1000, 2000) are visible
    await expect(page.locator('[role="columnheader"]').filter({ hasText: '1000' })).toBeVisible()
    await expect(page.locator('[role="columnheader"]').filter({ hasText: '2000' })).toBeVisible()

    // Verify row headers (prompt_name values: landscape, portrait) are visible
    await expect(page.locator('[role="rowheader"]').filter({ hasText: 'landscape' })).toBeVisible()
    await expect(page.locator('[role="rowheader"]').filter({ hasText: 'portrait' })).toBeVisible()
  })

  test('at least one image cell appears in the grid after axis assignment', async ({ page }) => {
    await page.goto('/')

    // Select the training run
    await selectTrainingRun(page, 'test-run/my-model')

    // Wait for scan to complete
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint → X axis, prompt_name → Y axis
    await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')
    await selectNaiveOption(page, 'Role for prompt_name', 'Y Axis')

    // Grid cells should contain images (not just "No image" placeholders)
    // The image cells with actual images render an <img> element inside .image-cell
    const gridCells = page.locator('.xy-grid [role="gridcell"]')
    await expect(gridCells.first()).toBeVisible()

    // At least one img element should be present in the grid
    const images = page.locator('.xy-grid [role="gridcell"] img')
    await expect(images.first()).toBeVisible()
  })

  test('dimension axis labels are visible in the rendered grid', async ({ page }) => {
    await page.goto('/')

    // Select the training run
    await selectTrainingRun(page, 'test-run/my-model')

    // Wait for scan to complete
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign axes
    await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')
    await selectNaiveOption(page, 'Role for prompt_name', 'Y Axis')

    // Verify column headers are visible and display checkpoint step values
    await expect(page.locator('.xy-grid__col-header').filter({ hasText: '1000' })).toBeVisible()
    await expect(page.locator('.xy-grid__col-header').filter({ hasText: '2000' })).toBeVisible()

    // Verify row headers are visible and display prompt_name values
    await expect(page.locator('.xy-grid__row-header').filter({ hasText: 'landscape' })).toBeVisible()
    await expect(page.locator('.xy-grid__row-header').filter({ hasText: 'portrait' })).toBeVisible()
  })
})
