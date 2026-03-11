import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel } from './helpers'

/**
 * E2E tests for the sidebar PresetSelector component (B-031).
 *
 * Story B-031: Dimension preset selector missing New/Save/Delete workflow
 *
 * The PresetSelector lives in the sidebar drawer and allows users to:
 *   - Select a dimension preset from a dropdown
 *   - Click "New" to clear the current selection and reset assignments
 *   - Save the current dimension assignments as a new preset
 *   - Delete a selected preset
 *
 * Acceptance criteria verified:
 *   - AC: New button is always visible in PresetSelector
 *   - AC: Clicking New clears the current preset selection and resets dimension assignments
 *   - AC: Save and Delete buttons appear below the preset selector dropdown
 *   - AC: Save button is disabled until the user has modified at least one field (dirty tracking)
 *   - AC: Save button enables when dimension assignments are touched
 *   - AC: Existing preset load/delete behavior is preserved
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Dimensions: cfg (single-value, disabled), checkpoint (multi-value),
 *     prompt_name (multi-value), seed (single-value, disabled)
 *   - S-080: single-value dimensions have their role select disabled,
 *     so tests must use multi-value dimensions (checkpoint, prompt_name)
 */

/**
 * Assigns a dimension role in the DimensionPanel.
 * The DimensionPanel renders NSelect components with aria-label="Mode for <dim>".
 */
async function assignDimensionRole(page: Page, dimensionName: string, role: string): Promise<void> {
  await selectNaiveOptionByLabel(page, `Mode for ${dimensionName}`, role)
}

/**
 * Saves a preset via the NModal input dialog.
 * Clicks the Save button to open the dialog, types the preset name, and confirms.
 *
 * AC: S-121: Save preset flow uses an NModal input dialog instead of window.prompt
 */
async function savePresetViaDialog(page: Page, presetName: string): Promise<void> {
  const saveButton = page.locator('[aria-label="Save preset"]')
  await expect(saveButton).toBeEnabled()
  await saveButton.click()

  // Wait for the save dialog to appear
  const saveDialog = page.locator('[data-testid="preset-save-dialog"]')
  await expect(saveDialog).toBeVisible()

  // Fill in the preset name
  const nameInput = saveDialog.locator('[data-testid="preset-save-dialog-input"] input')
  await expect(nameInput).toBeVisible()
  await nameInput.fill(presetName)

  // Confirm save
  const confirmButton = saveDialog.locator('[data-testid="preset-save-dialog-confirm"]')
  await expect(confirmButton).toBeEnabled()
  await confirmButton.click()

  // Dialog should close
  await expect(saveDialog).not.toBeVisible()
}

