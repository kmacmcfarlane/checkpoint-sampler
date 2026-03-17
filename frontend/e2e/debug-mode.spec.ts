import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for the Debug Mode overlay feature (story B-032, updated S-091).
 *
 * Verifies:
 * - AC1 (S-091): Debug toggle is in the Settings dialog, not in the top navigation bar
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
 * Dismisses any overlays (NDrawer masks, modal dialogs, settings dialog)
 * that could intercept pointer events on header buttons. Under resource
 * contention in parallel shards, NDrawer close animations take longer
 * than the 300ms fixed wait in closeDrawer (B-111).
 */
async function dismissOverlays(page: Page): Promise<void> {
  // Dismiss any visible NDrawer masks — these intercept all pointer events
  // while the drawer close animation is in progress.
  const drawerMask = page.locator('.n-drawer-mask')
  const maskCount = await drawerMask.count()
  for (let i = 0; i < maskCount; i++) {
    await expect(drawerMask.nth(i)).not.toBeVisible({ timeout: 5000 })
  }

  // Dismiss the settings dialog if left open by a prior test
  const settingsDialog = page.locator('[data-testid="settings-dialog"]')
  if (await settingsDialog.isVisible({ timeout: 200 }).catch(() => false)) {
    await page.keyboard.press('Escape')
    await expect(settingsDialog).not.toBeVisible()
  }
}

async function openSettingsDialog(page: Page): Promise<void> {
  await dismissOverlays(page)
  const settingsButton = page.locator('[data-testid="settings-button"]')
  await expect(settingsButton).toBeVisible()
  await settingsButton.click()
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible()
}

/**
 * Enables debug mode via the Settings dialog.
 */
async function enableDebugMode(page: Page): Promise<void> {
  await openSettingsDialog(page)
  const debugSwitch = page.locator('[data-testid="debug-toggle"]')
  await expect(debugSwitch).toBeVisible()
  // Click the switch to turn on debug mode
  await debugSwitch.click()
  // Close the dialog by pressing Escape
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="settings-dialog"]')).not.toBeVisible()
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
  await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

  // Wait for grid to render with images
  const gridCells = page.locator('.xy-grid [role="gridcell"]')
  await expect(gridCells.first()).toBeVisible()

  // Close the drawer and wait for all overlay masks to fully disappear.
  // closeDrawer uses a fixed 300ms wait which is insufficient under resource
  // contention in parallel shards (B-111).
  await closeDrawer(page)
  await dismissOverlays(page)
}

