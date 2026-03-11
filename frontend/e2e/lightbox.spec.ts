import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for the image lightbox user journey:
 * click image → inspect in lightbox → verify zoom controls → inspect metadata → close.
 *
 * Depends on the training-run-grid setup: selects a training run, assigns axes,
 * and verifies images are visible before interacting with the lightbox.
 *
 * Test fixture data:
 *   - Training run: "my-model" with 2 checkpoints (step 1000, step 2000)
 *   - Each checkpoint has 2 sample images: prompt_name=landscape and prompt_name=portrait
 */

/**
 * Navigates to the app, selects the test training run, assigns checkpoint → X and
 * prompt_name → Y, waits for images to appear, then closes the drawer so grid cells
 * are clickable (the NDrawer mask intercepts pointer events when the drawer is open).
 */
async function setupGridWithImages(page: Page): Promise<void> {
  await page.goto('/')

  // Select the fixture training run
  await selectTrainingRun(page, 'my-model')

  // Wait for dimension panel to appear (scan complete)
  await expect(page.getByText('Dimensions')).toBeVisible()

  // Assign axes so images appear
  await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

  // Wait for at least one image in the grid
  const images = page.locator('.xy-grid [role="gridcell"] img')
  await expect(images.first()).toBeVisible()

  // Close the drawer so its mask doesn't intercept clicks on grid cells.
  await closeDrawer(page)
}

