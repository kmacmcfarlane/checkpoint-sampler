import { test, expect, type Page } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for the Debug Mode overlay feature (story B-032).
 *
 * Verifies:
 * - AC1: Debug toggle button appears in the top navigation bar
 * - AC2: Debug overlay shows filtering parameters on each grid cell
 * - AC3: Debug overlay does not interfere with image click/lightbox
 * - AC5: Debug mode state does not persist across page reloads
 *
 * Test fixture data (from test-fixtures/):
 *   - Training run: "my-model" with 2 checkpoints (step 1000, step 2000)
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
  const popupMenu = page.locator('.n-base-select-menu:visible')
  await expect(popupMenu).toBeVisible()
  await popupMenu.getByText(optionText, { exact: true }).click()
  await expect(popupMenu).not.toBeVisible()
}

/**
 * Selects a training run from the sidebar NSelect dropdown.
 */
async function selectTrainingRun(page: Page, runName: string): Promise<void> {
  const selectTrigger = page.locator('[data-testid="training-run-select"]')
  await expect(selectTrigger).toBeVisible()
  await selectTrigger.click()
  const popupMenu = page.locator('.n-base-select-menu:visible')
  await expect(popupMenu).toBeVisible()
  await popupMenu.getByText(runName, { exact: true }).click()
  await expect(popupMenu).not.toBeVisible()
}

/**
 * Closes the NDrawer using its close button (aria-label="close" rendered by
 * Naive UI NBaseClose). The hamburger button may be occluded by the drawer
 * header, so using the drawer's own close button is more reliable.
 * Waits for the drawer mask animation to complete (per TEST_PRACTICES.md 6.9).
 */
async function closeDrawer(page: Page): Promise<void> {
  const drawerCloseButton = page.locator('[aria-label="close"]').first()
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    await expect(drawerCloseButton).not.toBeVisible()
    await page.waitForTimeout(300)
  }
}

/**
 * Sets up a grid by selecting a training run and assigning X/Y axes,
 * then closes the drawer to avoid NDrawer mask interference with
 * subsequent clicks on header elements (per TEST_PRACTICES.md 6.9).
 */
