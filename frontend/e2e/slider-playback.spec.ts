import { test, expect, type Page } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for the master slider and playback controls user journey:
 *   - Assign a dimension to Slider role and verify the master slider appears
 *   - Step the master slider and verify the displayed value updates
 *   - Start playback and verify automatic advancement through at least 2 steps
 *   - Stop playback and verify the slider holds its position
 *
 * Test fixture data:
 *   - Training run: "test-run/my-model"
 *   - Checkpoints: step 1000, step 2000
 *   - Images per checkpoint: prompt_name=landscape, prompt_name=portrait (seed=42, cfg=7)
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 *
 * Setup:
 *   - Assign "checkpoint" to X Axis (2 columns: 1000, 2000)
 *   - Assign "prompt_name" to Slider (2 slider values: landscape, portrait)
 *   This gives a 2-column grid with a per-cell slider, and a master slider for "prompt_name"
 *   with values ["landscape", "portrait"].
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
 * Closes the sidebar drawer if it is open.
 * On wide screens the drawer opens automatically and its mask blocks main-area elements.
 * The close button has aria-label="close" (set by Naive UI's NBaseClose).
 */
async function closeDrawer(page: Page): Promise<void> {
  const drawerCloseButton = page.locator('[aria-label="close"]').first()
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    // Wait for the drawer to close (close button disappears)
    await expect(drawerCloseButton).not.toBeVisible()
    await page.waitForTimeout(300)
  }
}

/**
 * Sets up the app with:
 *   - "test-run/my-model" selected
 *   - "checkpoint" assigned to X Axis
 *   - "prompt_name" assigned to Slider
 *   - Drawer closed so the main area is fully accessible
 *
 * This configuration produces a master slider for "prompt_name" with
 * values ["landscape", "portrait"].
 */
async function setupSlider(page: Page): Promise<void> {
  await page.goto('/')

  // Select the fixture training run
  await selectTrainingRun(page, 'test-run/my-model')

  // Wait for dimension panel to appear (scan complete)
  await expect(page.getByText('Dimensions')).toBeVisible()

  // Assign "checkpoint" to X Axis so images appear in the grid
  await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')

  // Assign "prompt_name" to Slider — this triggers the master slider to appear
  await selectNaiveOption(page, 'Role for prompt_name', 'Slider')

  // Close the drawer so the master slider in the main area is accessible
  await closeDrawer(page)
}

