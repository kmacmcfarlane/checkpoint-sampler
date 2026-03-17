import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer, dismissOverlays } from './helpers'

/**
 * Accessibility audit tests using axe-core.
 *
 * These tests run an automated WCAG/axe accessibility scan on the main app page
 * to catch critical and serious violations before they reach UAT.
 *
 * Recurring dark mode contrast bugs (B-007, B-008, B-023, B-032) motivated the
 * addition of these tests — axe catches color-contrast violations automatically.
 *
 * Enforcement policy:
 *   - 'critical' and 'serious' violations fail the test immediately.
 *   - 'moderate' and 'minor' violations are reported but do not fail the test.
 */

/** Severity levels that must be free of violations to pass. */
const BLOCKING_IMPACT_LEVELS: string[] = ['critical', 'serious']

/**
 * Formats axe violations into a readable multiline string for test failure output.
 */
function formatViolations(violations: Array<{ id: string; impact: string | null; description: string; nodes: unknown[] }>): string {
  return violations
    .map((v) => `[${v.impact ?? 'unknown'}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
    .join('\n')
}

/**
 * Closes the app drawer if it is open, so its mask does not intercept pointer events
 * on the header controls (e.g., the theme toggle button).
 *
 * Uses the close button in the drawer header (aria-label="close", set by NBaseClose).
 * Safe to call even if the drawer is closed.
 * Calls dismissOverlays afterward to wait for NDrawer masks to fully disappear
 * under resource contention (B-112).
 * See TEST_PRACTICES.md §6.9 (NDrawer mask interaction).
 */
async function closeDrawerIfOpen(page: Page): Promise<void> {
  const drawerCloseButton = page.locator('[aria-label="close"]').first()
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    // Wait for the drawer to close (close button disappears)
    await expect(drawerCloseButton).not.toBeVisible()
  }
  // Wait for all NDrawer masks to fully disappear (B-112: 300ms was insufficient
  // under parallel shard resource contention)
  await dismissOverlays(page)
}

test.describe('accessibility audit', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('main app page has no critical or serious axe violations in light mode', async ({ page }) => {
    // AC: E2E: At least one Playwright test runs an axe accessibility scan on the main app page
    // AC: E2E: Accessibility violations at 'critical' and 'serious' impact levels fail the test
    await page.goto('/')

    // Ensure the page has finished loading (title is rendered)
    await expect(page).toHaveTitle(/Checkpoint Sampler/)

    // Close the drawer so its mask does not block axe's DOM inspection or the theme toggle
    // (drawer auto-opens on the default wide E2E viewport; see TEST_PRACTICES.md §6.9)
    await closeDrawerIfOpen(page)

    // Ensure we are in light mode. If currently dark, switch to light via Settings dialog
    // (S-091: theme toggle moved from header to Settings dialog)
    const isDarkMode = await page.locator('.app.dark-mode').isVisible()
    if (isDarkMode) {
      await page.locator('[data-testid="settings-button"]').click()
      await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible()
      // Theme toggle shows "Light" in dark mode (clicking switches to light)
      await page.locator('[data-testid="theme-toggle"]').click()
      // Close the dialog
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-testid="settings-dialog"]')).not.toBeVisible()
      // Wait for dark-mode class to be removed
      await expect(page.locator('.app.dark-mode')).not.toBeVisible()
    }

    const results = await new AxeBuilder({ page }).analyze()

    const blockingViolations = results.violations.filter(
      (v) => v.impact !== null && BLOCKING_IMPACT_LEVELS.includes(v.impact),
    )

    // Non-blocking: log moderate/minor violations for awareness (do not fail)
    const nonBlockingViolations = results.violations.filter(
      (v) => v.impact === null || !BLOCKING_IMPACT_LEVELS.includes(v.impact),
    )
    if (nonBlockingViolations.length > 0) {
      console.log(
        `Non-blocking accessibility issues (moderate/minor) in light mode:\n${formatViolations(nonBlockingViolations)}`,
      )
    }

    if (blockingViolations.length > 0) {
      throw new Error(
        `Accessibility violations found in light mode (critical/serious):\n${formatViolations(blockingViolations)}`,
      )
    }

    expect(blockingViolations).toHaveLength(0)
  })

  test('main app page has no critical or serious axe violations in dark mode', async ({ page }) => {
    // AC: E2E: Accessibility violations at 'critical' and 'serious' impact levels fail the test
    // AC: E2E: Low-contrast issues (like the recurring dark mode bugs) are caught automatically
    await page.goto('/')

    // Ensure the page has finished loading
    await expect(page).toHaveTitle(/Checkpoint Sampler/)

    // Close the drawer so its mask does not intercept the theme toggle click
    // (NDrawer mask covers the full viewport and blocks pointer events on header controls)
    await closeDrawerIfOpen(page)

    // Switch to dark mode via the Settings dialog (S-091: theme toggle moved to settings)
    const isDarkMode = await page.locator('.app.dark-mode').isVisible()
    if (!isDarkMode) {
      await page.locator('[data-testid="settings-button"]').click()
      await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible()
      // Theme toggle shows "Dark" in light mode (clicking switches to dark)
      await page.locator('[data-testid="theme-toggle"]').click()
      // Close the dialog
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-testid="settings-dialog"]')).not.toBeVisible()
    }

    // Wait for dark-mode class to be applied (App.vue toggles .dark-mode on .app)
    await expect(page.locator('.app.dark-mode')).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()

    const blockingViolations = results.violations.filter(
      (v) => v.impact !== null && BLOCKING_IMPACT_LEVELS.includes(v.impact),
    )

    // Non-blocking: log moderate/minor violations for awareness
    const nonBlockingViolations = results.violations.filter(
      (v) => v.impact === null || !BLOCKING_IMPACT_LEVELS.includes(v.impact),
    )
    if (nonBlockingViolations.length > 0) {
      console.log(
        `Non-blocking accessibility issues (moderate/minor) in dark mode:\n${formatViolations(nonBlockingViolations)}`,
      )
    }

    if (blockingViolations.length > 0) {
      throw new Error(
        `Accessibility violations found in dark mode (critical/serious):\n${formatViolations(blockingViolations)}`,
      )
    }

    expect(blockingViolations).toHaveLength(0)
  })

  test('populated grid has no critical or serious axe violations in light mode', async ({ page }) => {
    // AC: E2E: Accessibility audit runs after loading a training run and assigning axes
    // AC: E2E: Catches contrast violations inside grid cells, image captions, and axis labels
    await page.goto('/')
    await expect(page).toHaveTitle(/Checkpoint Sampler/)

    // Load "my-model" training run from test fixtures
    await selectTrainingRun(page, 'my-model')

    // Wait for the Dimensions panel to appear (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign axes to render the XY grid with real images
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Wait for at least one grid cell image to load before scanning
    await expect(page.locator('.xy-grid [role="gridcell"] img').first()).toBeVisible()

    // Close the sidebar drawer so its mask does not interfere with the axe scan
    await closeDrawer(page)
    // Wait for all NDrawer masks to fully disappear (B-112)
    await dismissOverlays(page)

    // Ensure we are in light mode
    const isDarkMode = await page.locator('.app.dark-mode').isVisible()
    if (isDarkMode) {
      await page.locator('[data-testid="settings-button"]').click()
      await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible()
      await page.locator('[data-testid="theme-toggle"]').click()
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-testid="settings-dialog"]')).not.toBeVisible()
      await expect(page.locator('.app.dark-mode')).not.toBeVisible()
    }

    const results = await new AxeBuilder({ page }).analyze()

    const blockingViolations = results.violations.filter(
      (v) => v.impact !== null && BLOCKING_IMPACT_LEVELS.includes(v.impact),
    )

    const nonBlockingViolations = results.violations.filter(
      (v) => v.impact === null || !BLOCKING_IMPACT_LEVELS.includes(v.impact),
    )
    if (nonBlockingViolations.length > 0) {
      console.log(
        `Non-blocking accessibility issues (moderate/minor) in populated grid light mode:\n${formatViolations(nonBlockingViolations)}`,
      )
    }

    if (blockingViolations.length > 0) {
      throw new Error(
        `Accessibility violations found in populated grid light mode (critical/serious):\n${formatViolations(blockingViolations)}`,
      )
    }

    expect(blockingViolations).toHaveLength(0)
  })

  test('populated grid has no critical or serious axe violations in dark mode', async ({ page }) => {
    // AC: E2E: Accessibility audit runs after loading a training run and assigning axes
    // AC: E2E: Catches contrast violations inside grid cells, image captions, and axis labels
    await page.goto('/')
    await expect(page).toHaveTitle(/Checkpoint Sampler/)

    // Load "my-model" training run from test fixtures
    await selectTrainingRun(page, 'my-model')

    // Wait for the Dimensions panel to appear (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign axes to render the XY grid with real images
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    // Wait for at least one grid cell image to load before scanning
    await expect(page.locator('.xy-grid [role="gridcell"] img').first()).toBeVisible()

    // Close the sidebar drawer so its mask does not interfere with the theme toggle or axe scan
    await closeDrawer(page)
    // Wait for all NDrawer masks to fully disappear (B-112)
    await dismissOverlays(page)

    // Switch to dark mode via the Settings dialog
    const isDarkMode = await page.locator('.app.dark-mode').isVisible()
    if (!isDarkMode) {
      await page.locator('[data-testid="settings-button"]').click()
      await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible()
      await page.locator('[data-testid="theme-toggle"]').click()
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-testid="settings-dialog"]')).not.toBeVisible()
    }

    // Wait for dark-mode class to be applied
    await expect(page.locator('.app.dark-mode')).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()

    const blockingViolations = results.violations.filter(
      (v) => v.impact !== null && BLOCKING_IMPACT_LEVELS.includes(v.impact),
    )

    const nonBlockingViolations = results.violations.filter(
      (v) => v.impact === null || !BLOCKING_IMPACT_LEVELS.includes(v.impact),
    )
    if (nonBlockingViolations.length > 0) {
      console.log(
        `Non-blocking accessibility issues (moderate/minor) in populated grid dark mode:\n${formatViolations(nonBlockingViolations)}`,
      )
    }

    if (blockingViolations.length > 0) {
      throw new Error(
        `Accessibility violations found in populated grid dark mode (critical/serious):\n${formatViolations(blockingViolations)}`,
      )
    }

    expect(blockingViolations).toHaveLength(0)
  })
})
