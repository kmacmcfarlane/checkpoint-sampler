import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for S-092: Visual polish — remove heading, play/pause icon, refresh icons.
 *
 * Covers acceptance criteria:
 *   AC1: 'Checkpoint Sampler' heading is removed from the UI
 *   AC2: Slider animation play button shows a green triangle icon instead of text
 *   AC3: Play icon changes to a pause icon when animation is active
 *   AC4: Sample set selector has a refresh icon button to manually reload the list
 *   AC5: Training run selector has a refresh icon button to manually reload the list
 */

async function setupSlider(page: Page): Promise<void> {
  await page.goto('/')
  await selectTrainingRun(page, 'my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()
  await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Slider')
  await closeDrawer(page)
}

test.describe('S-092: visual polish', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: 'Checkpoint Sampler' heading is removed from the UI
  test('Checkpoint Sampler heading is not visible in the header', async ({ page }) => {
    await page.goto('/')
    // AC: 'Checkpoint Sampler' heading is removed from the UI
    const heading = page.locator('h1')
    await expect(heading).toHaveCount(0)
    // The header still renders (hamburger and controls are present)
    await expect(page.locator('.app-header')).toBeVisible()
  })

  // AC2: Slider animation play button shows a triangle icon (SVG) instead of text "Play"
  test('play button shows SVG icon instead of text', async ({ page }) => {
    await setupSlider(page)

    const masterSlider = page.locator('[aria-label="Master prompt_name slider"]')
    await expect(masterSlider).toBeVisible()

    // AC: Play button exists (identified by aria-label, not text content).
    // Scoped to the masterSlider group to avoid strict-mode violation when the X slider
    // bar (S-130) also renders a MasterSlider with its own Play button on the same page.
    const playButton = masterSlider.getByRole('button', { name: 'Play playback' })
    await expect(playButton).toBeVisible()

    // AC2: The button should contain an SVG (icon), not plain text "Play"
    const buttonText = await playButton.textContent()
    // textContent of an SVG button without accessible text is empty or whitespace
    expect(buttonText?.trim() ?? '').toBe('')
  })

  // AC3: Play icon changes to a pause icon when animation is active
  test('play icon changes to pause icon when playback starts', async ({ page }) => {
    await setupSlider(page)

    const masterSlider = page.locator('[aria-label="Master prompt_name slider"]')
    await expect(masterSlider).toBeVisible()

    // Initially shows Play button (aria-label = 'Play playback').
    // Scoped to the masterSlider group (S-130: X slider bar adds a second MasterSlider).
    const playButton = masterSlider.getByRole('button', { name: 'Play playback' })
    await expect(playButton).toBeVisible()

    // Start playback
    await playButton.click()

    // AC3: Play icon changes to pause icon (aria-label = 'Pause playback')
    const pauseButton = masterSlider.getByRole('button', { name: 'Pause playback' })
    await expect(pauseButton).toBeVisible()

    // Stop playback — icon reverts back to play
    await pauseButton.click()
    await expect(masterSlider.getByRole('button', { name: 'Play playback' })).toBeVisible()
  })

  // AC4: Sample set selector has a refresh icon button to manually reload the list
  test('sample set selector has a refresh icon button in the sidebar', async ({ page }) => {
    await page.goto('/')

    // The drawer is open by default on wide screens — look for the refresh button
    // AC4: Refresh icon button present next to Sample Set selector
    const refreshBtn = page.locator('[data-testid="refresh-sample-set-button"]')
    await expect(refreshBtn).toBeVisible()
  })

  // AC4: Refresh button reloads the sample set list
  test('sample set refresh button reloads the list', async ({ page }) => {
    await page.goto('/')

    // The Sample Set selector should have options after loading
    const trainingRunSelect = page.locator('[data-testid="training-run-select"]').first()
    await expect(trainingRunSelect).toBeVisible()
    // Wait for loading to finish (disabled class disappears)
    await expect(trainingRunSelect.locator('.n-base-selection--disabled')).toHaveCount(0)

    // Click the refresh button
    const refreshBtn = page.locator('[data-testid="refresh-sample-set-button"]')
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()

    // After refresh, the select should still be usable (not stuck in error state)
    await expect(trainingRunSelect.locator('.n-base-selection--disabled')).toHaveCount(0, { timeout: 5000 })
  })

  // AC5: Training run selector in the Generate Samples dialog has a refresh icon button
  test('training run selector in generate samples dialog has a refresh icon button', async ({ page }) => {
    await page.goto('/')

    // Open the Generate Samples dialog
    await closeDrawer(page)
    const generateBtn = page.locator('[data-testid="generate-samples-button"]')
    await expect(generateBtn).toBeVisible()
    await generateBtn.click()

    // Wait for the dialog to open
    const dialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Generate Samples' })
    await expect(dialog).toBeVisible()

    // AC5: Refresh icon button is present inside the dialog
    const refreshBtn = dialog.locator('[data-testid="refresh-training-run-button"]')
    await expect(refreshBtn).toBeVisible()
  })
})
