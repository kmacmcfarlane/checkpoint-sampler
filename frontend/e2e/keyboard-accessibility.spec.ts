import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

/**
 * E2E tests for keyboard accessibility of XYGrid headers (solo/unsolo filtering)
 * and ImageCell (lightbox activation) — S-175.
 *
 * Test fixture data:
 *   - Training run: "my-model" with 2 checkpoints (step 1000, step 2000)
 *   - Each checkpoint has 2 sample images: prompt_name=landscape and prompt_name=portrait
 */

/**
 * Navigates to the app, selects the test training run, assigns checkpoint → X and
 * prompt_name → Y, waits for images to appear, then closes the drawer so grid cells
 * are interactable (the NDrawer mask intercepts pointer events when the drawer is open).
 */
async function setupGridWithImages(page: Page): Promise<void> {
  await page.goto('/')

  await selectTrainingRun(page, 'my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()

  await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

  const images = page.locator('.xy-grid [role="gridcell"] img')
  await expect(images.first()).toBeVisible()

  await closeDrawer(page)
}

test.describe('keyboard accessibility: XYGrid headers and ImageCell', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: XYGrid row/column headers are keyboard-operable — Enter activates a column header
  test('focuses a column header and activates it with Enter to solo the value', async ({ page }) => {
    await setupGridWithImages(page)

    const colHeaders = page.locator('.xy-grid__col-header')
    await expect(colHeaders).toHaveCount(2)

    const header1000 = colHeaders.filter({ hasText: '1000' })
    await header1000.focus()
    await expect(header1000).toBeFocused()

    await page.keyboard.press('Enter')

    // Soloing checkpoint=1000 should reduce the grid to a single column
    await expect(colHeaders).toHaveCount(1)
    await expect(colHeaders.filter({ hasText: '1000' })).toBeVisible()
    await expect(colHeaders.filter({ hasText: '2000' })).not.toBeVisible()
  })

  // AC1: XYGrid row/column headers are keyboard-operable — Space activates a row header
  test('focuses a row header and activates it with Space to solo the value', async ({ page }) => {
    await setupGridWithImages(page)

    const rowHeaders = page.locator('.xy-grid__row-header')
    await expect(rowHeaders).toHaveCount(2)

    const headerLandscape = rowHeaders.filter({ hasText: 'landscape' })
    await headerLandscape.focus()
    await expect(headerLandscape).toBeFocused()

    await page.keyboard.press(' ')

    // Soloing prompt_name=landscape should reduce the grid to a single row
    await expect(rowHeaders).toHaveCount(1)
    await expect(rowHeaders.filter({ hasText: 'landscape' })).toBeVisible()
    await expect(rowHeaders.filter({ hasText: 'portrait' })).not.toBeVisible()
  })

  // AC2: ImageCell is always focusable when non-empty and Enter opens the lightbox
  test('focuses a non-empty image cell and opens the lightbox with Enter', async ({ page }) => {
    await setupGridWithImages(page)

    const firstCell = page.locator('.xy-grid [role="gridcell"] .image-cell').first()
    await expect(firstCell).toHaveAttribute('tabindex', '0')

    await firstCell.focus()
    await expect(firstCell).toBeFocused()

    await page.keyboard.press('Enter')

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()
  })

  // AC2: ImageCell is always focusable when non-empty and Space opens the lightbox
  test('focuses a non-empty image cell and opens the lightbox with Space', async ({ page }) => {
    await setupGridWithImages(page)

    const firstCell = page.locator('.xy-grid [role="gridcell"] .image-cell').first()
    await firstCell.focus()

    await page.keyboard.press(' ')

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()
  })
})
