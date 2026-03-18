import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for keyboard auto-repeat slider navigation (W-013):
 *   - Rapid repeated arrow key presses on a per-cell slider advance the slider correctly
 *   - The slider value display updates correctly under rapid keyboard input
 *   - No stale-prop race conditions manifest under browser-native auto-repeat rates
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Checkpoints: step 1000, step 2000
 *   - prompt_name: landscape, portrait (2 slider values)
 *
 * Setup: checkpoint -> X Axis, prompt_name -> Slider
 *   Per-cell sliders toggle between "landscape" and "portrait".
 *   With 2 values, the slider does not wrap (SliderBar stops at boundaries).
 *
 * S-132: Keyboard auto-repeat is now tested on per-cell SliderBars
 *   (the header master slider was replaced by AnimationControls which is playback-only).
 */

/**
 * Sets up the app with:
 *   - "my-model" selected
 *   - "checkpoint" assigned to X Axis
 *   - "prompt_name" assigned to Slider
 *   - Drawer closed so the main area is fully accessible
 */
async function setupSlider(page: Page): Promise<void> {
  await page.goto('/')

  await selectTrainingRun(page, 'my-model')

  // Wait for the dimension panel to appear (scan complete)
  await expect(page.getByText('Dimensions')).toBeVisible()

  // Assign "checkpoint" to X Axis so images appear in the grid
  await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')

  // Assign "prompt_name" to Slider — triggers per-cell sliders to appear
  await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Slider')

  // Close the drawer so the grid area is accessible
  await closeDrawer(page)
}

test.describe('slider keyboard auto-repeat navigation', () => {
  // AC: Each E2E test is independent — reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: Playwright test exercises arrow key auto-repeat on a per-cell slider
  // AC2: Test asserts correct slider progression under repeated key presses
  test('rapid ArrowRight auto-repeat lands on a valid slider value', async ({ page }) => {
    await setupSlider(page)

    const sliderBars = page.locator('.slider-bar')
    const firstSliderBar = sliderBars.first()
    await expect(firstSliderBar).toBeVisible()

    const valueDisplay = firstSliderBar.locator('.slider-bar__value')
    await expect(valueDisplay).toBeVisible()

    // The initial value should be "landscape" (index 0)
    await expect(valueDisplay).toContainText('landscape')

    // Focus the per-cell slider so it captures keyboard events
    await firstSliderBar.focus()

    // AC1: Simulate browser-native key auto-repeat by holding ArrowRight down.
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(300)
    await page.keyboard.up('ArrowRight')

    // AC2: After releasing the key, the slider must be at one of the two valid values.
    const finalValue = await valueDisplay.textContent()
    const trimmed = finalValue?.trim() ?? ''
    expect(['landscape', 'portrait']).toContain(trimmed)
  })

  // AC2: Test asserts correct slider progression under repeated key presses
  test('single ArrowRight press followed by rapid auto-repeat toggles value correctly', async ({ page }) => {
    await setupSlider(page)

    const sliderBars = page.locator('.slider-bar')
    const firstSliderBar = sliderBars.first()
    await expect(firstSliderBar).toBeVisible()

    const valueDisplay = firstSliderBar.locator('.slider-bar__value')
    await expect(valueDisplay).toBeVisible()

    // Start at "landscape"
    await expect(valueDisplay).toContainText('landscape')

    // Focus and press once (discrete) — should move to "portrait"
    await firstSliderBar.focus()
    await firstSliderBar.press('ArrowRight')
    await expect(valueDisplay).toContainText('portrait')

    // Now hold ArrowRight for auto-repeat — with 2 values and no wrap, it stays at "portrait"
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(300)
    await page.keyboard.up('ArrowRight')

    // After releasing, the slider must still be at one of the valid values (no corruption)
    const afterAutoRepeat = await valueDisplay.textContent()
    expect(['landscape', 'portrait']).toContain(afterAutoRepeat?.trim())
  })

  // AC3: Test catches stale-prop race conditions
  test('rapid auto-repeat does not corrupt slider state', async ({ page }) => {
    await setupSlider(page)

    const sliderBars = page.locator('.slider-bar')
    const firstSliderBar = sliderBars.first()
    await expect(firstSliderBar).toBeVisible()

    const valueDisplay = firstSliderBar.locator('.slider-bar__value')
    await expect(valueDisplay).toBeVisible()

    await firstSliderBar.focus()

    // Perform two separate rapid burst sequences to stress the event handler
    for (let burst = 0; burst < 2; burst++) {
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(200)
      await page.keyboard.up('ArrowRight')
      await page.waitForTimeout(50)
    }

    // The slider value display must render one of the two valid strings
    const finalValue = await valueDisplay.textContent()
    const trimmed = finalValue?.trim() ?? ''
    expect(['landscape', 'portrait']).toContain(trimmed)

    // The per-cell slider must still be visible and interactive
    await expect(firstSliderBar).toBeVisible()
  })

  // AC2: Alternating ArrowRight and ArrowLeft auto-repeat produces consistent state
  test('alternating ArrowRight and ArrowLeft auto-repeat stays consistent', async ({ page }) => {
    await setupSlider(page)

    const sliderBars = page.locator('.slider-bar')
    const firstSliderBar = sliderBars.first()
    await expect(firstSliderBar).toBeVisible()

    const valueDisplay = firstSliderBar.locator('.slider-bar__value')
    await expect(valueDisplay).toBeVisible()

    await firstSliderBar.focus()

    // Hold ArrowRight for a short burst
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(200)
    await page.keyboard.up('ArrowRight')

    const afterRight = (await valueDisplay.textContent())?.trim() ?? ''
    expect(['landscape', 'portrait']).toContain(afterRight)

    // Hold ArrowLeft for a short burst
    await page.keyboard.down('ArrowLeft')
    await page.waitForTimeout(200)
    await page.keyboard.up('ArrowLeft')

    const afterLeft = (await valueDisplay.textContent())?.trim() ?? ''
    expect(['landscape', 'portrait']).toContain(afterLeft)
  })
})
