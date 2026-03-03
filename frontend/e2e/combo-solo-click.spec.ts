import { test, expect, type Page } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for DimensionFilter solo click interaction:
 *   - Click a value's text (role="button", aria-label="Solo <dim> <value>") to solo it
 *     (only that value remains selected, grid shows only matching column/row)
 *   - Click the same value text again to unsolo (all values re-selected, grid shows full state)
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Checkpoints: step 1000, step 2000
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 *   - Combo filter dimension used: checkpoint (X axis), prompt_name (Y axis)
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
 * Closes the drawer so its mask doesn't intercept clicks on main-area elements.
 */
async function closeDrawer(page: Page): Promise<void> {
  const drawerCloseButton = page.locator('[aria-label="close"]').first()
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    await expect(drawerCloseButton).not.toBeVisible()
    await page.waitForTimeout(300)
  }
}

/**
 * Expands the main-area "Filters" collapsible section.
 */
async function expandFiltersSection(page: Page): Promise<void> {
  const filterToggle = page.getByRole('button', { name: 'Toggle all filters' })
  await expect(filterToggle).toBeVisible()
  const expanded = await filterToggle.getAttribute('aria-expanded')
  if (expanded === 'false') {
    await filterToggle.click()
  }
  await expect(page.locator('.dimension-filters')).toBeVisible()
}

/**
 * Expands a single dimension's filter panel.
 */
async function expandDimensionFilter(page: Page, dimensionName: string): Promise<void> {
  const toggleButton = page.getByRole('button', { name: `Toggle ${dimensionName} filter` })
  await expect(toggleButton).toBeVisible()
  const expanded = await toggleButton.getAttribute('aria-expanded')
  if (expanded === 'false') {
    await toggleButton.click()
  }
}

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
    await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')
    await selectNaiveOption(page, 'Role for prompt_name', 'Y Axis')

    // Close drawer to interact with main area
    await closeDrawer(page)

    // Verify we start with 2 column headers (1000 and 2000)
    const colHeaders = page.locator('.xy-grid__col-header')
    await expect(colHeaders).toHaveCount(2)
    await expect(colHeaders.filter({ hasText: '1000' })).toBeVisible()
    await expect(colHeaders.filter({ hasText: '2000' })).toBeVisible()

    // Expand Filters section in the main area
    await expandFiltersSection(page)

    // Expand the "checkpoint" dimension filter
    await expandDimensionFilter(page, 'checkpoint')

    // AC1: Solo click — click the "1000" value text (role=button, aria-label="Solo checkpoint 1000")
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
    await selectNaiveOption(page, 'Role for checkpoint', 'X Axis')
    await selectNaiveOption(page, 'Role for prompt_name', 'Y Axis')

    // Close drawer to interact with main area
    await closeDrawer(page)

    // Expand Filters section in the main area
    await expandFiltersSection(page)

    // Expand the "checkpoint" dimension filter
    await expandDimensionFilter(page, 'checkpoint')

    const colHeaders = page.locator('.xy-grid__col-header')

    // AC1: First solo click — solo checkpoint 1000
    const soloButton1000 = page.getByRole('button', { name: 'Solo checkpoint 1000' })
    await soloButton1000.click()

    // Verify soloed state: only checkpoint 1000 visible
    await expect(colHeaders).toHaveCount(1)
    await expect(colHeaders.filter({ hasText: '1000' })).toBeVisible()

    // AC1: Second click on the same value text — unsolo (re-select all values)
    await soloButton1000.click()

    // Verify unsolo state: both checkpoints visible again
    await expect(colHeaders).toHaveCount(2)
    await expect(colHeaders.filter({ hasText: '1000' })).toBeVisible()
    await expect(colHeaders.filter({ hasText: '2000' })).toBeVisible()
  })
})
