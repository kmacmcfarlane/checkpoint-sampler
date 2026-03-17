import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for S-131: Add Y slider on right side of viewport.
 *
 * Verifies:
 *   - AC1: Y slider is pinned to the right edge of the viewport
 *   - AC2: Y slider is hidden when no dimension mapping is assigned to the Y axis
 *   - AC3: Layout remains clean with slider visible and hidden
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Dimensions: prompt_name (2 values: landscape, portrait), checkpoint (2 values)
 *   - Note: cfg and seed have only 1 value each (hidden by default), so we use
 *     prompt_name (multi-value) for Y and checkpoint (multi-value) for X.
 */

test.describe('S-131: Y slider pinned to right side of viewport', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC2: Y slider is hidden when no dimension mapping is assigned to Y axis
  test('AC2: Y slider bar is not visible when no Y dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    // Do NOT assign any dimension to Y axis
    await closeDrawer(page)

    // AC2: Y slider bar must not be present in the DOM
    await expect(page.locator('[data-testid="y-slider-bar"]')).not.toBeVisible()
  })

  // AC1: Y slider is visible and pinned at the right when Y dimension is assigned
  test('AC1: Y slider bar is visible and pinned at right when Y dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign prompt_name to Y axis (has 2 values: landscape, portrait)
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')
    await closeDrawer(page)

    // AC1: Y slider bar should be visible at the right
    const ySliderBar = page.locator('[data-testid="y-slider-bar"]')
    await expect(ySliderBar).toBeVisible()

    // AC1: Verify the slider is pinned to the right via fixed positioning
    // Check that it appears near the right edge of the viewport using bounding box
    const viewport = page.viewportSize()
    const box = await ySliderBar.boundingBox()
    expect(box).not.toBeNull()
    // The slider bar's right edge should be at or near the viewport right
    // (within a small tolerance for rounding)
    expect(box!.x + box!.width).toBeCloseTo(viewport!.width, -1)
  })

  // AC2: Y slider disappears when Y assignment is removed
  test('AC2: Y slider bar disappears when Y dimension assignment is removed', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign prompt_name to Y axis
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Verify slider is visible
    const ySliderBar = page.locator('[data-testid="y-slider-bar"]')
    await expect(ySliderBar).toBeVisible()

    // Remove Y axis assignment (change to Single filter mode)
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Single')
    await closeDrawer(page)

    // AC2: Y slider bar should be hidden again
    await expect(ySliderBar).not.toBeVisible()
  })

  // AC3: Layout is clean when Y slider is visible (no overflow, no overlap with content)
  test('AC3: Layout is clean when Y slider is visible', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')
    await closeDrawer(page)

    // AC3: No horizontal scrollbar should appear
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1) // allow 1px tolerance

    // AC3: The app header should still be fully visible
    const header = page.locator('.app-header')
    await expect(header).toBeVisible()

    // AC3: Y slider bar should be visible
    await expect(page.locator('[data-testid="y-slider-bar"]')).toBeVisible()
  })

  // AC3: Both X and Y sliders can be visible at the same time without layout issues
  test('AC3: Both X and Y sliders are visible together without layout issues', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint to X and prompt_name to Y
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')
    await closeDrawer(page)

    // AC3: Both slider bars should be visible
    await expect(page.locator('[data-testid="x-slider-bar"]')).toBeVisible()
    await expect(page.locator('[data-testid="y-slider-bar"]')).toBeVisible()

    // AC3: No horizontal scrollbar should appear
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1) // allow 1px tolerance
  })
})
