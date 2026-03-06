import { test, expect } from '@playwright/test'
import { resetDatabase, closeDrawer, uninstallDemo } from './helpers'

/**
 * E2E tests for the demo dataset settings dialog (story S-078).
 *
 * Verifies:
 * - AC3: Demo dataset is visible and browsable out of the box
 * - AC4: Demo dataset is deletable from the UI
 * - AC5: Settings dialog allows re-adding the demo dataset after deletion
 * - AC6: Settings button is visible in the toolbar
 *
 * The demo dataset is auto-installed on first backend startup, so after
 * a database reset it should still be installed (the demo directory persists
 * in the volume, and the backend checks for the directory on disk).
 */

test.beforeEach(async ({ request }) => {
  await resetDatabase(request)
  // Ensure the demo dataset is installed before each test
  // (the database reset clears the preset but the demo directory persists;
  // re-install ensures a clean, consistent state)
  await request.post('/api/demo/install')
})

// Uninstall the demo dataset after each test to prevent filesystem artifacts
// (demo-study/ directory, demo images, demo preset) from leaking into
// subsequent spec files. The resetDatabase in the next spec's beforeEach
// cleans the DB, but the demo directory on disk persists unless explicitly removed.
test.afterEach(async ({ request }) => {
  await uninstallDemo(request)
})

test.describe('demo settings dialog (S-078)', () => {
  test('settings button is visible in the toolbar', async ({ page }) => {
    await page.goto('/')
    await closeDrawer(page)

    const settingsButton = page.locator('[data-testid="settings-button"]')
    await expect(settingsButton).toBeVisible()
  })

  test('settings dialog opens and shows demo status as installed', async ({ page }) => {
    await page.goto('/')
    await closeDrawer(page)

    const settingsButton = page.locator('[data-testid="settings-button"]')
    await settingsButton.click()

    // Wait for the settings dialog to appear
    const dialog = page.locator('[data-testid="settings-dialog"]')
    await expect(dialog).toBeVisible()

    // Demo section should show installed status
    const demoStatus = page.locator('[data-testid="demo-status"]')
    await expect(demoStatus).toContainText('Installed')

    // Delete button should be visible (since demo is installed)
    const deleteButton = page.locator('[data-testid="demo-delete-button"]')
    await expect(deleteButton).toBeVisible()
  })

  test('demo dataset is deletable from the settings dialog', async ({ page }) => {
    await page.goto('/')
    await closeDrawer(page)

    // Open settings
    await page.locator('[data-testid="settings-button"]').click()
    const dialog = page.locator('[data-testid="settings-dialog"]')
    await expect(dialog).toBeVisible()

    // Click Delete Demo
    const deleteButton = page.locator('[data-testid="demo-delete-button"]')
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    // Status should update to Not installed
    const demoStatus = page.locator('[data-testid="demo-status"]')
    await expect(demoStatus).toContainText('Not installed')

    // Restore button should now be visible
    const restoreButton = page.locator('[data-testid="demo-restore-button"]')
    await expect(restoreButton).toBeVisible()
  })

  test('demo dataset can be re-added from settings dialog after deletion', async ({ page }) => {
    await page.goto('/')
    await closeDrawer(page)

    // Open settings and delete demo first
    await page.locator('[data-testid="settings-button"]').click()
    const dialog = page.locator('[data-testid="settings-dialog"]')
    await expect(dialog).toBeVisible()

    await page.locator('[data-testid="demo-delete-button"]').click()
    await expect(page.locator('[data-testid="demo-status"]')).toContainText('Not installed')

    // Click Restore Demo
    const restoreButton = page.locator('[data-testid="demo-restore-button"]')
    await expect(restoreButton).toBeVisible()
    await restoreButton.click()

    // Status should update back to Installed
    await expect(page.locator('[data-testid="demo-status"]')).toContainText('Installed')

    // Delete button should reappear
    await expect(page.locator('[data-testid="demo-delete-button"]')).toBeVisible()
  })

  test('demo dataset is visible as a training run out of the box', async ({ page }) => {
    await page.goto('/')

    // The demo training run should appear in the training run selector
    // The demo creates a study named "demo-study" with checkpoint dirs,
    // which the viewer discovers as "demo-study/demo-model"
    const selectTrigger = page.locator('[data-testid="training-run-select"]')
    await expect(selectTrigger).toBeVisible()
    await selectTrigger.click()

    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()

    // Verify demo training run appears in the list
    const demoOption = popupMenu.getByText('demo-study/demo-model')
    await expect(demoOption).toBeVisible()

    // Close the popup
    await page.keyboard.press('Escape')
  })

  test('demo API endpoints respond correctly', async ({ request }) => {
    // GET /api/demo/status should return installed status
    const statusResponse = await request.get('/api/demo/status')
    expect(statusResponse.status()).toBe(200)
    const status = await statusResponse.json()
    expect(status.installed).toBe(true)

    // DELETE /api/demo should uninstall
    const deleteResponse = await request.delete('/api/demo')
    expect(deleteResponse.status()).toBe(200)
    const deleteResult = await deleteResponse.json()
    expect(deleteResult.installed).toBe(false)

    // GET /api/demo/status should now return not installed
    const statusAfterDelete = await request.get('/api/demo/status')
    expect(statusAfterDelete.status()).toBe(200)
    const statusResult = await statusAfterDelete.json()
    expect(statusResult.installed).toBe(false)

    // POST /api/demo/install should reinstall
    const installResponse = await request.post('/api/demo/install')
    expect(installResponse.status()).toBe(200)
    const installResult = await installResponse.json()
    expect(installResult.installed).toBe(true)
  })
})