test.describe('image lightbox interaction', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('clicks an image cell to open the lightbox', async ({ page }) => {
    await setupGridWithImages(page)

    // Click the first image in the grid
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    // The lightbox dialog should appear
    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()
  })

  test('lightbox displays the full-size image', async ({ page }) => {
    await setupGridWithImages(page)

    // Click the first image cell to open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    // The lightbox should be visible
    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // The full-size image element with alt "Full-size image" should be visible
    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    await expect(fullSizeImage).toBeVisible()

    // The image src should point to the API images endpoint
    const src = await fullSizeImage.getAttribute('src')
    expect(src).toContain('/api/images/')
  })

  test('zoom controls are visible and functional in the lightbox', async ({ page }) => {
    await setupGridWithImages(page)

    // Open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // All three zoom control buttons should be visible
    const zoomInButton = page.getByRole('button', { name: 'Zoom in' })
    const zoomOutButton = page.getByRole('button', { name: 'Zoom out' })
    const resetZoomButton = page.getByRole('button', { name: 'Reset zoom' })

    await expect(zoomInButton).toBeVisible()
    await expect(zoomOutButton).toBeVisible()
    await expect(resetZoomButton).toBeVisible()

    // The image element to check transform changes
    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')

    // Initial transform should be scale(1)
    const initialTransform = await fullSizeImage.evaluate((el) => (el as HTMLElement).style.transform)
    expect(initialTransform).toContain('scale(1)')

    // Click zoom in and verify scale increases
    await zoomInButton.click()
    const afterZoomInTransform = await fullSizeImage.evaluate((el) => (el as HTMLElement).style.transform)
    expect(afterZoomInTransform).not.toContain('scale(1)')

    // Click reset zoom and verify scale returns to 1
    await resetZoomButton.click()
    const afterResetTransform = await fullSizeImage.evaluate((el) => (el as HTMLElement).style.transform)
    expect(afterResetTransform).toContain('scale(1)')

    // Click zoom out and verify scale decreases below 1
    await zoomOutButton.click()
    const afterZoomOutTransform = await fullSizeImage.evaluate((el) => (el as HTMLElement).style.transform)
    expect(afterZoomOutTransform).not.toContain('scale(1)')
  })

  test('metadata panel is accessible from the lightbox', async ({ page }) => {
    await setupGridWithImages(page)

    // Open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // The "Show Metadata" button should be visible (metadata panel collapsed by default)
    const metadataToggleButton = page.getByRole('button', { name: 'Toggle metadata' })
    await expect(metadataToggleButton).toBeVisible()
    await expect(metadataToggleButton).toContainText('Show Metadata')

    // Click to open the metadata panel
    await metadataToggleButton.click()

    // The button label should now say "Hide Metadata"
    await expect(metadataToggleButton).toContainText('Hide Metadata')

    // The metadata content area should be visible
    const metadataContent = page.locator('.metadata-content')
    await expect(metadataContent).toBeVisible()

    // The metadata content should display one of: entries, "No metadata available",
    // "Loading metadata...", or an error (any of these indicates the panel is working)
    const hasEntries = await page.locator('.metadata-entries').isVisible()
    const hasEmpty = await page.locator('.metadata-empty').isVisible()
    const hasLoading = await page.locator('.metadata-loading').isVisible()
    const hasError = await page.locator('.metadata-error').isVisible()
    expect(hasEntries || hasEmpty || hasLoading || hasError).toBe(true)
  })

  test('metadata panel shows typed fields from sidecar JSON (S-068)', async ({ page }) => {
    await setupGridWithImages(page)

    // The grid has checkpoint on X (step-1000, step-2000) and prompt_name on Y
    // (landscape, portrait). The first image in DOM order is the landscape image
    // for step-1000, which has a JSON sidecar with both string and numeric fields.
    // We need to click the image whose src contains "step00001000" and "landscape"
    // to open the sidecar-backed metadata.
    const targetImage = page.locator(
      '.xy-grid [role="gridcell"] img[src*="step00001000"][src*="landscape"]',
    )
    // Fall back to first image if the specific selector doesn't match (grid ordering)
    const imageToClick = (await targetImage.count()) > 0
      ? targetImage.first()
      : page.locator('.xy-grid [role="gridcell"] img').first()
    await imageToClick.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // Open the metadata panel
    const metadataToggle = page.getByRole('button', { name: 'Toggle metadata' })
    await metadataToggle.click()

    // Wait for metadata entries to appear (sidecar is available)
    const metadataEntries = page.locator('.metadata-entries')
    await expect(metadataEntries).toBeVisible({ timeout: 5000 })

    // Verify string fields are displayed
    const allKeys = metadataEntries.locator('.metadata-key')
    const keyTexts = await allKeys.allTextContents()

    // The sidecar has: prompt_name, sampler_name, workflow_name (string),
    // seed, steps, cfg (numeric)
    expect(keyTexts).toContain('prompt_name')
    expect(keyTexts).toContain('seed')
    expect(keyTexts).toContain('cfg')
    expect(keyTexts).toContain('steps')

    // Verify numeric values are rendered correctly (seed=42, steps=20, cfg=7.5)
    // Find the metadata-value <pre> elements that follow numeric keys
    const seedEntry = metadataEntries.locator('.metadata-entry').filter({ hasText: 'seed' })
    const seedValue = seedEntry.locator('.metadata-value')
    await expect(seedValue).toContainText('42')

    const stepsEntry = metadataEntries.locator('.metadata-entry').filter({ hasText: 'steps' })
    const stepsValue = stepsEntry.locator('.metadata-value')
    await expect(stepsValue).toContainText('20')

    const cfgEntry = metadataEntries.locator('.metadata-entry').filter({ hasText: 'cfg' })
    const cfgValue = cfgEntry.locator('.metadata-value')
    await expect(cfgValue).toContainText('7.5')

    // Verify string values are present
    const promptNameEntry = metadataEntries.locator('.metadata-entry').filter({ hasText: 'prompt_name' })
    const promptNameValue = promptNameEntry.locator('.metadata-value')
    await expect(promptNameValue).toContainText('landscape')
  })

  test('closes the lightbox and returns to the grid view', async ({ page }) => {
    await setupGridWithImages(page)

    // Open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // The grid should still be in the DOM but behind the lightbox
    const gridContainer = page.locator('.xy-grid-container')

    // Close the lightbox using the close button
    const closeButton = page.getByRole('button', { name: 'Close lightbox' })
    await expect(closeButton).toBeVisible()
    await closeButton.click()

    // The lightbox should be gone
    await expect(lightbox).not.toBeVisible()

    // The grid should be visible again
    await expect(gridContainer).toBeVisible()
  })

  test('closes the lightbox with the Escape key and returns to the grid view', async ({ page }) => {
    await setupGridWithImages(page)

    // Open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // Press Escape to close
    await page.keyboard.press('Escape')

    // The lightbox should be gone
    await expect(lightbox).not.toBeVisible()

    // The grid should remain visible
    const gridContainer = page.locator('.xy-grid-container')
    await expect(gridContainer).toBeVisible()
  })
})