test.describe('debug mode overlay', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1 (S-091): Debug toggle is in the Settings dialog, not in the top navigation bar
  test('debug toggle is inside the Settings dialog, not in the header', async ({ page }) => {
    await page.goto('/')
    await closeDrawer(page)

    // The debug toggle should NOT be directly visible in the header
    // (it's now inside the Settings dialog)
    const headerDebugToggle = page.locator('header [data-testid="debug-toggle"]')
    await expect(headerDebugToggle).toHaveCount(0)

    // Open the Settings dialog — debug toggle should be inside
    await openSettingsDialog(page)
    const dialogDebugToggle = page.locator('[data-testid="settings-dialog"] [data-testid="debug-toggle"]')
    await expect(dialogDebugToggle).toBeVisible()
  })

  // AC2: When debug mode is active, each grid cell overlays a panel showing filtering parameters
  test('enabling debug mode shows debug overlays on grid cells', async ({ page }) => {
    await setupGridWithAxes(page)

    // Verify no debug overlays are visible initially
    await expect(page.locator('[data-testid="debug-overlay"]')).toHaveCount(0)

    // Enable debug mode via settings dialog
    await enableDebugMode(page)

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
    await enableDebugMode(page)

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
  // Note: S-080 disables role assignment for single-value dimensions (cfg, seed).
  // Use prompt_name as Slider since it has multiple values.
  test('debug overlay shows slider value when slider dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign axes: checkpoint -> X, prompt_name -> Slider (both multi-value)
    // S-080: cfg and seed are single-value and have disabled role selects
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Slider')

    // Wait for grid
    await expect(page.locator('.xy-grid [role="gridcell"]').first()).toBeVisible()

    // Close drawer before clicking settings button
    await closeDrawer(page)

    // Enable debug mode via settings dialog
    await enableDebugMode(page)

    // Check that slider value is shown in overlay
    const firstOverlay = page.locator('[data-testid="debug-overlay"]').first()
    await expect(firstOverlay).toBeVisible()

    const sliderValue = firstOverlay.locator('[data-testid="debug-slider-value"]')
    await expect(sliderValue).toBeVisible()
    await expect(sliderValue).toContainText('prompt_name:')
  })

  // AC3: Debug overlay does not interfere with image click/lightbox interaction
  test('clicking an image cell with debug overlay active opens the lightbox', async ({ page }) => {
    await setupGridWithAxes(page)

    // Enable debug mode
    await enableDebugMode(page)

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

  // AC1: Debug toggle can be toggled off from the Settings dialog
  test('debug toggle can be toggled off', async ({ page }) => {
    await setupGridWithAxes(page)

    // Enable debug mode
    await enableDebugMode(page)
    await expect(page.locator('[data-testid="debug-overlay"]').first()).toBeVisible()

    // Open settings and disable debug mode
    await openSettingsDialog(page)
    const debugSwitch = page.locator('[data-testid="debug-toggle"]')
    await debugSwitch.click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="settings-dialog"]')).not.toBeVisible()

    // Debug overlays should no longer be visible
    await expect(page.locator('[data-testid="debug-overlay"]')).toHaveCount(0)
  })

  // AC5: Debug mode state does not persist across page reloads (session-only)
  test('debug mode does not persist after page reload', async ({ page }) => {
    await setupGridWithAxes(page)

    // Enable debug mode
    await enableDebugMode(page)
    await expect(page.locator('[data-testid="debug-overlay"]').first()).toBeVisible()

    // Reload the page
    await page.reload()

    // Debug overlays should NOT be present after reload.
    // The debug switch in Settings dialog should be in off state.
    await closeDrawer(page)
    await openSettingsDialog(page)
    const debugSwitch = page.locator('[data-testid="debug-toggle"]')
    await expect(debugSwitch).toBeVisible()

    // Verify no debug overlays anywhere on the page (even with dialog closed)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="debug-overlay"]')).toHaveCount(0)
  })

  // AC1 (S-100): When debug mode is enabled, the lightbox displays a params overlay on the current image
  test('lightbox shows debug overlay when debug mode is enabled', async ({ page }) => {
    await setupGridWithAxes(page)

    // Enable debug mode
    await enableDebugMode(page)

    // Wait for debug overlays to appear on grid cells
    await expect(page.locator('[data-testid="debug-overlay"]').first()).toBeVisible()

    // Click the first image cell that has an actual image
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await expect(firstImage).toBeVisible()
    await firstImage.click()

    // Lightbox should open
    const lightbox = page.locator('.lightbox-backdrop')
    await expect(lightbox).toBeVisible()

    // AC1: Debug overlay should appear inside the lightbox
    const lightboxDebugOverlay = lightbox.locator('[data-testid="lightbox-debug-overlay"]')
    await expect(lightboxDebugOverlay).toBeVisible()
  })

  // AC4 (S-100): When debug mode is disabled, no overlay is shown in the lightbox
  test('lightbox does not show debug overlay when debug mode is disabled', async ({ page }) => {
    await setupGridWithAxes(page)

    // Do NOT enable debug mode — it starts off

    // Click the first image to open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await expect(firstImage).toBeVisible()
    await firstImage.click()

    // Lightbox should open
    const lightbox = page.locator('.lightbox-backdrop')
    await expect(lightbox).toBeVisible()

    // AC4: No debug overlay should be present in the lightbox
    const lightboxDebugOverlay = lightbox.locator('[data-testid="lightbox-debug-overlay"]')
    await expect(lightboxDebugOverlay).toHaveCount(0)

    // Close lightbox
    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible()
  })

  // AC2 (S-100): Overlay shows the same parameter information as the XY grid debug overlay
  test('lightbox debug overlay shows x and y axis values matching the grid cell', async ({ page }) => {
    await setupGridWithAxes(page)

    // Enable debug mode — grid cells will show overlays with X and Y info
    await enableDebugMode(page)
    await expect(page.locator('[data-testid="debug-overlay"]').first()).toBeVisible()

    // Click the first image to open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await expect(firstImage).toBeVisible()
    await firstImage.click()

    const lightbox = page.locator('.lightbox-backdrop')
    await expect(lightbox).toBeVisible()

    const lightboxDebugOverlay = lightbox.locator('[data-testid="lightbox-debug-overlay"]')
    await expect(lightboxDebugOverlay).toBeVisible()

    // AC2: The overlay should show X and Y values
    const xValue = lightboxDebugOverlay.locator('[data-testid="debug-x-value"]')
    await expect(xValue).toBeVisible()
    await expect(xValue).toContainText('X:')

    const yValue = lightboxDebugOverlay.locator('[data-testid="debug-y-value"]')
    await expect(yValue).toBeVisible()
    await expect(yValue).toContainText('Y:')

    // Close lightbox
    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible()
  })

  // AC3 (S-100): Overlay is positioned to not obscure the main content of the image
  test('lightbox debug overlay does not interfere with zoom or image interaction', async ({ page }) => {
    await setupGridWithAxes(page)
    await enableDebugMode(page)

    await expect(page.locator('[data-testid="debug-overlay"]').first()).toBeVisible()

    // Click the first image to open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('.lightbox-backdrop')
    await expect(lightbox).toBeVisible()

    // Verify debug overlay is present but the main image is still visible and accessible
    const lightboxDebugOverlay = lightbox.locator('[data-testid="lightbox-debug-overlay"]')
    await expect(lightboxDebugOverlay).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    await expect(fullSizeImage).toBeVisible()

    // Zoom in using the zoom button — should still work with overlay present
    const zoomInButton = page.getByRole('button', { name: 'Zoom in' })
    await expect(zoomInButton).toBeVisible()
    await zoomInButton.click()

    const transform = await fullSizeImage.evaluate((el) => (el as HTMLElement).style.transform)
    // Scale should have increased above 1 after zoom in
    const scaleMatch = transform.match(/scale\(([^)]+)\)/)
    expect(scaleMatch).toBeTruthy()
    expect(parseFloat(scaleMatch![1])).toBeGreaterThan(1)

    // Close lightbox
    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible()
  })
})
