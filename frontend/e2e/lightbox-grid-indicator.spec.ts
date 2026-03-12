import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for the lightbox grid position indicator (S-118).
 *
 * The indicator shows "X / Y" (e.g., "2 / 4") at the top-center of the lightbox
 * when there are multiple images in the grid. It updates reactively as the user
 * navigates with Shift+Arrow keys.
 *
 * Test fixture data:
 *   - Training run: "my-model" with 2 checkpoints (step-1000, step-2000)
 *   - Each checkpoint has 2 sample images: prompt_name=landscape and portrait
 *   - Grid: checkpoint → X Axis (2 cols), prompt_name → Y Axis (2 rows) → 4 images total
 */

async function setupGridWithImages(page: Page): Promise<void> {
  await page.goto('/')
  await selectTrainingRun(page, 'my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()

  await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

  const images = page.locator('.xy-grid [role="gridcell"] img')
  await expect(images.first()).toBeVisible()

  await closeDrawer(page)
}

test.describe('lightbox grid position indicator (S-118)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: Thumbnail strip or position indicator shows current grid position in lightbox
  test('position indicator is visible in the lightbox when grid has multiple images', async ({ page }) => {
    await setupGridWithImages(page)

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // AC1: Indicator should be visible showing "1 / N" for the first image
    const indicator = page.locator('[data-testid="lightbox-grid-indicator"]')
    await expect(indicator).toBeVisible()

    const text = await indicator.textContent()
    expect(text).toMatch(/^1 \/ \d+$/)
    // Grid has 4 images (2 checkpoints × 2 prompt_name values)
    expect(text).toBe('1 / 4')
  })

  // AC2: Position updates when navigating with Shift+Arrow keys
  test('position indicator updates when navigating with Shift+ArrowRight', async ({ page }) => {
    await setupGridWithImages(page)

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const indicator = page.locator('[data-testid="lightbox-grid-indicator"]')
    await expect(indicator).toHaveText('1 / 4')

    // AC2: Navigate right — indicator should update to "2 / 4"
    await page.keyboard.press('Shift+ArrowRight')
    await expect(indicator).toHaveText('2 / 4')

    // Navigate right again
    await page.keyboard.press('Shift+ArrowRight')
    await expect(indicator).toHaveText('3 / 4')
  })

  // AC2: Position updates on Shift+ArrowLeft navigation too
  test('position indicator updates when navigating with Shift+ArrowLeft', async ({ page }) => {
    await setupGridWithImages(page)

    // Click the second image so we can navigate left
    const secondImage = page.locator('.xy-grid [role="gridcell"] img').nth(1)
    await secondImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const indicator = page.locator('[data-testid="lightbox-grid-indicator"]')
    // Second image is index 1 → "2 / 4"
    await expect(indicator).toHaveText('2 / 4')

    // Navigate left → should go back to "1 / 4"
    await page.keyboard.press('Shift+ArrowLeft')
    await expect(indicator).toHaveText('1 / 4')
  })

  // AC3: Indicator is unobtrusive — it should not obscure the image
  test('indicator is positioned at the top-center and does not cover the main image', async ({ page }) => {
    await setupGridWithImages(page)

    const firstImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    const indicator = page.locator('[data-testid="lightbox-grid-indicator"]')
    await expect(indicator).toBeVisible()

    const lightboxBox = await lightbox.boundingBox()
    const indicatorBox = await indicator.boundingBox()
    const fullImage = lightbox.locator('img[alt="Full-size image"]')
    const imageBox = await fullImage.boundingBox()

    expect(lightboxBox).not.toBeNull()
    expect(indicatorBox).not.toBeNull()
    expect(imageBox).not.toBeNull()

    // AC3: Indicator should be near the top of the lightbox (within 60px from top)
    const indicatorTopRelative = indicatorBox!.y - lightboxBox!.y
    expect(indicatorTopRelative).toBeLessThan(60)

    // AC3: Indicator should be horizontally centered (within 200px of center)
    const lightboxCenterX = lightboxBox!.x + lightboxBox!.width / 2
    const indicatorCenterX = indicatorBox!.x + indicatorBox!.width / 2
    expect(Math.abs(indicatorCenterX - lightboxCenterX)).toBeLessThan(200)

    // AC3: Indicator height is small (unobtrusive) — should be at most 50px tall
    expect(indicatorBox!.height).toBeLessThan(50)
  })
})