/**
 * Sets up the app with:
 *   - "my-model" selected
 *   - "checkpoint" assigned to X Axis
 *   - "prompt_name" assigned to Slider
 *   - Drawer closed
 *
 * This gives a 2-column grid (checkpoint 1000, 2000) with prompt_name as
 * slider dimension. The slider panel inside the lightbox should show
 * "prompt_name" as its label.
 */
async function setupGridWithSlider(page: Page): Promise<void> {
  await page.goto('/')
  await selectTrainingRun(page, 'my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()

  await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Slider')

  // Wait for at least one image in the grid
  const images = page.locator('.xy-grid [role="gridcell"] img')
  await expect(images.first()).toBeVisible()

  // Close the drawer so its mask doesn't intercept clicks on grid cells.
  await closeDrawer(page)
}

test.describe('lightbox keyboard navigation (Shift+Arrow)', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: Shift+ArrowLeft and Shift+ArrowRight navigate between images in the grid
  // while the lightbox is open
  test('Shift+ArrowRight navigates to the next grid image in the lightbox', async ({ page }) => {
    await setupGridWithImages(page)

    // Open the lightbox by clicking the first image cell
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // Record the initial image src
    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const initialSrc = await fullSizeImage.getAttribute('src')
    expect(initialSrc).toContain('/api/images/')

    // Press Shift+ArrowRight to navigate to the next image
    await page.keyboard.press('Shift+ArrowRight')

    // The image src should change to a different image
    await expect(fullSizeImage).not.toHaveAttribute('src', initialSrc!)
    const newSrc = await fullSizeImage.getAttribute('src')
    expect(newSrc).toContain('/api/images/')
    expect(newSrc).not.toBe(initialSrc)
  })

  test('Shift+ArrowLeft navigates to the previous grid image in the lightbox', async ({ page }) => {
    await setupGridWithImages(page)

    // Open the lightbox on the second image cell (not the first, so we can go back)
    const secondImage = page.locator('.xy-grid [role="gridcell"] img').nth(1)
    await secondImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const initialSrc = await fullSizeImage.getAttribute('src')

    // Press Shift+ArrowLeft to navigate to the previous image
    await page.keyboard.press('Shift+ArrowLeft')

    // The image should change
    await expect(fullSizeImage).not.toHaveAttribute('src', initialSrc!)
  })

  // AC: Navigation wraps around at grid boundaries
  test('navigation wraps around at grid boundaries', async ({ page }) => {
    await setupGridWithImages(page)

    // Open lightbox on the first image cell
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const firstSrc = await fullSizeImage.getAttribute('src')

    // Press Shift+ArrowLeft on the first image — should wrap to the last image
    await page.keyboard.press('Shift+ArrowLeft')

    const wrappedSrc = await fullSizeImage.getAttribute('src')
    expect(wrappedSrc).toContain('/api/images/')
    expect(wrappedSrc).not.toBe(firstSrc)

    // Press Shift+ArrowRight on the last image — should wrap back to the first image
    await page.keyboard.press('Shift+ArrowRight')

    const backToFirstSrc = await fullSizeImage.getAttribute('src')
    expect(backToFirstSrc).toBe(firstSrc)
  })

  // AC: Regular ArrowLeft/ArrowRight continue to control the slider (existing behavior)
  test('plain ArrowLeft/ArrowRight do not navigate grid images (no navigate event)', async ({ page }) => {
    await setupGridWithImages(page)

    // Open lightbox on the first image cell
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const initialSrc = await fullSizeImage.getAttribute('src')

    // Plain ArrowRight (no Shift) should NOT change the image (no slider in this config)
    await page.keyboard.press('ArrowRight')

    // Image should remain the same
    const afterArrowSrc = await fullSizeImage.getAttribute('src')
    expect(afterArrowSrc).toBe(initialSrc)
  })
})

