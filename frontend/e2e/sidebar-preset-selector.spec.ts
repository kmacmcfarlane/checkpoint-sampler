import { test, expect, type Page } from '@playwright/test'
import { resetDatabase } from './helpers'

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
 *   - Dimensions: cfg, checkpoint, prompt_name, seed
 */

/**
 * Selects a training run from the sidebar NSelect dropdown.
 */
async function selectTrainingRun(page: Page, runName: string): Promise<void> {
  const selectTrigger = page.locator('[data-testid="training-run-select"]')
  await expect(selectTrigger).toBeVisible()
  await selectTrigger.click()
  const popupMenu = page.locator('.n-base-select-menu:visible')
  await expect(popupMenu).toBeVisible()
  await popupMenu.getByText(runName, { exact: true }).click()
  await expect(popupMenu).not.toBeVisible()
}

/**
 * Opens a Naive UI NSelect dropdown identified by aria-label, waits for the
 * popup to appear, then clicks the option matching optionText.
 */
async function selectNaiveOption(page: Page, selectAriaLabel: string, optionText: string): Promise<void> {
  const select = page.locator(`[aria-label="${selectAriaLabel}"]`)
  await select.click()
  const popupMenu = page.locator('.n-base-select-menu:visible')
  await expect(popupMenu).toBeVisible()
  await popupMenu.getByText(optionText, { exact: true }).click()
  await expect(popupMenu).not.toBeVisible()
}

/**
 * Assigns a dimension role in the DimensionPanel.
 * The DimensionPanel renders NSelect components with aria-label="Role for <dim>".
 */
async function assignDimensionRole(page: Page, dimensionName: string, role: string): Promise<void> {
  await selectNaiveOption(page, `Role for ${dimensionName}`, role)
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

    // Assign a dimension to X axis (this modifies assignments, making it dirty)
    await assignDimensionRole(page, 'cfg', 'X Axis')

    // Save should now be enabled (dirty)
    await expect(saveButton).toBeEnabled()
  })

  // AC: Save button creates a new preset via the prompt dialog
  // AC: Existing preset load/delete behavior is preserved
  test('saves a new dimension preset and loads it back', async ({ page }) => {
    const presetName = `E2E Sidebar Preset ${Date.now()}`

    // Click New to establish baseline
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()

    // Assign dimensions to make it dirty
    await assignDimensionRole(page, 'cfg', 'X Axis')
    await assignDimensionRole(page, 'prompt_name', 'Y Axis')

    // Save should be enabled
    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeEnabled()

    // Register handler for the window.prompt dialog
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('prompt')
      await dialog.accept(presetName)
    })

    // Click Save
    await saveButton.click()

    // After saving, the Save button should be disabled again (snapshot updated)
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
  test('deletes a selected preset', async ({ page }) => {
    const presetName = `E2E Delete Sidebar ${Date.now()}`

    // Create a preset first
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    await assignDimensionRole(page, 'cfg', 'X Axis')

    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(presetName)
      }
    })

    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(saveButton).toBeDisabled()

    // Delete button should now be visible (preset is selected after save)
    const deleteButton = page.locator('[aria-label="Delete preset"]')
    await expect(deleteButton).toBeVisible()

    // Click Delete
    await deleteButton.click()

    // After deletion, the Delete button should disappear (no preset selected)
    await expect(deleteButton).not.toBeVisible()

    // The preset should be removed from the dropdown
    const presetSelect = page.locator('.preset-select')
    await presetSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    // The popup may not appear if there are no presets left; if it does, the deleted preset should not be in it
    if (await popupMenu.isVisible().catch(() => false)) {
      await expect(popupMenu.getByText(presetName, { exact: true })).not.toBeVisible()
      await page.keyboard.press('Escape')
    }
  })

  // AC: Clicking New clears the current preset selection
  test('clicking New clears the current preset selection', async ({ page }) => {
    const presetName = `E2E Clear Selection ${Date.now()}`

    // Create and save a preset
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()
    await assignDimensionRole(page, 'cfg', 'X Axis')

    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(presetName)
      }
    })

    const saveButton = page.locator('[aria-label="Save preset"]')
    await saveButton.click()
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
})
