import { test, expect } from '@playwright/test'

/**
 * E2E tests for narrow-screen eager auto-select behavior (B-030).
 *
 * On narrow screens (<1024px) the sidebar drawer does not open automatically.
 * When localStorage has a saved training run, the app eagerly loads it so that
 * header controls (Generate Samples, Jobs, Metadata, Live indicator) appear
 * immediately without requiring the user to open the drawer first.
 *
 * Test fixture data:
 *   - Training run: "test-run/my-model" with 2 checkpoints (step 1000, step 2000)
 */

test.describe('narrow screen eager auto-select', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

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

  test('no header buttons on narrow screen when no saved training run in localStorage', async ({ page }) => {
    // AC: If no saved training run exists in localStorage, the app shows
    // 'Select a training run to get started' as before.

    // Navigate with no localStorage data (clean state)
    await page.goto('/')

    // The placeholder message should be shown
    await expect(page.getByText('Select a training run to get started.')).toBeVisible()

    // Header buttons should NOT be visible
    await expect(page.locator('[data-testid="generate-samples-button"]')).not.toBeVisible()
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
    const selectTrigger = page.locator('.training-run-selector .n-select')
    await expect(selectTrigger).toBeVisible()
    await expect(selectTrigger).toContainText(trainingRunName)
  })
})