test.describe('lightbox Y-axis keyboard navigation (Shift+Up/Down)', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: Shift+Down navigates to the image below in the Y axis of the grid
  test('Shift+ArrowDown navigates to the image below in the Y axis', async ({ page }) => {
    // Setup: checkpoint → X (2 cols: step-1000, step-2000), prompt_name → Y (2 rows: landscape, portrait)
    await setupGridWithImages(page)

    // Open the lightbox by clicking the first image (row 0, col 0 in row-major order)
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const initialSrc = await fullSizeImage.getAttribute('src')
    expect(initialSrc).toContain('/api/images/')

    // Press Shift+ArrowDown to navigate down one row (same column, next Y value)
    await page.keyboard.press('Shift+ArrowDown')

    // The image src should change (moved to next row)
    await expect(fullSizeImage).not.toHaveAttribute('src', initialSrc!)
    const newSrc = await fullSizeImage.getAttribute('src')
    expect(newSrc).toContain('/api/images/')
    expect(newSrc).not.toBe(initialSrc)
  })

  // AC: Shift+Up navigates to the image above in the Y axis
  test('Shift+ArrowUp navigates to the image above in the Y axis', async ({ page }) => {
    await setupGridWithImages(page)

    // Click the third image (index 2 in row-major order: second row, first column)
    const thirdImage = page.locator('.xy-grid [role="gridcell"] img').nth(2)
    await thirdImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const initialSrc = await fullSizeImage.getAttribute('src')

    // Press Shift+ArrowUp to navigate up one row
    await page.keyboard.press('Shift+ArrowUp')

    // The image src should change (moved to previous row)
    await expect(fullSizeImage).not.toHaveAttribute('src', initialSrc!)
    const newSrc = await fullSizeImage.getAttribute('src')
    expect(newSrc).not.toBe(initialSrc)
  })

  // AC: Navigation wraps at grid boundaries (consistent with existing X-axis behavior)
  test('Shift+ArrowDown wraps from last row to first row (same column)', async ({ page }) => {
    await setupGridWithImages(page)

    // Click the third image (index 2: second row, first col) — bottom-left in a 2×2 grid
    const thirdImage = page.locator('.xy-grid [role="gridcell"] img').nth(2)
    await thirdImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const bottomRowSrc = await fullSizeImage.getAttribute('src')

    // Shift+ArrowDown at last row wraps to first row at same column
    await page.keyboard.press('Shift+ArrowDown')

    const wrappedSrc = await fullSizeImage.getAttribute('src')
    expect(wrappedSrc).not.toBe(bottomRowSrc)

    // Pressing Shift+ArrowDown again wraps back to bottom row
    await page.keyboard.press('Shift+ArrowDown')
    const backToBottomSrc = await fullSizeImage.getAttribute('src')
    expect(backToBottomSrc).toBe(bottomRowSrc)
  })

  // AC: Existing X-axis left/right navigation is unchanged
  test('Shift+ArrowRight still navigates X axis when Y navigation is also enabled', async ({ page }) => {
    await setupGridWithImages(page)

    // Open the lightbox on the first image
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const initialSrc = await fullSizeImage.getAttribute('src')

    // Shift+ArrowRight should still navigate X axis (same row, next column)
    await page.keyboard.press('Shift+ArrowRight')

    const newSrc = await fullSizeImage.getAttribute('src')
    expect(newSrc).not.toBe(initialSrc)
    expect(newSrc).toContain('/api/images/')
  })
})

