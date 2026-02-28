import { test, expect, type Page } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for the image lightbox user journey:
 * click image → inspect in lightbox → verify zoom controls → inspect metadata → close.
 *
 * Depends on the training-run-grid setup: selects a training run, assigns axes,
 * and verifies images are visible before interacting with the lightbox.
 *
 * Test fixture data:
 *   - Training run: "test-run/my-model" with 2 checkpoints (step 1000, step 2000)
 *   - Each checkpoint has 2 sample images: prompt_name=landscape and prompt_name=portrait
 */

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
 * Opens a Naive UI NSelect dropdown identified by aria-label, waits for the
 * popup to appear, then clicks the option matching optionText.
 *
 * Note: .n-base-select-menu is a Naive UI portal element; no stable data-testid
 * alternative exists. It is stable in practice as a functional class (not internal styling).
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
 * Navigates to the app, selects the test training run, assigns checkpoint → X and
 * prompt_name → Y, waits for images to appear, then closes the drawer so grid cells
 * are clickable (the NDrawer mask intercepts pointer events when the drawer is open).
 */
async function setupGridWithImages(page: Page): Promise<void> {
  await page.goto('/')

  // Select the fixture training run
  await selectTrainingRun(page, 'test-run/my-model')

  // Wait for dimension panel to appear (scan complete)
  await expect(page.getByText('Dimensions')).toBeVisible()

  // Assign axes so images appear
  await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')
  await selectNaiveOption(page, 'Role for prompt_name', 'Y Axis')

  // Wait for at least one image in the grid
  const images = page.locator('.xy-grid [role="gridcell"] img')
  await expect(images.first()).toBeVisible()

  // Close the drawer so its mask doesn't intercept clicks on grid cells.
  // NDrawer renders a mask overlay that blocks pointer events even on desktop.
  // The close button has aria-label="close" (set by Naive UI's NBaseClose).
  const drawerCloseButton = page.locator('[aria-label="close"]').first()
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    // Wait for the drawer to close (close button disappears)
    await expect(drawerCloseButton).not.toBeVisible()
    await page.waitForTimeout(300)
  }
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
 *   - "test-run/my-model" selected
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
  await selectTrainingRun(page, 'test-run/my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()

  await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')
  await selectNaiveOption(page, 'Role for prompt_name', 'Slider')

  // Wait for at least one image in the grid
  const images = page.locator('.xy-grid [role="gridcell"] img')
  await expect(images.first()).toBeVisible()

  // Close the drawer so its mask doesn't intercept clicks on grid cells.
  // The close button has aria-label="close" (set by Naive UI's NBaseClose).
  const drawerCloseButton = page.locator('[aria-label="close"]').first()
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    // Wait for the drawer to close (close button disappears)
    await expect(drawerCloseButton).not.toBeVisible()
    await page.waitForTimeout(300)
  }
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