test.describe('sidebar PresetSelector New/Save/Delete workflow', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/')
    // Select the fixture training run so the PresetSelector appears in the drawer
    await selectTrainingRun(page, 'my-model')
    // Wait for scan to complete (Dimensions panel appears in the drawer)
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  // AC: A 'New' button is always visible in PresetSelector
  test('New button is always visible in the sidebar preset section', async ({ page }) => {
    // The Preset section should be visible in the drawer
    await expect(page.getByText('Preset', { exact: true })).toBeVisible()

    // The New button should be visible even when no presets exist
    const newButton = page.locator('[aria-label="New preset"]')
    await expect(newButton).toBeVisible()
  })

  // AC: Save and Delete buttons appear below the preset selector dropdown
  test('Save button is visible below the dropdown', async ({ page }) => {
    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeVisible()
  })

  // AC: Save button is disabled until the user has modified at least one field (dirty tracking)
  test('Save button is disabled initially (not dirty)', async ({ page }) => {
    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeVisible()
    await expect(saveButton).toBeDisabled()
  })

  // AC: Clicking New clears the current preset selection and resets dimension assignments
  // AC: Save button enables when dimension assignments are touched (dirty tracking)
  test('clicking New then changing an assignment enables Save', async ({ page }) => {
    // Click New to establish a baseline snapshot
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()

    // Save should still be disabled (no changes yet after New)
    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeDisabled()

    // Assign a multi-value dimension to X axis (this modifies assignments, making it dirty)
    // Note: cfg and seed are single-value dimensions and have their role select disabled (S-080)
    await assignDimensionRole(page, 'checkpoint', 'X Axis')

    // Save should now be enabled (dirty)
    await expect(saveButton).toBeEnabled()
  })

  // AC: Save button creates a new preset via the NModal input dialog
  // AC: Existing preset load/delete behavior is preserved
  test('saves a new dimension preset and loads it back', async ({ page }) => {
    const presetName = `E2E Sidebar Preset ${Date.now()}`

    // Click New to establish baseline
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()

    // Assign multi-value dimensions to make it dirty (S-080: single-value dims are disabled)
    await assignDimensionRole(page, 'checkpoint', 'X Axis')
    await assignDimensionRole(page, 'prompt_name', 'Y Axis')

    // AC: S-121: Save via NModal dialog instead of window.prompt
    await savePresetViaDialog(page, presetName)

    // After saving, the Save button should be disabled again (snapshot updated)
    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeDisabled()

    // The newly created preset should now appear in the preset dropdown
    // Click New to clear the selection, then verify we can re-select the preset
    await newButton.click()

    // Open the preset dropdown and select the newly saved preset
    const presetSelect = page.locator('.preset-select')
    await presetSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await expect(popupMenu.getByText(presetName, { exact: true })).toBeVisible()
    await popupMenu.getByText(presetName, { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // After loading, the Delete button should appear
    const deleteButton = page.locator('[aria-label="Delete preset"]')
    await expect(deleteButton).toBeVisible()
  })

  // AC: Existing preset load/delete behavior is preserved
  // AC1: Delete button shows confirmation dialog; AC2: Confirming removes the preset; AC3: Selector resets
  test('deletes a selected preset via confirmation dialog', async ({ page }) => {
    const presetName = `E2E Delete Sidebar ${Date.now()}`

    // Create a preset first (use multi-value dimension; S-080 disables single-value role selects)
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    await assignDimensionRole(page, 'checkpoint', 'X Axis')

    // AC: S-121: Save via NModal dialog instead of window.prompt
    await savePresetViaDialog(page, presetName)

    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeDisabled()

    // Delete button should now be visible (preset is selected after save)
    const deleteButton = page.locator('[aria-label="Delete preset"]')
    await expect(deleteButton).toBeVisible()

    // AC1: Click Delete — should open the ConfirmDeleteDialog instead of deleting immediately
    await deleteButton.click()

    // AC1: Confirmation dialog should be visible
    // data-testid="preset-delete-dialog" is passed from PresetSelector to ConfirmDeleteDialog
    const confirmDialog = page.locator('[data-testid="preset-delete-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // AC2: Confirm the deletion
    await confirmDialog.locator('[data-testid="confirm-delete-button"]').click()
    await expect(confirmDialog).not.toBeVisible()

    // AC3: After deletion, the Delete button should disappear (no preset selected)
    await expect(deleteButton).not.toBeVisible()

    // AC2: The preset should be removed from the dropdown
    const presetSelect = page.locator('.preset-select')
    await presetSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    // The popup may not appear if there are no presets left; if it does, the deleted preset should not be in it
    if (await popupMenu.isVisible().catch(() => false)) {
      await expect(popupMenu.getByText(presetName, { exact: true })).not.toBeVisible()
      await page.keyboard.press('Escape')
    }
  })

  // AC (UAT rework B-031): Update button appears when an existing preset is loaded and assignments are modified
  test('Update button appears after modifying a loaded preset and updates it in-place', async ({ page }) => {
    const presetName = `E2E Update Preset ${Date.now()}`

    // Create a preset first (use multi-value dimension; S-080 disables single-value role selects)
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    await assignDimensionRole(page, 'checkpoint', 'X Axis')

    // AC: S-121: Save via NModal dialog instead of window.prompt
    await savePresetViaDialog(page, presetName)

    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeDisabled()

    // Update button should NOT be visible (assignments are clean after save)
    const updateButton = page.locator('[aria-label="Update preset"]')
    await expect(updateButton).not.toBeVisible()

    // Modify a dimension assignment to make dirty
    await assignDimensionRole(page, 'prompt_name', 'Y Axis')

    // Update button should now appear (preset selected + dirty)
    await expect(updateButton).toBeVisible()

    // Click Update
    await updateButton.click()

    // After update, the button should disappear (snapshot refreshed, no longer dirty)
    await expect(updateButton).not.toBeVisible()

    // Save button should also be disabled (clean state)
    await expect(saveButton).toBeDisabled()

    // Verify the preset was updated: click New to clear, then re-load the preset
    await newButton.click()
    const presetSelect = page.locator('.preset-select')
    await presetSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText(presetName, { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // The preset should still exist (it was updated, not duplicated)
    // Delete button should appear (preset is selected)
    const deleteButton = page.locator('[aria-label="Delete preset"]')
    await expect(deleteButton).toBeVisible()
  })

  // S-096 AC3: After deleting a preset, auto-selects the most recently used preset
  test('deleting a preset auto-selects the most recently used preset (S-096)', async ({ page }) => {
    const presetA = `E2E Preset A ${Date.now()}`
    const presetB = `E2E Preset B ${Date.now()}`

    const newButton = page.locator('[aria-label="New preset"]')
    const saveButton = page.locator('[aria-label="Save preset"]')
    const deleteButton = page.locator('[aria-label="Delete preset"]')
    const presetSelect = page.locator('.preset-select')

    // Create Preset A: assign checkpoint to X Axis
    // AC: S-121: Save via NModal dialog instead of window.prompt
    await newButton.click()
    await assignDimensionRole(page, 'checkpoint', 'X Axis')
    await savePresetViaDialog(page, presetA)
    await expect(saveButton).toBeDisabled()

    // Create Preset B: click New, assign prompt_name to Y Axis
    await newButton.click()
    await assignDimensionRole(page, 'prompt_name', 'Y Axis')
    await savePresetViaDialog(page, presetB)
    await expect(saveButton).toBeDisabled()

    // Now we have two presets. Preset B is currently selected (just saved).
    // Visit Preset A to build MRU history: A is now the most recently used.
    await presetSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText(presetA, { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Now visit Preset B again so B is current and A is MRU.
    await presetSelect.click()
    const popupMenu2 = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu2).toBeVisible()
    await popupMenu2.getByText(presetB, { exact: true }).click()
    await expect(popupMenu2).not.toBeVisible()

    // Preset B is selected. MRU order: [B, A]. Delete B.
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    const confirmDialog = page.locator('[data-testid="preset-delete-dialog"]')
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.locator('[data-testid="confirm-delete-button"]').click()
    await expect(confirmDialog).not.toBeVisible()

    // AC3 (S-096): After deleting B, Preset A should be auto-selected (MRU fallback)
    await expect(deleteButton).toBeVisible() // A is now selected, so delete button is visible

    // Verify the preset dropdown shows Preset A is selected (its text appears in the select)
    await expect(presetSelect).toContainText(presetA)

    // Verify Preset B is gone from the dropdown
    await presetSelect.click()
    const popupMenu3 = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu3).toBeVisible()
    await expect(popupMenu3.getByText(presetB, { exact: true })).not.toBeVisible()
    await page.keyboard.press('Escape')
  })

  // AC: Clicking New clears the current preset selection
  test('clicking New clears the current preset selection', async ({ page }) => {
    const presetName = `E2E Clear Selection ${Date.now()}`

    // Create and save a preset (use multi-value dimension; S-080 disables single-value role selects)
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    await assignDimensionRole(page, 'checkpoint', 'X Axis')

    // AC: S-121: Save via NModal dialog instead of window.prompt
    await savePresetViaDialog(page, presetName)

    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeDisabled()

    // Preset should be selected (Delete button is visible)
    const deleteButton = page.locator('[aria-label="Delete preset"]')
    await expect(deleteButton).toBeVisible()

    // Click New to clear the selection
    await newButton.click()

    // Delete button should disappear (no preset selected)
    await expect(deleteButton).not.toBeVisible()

    // Save should be disabled again (fresh baseline, no changes)
    await expect(saveButton).toBeDisabled()
  })

  // AC: S-121: FE: Save preset flow uses an NModal input dialog instead of window.prompt
  test('S-121: Save opens an NModal dialog with a text input', async ({ page }) => {
    // Click New then make dirty
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    await assignDimensionRole(page, 'checkpoint', 'X Axis')

    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeEnabled()

    // Click Save — should open NModal dialog, NOT a browser prompt
    await saveButton.click()

    // AC1: The NModal save dialog should be visible
    const saveDialog = page.locator('[data-testid="preset-save-dialog"]')
    await expect(saveDialog).toBeVisible()

    // Dialog should have an input and confirm/cancel buttons
    await expect(saveDialog.locator('[data-testid="preset-save-dialog-input"]')).toBeVisible()
    await expect(saveDialog.locator('[data-testid="preset-save-dialog-confirm"]')).toBeVisible()
    await expect(saveDialog.locator('[data-testid="preset-save-dialog-cancel"]')).toBeVisible()
  })

  // AC: S-121: FE: Cancel action works correctly
  test('S-121: Cancelling the save dialog does not create a preset', async ({ page }) => {
    // Make dirty
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    await assignDimensionRole(page, 'checkpoint', 'X Axis')

    const saveButton = page.locator('[aria-label="Save preset"]')
    await saveButton.click()

    const saveDialog = page.locator('[data-testid="preset-save-dialog"]')
    await expect(saveDialog).toBeVisible()

    // AC3: Cancel closes the dialog without saving
    const cancelButton = saveDialog.locator('[data-testid="preset-save-dialog-cancel"]')
    await cancelButton.click()

    // Dialog should be gone
    await expect(saveDialog).not.toBeVisible()

    // Save button should still be enabled (preset was not created)
    await expect(saveButton).toBeEnabled()
  })

  // Testing scenario: Empty name is rejected (confirm button disabled)
  test('S-121: Confirm button is disabled when preset name is empty', async ({ page }) => {
    // Make dirty
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    await assignDimensionRole(page, 'checkpoint', 'X Axis')

    const saveButton = page.locator('[aria-label="Save preset"]')
    await saveButton.click()

    const saveDialog = page.locator('[data-testid="preset-save-dialog"]')
    await expect(saveDialog).toBeVisible()

    // Confirm button should be disabled (input is empty)
    const confirmButton = saveDialog.locator('[data-testid="preset-save-dialog-confirm"]')
    await expect(confirmButton).toBeDisabled()

    // Cancel to clean up
    await saveDialog.locator('[data-testid="preset-save-dialog-cancel"]').click()
    await expect(saveDialog).not.toBeVisible()
  })
})