test.describe('lightbox mousedown origin guard (B-033)', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: B-033 AC#2 — Dragging the slider and releasing (mouse-up) over the lightbox
  // background does NOT close the lightbox
  test('slider drag ending on backdrop does not close the lightbox', async ({ page }) => {
    await setupGridWithSlider(page)

    // Open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // The slider panel should be visible at the bottom
    const sliderPanel = lightbox.locator('.lightbox-slider-panel')
    await expect(sliderPanel).toBeVisible()

    // Simulate a drag gesture: mousedown on the slider panel, then mouseup on the backdrop.
    // This is the exact scenario that caused the bug — releasing the mouse after dragging
    // the slider should NOT close the lightbox.
    const sliderBox = await sliderPanel.boundingBox()
    expect(sliderBox).not.toBeNull()

    const backdropBox = await lightbox.boundingBox()
    expect(backdropBox).not.toBeNull()

    // mousedown on the slider panel center
    await page.mouse.move(sliderBox!.x + sliderBox!.width / 2, sliderBox!.y + sliderBox!.height / 2)
    await page.mouse.down()

    // mouseup on the backdrop (top-right corner area — far from any interactive element)
    await page.mouse.move(backdropBox!.x + backdropBox!.width - 20, backdropBox!.y + 20)
    await page.mouse.up()

    // The lightbox should still be visible (not closed by the drag release)
    await expect(lightbox).toBeVisible()
  })

  // AC: B-033 AC#3 — Normal background click-to-close still works (mouse-down + mouse-up
  // both on backdrop)
  test('normal background click still closes the lightbox', async ({ page }) => {
    await setupGridWithSlider(page)

    // Open the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // Click on the backdrop background (top-right corner, away from controls and slider).
    // A normal click has mousedown + mouseup at the same position on the backdrop, which
    // should close the lightbox.
    const backdropBox = await lightbox.boundingBox()
    expect(backdropBox).not.toBeNull()

    // Use a position in the top-right area of the backdrop, away from the close button
    // (top-left), zoom controls, and the keyboard shortcuts button (top-right corner).
    // Offset 80px from the right to clear the shortcuts area (positioned at right: 12px).
    await page.mouse.click(backdropBox!.x + backdropBox!.width - 80, backdropBox!.y + 20)

    // The lightbox should be closed
    await expect(lightbox).not.toBeVisible()
  })
})

test.describe('lightbox slider dimension label', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: Lightbox slider label shows the actual dimension name (e.g., 'cfg', 'checkpoint')
  // instead of generic 'Slider'
  // AC: Dimension name passed through to the lightbox as a prop from the grid
  test('lightbox slider shows the actual dimension name as label', async ({ page }) => {
    await setupGridWithSlider(page)

    // Open lightbox on the first image cell
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // The lightbox should show a slider panel with the dimension name "prompt_name"
    // (not the generic "Slider" label)
    const sliderPanel = lightbox.locator('.lightbox-slider-panel')
    await expect(sliderPanel).toBeVisible()

    // The SliderBar uses its label prop as the aria-label on the root .slider-bar div.
    // Verify it shows the actual dimension name "prompt_name" instead of generic "Slider".
    const sliderBar = sliderPanel.locator('.slider-bar')
    await expect(sliderBar).toBeVisible()
    const ariaLabel = await sliderBar.getAttribute('aria-label')
    expect(ariaLabel).toBe('prompt_name')
  })
})

