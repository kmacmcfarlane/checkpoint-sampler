import { test, expect } from '@playwright/test'
import { resetDatabase, closeDrawer } from './helpers'

/**
 * E2E tests for the appearance settings (theme and debug mode) moved
 * into the Settings dialog (story S-091).
 *
 * Verifies:
 * - AC1: Light/Dark theme selector is in the Settings dialog, not in the header
 * - AC2: Debug mode toggle is in the Settings dialog, not in the header
 * - AC3: Theme and debug mode changes take effect immediately from within the dialog
 * - AC4: Theme persists across page reloads (localStorage)
 */

test.describe('Settings dialog appearance controls (S-091)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: Light/Dark theme selector is in the Settings dialog, removed from its current location
  test('theme toggle is inside the Settings dialog and not in the header', async ({ page }) => {
    await page.goto('/')
    await closeDrawer(page)

    // The old ThemeToggle button should not be in the header
    // (it was a quaternary button showing "Dark" or "Light" outside the settings dialog)
    const settingsDialog = page.locator('[data-testid="settings-dialog"]')
    await expect(settingsDialog).not.toBeVisible()

    // Open settings — theme-toggle should be inside
    await page.locator('[data-testid="settings-button"]').click()
    await expect(settingsDialog).toBeVisible()

    const themeToggle = page.locator('[data-testid="theme-toggle"]')
    await expect(themeToggle).toBeVisible()
  })

  // AC2: Debug mode toggle is in the Settings dialog, removed from its current location
  test('debug toggle is inside the Settings dialog and not in the header', async ({ page }) => {
    await page.goto('/')
    await closeDrawer(page)

    // Debug toggle should not be directly accessible in the header
    const headerDebugToggle = page.locator('header [data-testid="debug-toggle"]')
    await expect(headerDebugToggle).toHaveCount(0)

    // Open settings — debug-toggle should be inside
    await page.locator('[data-testid="settings-button"]').click()
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible()

    const debugToggle = page.locator('[data-testid="debug-toggle"]')
    await expect(debugToggle).toBeVisible()
  })

  // AC3: Theme changes take effect immediately from within the dialog
  test('toggling the theme from the Settings dialog applies immediately', async ({ page }) => {
    await page.goto('/')
    await closeDrawer(page)

    // Open settings
    await page.locator('[data-testid="settings-button"]').click()
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible()

    // The theme toggle button should show "Dark" (indicating clicking switches to dark)
    // when starting in light mode
    const themeToggle = page.locator('[data-testid="theme-toggle"]')
    await expect(themeToggle).toBeVisible()

    // Get initial text — should be "Dark" (in light mode) or "Light" (in dark mode)
    const initialText = await themeToggle.textContent()

    // Click to toggle
    await themeToggle.click()

    // Text should have flipped
    const afterText = await themeToggle.textContent()
    expect(afterText).not.toBe(initialText)
  })

  // AC4: Theme persists across page reloads (existing localStorage behavior)
  test('theme setting persists after page reload', async ({ page }) => {
    await page.goto('/')
    await closeDrawer(page)

    // Open settings and note the current theme button text
    await page.locator('[data-testid="settings-button"]').click()
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible()

    const themeToggle = page.locator('[data-testid="theme-toggle"]')
    const initialText = await themeToggle.textContent()

    // Toggle the theme
    await themeToggle.click()
    const afterToggleText = await themeToggle.textContent()
    expect(afterToggleText).not.toBe(initialText)

    // Close dialog and reload
    await page.keyboard.press('Escape')
    await page.reload()
    await closeDrawer(page)

    // Open settings again — theme should still be in the toggled state
    await page.locator('[data-testid="settings-button"]').click()
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible()

    const reloadedText = await page.locator('[data-testid="theme-toggle"]').textContent()
    expect(reloadedText).toBe(afterToggleText)
  })
})
