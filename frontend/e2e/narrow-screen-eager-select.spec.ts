import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for narrow-screen eager auto-select behavior (B-030).
 *
 * On narrow screens (<1024px) the sidebar drawer does not open automatically.
 * When localStorage has a saved training run, the app eagerly loads it so that
 * header controls (Generate Samples, Jobs, Metadata, Live indicator) appear
 * immediately without requiring the user to open the drawer first.
 *
 * Test fixture data:
 *   - Training run: "my-model" with 2 checkpoints (step 1000, step 2000)
 */

test.describe('narrow screen eager auto-select', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('header buttons appear on narrow screen when saved training run exists in localStorage', async ({ page, request }) => {
    // AC: On narrow screens (<1024px), the app eagerly loads the saved training
    // run from localStorage and triggers a scan on mount, regardless of drawer state.
    // AC: Header buttons (Generate Samples, Jobs, Metadata, Live indicator) appear
    // immediately after app load when a saved training run exists.

    // Step 1: Discover the training run ID from the API
    const response = await request.get('/api/training-runs')
    expect(response.ok()).toBeTruthy()
    const runs = await response.json()
    expect(runs.length).toBeGreaterThan(0)
    const trainingRunId = runs[0].id

    // Step 2: Set localStorage before page loads so eagerAutoSelect picks it up
    await page.addInitScript((runId: number) => {
      localStorage.setItem(
        'checkpoint-sampler-last-preset',
        JSON.stringify({ trainingRunId: runId, presetId: 'e2e-test-preset' }),
      )
    }, trainingRunId)

    // Step 3: Navigate to the app at narrow viewport
    await page.goto('/')

    // Step 4: Verify header buttons appear without opening the drawer
    // Generate Samples button
    await expect(page.locator('[data-testid="generate-samples-button"]')).toBeVisible({ timeout: 10000 })

    // Jobs button
    await expect(page.getByRole('button', { name: 'Toggle sample jobs panel' })).toBeVisible()

    // Metadata button
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).toBeVisible()

    // Live/Disconnected status indicator
    const statusTag = page.locator('header').getByText(/^(Live|Disconnected)$/)
    await expect(statusTag).toBeVisible()
  })

  test('Generate Samples and Jobs buttons are always visible on narrow screen even without a saved training run', async ({ page }) => {
    // UAT rework B-030: Generate Samples and Jobs must ALWAYS be visible,
    // regardless of whether a training run is selected.
    // Only the Metadata button is gated on training run selection.

    // Navigate with no localStorage data (clean state)
    await page.goto('/')

    // The placeholder message should still be shown when no run is selected
    await expect(page.getByText('Select a training run to get started.')).toBeVisible()

    // Generate Samples and Jobs buttons MUST be visible immediately
    await expect(page.locator('[data-testid="generate-samples-button"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Toggle sample jobs panel' })).toBeVisible()

    // Metadata button should NOT be visible (still gated on training run selection)
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).not.toBeVisible()
  })

  test('drawer shows the auto-selected training run when opened on narrow screen', async ({ page, request }) => {
    // AC: The drawer's TrainingRunSelector still reflects the auto-selected
    // training run when opened.

    // Step 1: Discover the training run ID from the API
    const response = await request.get('/api/training-runs')
    const runs = await response.json()
    const trainingRunId = runs[0].id
    const trainingRunName = runs[0].name

    // Step 2: Set localStorage before page loads
    await page.addInitScript((runId: number) => {
      localStorage.setItem(
        'checkpoint-sampler-last-preset',
        JSON.stringify({ trainingRunId: runId, presetId: 'e2e-test-preset' }),
      )
    }, trainingRunId)

    // Step 3: Navigate to the app
    await page.goto('/')

    // Wait for eager auto-select to complete (header buttons visible)
    await expect(page.locator('[data-testid="generate-samples-button"]')).toBeVisible({ timeout: 10000 })

    // Step 4: Open the drawer by clicking the hamburger button
    await page.getByRole('button', { name: 'Toggle controls drawer' }).click()

    // Step 5: Verify the training run selector in the drawer shows the correct run
    // The NSelect trigger should display the training run name
    const selectTrigger = page.locator('[data-testid="training-run-select"]')
    await expect(selectTrigger).toBeVisible()
    await expect(selectTrigger).toContainText(trainingRunName)
  })

  test('header buttons appear when only standalone training run key is in localStorage (no preset)', async ({ page, request }) => {
    // B-030 core fix: eagerAutoSelect falls back to the standalone
    // checkpoint-sampler-last-training-run key when no preset data exists.
    // This is the exact scenario the bug reported: user selects a training run
    // without ever saving a preset, then reloads on a narrow screen.

    // Step 1: Discover the training run ID from the API
    const response = await request.get('/api/training-runs')
    expect(response.ok()).toBeTruthy()
    const runs = await response.json()
    expect(runs.length).toBeGreaterThan(0)
    const trainingRunId = runs[0].id

    // Step 2: Set ONLY the standalone key -- no preset key at all
    await page.addInitScript((runId: number) => {
      localStorage.setItem('checkpoint-sampler-last-training-run', String(runId))
    }, trainingRunId)

    // Step 3: Navigate to the app at narrow viewport
    await page.goto('/')

    // Step 4: Verify header buttons appear without opening the drawer
    await expect(page.locator('[data-testid="generate-samples-button"]')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Toggle sample jobs panel' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Toggle checkpoint metadata panel' })).toBeVisible()

    // Live/Disconnected status indicator
    const statusTag = page.locator('header').getByText(/^(Live|Disconnected)$/)
    await expect(statusTag).toBeVisible()
  })

  test('selecting a training run writes the standalone localStorage key', async ({ page, request }) => {
    // Verify that onTrainingRunSelect persists the training run ID to the
    // standalone key so the next page load can eagerly restore it.

    // Step 1: Discover the training run name from the API
    const response = await request.get('/api/training-runs')
    const runs = await response.json()
    const trainingRunName = runs[0].name
    const trainingRunId = runs[0].id

    // Step 2: Navigate with no localStorage data
    await page.goto('/')

    // Step 3: Open the drawer and select a training run
    await page.getByRole('button', { name: 'Toggle controls drawer' }).click()
    const selectTrigger = page.locator('[data-testid="training-run-select"]')
    await expect(selectTrigger).toBeVisible()
    await selectTrigger.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText(trainingRunName, { exact: true }).click()

    // Step 4: Wait for scan to complete (header buttons appear)
    await expect(page.locator('[data-testid="generate-samples-button"]')).toBeVisible({ timeout: 10000 })

    // Step 5: Verify the standalone key was written to localStorage
    const storedId = await page.evaluate(() =>
      localStorage.getItem('checkpoint-sampler-last-training-run'),
    )
    expect(storedId).toBe(String(trainingRunId))
  })

  test('drawer reflects auto-selected run from standalone key when opened', async ({ page, request }) => {
    // AC3: When the standalone key (not preset) triggers eager load,
    // the drawer's TrainingRunSelector still shows the correct run.

    // Step 1: Discover the training run from the API
    const response = await request.get('/api/training-runs')
    const runs = await response.json()
    const trainingRunId = runs[0].id
    const trainingRunName = runs[0].name

    // Step 2: Set ONLY the standalone key
    await page.addInitScript((runId: number) => {
      localStorage.setItem('checkpoint-sampler-last-training-run', String(runId))
    }, trainingRunId)

    // Step 3: Navigate
    await page.goto('/')

    // Step 4: Wait for eager auto-select
    await expect(page.locator('[data-testid="generate-samples-button"]')).toBeVisible({ timeout: 10000 })

    // Step 5: Open drawer and verify the selector shows the correct run
    await page.getByRole('button', { name: 'Toggle controls drawer' }).click()
    const selectTrigger = page.locator('[data-testid="training-run-select"]')
    await expect(selectTrigger).toBeVisible()
    await expect(selectTrigger).toContainText(trainingRunName)
  })
})
