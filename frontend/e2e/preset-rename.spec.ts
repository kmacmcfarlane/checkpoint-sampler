import { test, expect } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  savePresetViaDialog,
} from './helpers'

/**
 * E2E tests for the inline preset rename affordance (S-104).
 *
 * Story S-104: Rename preset inline
 *
 * The PresetSelector's Rename button opens a modal dialog pre-filled with the
 * current preset name. Confirming calls PUT /api/presets/{id} with the new
 * name and the existing mapping. The NSelect dropdown reflects the updated
 * name immediately without a page reload.
 *
 * Acceptance criteria:
 *   AC1: FE: Inline rename affordance on the preset name field
 *   AC2: FE: Renaming updates the preset without requiring Save-As
 *
 * Test fixture:
 *   - Training run: "my-model"
 *   - Uses a multi-value dimension (checkpoint) for dirty tracking
 */

test.describe('sidebar PresetSelector rename flow', () => {
  test.beforeEach(async ({ page, request }) => {
    // AC: Each E2E test is independent -- reset database before each test
    await resetDatabase(request)
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  // AC1: Rename button appears when a preset is selected
  test('Rename button is not visible when no preset is selected', async ({ page }) => {
    const renameButton = page.locator('[aria-label="Rename preset"]')
    await expect(renameButton).not.toBeVisible()
  })

  // AC1: Inline rename affordance on the preset name field — Rename button becomes visible after selecting a preset
  test('Rename button appears after a preset is created and selected', async ({ page }) => {
    const presetName = `E2E Rename Test ${Date.now()}`

    // Create a preset so we have something to rename
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    // Assign a multi-value dimension to make it dirty
    const checkpointSelect = page.locator('[aria-label="Mode for checkpoint"]')
    await checkpointSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('X Axis', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    await savePresetViaDialog(page, presetName)

    // AC1: After save, the preset is selected and the Rename button should be visible
    const renameButton = page.locator('[aria-label="Rename preset"]')
    await expect(renameButton).toBeVisible()
  })

  // AC1: Clicking Rename opens a dialog pre-filled with the current preset name
  test('clicking Rename opens a dialog pre-filled with the current preset name', async ({ page }) => {
    const presetName = `E2E Rename Dialog ${Date.now()}`

    // Create a preset
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    const checkpointSelect = page.locator('[aria-label="Mode for checkpoint"]')
    await checkpointSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('X Axis', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()
    await savePresetViaDialog(page, presetName)

    // AC1: Click Rename
    const renameButton = page.locator('[aria-label="Rename preset"]')
    await renameButton.click()

    // AC1: The rename dialog should be visible
    const renameDialog = page.locator('[data-testid="preset-rename-dialog"]')
    await expect(renameDialog).toBeVisible()

    // AC1: The input should be pre-filled with the current preset name
    const renameInput = renameDialog.locator('[data-testid="preset-rename-dialog-input"] input')
    await expect(renameInput).toHaveValue(presetName)

    // Dialog has confirm and cancel buttons
    await expect(renameDialog.locator('[data-testid="preset-rename-dialog-confirm"]')).toBeVisible()
    await expect(renameDialog.locator('[data-testid="preset-rename-dialog-cancel"]')).toBeVisible()

    // Cancel to clean up
    await renameDialog.locator('[data-testid="preset-rename-dialog-cancel"]').click()
    await expect(renameDialog).not.toBeVisible()
  })

  // AC2: Renaming updates the preset without requiring Save-As
  test('confirming rename updates preset name in the dropdown without Save-As', async ({ page }) => {
    const originalName = `E2E Rename Original ${Date.now()}`
    const newName = `${originalName} Renamed`

    // Create a preset
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    const checkpointSelect = page.locator('[aria-label="Mode for checkpoint"]')
    await checkpointSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('X Axis', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()
    await savePresetViaDialog(page, originalName)

    // Click Rename
    const renameButton = page.locator('[aria-label="Rename preset"]')
    await renameButton.click()

    const renameDialog = page.locator('[data-testid="preset-rename-dialog"]')
    await expect(renameDialog).toBeVisible()

    // AC2: Change the preset name
    const renameInput = renameDialog.locator('[data-testid="preset-rename-dialog-input"] input')
    await renameInput.clear()
    await renameInput.fill(newName)

    // AC2: Confirm rename — wait for the PUT /api/presets/{id} API call
    const confirmButton = renameDialog.locator('[data-testid="preset-rename-dialog-confirm"]')
    await expect(confirmButton).toBeEnabled()
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/presets/') &&
          resp.request().method() === 'PUT' &&
          resp.status() === 200,
      ),
      confirmButton.click(),
    ])

    // Dialog should close after rename
    await expect(renameDialog).not.toBeVisible()

    // AC2: The NSelect dropdown should show the new name (not a new preset)
    const presetSelect = page.locator('.preset-select')
    await expect(presetSelect).toContainText(newName)

    // AC2: Only one preset exists (Rename, not Save-As — no duplicate)
    await presetSelect.click()
    const presetPopup = page.locator('.n-base-select-menu:visible')
    await expect(presetPopup).toBeVisible()
    // The new name appears exactly once
    await expect(presetPopup.getByText(newName, { exact: true })).toHaveCount(1)
    // The original name (exact text) should not appear as its own option
    await expect(presetPopup.getByText(originalName, { exact: true })).not.toBeVisible()
    await page.keyboard.press('Escape')
  })

  // AC: Cancelling the rename dialog does not modify the preset
  test('cancelling rename dialog does not change the preset name', async ({ page }) => {
    const originalName = `E2E Rename Cancel ${Date.now()}`

    // Create a preset
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    const checkpointSelect = page.locator('[aria-label="Mode for checkpoint"]')
    await checkpointSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('X Axis', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()
    await savePresetViaDialog(page, originalName)

    // Click Rename, change the name, then cancel
    const renameButton = page.locator('[aria-label="Rename preset"]')
    await renameButton.click()

    const renameDialog = page.locator('[data-testid="preset-rename-dialog"]')
    await expect(renameDialog).toBeVisible()

    const renameInput = renameDialog.locator('[data-testid="preset-rename-dialog-input"] input')
    await renameInput.clear()
    await renameInput.fill('This should not be saved')

    // Cancel
    await renameDialog.locator('[data-testid="preset-rename-dialog-cancel"]').click()
    await expect(renameDialog).not.toBeVisible()

    // The dropdown should still show the original name
    const presetSelect = page.locator('.preset-select')
    await expect(presetSelect).toContainText(originalName)
    await expect(presetSelect).not.toContainText('This should not be saved')
  })

  // AC: Confirm button is disabled when the rename input is empty
  test('Rename confirm button is disabled when input is cleared', async ({ page }) => {
    const presetName = `E2E Rename Empty ${Date.now()}`

    // Create a preset
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    const checkpointSelect = page.locator('[aria-label="Mode for checkpoint"]')
    await checkpointSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('X Axis', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()
    await savePresetViaDialog(page, presetName)

    // Open rename dialog
    const renameButton = page.locator('[aria-label="Rename preset"]')
    await renameButton.click()

    const renameDialog = page.locator('[data-testid="preset-rename-dialog"]')
    await expect(renameDialog).toBeVisible()

    // Clear the input
    const renameInput = renameDialog.locator('[data-testid="preset-rename-dialog-input"] input')
    await renameInput.clear()

    // Confirm button should be disabled
    const confirmButton = renameDialog.locator('[data-testid="preset-rename-dialog-confirm"]')
    await expect(confirmButton).toBeDisabled()

    // Cancel to clean up
    await renameDialog.locator('[data-testid="preset-rename-dialog-cancel"]').click()
    await expect(renameDialog).not.toBeVisible()
  })
})
