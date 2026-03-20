import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for S-130: Move X slider to bottom of viewport.
 *
 * Verifies:
 *   - AC1: X slider is pinned to the bottom edge of the viewport
 *   - AC2: X slider is hidden when no dimension mapping is assigned to the X Slider
 *   - AC3: Layout remains clean with slider visible and hidden
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 */

test.describe('S-130: X slider pinned to bottom of viewport', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC2: X slider is hidden when no dimension mapping is assigned to X Slider
  test('AC2: X slider bar is not visible when no X dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    // Do NOT assign any dimension to X Slider
    await closeDrawer(page)

    // AC2: X slider bar must not be present in the DOM
    await expect(page.locator('[data-testid="x-slider-bar"]')).not.toBeVisible()
  })

  // AC1: X slider is visible and pinned at the bottom when X dimension is assigned
  test('AC1: X slider bar is visible and pinned at bottom when X dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint to X Slider
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Slider')
    await closeDrawer(page)

    // AC1: X slider bar should be visible at the bottom
    const xSliderBar = page.locator('[data-testid="x-slider-bar"]')
    await expect(xSliderBar).toBeVisible()

    // AC1: Verify the slider is pinned to the bottom via fixed positioning
    // Check that it appears near the bottom of the viewport using bounding box
    const viewport = page.viewportSize()
    const box = await xSliderBar.boundingBox()
    expect(box).not.toBeNull()
    // The slider bar's bottom edge should be at or near the viewport bottom
    // (within a small tolerance for rounding)
    expect(box!.y + box!.height).toBeCloseTo(viewport!.height, -1)
  })

  // AC2: X slider disappears when X assignment is removed
  test('AC2: X slider bar disappears when X dimension assignment is removed', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint to X Slider
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Slider')

    // Verify slider is visible
    const xSliderBar = page.locator('[data-testid="x-slider-bar"]')
    await expect(xSliderBar).toBeVisible()

    // Remove X Slider assignment (change to Single filter mode)
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'Single')
    await closeDrawer(page)

    // AC2: X slider bar should be hidden again
    await expect(xSliderBar).not.toBeVisible()
  })

  // AC3: Layout is clean when slider is visible (no overflow, no overlap with content)
  test('AC3: Layout is clean when X slider is visible', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Slider')
    await closeDrawer(page)

    // AC3: No horizontal scrollbar should appear (overflow-x: hidden)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1) // allow 1px tolerance

    // AC3: The app header should still be fully visible
    const header = page.locator('.app-header')
    await expect(header).toBeVisible()

    // AC3: X slider bar should be visible
    await expect(page.locator('[data-testid="x-slider-bar"]')).toBeVisible()
  })
})
