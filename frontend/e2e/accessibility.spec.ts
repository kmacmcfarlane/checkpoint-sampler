import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

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
 * Uses the close button in the drawer header. Safe to call even if the drawer is closed.
 * See TEST_PRACTICES.md §6.9 (NDrawer mask interaction).
 */
async function closeDrawerIfOpen(page: Page): Promise<void> {
  const drawerCloseButton = page.locator('.n-drawer-header__close')
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    await expect(page.locator('.n-drawer-mask')).not.toBeVisible()
  }
}

test.describe('accessibility audit', () => {
  test('main app page has no critical or serious axe violations in light mode', async ({ page }) => {
    // AC: E2E: At least one Playwright test runs an axe accessibility scan on the main app page
    // AC: E2E: Accessibility violations at 'critical' and 'serious' impact levels fail the test
    await page.goto('/')

    // Ensure the page has finished loading (title is rendered)
    await expect(page).toHaveTitle(/Checkpoint Sampler/)

    // Close the drawer so its mask does not block axe's DOM inspection or the theme toggle
    // (drawer auto-opens on the default wide E2E viewport; see TEST_PRACTICES.md §6.9)
    await closeDrawerIfOpen(page)

    // Ensure we are in light mode. If currently dark, switch to light.
    const switchToLightButton = page.getByRole('button', { name: 'Switch to light theme' })
    if (await switchToLightButton.isVisible()) {
      await switchToLightButton.click()
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

    // Switch to dark mode if not already active
    const switchToDarkButton = page.getByRole('button', { name: 'Switch to dark theme' })
    if (await switchToDarkButton.isVisible()) {
      await switchToDarkButton.click()
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
})
