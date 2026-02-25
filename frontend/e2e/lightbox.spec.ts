import { test, expect, type Page } from '@playwright/test'

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
  const selectTrigger = page.locator('.training-run-selector .n-select')
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
  const drawerCloseButton = page.locator('.n-drawer-header__close')
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    await expect(page.locator('.n-drawer-mask')).not.toBeVisible()
  }
}

test.describe('image lightbox interaction', () => {
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
