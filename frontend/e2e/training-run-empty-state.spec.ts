import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for S-173: Helpful empty state when no training runs are found.
 *
 * Verifies that when the training run discovery returns zero results, the
 * selector shows a helpful message naming the configured checkpoint
 * directories and pointing at the config/layout docs, instead of a generic
 * "No Data" message that leaves misconfigured newcomers stuck.
 */

test.describe('training run selector empty state (S-173)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC2: FE: TrainingRunSelector empty state names the configured checkpoint
  // directories and hints at config/layout docs instead of the generic "No Data".
  test('shows a helpful empty state naming the configured checkpoint directories', async ({ page }) => {
    await page.route('**/api/v1/training-runs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })
    await page.route('**/api/v1/config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ max_study_items: 50000, checkpoint_dirs: ['/data/checkpoints'] }),
      })
    })

    await page.goto('/')

    const emptyState = page.locator('[data-testid="training-run-empty-state"]')
    await expect(emptyState).toBeVisible()
    await expect(emptyState).toContainText('/data/checkpoints')
    await expect(emptyState).toContainText('docs/filesystem.md')
    await expect(emptyState).not.toContainText('No Data')
  })

  // AC2: Falls back to a generic (still non-"No Data") message if config cannot be fetched.
  test('falls back to a generic message when checkpoint dirs cannot be fetched', async ({ page }) => {
    await page.route('**/api/v1/training-runs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })
    await page.route('**/api/v1/config', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/')

    const emptyState = page.locator('[data-testid="training-run-empty-state"]')
    await expect(emptyState).toBeVisible()
    await expect(emptyState).toContainText('No training runs found')
  })

  // AC: The empty state does not appear when training runs are available.
  test('does not show the empty state when training runs exist', async ({ page }) => {
    await page.goto('/')

    const emptyState = page.locator('[data-testid="training-run-empty-state"]')
    await expect(emptyState).not.toBeVisible()
  })
})
