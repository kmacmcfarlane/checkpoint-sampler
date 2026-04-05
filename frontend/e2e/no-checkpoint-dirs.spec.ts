import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun } from './helpers'

/**
 * E2E tests for B-135: Training run with no checkpoint sample dirs.
 *
 * Verifies that when a training run scan returns empty results (no images,
 * no dimensions), the UI displays an appropriate empty state message instead
 * of an error. This tests the frontend behavior for a training run whose
 * sample directories have been cleared or not yet generated.
 */

test.describe('training run with no checkpoint sample dirs (B-135)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: FE: Grid displays empty state (no error) when training run has no samples
  test('shows no-samples message instead of error when scan returns empty results', async ({ page }) => {
    // Intercept the scan API to return empty results (simulating a training run
    // with no checkpoint sample directories).
    await page.route('**/api/training-runs/*/scan', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ images: [], dimensions: [] }),
      })
    })

    await page.goto('/')

    // Select the training run (the route intercept ensures the scan returns empty)
    await selectTrainingRun(page, 'my-model')

    // AC: No error message should be shown
    await expect(page.locator('.error[role="alert"]')).not.toBeVisible()

    // AC: The no-samples message should be displayed
    const noSamplesMessage = page.locator('[data-testid="no-samples-message"]')
    await expect(noSamplesMessage).toBeVisible()
    await expect(noSamplesMessage).toContainText('No sample images found')
  })

  // AC: Grid displays empty state (no error) — verify no error class shown
  test('does not show scan error when scan returns empty results', async ({ page }) => {
    // Intercept scan API to return empty results
    await page.route('**/api/training-runs/*/scan', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ images: [], dimensions: [] }),
      })
    })

    await page.goto('/')
    await selectTrainingRun(page, 'my-model')

    // Should NOT show "Scanning..." stuck
    await expect(page.getByText('Scanning...')).not.toBeVisible()

    // Should NOT show an error message
    await expect(page.locator('.error[role="alert"]')).not.toBeVisible()

    // Should show the no-samples message, not the XY grid
    await expect(page.locator('[data-testid="no-samples-message"]')).toBeVisible()
    await expect(page.locator('.xy-grid')).not.toBeVisible()
    await expect(page.locator('.xy-grid-flat')).not.toBeVisible()
  })
})