test.describe('slider and playback controls', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('assigning a dimension to Slider role makes the master slider appear', async ({ page }) => {
    await setupSlider(page)

    // The master slider group for "prompt_name" should now be visible
    const masterSlider = page.locator('[aria-label="Master prompt_name slider"]')
    await expect(masterSlider).toBeVisible()

    // The slider dimension label should appear inside the master slider
    await expect(masterSlider).toContainText('prompt_name')

    // The Play button should be visible (playback not yet started)
    const playButton = page.getByRole('button', { name: 'Play playback' })
    await expect(playButton).toBeVisible()
  })

  test('stepping the master slider with keyboard advances the displayed value', async ({ page }) => {
    await setupSlider(page)

    const masterSlider = page.locator('[aria-label="Master prompt_name slider"]')
    await expect(masterSlider).toBeVisible()

    // Read the initial displayed value (first slider value: "landscape")
    const valueDisplay = masterSlider.locator('.master-slider__value')
    await expect(valueDisplay).toBeVisible()
    const initialValue = await valueDisplay.textContent()
    expect(initialValue?.trim()).toBe('landscape')

    // Focus the master slider group and press Ctrl+ArrowRight to advance by one step
    // (MasterSlider uses Ctrl+Arrow to avoid conflict with zoom controls)
    await masterSlider.focus()
    await masterSlider.press('Control+ArrowRight')

    // The displayed value should now be "portrait" (second value)
    await expect(valueDisplay).toContainText('portrait')

    // Press Ctrl+ArrowLeft to step back
    await masterSlider.press('Control+ArrowLeft')

    // The displayed value should return to "landscape"
    await expect(valueDisplay).toContainText('landscape')
  })

  test('stepping the master slider updates all image cells', async ({ page }) => {
    await setupSlider(page)

    const masterSlider = page.locator('[aria-label="Master prompt_name slider"]')
    await expect(masterSlider).toBeVisible()

    // The grid should be visible with image cells
    await expect(page.locator('.xy-grid-container')).toBeVisible()

    // The initial value is "landscape" — SliderBar cells in the grid should show "landscape"
    const sliderBars = page.locator('.slider-bar')
    const firstSliderBar = sliderBars.first()
    await expect(firstSliderBar).toBeVisible()
    await expect(firstSliderBar).toContainText('landscape')

    // Step the master slider forward to "portrait" (Ctrl+Arrow for MasterSlider)
    await masterSlider.focus()
    await masterSlider.press('Control+ArrowRight')

    // All per-cell SliderBars should now show "portrait"
    await expect(firstSliderBar).toContainText('portrait')

    // There should be at least one column (checkpoint 1000) — verify image cell exists
    await expect(page.locator('.xy-grid [role="gridcell"]').first()).toBeVisible()
  })

  test('starts playback and verifies automatic advancement through at least 2 steps', async ({ page }) => {
    await setupSlider(page)

    const masterSlider = page.locator('[aria-label="Master prompt_name slider"]')
    await expect(masterSlider).toBeVisible()

    const valueDisplay = masterSlider.locator('.master-slider__value')
    await expect(valueDisplay).toBeVisible()

    // Ensure we start at "landscape" (index 0)
    const initialValue = await valueDisplay.textContent()
    expect(initialValue?.trim()).toBe('landscape')

    // Click the Play button to start playback
    const playButton = page.getByRole('button', { name: 'Play playback' })
    await expect(playButton).toBeVisible()
    await playButton.click()

    // The button should now show "Pause"
    const pauseButton = page.getByRole('button', { name: 'Pause playback' })
    await expect(pauseButton).toBeVisible()

    // Change playback speed to 0.25s for faster advancement during the test
    const speedSelect = page.locator('[aria-label="Playback speed"]')
    await expect(speedSelect).toBeVisible()
    await speedSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('0.25s', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Wait for the first automatic advancement: "landscape" → "portrait"
    await expect(valueDisplay).toContainText('portrait', { timeout: 5000 })

    // With loop enabled (default), the slider wraps back to "landscape"
    // Wait for the second automatic advancement: "portrait" → "landscape" (loop)
    await expect(valueDisplay).toContainText('landscape', { timeout: 5000 })

    // Playback is still running — pause button should remain visible
    await expect(pauseButton).toBeVisible()
  })

  test('stops playback and verifies the slider holds its position', async ({ page }) => {
    await setupSlider(page)

    const masterSlider = page.locator('[aria-label="Master prompt_name slider"]')
    await expect(masterSlider).toBeVisible()

    const valueDisplay = masterSlider.locator('.master-slider__value')
    await expect(valueDisplay).toBeVisible()

    // Start playback
    const playButton = page.getByRole('button', { name: 'Play playback' })
    await playButton.click()

    const pauseButton = page.getByRole('button', { name: 'Pause playback' })
    await expect(pauseButton).toBeVisible()

    // Change playback speed to 0.25s so we can observe an advance before stopping
    const speedSelect = page.locator('[aria-label="Playback speed"]')
    await expect(speedSelect).toBeVisible()
    await speedSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('0.25s', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Wait for at least one automatic advance to "portrait"
    await expect(valueDisplay).toContainText('portrait', { timeout: 5000 })

    // Stop playback by clicking Pause
    await pauseButton.click()

    // After stopping, the Play button should reappear
    await expect(page.getByRole('button', { name: 'Play playback' })).toBeVisible()

    // The slider value should remain at "portrait" (no further advances)
    const valueAfterStop = await valueDisplay.textContent()
    expect(valueAfterStop?.trim()).toBe('portrait')

    // Wait briefly and verify the value does not change (playback is stopped)
    // Use a small timeout poll to verify the value is stable
    await page.waitForTimeout(600) // 600ms > 250ms interval to verify no advance
    const valueAfterWait = await valueDisplay.textContent()
    expect(valueAfterWait?.trim()).toBe('portrait')
  })
})
