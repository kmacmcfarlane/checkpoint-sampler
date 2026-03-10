import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for lightbox slider bidirectional sync (B-068):
 *   - Moving the slider inside the lightbox updates the master slider and all other cells
 *   - Shift+Arrow navigation between images keeps all sliders in sync
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Checkpoints: step-1000, step-2000 (2 columns on X axis)
 *   - prompt_name: landscape, portrait (2 slider values)
 *
 * Setup: checkpoint → X Axis, prompt_name → Slider
 *   This gives a 2-column grid (one cell per checkpoint) with a master slider
 *   for "prompt_name" (values: landscape, portrait).
 */

/**
 * Sets up the app with:
 *   - "my-model" selected
 *   - "checkpoint" assigned to X Axis
 *   - "prompt_name" assigned to Slider
 *   - Drawer closed
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

/**
 * Returns the current displayed value of the master slider (the span next to the NSlider).
 */
async function getMasterSliderValue(page: Page): Promise<string> {
  const masterSlider = page.locator('[aria-label="Master prompt_name slider"]')
  const valueSpan = masterSlider.locator('.master-slider__value')
  return valueSpan.textContent().then((t) => (t ?? '').trim())
}

test.describe('lightbox slider bidirectional sync (B-068)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1 (B-068): Changing the slider in the lightbox updates the master slider
  test('AC1: moving the lightbox slider updates the master slider value', async ({ page }) => {
    await setupGridWithSlider(page)

    // Record the initial master slider value
    const initialMasterValue = await getMasterSliderValue(page)
    expect(initialMasterValue).toBeTruthy() // should be 'landscape' or 'portrait'

    // Open the lightbox by clicking the first grid image
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // The lightbox slider panel should be visible
    const sliderPanel = lightbox.locator('.lightbox-slider-panel')
    await expect(sliderPanel).toBeVisible()

    // Record the initial image src in the lightbox
    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const initialLightboxSrc = await fullSizeImage.getAttribute('src')
    expect(initialLightboxSrc).toContain('/api/images/')

    // Use ArrowRight to move the lightbox slider to the next value
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)

    // The lightbox image should change (different slider value)
    const newLightboxSrc = await fullSizeImage.getAttribute('src')
    expect(newLightboxSrc).not.toBe(initialLightboxSrc)

    // Close the lightbox to verify master slider
    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible()

    // The master slider value should have changed to reflect the new slider position
    const newMasterValue = await getMasterSliderValue(page)
    expect(newMasterValue).not.toBe(initialMasterValue)
  })

  // AC1 (B-068): After the lightbox slider changes, all other cell sliders are in sync
  test('AC1: lightbox slider change updates all cell images to the new slider value', async ({ page }) => {
    await setupGridWithSlider(page)

    // Open the first grid image in the lightbox
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // Move the lightbox slider to the second value
    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')
    const initialLightboxSrc = await fullSizeImage.getAttribute('src')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)

    // Close the lightbox
    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible()

    // All grid cells should now show the updated slider value.
    // The grid has 2 cells (checkpoint step-1000, step-2000). The cell images should
    // have changed (different prompt_name value after the slider move).
    const gridImages = page.locator('.xy-grid [role="gridcell"] img')
    const cell1Src = await gridImages.nth(0).getAttribute('src')
    const cell2Src = await gridImages.nth(1).getAttribute('src')

    // Both cells' image src should not match the original first cell (which was at 'landscape').
    // After the slider change, both should show the new slider value ('portrait').
    // Note: they have different src (different checkpoints) but same prompt_name.
    expect(cell1Src).not.toBe(initialLightboxSrc)
    expect(cell2Src).not.toContain(initialLightboxSrc?.split('/').pop())
  })

  // AC2 (B-068): Shift+Arrow navigation keeps all sliders in sync
  test('AC2: Shift+Arrow navigation keeps slider values in sync after a slider change', async ({ page }) => {
    await setupGridWithSlider(page)

    // Open the first grid image
    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')

    // Step 1: Move the slider to the second value using ArrowRight
    const initialSrc = await fullSizeImage.getAttribute('src')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)

    const afterSliderSrc = await fullSizeImage.getAttribute('src')
    expect(afterSliderSrc).not.toBe(initialSrc)

    // Step 2: Navigate to the second grid image using Shift+ArrowRight
    await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(200)

    const afterNavSrc = await fullSizeImage.getAttribute('src')
    // The image should be a different cell entirely (different checkpoint)
    expect(afterNavSrc).not.toBe(afterSliderSrc)

    // Step 3: Check the slider position is still at the second value (not reset to first)
    const sliderPanel = lightbox.locator('.lightbox-slider-panel')
    await expect(sliderPanel).toBeVisible()
    const sliderValueSpan = sliderPanel.locator('.slider-bar__value')
    const sliderValueText = await sliderValueSpan.textContent()

    // Verify the master slider value matches the lightbox slider
    const masterValue = await getMasterSliderValue(page)
    expect(sliderValueText?.trim()).toBe(masterValue)
  })

  // AC2 (B-068): Navigating via Shift+Arrow after a slider change shows the correct image
  test('AC2: Shift+ArrowRight after slider change shows image at the new slider value', async ({ page }) => {
    await setupGridWithSlider(page)

    // The fixture has: checkpoint X (step-1000, step-2000) and prompt_name Slider (landscape, portrait).
    // Initial slider value is 'landscape'. After ArrowRight, it becomes 'portrait'.

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')

    // Move slider to portrait
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)

    // Verify the lightbox shows portrait
    const portraitSrcCell1 = await fullSizeImage.getAttribute('src')
    expect(portraitSrcCell1).toContain('portrait')

    // Navigate to the second grid cell (step-2000, should still show portrait)
    await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(200)

    const portraitSrcCell2 = await fullSizeImage.getAttribute('src')
    // Should still be portrait (not reverted to landscape)
    expect(portraitSrcCell2).toContain('portrait')
    // Should be a different cell (different checkpoint)
    expect(portraitSrcCell2).not.toBe(portraitSrcCell1)
  })

  // AC3 (B-068): No images show different slider values after Shift+Arrow navigation
  test('AC3: all sliders remain consistent after multiple Shift+Arrow navigations', async ({ page }) => {
    await setupGridWithSlider(page)

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()
    const fullSizeImage = lightbox.locator('img[alt="Full-size image"]')

    // Move slider to second value (portrait)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)

    // Navigate right (to second cell)
    await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(200)
    const srcAtCell2 = await fullSizeImage.getAttribute('src')
    expect(srcAtCell2).toContain('portrait')

    // Navigate right again (wraps back to first cell)
    await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(200)
    const srcBackAtCell1 = await fullSizeImage.getAttribute('src')

    // First cell should show portrait, not have reverted to landscape
    expect(srcBackAtCell1).toContain('portrait')

    // Close lightbox and verify master slider still at portrait
    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible()

    const masterValue = await getMasterSliderValue(page)
    expect(masterValue).toBe('portrait')
  })
})
