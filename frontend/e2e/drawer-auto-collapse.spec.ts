import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel } from './helpers'

/**
 * E2E tests for drawer auto-collapse on image grid interaction (S-069).
 *
 * On narrow/medium screens (<1024px) where the drawer overlays content, the
 * drawer auto-collapses when the user:
 *   - Clicks a column/row header in the grid (AC1, AC2)
 *   - Uses Ctrl+Arrow keyboard navigation (AC1, AC2)
 * On wide screens (>=1024px), the drawer stays open (AC3).
 * Manual toggle always works regardless of auto-collapse state (AC4).
 *
 * Note on NDrawer mask: NDrawer renders a mask overlay that intercepts pointer
 * events. E2E tests use { force: true } to bypass the mask when needed, or use
 * keyboard events (Ctrl+Arrow) which are not blocked by the mask. See
 * TEST_PRACTICES.md section 6.9.
 *
 * Test fixture data:
 *   - Training run: "my-model" with 2 checkpoints (step 1000, step 2000)
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 */

/**
 * Closes the drawer using its close button, waiting for the mask animation.
 * Uses a stricter assertion than the shared closeDrawer helper since
 * drawer-auto-collapse tests need to verify the entire .n-drawer element
 * disappears, not just the close button.
 */
async function closeDrawer(page: Page): Promise<void> {
  const closeBtn = page.locator('[aria-label="close"]').first()
  if (await closeBtn.isVisible()) {
    await closeBtn.click()
    await expect(page.locator('.n-drawer')).not.toBeVisible({ timeout: 3000 })
    await page.waitForTimeout(300) // wait for mask animation per TEST_PRACTICES.md 6.9
  }
}

/**
 * Sets up a training run with axes assigned and grid visible on narrow screen.
 * Opens the drawer, selects run, assigns axes, then closes the drawer so the
 * grid is accessible.
 */
async function setupGridOnNarrowScreen(page: Page): Promise<void> {
  // On narrow screens (<1024px), drawer starts closed -- open it
  const toggleBtn = page.getByRole('button', { name: 'Toggle controls drawer' })
  await expect(toggleBtn).toBeVisible()
  await toggleBtn.click()

  // Select the fixture training run
  await selectTrainingRun(page, 'my-model')

  // Wait for dimension panel to appear (scan complete)
  await expect(page.getByText('Dimensions')).toBeVisible()

  // Assign checkpoint to X axis and prompt_name to Y axis
  await selectNaiveOptionByLabel(page, 'Role for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Role for prompt_name', 'Y Axis')

  // Verify grid is rendered
  await expect(page.locator('.xy-grid-container')).toBeVisible()

  // Close the drawer so the grid is accessible without the mask
  await closeDrawer(page)
}

test.describe('drawer auto-collapse on narrow screen', () => {
  // AC2: Auto-collapse only triggers on narrow/medium screens
  test.use({ viewport: { width: 768, height: 1024 } })

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('AC1/AC2: Ctrl+Arrow keyboard nav auto-collapses the drawer on narrow screen', async ({ page }) => {
    // AC1: NDrawer auto-collapses when user uses keyboard navigation
    // AC2: Auto-collapse only triggers on narrow/medium screens
    await page.goto('/')
    await setupGridOnNarrowScreen(page)

    // Open the drawer
    const toggleBtn = page.getByRole('button', { name: 'Toggle controls drawer' })
    await toggleBtn.click()
    const drawerContent = page.locator('.n-drawer')
    await expect(drawerContent).toBeVisible()

    // Simulate Ctrl+ArrowRight keyboard navigation (document-level keydown)
    // Keyboard events are not blocked by the drawer mask
    await page.keyboard.press('Control+ArrowRight')

    // The drawer should auto-collapse
    await expect(drawerContent).not.toBeVisible({ timeout: 3000 })
  })

  test('AC1/AC2: clicking a column header auto-collapses the drawer on narrow screen', async ({ page }) => {
    // AC1: NDrawer auto-collapses when user clicks a grid header
    // AC2: Auto-collapse only triggers on narrow/medium screens
    await page.goto('/')
    await setupGridOnNarrowScreen(page)

    // Open the drawer
    const toggleBtn = page.getByRole('button', { name: 'Toggle controls drawer' })
    await toggleBtn.click()
    const drawerContent = page.locator('.n-drawer')
    await expect(drawerContent).toBeVisible()

    // Click a column header using force to bypass the drawer mask overlay
    const colHeader = page.locator('.xy-grid__col-header').first()
    await colHeader.click({ force: true })

    // The drawer should auto-collapse
    await expect(drawerContent).not.toBeVisible({ timeout: 3000 })
  })

  test('AC4: manual toggle works after auto-collapse on narrow screen', async ({ page }) => {
    // AC4: Manual drawer toggle still works regardless of auto-collapse
    await page.goto('/')
    await setupGridOnNarrowScreen(page)

    // Open the drawer
    const toggleBtn = page.getByRole('button', { name: 'Toggle controls drawer' })
    await toggleBtn.click()
    const drawerContent = page.locator('.n-drawer')
    await expect(drawerContent).toBeVisible()

    // Trigger auto-collapse via Ctrl+Arrow keyboard nav
    await page.keyboard.press('Control+ArrowRight')
    await expect(drawerContent).not.toBeVisible({ timeout: 3000 })

    // Re-open the drawer manually with the hamburger toggle
    await toggleBtn.click()
    await expect(drawerContent).toBeVisible()

    // Close it manually using the drawer close button
    await closeDrawer(page)
    await expect(drawerContent).not.toBeVisible({ timeout: 3000 })
  })
})

test.describe('drawer stays open on wide screen', () => {
  // AC3: On wide screens the drawer remains open (default Playwright viewport is 1280x720)
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('AC3: Ctrl+Arrow keyboard nav does NOT close the drawer on wide screen', async ({ page }) => {
    // AC3: On wide screens the drawer remains open (current behavior)
    await page.goto('/')

    // On wide screens, the drawer opens automatically
    const drawerContent = page.locator('.n-drawer')
    await expect(drawerContent).toBeVisible()

    // Select training run and set up axes
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await selectNaiveOptionByLabel(page, 'Role for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Role for prompt_name', 'Y Axis')

    // Verify grid is visible
    await expect(page.locator('.xy-grid-container')).toBeVisible()

    // Simulate Ctrl+ArrowRight keyboard navigation
    await page.keyboard.press('Control+ArrowRight')

    // The drawer should remain open on wide screens
    await expect(drawerContent).toBeVisible()

    // Also verify with Ctrl+ArrowLeft
    await page.keyboard.press('Control+ArrowLeft')
    await expect(drawerContent).toBeVisible()
  })
})