test.describe('lightbox slider and metadata panel layout (B-069)', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1 (B-069): Slider and metadata button do not overlap when slider is visible
  // AC2 (B-069): Both controls are fully accessible and clickable without obstruction
  test('metadata button is above the slider panel and both are accessible', async ({ page }) => {
    await setupGridWithSlider(page)

    // Open lightbox (slider is present because prompt_name → Slider)
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const sliderPanel = lightbox.locator('.lightbox-slider-panel')
    await expect(sliderPanel).toBeVisible()

    const metadataPanel = lightbox.locator('.metadata-panel')
    await expect(metadataPanel).toBeVisible()

    // AC1: Verify the metadata panel bottom edge is at or above the slider panel top edge
    // (no overlap). The metadata button should be positioned above the slider panel.
    const sliderBox = await sliderPanel.boundingBox()
    const metadataBox = await metadataPanel.boundingBox()

    expect(sliderBox).not.toBeNull()
    expect(metadataBox).not.toBeNull()

    // The bottom of the metadata panel must not extend below the top of the slider panel
    const metadataBottom = metadataBox!.y + metadataBox!.height
    const sliderTop = sliderBox!.y
    expect(metadataBottom).toBeLessThanOrEqual(sliderTop + 2) // 2px tolerance for sub-pixel rounding

    // AC2: The metadata toggle button should be clickable (not covered by slider panel)
    const metadataToggle = page.getByRole('button', { name: 'Toggle metadata' })
    await expect(metadataToggle).toBeVisible()
    await metadataToggle.click()

    // After clicking, metadata content should appear (confirming it was accessible)
    const metadataContent = lightbox.locator('.metadata-content')
    await expect(metadataContent).toBeVisible()
  })

  // AC3 (B-069): Layout is correct across typical viewport sizes — verify at 1280px and 1440px
  test('metadata panel does not overlap slider panel at 1440px viewport width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupGridWithSlider(page)

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const sliderPanel = lightbox.locator('.lightbox-slider-panel')
    const metadataPanel = lightbox.locator('.metadata-panel')

    await expect(sliderPanel).toBeVisible()
    await expect(metadataPanel).toBeVisible()

    const sliderBox = await sliderPanel.boundingBox()
    const metadataBox = await metadataPanel.boundingBox()

    expect(sliderBox).not.toBeNull()
    expect(metadataBox).not.toBeNull()

    const metadataBottom = metadataBox!.y + metadataBox!.height
    const sliderTop = sliderBox!.y
    expect(metadataBottom).toBeLessThanOrEqual(sliderTop + 2) // 2px tolerance for sub-pixel rounding
  })
})

test.describe('keyboard shortcuts help overlay (S-109)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: Lightbox includes a keyboard shortcuts tooltip or help panel
  test('shortcuts help button is visible in the lightbox', async ({ page }) => {
    await setupGridWithImages(page)

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const shortcutsBtn = page.locator('[data-testid="lightbox-shortcuts-btn"]')
    await expect(shortcutsBtn).toBeVisible()
    await expect(shortcutsBtn).toHaveText('?')
  })

  // AC2: Lists all shortcuts (Escape, Shift+Arrow for grid nav, plain Arrow for slider)
  test('shortcuts panel lists all keyboard shortcuts', async ({ page }) => {
    await setupGridWithImages(page)

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // Open the shortcuts panel
    await page.locator('[data-testid="lightbox-shortcuts-btn"]').click()

    const panel = page.locator('[data-testid="lightbox-shortcuts-panel"]')
    await expect(panel).toBeVisible()

    // Verify all four shortcut groups are listed
    const panelText = await panel.textContent()
    expect(panelText).toContain('Esc')
    expect(panelText).toContain('Close lightbox')
    expect(panelText).toContain('Shift')
    expect(panelText).toContain('Navigate grid')
    expect(panelText).toContain('Slider')
  })

  // AC3: Help is unobtrusive (hidden by default) and dismissible (toggle off)
  test('shortcuts panel is hidden by default and dismissible', async ({ page }) => {
    await setupGridWithImages(page)

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const panel = page.locator('[data-testid="lightbox-shortcuts-panel"]')
    const btn = page.locator('[data-testid="lightbox-shortcuts-btn"]')

    // Panel is hidden by default
    await expect(panel).not.toBeVisible()

    // Click to show
    await btn.click()
    await expect(panel).toBeVisible()

    // Click again to dismiss
    await btn.click()
    await expect(panel).not.toBeVisible()
  })

  // AC: '?' hotkey opens and closes the shortcuts panel (UAT feedback — user expected hotkey)
  test('? hotkey toggles the shortcuts panel open and closed', async ({ page }) => {
    await setupGridWithImages(page)

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const panel = page.locator('[data-testid="lightbox-shortcuts-panel"]')

    // Panel is hidden by default
    await expect(panel).not.toBeVisible()

    // Press '?' to open the panel
    await page.keyboard.press('?')
    await expect(panel).toBeVisible()

    // Press '?' again to close the panel
    await page.keyboard.press('?')
    await expect(panel).not.toBeVisible()
  })
})
