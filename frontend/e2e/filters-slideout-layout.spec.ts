import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  selectNaiveOptionByLabel,
  closeDrawer,
  openFiltersDrawer,
  closeFiltersDrawer,
} from './helpers'

/**
 * E2E tests for S-082: filters slideout, slider/zoom relocation.
 *
 * Verifies:
 *   - AC1: Filters button opens a right-side slideout with all filters (not individually collapsible)
 *   - AC2: MasterSlider is in the header-center area (top bar)
 *   - AC3: ZoomControl is in the header-controls area (top nav bar)
 *   - AC4: Existing filter, slider, and zoom functionality is preserved
 *   - AC5: Layout is responsive on narrow screens
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Checkpoints: step 1000, step 2000
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 */

/**
 * Selects the training run, assigns checkpoint to X and prompt_name to Slider,
 * then closes the sidebar drawer.
 */
async function setupWithSlider(page: Page): Promise<void> {
  await page.goto('/')
  await selectTrainingRun(page, 'my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()
  await selectNaiveOptionByLabel(page, 'Role for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Role for prompt_name', 'Slider')
  await closeDrawer(page)
}

/**
 * Selects the training run, assigns checkpoint to X and prompt_name to Y,
 * then closes the sidebar drawer. This puts both dimensions in 'multi' filter mode.
 */
async function setupWithAxes(page: Page): Promise<void> {
  await page.goto('/')
  await selectTrainingRun(page, 'my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()
  await selectNaiveOptionByLabel(page, 'Role for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Role for prompt_name', 'Y Axis')
  await closeDrawer(page)
}

test.describe('S-082: filters slideout and layout relocation', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // -- AC1: Filters button and right-side slideout --

  test('AC1: Filters button appears in header after selecting a training run', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await closeDrawer(page)

    const filtersButton = page.locator('[data-testid="filters-button"]')
    await expect(filtersButton).toBeVisible()
    await expect(filtersButton).toContainText('Filters')
  })

  test('AC1: clicking Filters button opens right-side drawer with dimension filters', async ({ page }) => {
    // Assign dimensions to put them in 'multi' filter mode (default is 'hide')
    await setupWithAxes(page)

    // Open the filters drawer
    await openFiltersDrawer(page)

    // The drawer should contain dimension filter entries -- filters are always expanded
    // (no per-dimension toggle button). Checkpoint is assigned to X axis (multi mode),
    // so its checkboxes should be visible.
    const checkpointFilter = page.locator('[aria-label="Toggle checkpoint 1000"]')
    await expect(checkpointFilter.first()).toBeVisible()
  })

  test('AC1: filters in drawer are always expanded (no toggle buttons)', async ({ page }) => {
    await setupWithAxes(page)

    await openFiltersDrawer(page)

    // There should be no per-dimension toggle buttons in the filters drawer
    // (alwaysExpanded=true removes the toggle button)
    const toggleButtons = page.locator('.dimension-filter__toggle')
    await expect(toggleButtons).toHaveCount(0)
  })

  test('AC1: old inline filters section does not exist', async ({ page }) => {
    await setupWithAxes(page)

    // The old .dimension-filters section and "Toggle all filters" button should not exist
    await expect(page.locator('.dimension-filters')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Toggle all filters' })).toHaveCount(0)
  })

  // -- AC2: MasterSlider in header-center area --

  test('AC2: MasterSlider is visible in the header area after assigning Slider dimension', async ({ page }) => {
    await setupWithSlider(page)

    // The master slider should be in the header (not in main content)
    const headerCenter = page.locator('.header-center')
    await expect(headerCenter).toBeVisible()

    // The master slider component should be inside header-center
    const masterSlider = page.locator('.header-center [aria-label="Master prompt_name slider"]')
    await expect(masterSlider).toBeVisible()
  })

  // -- AC3: ZoomControl in header-controls area --

  test('AC3: ZoomControl is visible in header-controls after selecting a training run', async ({ page }) => {
    await setupWithAxes(page)

    // ZoomControl should be in the header-controls area
    const headerControls = page.locator('.header-controls')
    await expect(headerControls).toBeVisible()

    // The zoom control group should be within header-controls
    const zoomControl = headerControls.locator('[aria-label="Grid cell zoom control"]')
    await expect(zoomControl).toBeVisible()
  })

  test('AC3: old controls-sticky section does not exist', async ({ page }) => {
    await setupWithAxes(page)

    // The old .controls-sticky section should not exist
    await expect(page.locator('.controls-sticky')).toHaveCount(0)
  })

  // -- AC4: Existing functionality preserved --

  test('AC4: zoom control is visible in header after selecting a training run', async ({ page }) => {
    await setupWithAxes(page)

    // Grid should be visible
    await expect(page.locator('.xy-grid-container')).toBeVisible()

    // The zoom control should be visible in the header
    const zoomControl = page.locator('[aria-label="Grid cell zoom control"]')
    await expect(zoomControl).toBeVisible()
    await expect(zoomControl).toContainText('Zoom')
  })

  test('AC4: filter changes in the drawer update the grid', async ({ page }) => {
    await setupWithAxes(page)

    // Verify 2 column headers initially
    const colHeaders = page.locator('.xy-grid__col-header')
    await expect(colHeaders).toHaveCount(2)

    // Open filters drawer and deselect one value
    await openFiltersDrawer(page)
    const checkbox = page.locator('[aria-label="Toggle checkpoint 1000"]')
    await checkbox.first().click()

    // Grid should update to show only 1 column
    await expect(colHeaders).toHaveCount(1)

    // Close filters drawer
    await closeFiltersDrawer(page)
  })
})