async function setupGridWithAxes(page: Page): Promise<void> {
  await page.goto('/')
  await selectTrainingRun(page, 'my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()

  // Assign checkpoint -> X axis, prompt_name -> Y axis
  await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')
  await selectNaiveOption(page, 'Role for prompt_name', 'Y Axis')

  // Wait for grid to render with images
  const gridCells = page.locator('.xy-grid [role="gridcell"]')
  await expect(gridCells.first()).toBeVisible()

  // Close the drawer so its mask doesn't intercept clicks on header controls
  await closeDrawer(page)
}

test.describe('debug mode overlay', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: A 'Debug' toggle button appears in the top navigation bar
  test('debug toggle button is visible in the header', async ({ page }) => {
    await page.goto('/')

    // Close the drawer to avoid mask interference
    await closeDrawer(page)

    const debugButton = page.locator('[data-testid="debug-toggle"]')
    await expect(debugButton).toBeVisible()
    await expect(debugButton).toHaveText('Debug')
  })

  // AC2: When debug mode is active, each grid cell overlays a panel showing filtering parameters
  test('enabling debug mode shows debug overlays on grid cells', async ({ page }) => {
    await setupGridWithAxes(page)

    // Verify no debug overlays are visible initially
    await expect(page.locator('[data-testid="debug-overlay"]')).toHaveCount(0)

    // Click the Debug toggle
    await page.locator('[data-testid="debug-toggle"]').click()

    // Debug overlays should now appear on grid cells
    const overlays = page.locator('[data-testid="debug-overlay"]')
    await expect(overlays.first()).toBeVisible()

    // Each grid cell should have a debug overlay (2x2 grid = 4 cells)
    const overlayCount = await overlays.count()
    expect(overlayCount).toBe(4)
  })

  // AC2: Debug overlay shows x value, y value for each cell
  test('debug overlay displays x and y axis values', async ({ page }) => {
    await setupGridWithAxes(page)

    // Enable debug mode
    await page.locator('[data-testid="debug-toggle"]').click()

    // Check first overlay shows X and Y values
    const firstOverlay = page.locator('[data-testid="debug-overlay"]').first()
    await expect(firstOverlay).toBeVisible()

    // Should show X value (checkpoint values: 1000 or 2000)
    const xValue = firstOverlay.locator('[data-testid="debug-x-value"]')
    await expect(xValue).toBeVisible()
    await expect(xValue).toContainText('X:')

    // Should show Y value (prompt_name values: landscape or portrait)
    const yValue = firstOverlay.locator('[data-testid="debug-y-value"]')
    await expect(yValue).toBeVisible()
    await expect(yValue).toContainText('Y:')
  })

  // AC2: Debug overlay shows slider value when slider dimension is assigned
  test('debug overlay shows slider value when slider dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign axes with a slider dimension
    await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')
    await selectNaiveOption(page, 'Role for prompt_name', 'Y Axis')
    await selectNaiveOption(page, 'Role for cfg', 'Slider')

    // Wait for grid
    await expect(page.locator('.xy-grid [role="gridcell"]').first()).toBeVisible()

    // Close drawer before clicking debug toggle
    await closeDrawer(page)

    // Enable debug mode
    await page.locator('[data-testid="debug-toggle"]').click()

    // Check that slider value is shown in overlay
    const firstOverlay = page.locator('[data-testid="debug-overlay"]').first()
    await expect(firstOverlay).toBeVisible()

    const sliderValue = firstOverlay.locator('[data-testid="debug-slider-value"]')
    await expect(sliderValue).toBeVisible()
    await expect(sliderValue).toContainText('cfg:')
  })

  // AC3: Debug overlay does not interfere with image click/lightbox interaction
  test('clicking an image cell with debug overlay active opens the lightbox', async ({ page }) => {
    await setupGridWithAxes(page)

    // Enable debug mode
    await page.locator('[data-testid="debug-toggle"]').click()

    // Wait for overlays to appear
    await expect(page.locator('[data-testid="debug-overlay"]').first()).toBeVisible()

    // Click on the first image cell that has an actual image
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await expect(firstImage).toBeVisible()
    await firstImage.click()

    // Lightbox should open
    const lightbox = page.locator('.lightbox-backdrop')
    await expect(lightbox).toBeVisible()

    // Close lightbox with Escape
    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible()
  })

  // AC1: Debug toggle button toggles debug mode off when clicked again
  test('debug toggle can be toggled off', async ({ page }) => {
    await setupGridWithAxes(page)

    // Enable debug mode
    await page.locator('[data-testid="debug-toggle"]').click()
    await expect(page.locator('[data-testid="debug-overlay"]').first()).toBeVisible()

    // Disable debug mode
    await page.locator('[data-testid="debug-toggle"]').click()

    // Debug overlays should no longer be visible
    await expect(page.locator('[data-testid="debug-overlay"]')).toHaveCount(0)
  })

  // AC5: Debug mode state does not persist across page reloads (session-only)
  test('debug mode does not persist after page reload', async ({ page }) => {
    await setupGridWithAxes(page)

    // Enable debug mode
    await page.locator('[data-testid="debug-toggle"]').click()
    await expect(page.locator('[data-testid="debug-overlay"]').first()).toBeVisible()

    // Reload the page
    await page.reload()

    // Debug overlays should NOT be present after reload.
    // The debug button should be in default (non-active) state.
    const debugButton = page.locator('[data-testid="debug-toggle"]')
    await expect(debugButton).toBeVisible()

    // Verify no debug overlays anywhere on the page
    await expect(page.locator('[data-testid="debug-overlay"]')).toHaveCount(0)
  })
})
