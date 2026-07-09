import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectStudy, selectNaiveOptionByLabel, closeDrawer, dismissOverlays } from './helpers'

/**
 * E2E tests for the core user journey:
 * open app → select training run → configure axes → see XY grid with images.
 *
 * These tests run against the self-contained test stack (docker-compose.test.yml)
 * which mounts test-fixtures/ as the checkpoint and sample data sources.
 *
 * Expected test fixture data:
 *   - Training run: "my-model" with 2 checkpoints (step 1000, step 2000)
 *   - Each checkpoint has 2 sample images: prompt_name=landscape and prompt_name=portrait
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 */

test.describe('training run selection and XY grid display', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('selects a training run from the sidebar dropdown', async ({ page }) => {
    await page.goto('/')

    // The drawer opens automatically on wide screens (>= 1024px).
    // Ensure the Training Run label is visible in the drawer.
    await expect(page.getByText('Training Run', { exact: true })).toBeVisible()

    // Select the fixture training run
    await selectTrainingRun(page, 'my-model')

    // After selection, the main content should no longer show the "get started" prompt
    await expect(page.getByText('Select a training run to get started.')).not.toBeVisible()

    // The app scans the run (briefly shows "Scanning...") then renders the Dimensions panel
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test('XY grid renders with dimension axis labels after assigning axes', async ({ page }) => {
    await page.goto('/')

    // Select the training run
    await selectTrainingRun(page, 'my-model')

    // Wait for dimension panel to appear (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign "checkpoint" dimension to X axis
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')

    // Assign "prompt_name" dimension to Y axis
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // The XY grid container should now be visible
    const gridContainer = page.locator('.xy-grid-container')
    await expect(gridContainer).toBeVisible()

    // Verify column headers (checkpoint values: 1000, 2000) are visible
    await expect(page.locator('[role="columnheader"]').filter({ hasText: '1000' })).toBeVisible()
    await expect(page.locator('[role="columnheader"]').filter({ hasText: '2000' })).toBeVisible()

    // Verify row headers (prompt_name values: landscape, portrait) are visible
    await expect(page.locator('[role="rowheader"]').filter({ hasText: 'landscape' })).toBeVisible()
    await expect(page.locator('[role="rowheader"]').filter({ hasText: 'portrait' })).toBeVisible()
  })

  // S-160: hovering a prompt-dimension header shows a tooltip with the full prompt text.
  test('hovering a prompt-dimension row header shows the full prompt text tooltip', async ({ page }) => {
    await page.goto('/')

    await selectTrainingRun(page, 'my-model')
    // Select the study-grouped variant of this training run ("E2E Fixture Study") -- its
    // study_label matches a seeded Study record, which is required for the prompt-text
    // lookup map (App.vue activeStudyPromptTextMap) to be populated (S-160).
    await selectStudy(page, 'E2E Fixture Study')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint → X axis, prompt_name → Y axis (prompt dimension on rows).
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Close the sidebar drawer -- its mask intercepts pointer events (hover) on the grid.
    await closeDrawer(page)
    await dismissOverlays(page)

    const landscapeRowHeader = page.locator('[data-testid="xy-grid-row-header"]').filter({ hasText: 'landscape' })
    await expect(landscapeRowHeader).toBeVisible()

    // Hovering the prompt-dimension row header should reveal the full prompt text (fixture: "a beautiful landscape").
    // Naive UI's NTooltip listens for real pointer movement, so hover in two steps (move onto the
    // page, then onto the target) rather than a single synthetic hover.
    const box = await landscapeRowHeader.boundingBox()
    if (!box) throw new Error('landscape row header has no bounding box')
    await page.mouse.move(box.x + 1, box.y + 1)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
    await expect(page.locator('.n-tooltip').filter({ hasText: 'a beautiful landscape' })).toBeVisible()

    // AC: header:click behavior is preserved -- clicking the header (via hover state) still works
    // and does not error or block selection. Clicking toggles the header's filter selection.
    await landscapeRowHeader.click()

    // Hovering a non-prompt-dimension header (checkpoint column header) shows no prompt tooltip.
    const checkpointColHeader = page.locator('[data-testid="xy-grid-col-header"]').filter({ hasText: '1000' })
    await expect(checkpointColHeader).toBeVisible()
    await checkpointColHeader.hover()
    await expect(page.locator('.n-tooltip').filter({ hasText: 'a beautiful landscape' })).not.toBeVisible()
  })

  test('at least one image cell appears in the grid after axis assignment', async ({ page }) => {
    await page.goto('/')

    // Select the training run
    await selectTrainingRun(page, 'my-model')

    // Wait for scan to complete
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign checkpoint → X axis, prompt_name → Y axis
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Grid cells should contain images (not just "No image" placeholders)
    // The image cells with actual images render an <img> element inside .image-cell
    const gridCells = page.locator('.xy-grid [role="gridcell"]')
    await expect(gridCells.first()).toBeVisible()

    // At least one img element should be present in the grid
    const images = page.locator('.xy-grid [role="gridcell"] img')
    await expect(images.first()).toBeVisible()
  })

  test('dimension axis labels are visible in the rendered grid', async ({ page }) => {
    await page.goto('/')

    // Select the training run
    await selectTrainingRun(page, 'my-model')

    // Wait for scan to complete
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign axes
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Verify column headers are visible and display checkpoint step values
    await expect(page.locator('.xy-grid__col-header').filter({ hasText: '1000' })).toBeVisible()
    await expect(page.locator('.xy-grid__col-header').filter({ hasText: '2000' })).toBeVisible()

    // Verify row headers are visible and display prompt_name values
    await expect(page.locator('.xy-grid__row-header').filter({ hasText: 'landscape' })).toBeVisible()
    await expect(page.locator('.xy-grid__row-header').filter({ hasText: 'portrait' })).toBeVisible()
  })
})
