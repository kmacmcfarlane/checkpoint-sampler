import { test, expect } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  selectNaiveOptionByLabel,
  closeDrawer,
  openFiltersDrawer,
} from './helpers'

/**
 * E2E tests for DimensionFilter solo click interaction:
 *   - Click a value's text (role="button", aria-label="Solo <dim> <value>") to solo it
 *     (only that value remains selected, grid shows only matching column/row)
 *   - Click the same value text again to unsolo (all values re-selected, grid shows full state)
 *
 * Filters are accessed via the right-side Filters drawer (opened by the
 * "Filters" button in the header). Individual dimension filters are always
 * expanded inside the drawer (no per-dimension toggle).
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Checkpoints: step 1000, step 2000
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 *   - Combo filter dimension used: checkpoint (X axis), prompt_name (Y axis)
 */

test.describe('DimensionFilter solo click interaction', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('solo click on a value text selects only that value (X axis column reduces)', async ({ page }) => {
    // AC1: Click value text to solo, click again to unsolo
    await page.goto('/')

    // Select the fixture training run
    await selectTrainingRun(page, 'my-model')

    // Wait for dimension panel to appear (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint to X axis and prompt_name to Y axis
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Close sidebar drawer to interact with main area
    await closeDrawer(page)

    // Verify we start with 2 column headers (1000 and 2000)
    const colHeaders = page.locator('.xy-grid__col-header')
    await expect(colHeaders).toHaveCount(2)
    await expect(colHeaders.filter({ hasText: '1000' })).toBeVisible()
    await expect(colHeaders.filter({ hasText: '2000' })).toBeVisible()

    // Open Filters drawer (right-side slideout)
    await openFiltersDrawer(page)

    // Filters are always expanded in the drawer -- no per-dimension toggle needed.
    // AC1: Solo click -- click the "1000" value text (role=button, aria-label="Solo checkpoint 1000")
    // This should select only checkpoint 1000, removing checkpoint 2000 from the grid
    const soloButton1000 = page.getByRole('button', { name: 'Solo checkpoint 1000' })
    await expect(soloButton1000).toBeVisible()
    await soloButton1000.click()

    // After soloing checkpoint 1000, only column "1000" should be visible
    await expect(colHeaders).toHaveCount(1)
    await expect(colHeaders.filter({ hasText: '1000' })).toBeVisible()
    await expect(colHeaders.filter({ hasText: '2000' })).not.toBeVisible()
  })

  test('solo click again (unsolo) re-selects all values and restores full grid', async ({ page }) => {
    // AC1: Click value text to solo, click again to unsolo
    await page.goto('/')

    // Select the fixture training run
    await selectTrainingRun(page, 'my-model')

    // Wait for dimension panel to appear (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint to X axis and prompt_name to Y axis
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Close sidebar drawer to interact with main area
    await closeDrawer(page)

    // Open Filters drawer
    await openFiltersDrawer(page)

    // Filters are always expanded -- no per-dimension toggle needed.
    const colHeaders = page.locator('.xy-grid__col-header')

    // AC1: First solo click -- solo checkpoint 1000
    const soloButton1000 = page.getByRole('button', { name: 'Solo checkpoint 1000' })
    await soloButton1000.click()

    // Verify soloed state: only checkpoint 1000 visible
    await expect(colHeaders).toHaveCount(1)
    await expect(colHeaders.filter({ hasText: '1000' })).toBeVisible()

    // AC1: Second click on the same value text -- unsolo (re-select all values)
    await soloButton1000.click()

    // Verify unsolo state: both checkpoints visible again
    await expect(colHeaders).toHaveCount(2)
    await expect(colHeaders.filter({ hasText: '1000' })).toBeVisible()
    await expect(colHeaders.filter({ hasText: '2000' })).toBeVisible()
  })
})
