import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for S-132: X/Y axis sliders rework -- bottom/right positioning,
 * dimension mappings, lightbox sync, and animation controls.
 *
 * Dimension mappings are now 4 independent options:
 *   - X Axis: grid columns only
 *   - Y Axis: grid rows only
 *   - X Slider: bottom horizontal slider only
 *   - Y Slider: right vertical slider only
 *
 * Verifies:
 *   - AC: Animation controls positioned at top where master slider was
 *   - AC: X slider pinned to bottom, Y slider pinned to right
 *   - AC: X slider hidden when no X Slider dimension mapped
 *   - AC: Y slider hidden when no Y Slider dimension mapped
 *   - AC: Lightbox X/Y sliders synced to main view sliders
 *   - AC: X Axis assignment does NOT show X slider (independent mapping)
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Dimensions: checkpoint (2 values: step-1000, step-2000),
 *                 prompt_name (2 values: landscape, portrait)
 */

test.describe('S-132: X/Y sliders rework', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: FE: Remove master slider from top position, replace with animation controls
  test('AC: Animation controls appear in header when slider dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint to Slider
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'Slider')
    await closeDrawer(page)

    // AC: Animation controls should be visible in the header area
    const animationControls = page.locator('[data-testid="animation-controls"]')
    await expect(animationControls).toBeVisible()

    // AC: The animation controls should contain a play button
    const playBtn = animationControls.locator('[data-testid="play-pause-button"]')
    await expect(playBtn).toBeVisible()
  })

  // AC: FE: X slider hidden when no dimension mapped to X Slider
  test('AC: X slider bar is not visible when no X Slider dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await closeDrawer(page)

    await expect(page.locator('[data-testid="x-slider-bar"]')).not.toBeVisible()
  })

  // AC: FE: Add horizontal X slider pinned to bottom edge of viewport
  test('AC: X slider bar is visible and pinned at bottom when X Slider dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // AC: Use "X Slider" (not "X Axis") to control the bottom slider
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Slider')
    await closeDrawer(page)

    const xSliderBar = page.locator('[data-testid="x-slider-bar"]')
    await expect(xSliderBar).toBeVisible()

    // Verify pinned to bottom of viewport
    const viewport = page.viewportSize()
    const box = await xSliderBar.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeCloseTo(viewport!.height, -1)
  })

  // AC: FE: Y slider hidden when no dimension mapped to Y Slider
  test('AC: Y slider bar is not visible when no Y Slider dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await closeDrawer(page)

    await expect(page.locator('[data-testid="y-slider-bar"]')).not.toBeVisible()
  })

  // AC: FE: Add vertical Y slider pinned to right edge of viewport
  test('AC: Y slider bar is visible and pinned at right when Y Slider dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // AC: Use "Y Slider" (not "Y Axis") to control the right slider
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Slider')
    await closeDrawer(page)

    const ySliderBar = page.locator('[data-testid="y-slider-bar"]')
    await expect(ySliderBar).toBeVisible()

    // Verify pinned to right of viewport
    const viewport = page.viewportSize()
    const box = await ySliderBar.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeCloseTo(viewport!.width, -1)
  })

  // AC: FE: X slider disappears when X Slider assignment is removed
  test('AC: X slider bar disappears when X Slider dimension assignment is removed', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Slider')
    const xSliderBar = page.locator('[data-testid="x-slider-bar"]')
    await expect(xSliderBar).toBeVisible()

    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'Single')
    await closeDrawer(page)

    await expect(xSliderBar).not.toBeVisible()
  })

  // AC: FE: Y slider disappears when Y Slider assignment is removed
  test('AC: Y slider bar disappears when Y Slider dimension assignment is removed', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Slider')
    const ySliderBar = page.locator('[data-testid="y-slider-bar"]')
    await expect(ySliderBar).toBeVisible()

    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Single')
    await closeDrawer(page)

    await expect(ySliderBar).not.toBeVisible()
  })

  // AC: X Axis assignment does NOT show the X slider (independent mapping)
  test('AC: X Axis assignment does NOT show X slider bar (independent mapping)', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint to X Axis (grid placement only)
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await closeDrawer(page)

    // X Axis only controls grid columns, NOT the bottom slider
    await expect(page.locator('[data-testid="x-slider-bar"]')).not.toBeVisible()
  })

  // AC: Y Axis assignment does NOT show the Y slider (independent mapping)
  test('AC: Y Axis assignment does NOT show Y slider bar (independent mapping)', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign prompt_name to Y Axis (grid placement only)
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')
    await closeDrawer(page)

    // Y Axis only controls grid rows, NOT the right slider
    await expect(page.locator('[data-testid="y-slider-bar"]')).not.toBeVisible()
  })

  // AC: FE: Lightbox X/Y sliders synced to main view X/Y sliders
  test('AC: Lightbox shows X slider when X Slider dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint to X Slider (for the bottom slider) and X Axis (for grid columns)
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Slider')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'X Axis')
    await closeDrawer(page)

    // Wait for grid images
    const images = page.locator('.xy-grid [role="gridcell"] img')
    await expect(images.first()).toBeVisible()

    // Open lightbox by clicking first image
    await images.first().click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // AC: Lightbox X slider should be visible
    const lightboxXSlider = lightbox.locator('[data-testid="lightbox-x-slider-bar"]')
    await expect(lightboxXSlider).toBeVisible()
  })

  // AC: FE: Lightbox Y slider appears when Y Slider dimension is assigned
  test('AC: Lightbox shows Y slider when Y Slider dimension is assigned', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign prompt_name to Y Slider and checkpoint to X Axis (for grid)
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Slider')
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await closeDrawer(page)

    // Wait for grid images
    const images = page.locator('.xy-grid [role="gridcell"] img')
    await expect(images.first()).toBeVisible()

    // Open lightbox
    await images.first().click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // AC: Lightbox Y slider should be visible
    const lightboxYSlider = lightbox.locator('[data-testid="lightbox-y-slider-bar"]')
    await expect(lightboxYSlider).toBeVisible()
  })

  // AC: FE: Lightbox does NOT show X/Y sliders when those dimensions are not assigned
  test('AC: Lightbox hides X/Y sliders when no slider dimensions mapped', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint to X Axis (grid only, not slider) to get a grid
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    // No X Slider or Y Slider assignment
    await closeDrawer(page)

    const images = page.locator('.xy-grid [role="gridcell"] img')
    await expect(images.first()).toBeVisible()

    await images.first().click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // Neither X Slider nor Y Slider is assigned, so lightbox should not show them
    expect(await lightbox.locator('[data-testid="lightbox-x-slider-bar"]').count()).toBe(0)
    expect(await lightbox.locator('[data-testid="lightbox-y-slider-bar"]').count()).toBe(0)
  })
})
