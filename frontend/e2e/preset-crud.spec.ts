import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the sample preset CRUD lifecycle via the job launch dialog.
 *
 * User journey:
 *   1. Open the "Generate Samples" dialog from the header button.
 *   2. Click "Manage Presets" to open the preset editor modal.
 *   3. Create a new preset with a unique name and save it.
 *   4. Verify the new preset appears in the preset selector dropdown.
 *   5. Edit the preset (change a field) and save.
 *   6. Delete the preset and verify it is removed from the dropdown.
 *
 * Test fixture data:
 *   - Training run: "test-run/my-model" (required to show the "Generate Samples" button)
 *
 * Note: On wide screens (>= 1024px) the sidebar drawer opens automatically.
 * Its mask intercepts pointer events on the rest of the page, so we close the
 * drawer before interacting with the header buttons.
 *
 * Naive UI NModal with preset="card" renders an NCard with:
 *   - class "n-modal"
 *   - role="dialog"
 *   - aria-modal="true"
 * The selector used here is `[role="dialog"][aria-modal="true"]` filtered by
 * title text.
 */

/**
 * Selects a training run from the sidebar NSelect dropdown.
 */
async function selectTrainingRun(page: Page, runName: string): Promise<void> {
  const selectTrigger = page.locator('.training-run-selector .n-select')
  await expect(selectTrigger).toBeVisible()
  await selectTrigger.click()
  const popupMenu = page.locator('.n-base-select-menu:visible')
  await expect(popupMenu).toBeVisible()
  await popupMenu.getByText(runName, { exact: true }).click()
  await expect(popupMenu).not.toBeVisible()
}

/**
 * Closes the sidebar drawer if it is open.
 * On wide screens the drawer opens automatically and its mask blocks header buttons.
 */
async function closeDrawer(page: Page): Promise<void> {
  const drawerCloseButton = page.locator('.n-drawer-header__close')
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    await expect(page.locator('.n-drawer-mask')).not.toBeVisible()
  }
}

/**
 * Adds a value as a tag in a Naive UI NSelect with tag+filterable mode.
 * Types the value into the filter input and presses Enter to create the tag.
 */
async function addTagToNaiveSelect(page: Page, selectTestId: string, value: string): Promise<void> {
  const select = page.locator(`[data-testid="${selectTestId}"]`)
  await select.click()
  const input = select.locator('input')
  await input.fill(value)
  await input.press('Enter')
  // Wait for the tag to appear in the select
  await expect(select).toContainText(value)
}

/**
 * Fills in the preset name field in the SamplePresetEditor.
 */
async function fillPresetName(page: Page, name: string): Promise<void> {
  const nameInput = page.locator('[data-testid="preset-name-input"] input')
  await nameInput.fill(name)
}

/**
 * Adds a value as a tag in a Naive UI NDynamicTags component.
 * Clicks the "+" Add button to reveal the inline input, types the value, then presses Enter.
 */
async function addTagToNDynamicTags(page: Page, tagsTestId: string, value: string): Promise<void> {
  const container = page.locator(`[data-testid="${tagsTestId}"]`)
  // Click the "+" add button to reveal the inline input
  const addButton = container.locator('.n-dynamic-tags__add')
  await addButton.click()
  // Type the value into the revealed input
  const input = container.locator('input')
  await input.fill(value)
  await input.press('Enter')
  // Wait for the tag to appear
  await expect(container).toContainText(value)
}

/**
 * Fills in the first prompt row (name and text) in the NDynamicInput.
 * The NDynamicInput renders prompt rows with two inputs: name and text.
 */
async function fillFirstPromptRow(page: Page, promptName: string, promptText: string): Promise<void> {
  const promptRows = page.locator('.prompt-row')
  const firstRow = promptRows.first()
  await expect(firstRow).toBeVisible()

  const inputs = firstRow.locator('input')
  // First input: prompt name, second: prompt text
  await inputs.nth(0).fill(promptName)
  await inputs.nth(1).fill(promptText)
}

/**
 * Adds a sampler/scheduler pair via the NDynamicInput for pairs.
 * Clicks the "Add" button to create a new pair row, then fills in the
 * sampler and scheduler NSelect inputs using tag mode.
 *
 * When the pairs list is empty (min=0), Naive UI renders a dashed "create"
 * button instead of per-row action buttons. This helper handles both cases.
 */
async function addSamplerSchedulerPair(page: Page, sampler: string, scheduler: string): Promise<void> {
  const pairsContainer = page.locator('[data-testid="sampler-scheduler-pairs"]')
  await expect(pairsContainer).toBeVisible()

  // Determine which add button to click:
  // - Empty list: Naive UI renders a dashed button (n-button--dashed) as the "create first item" action
  // - Non-empty list: each row has action buttons (.n-dynamic-input-item__action button)
  const perRowAddButton = pairsContainer.locator('.n-dynamic-input-item__action button').last()
  const emptyStateButton = pairsContainer.locator('button.n-button--dashed')

  if (await perRowAddButton.isVisible().catch(() => false)) {
    await perRowAddButton.click()
  } else {
    await emptyStateButton.click()
  }

  // Find the last pair-row (the one just added)
  const pairRows = pairsContainer.locator('.pair-row')
  const lastRow = pairRows.last()
  await expect(lastRow).toBeVisible()

  // Fill in the sampler select (first NSelect in the row)
  const samplerSelect = lastRow.locator('.pair-select').first()
  await samplerSelect.click()
  const samplerInput = samplerSelect.locator('input')
  await samplerInput.fill(sampler)
  await samplerInput.press('Enter')
  await expect(samplerSelect).toContainText(sampler)

  // Fill in the scheduler select (second NSelect in the row)
  const schedulerSelect = lastRow.locator('.pair-select').last()
  await schedulerSelect.click()
  const schedulerInput = schedulerSelect.locator('input')
  await schedulerInput.fill(scheduler)
  await schedulerInput.press('Enter')
  await expect(schedulerSelect).toContainText(scheduler)
}

/**
 * Returns the Generate Samples dialog locator.
 * Naive UI NModal preset="card" renders an NCard with role="dialog" and aria-modal="true".
 */
function getGenerateSamplesDialog(page: Page) {
  return page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Generate Samples' })
}

/**
 * Returns the Manage Sample Presets dialog locator.
 */
function getManagePresetsDialog(page: Page) {
  return page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Manage Sample Presets' })
}

/**
 * Opens the Generate Samples dialog from the header button.
 * Closes the sidebar drawer first to unblock the header controls.
 * Requires a training run to already be selected.
 */
async function openGenerateSamplesDialog(page: Page): Promise<void> {
  // Close the drawer so its mask doesn't intercept clicks on header buttons
  await closeDrawer(page)

  const generateButton = page.locator('[data-testid="generate-samples-button"]')
  await expect(generateButton).toBeVisible()
  await generateButton.click()

  // Wait for the Generate Samples dialog to appear
  await expect(getGenerateSamplesDialog(page)).toBeVisible()
}

/**
 * Opens the Manage Presets editor from within the Generate Samples dialog.
 */
async function openManagePresetsEditor(page: Page): Promise<void> {
  const managePresetsButton = page.locator('[data-testid="manage-presets-button"]')
  await expect(managePresetsButton).toBeVisible()
  await managePresetsButton.click()

  // Wait for the Manage Sample Presets dialog to appear
  await expect(getManagePresetsDialog(page)).toBeVisible()
}

/**
 * Closes the Manage Presets modal by clicking its close button.
 * Naive UI NCard (preset="card") renders a close button in the card header.
 */
async function closeManagePresetsModal(page: Page): Promise<void> {
  const managePresetsDialog = getManagePresetsDialog(page)
  // The close button in a Naive UI NCard header has class n-card-header__close
  const closeButton = managePresetsDialog.locator('.n-card-header__close').first()
  await expect(closeButton).toBeVisible()
  await closeButton.click()
  await expect(managePresetsDialog).not.toBeVisible()
}

test.describe('sample preset CRUD via job launch dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Select the fixture training run so the "Generate Samples" button appears
    await selectTrainingRun(page, 'test-run/my-model')
    // Wait for scan to complete (Dimensions panel appears in the drawer)
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test('opens the Generate Samples dialog', async ({ page }) => {
    await openGenerateSamplesDialog(page)

    // The Generate Samples dialog should be visible
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // The preset select dropdown should be present
    await expect(page.locator('[data-testid="preset-select"]')).toBeVisible()

    // The "Manage Presets" button should be visible
    await expect(page.locator('[data-testid="manage-presets-button"]')).toBeVisible()
  })

  test('opens the preset editor by clicking Manage Presets', async ({ page }) => {
    await openGenerateSamplesDialog(page)
    await openManagePresetsEditor(page)

    // The Manage Sample Presets dialog should be visible
    const editorDialog = getManagePresetsDialog(page)
    await expect(editorDialog).toBeVisible()

    // The preset name input should be present inside the editor
    await expect(page.locator('[data-testid="preset-name-input"]')).toBeVisible()

    // The save button should be present
    await expect(page.locator('[data-testid="save-preset-button"]')).toBeVisible()
  })

  test('creates a new preset and verifies it appears in the preset selector', async ({ page }) => {
    const uniquePresetName = `E2E Test Preset ${Date.now()}`

    await openGenerateSamplesDialog(page)
    await openManagePresetsEditor(page)

    // Click "New Preset" to ensure the form is in create mode
    const newPresetButton = page.locator('[data-testid="new-preset-button"]')
    await expect(newPresetButton).toBeVisible()
    await newPresetButton.click()

    // Fill in the preset name
    await fillPresetName(page, uniquePresetName)

    // Fill in the first prompt row (required for saving)
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')

    // Steps, CFGs, and seeds default to [30], [7.0], [42] respectively via NDynamicTags.
    // The defaults are sufficient; no additional tags need to be added.

    // Add a sampler/scheduler pair (ComfyUI may not be available; tag mode allows custom values)
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // The Save Preset button should now be enabled
    const saveButton = page.locator('[data-testid="save-preset-button"]')
    await expect(saveButton).not.toBeDisabled()

    // Save the preset
    await saveButton.click()

    // After saving, the button label switches to "Update Preset"
    await expect(saveButton).toContainText('Update Preset')

    // The preset editor's preset selector should now display the new preset name
    const editorPresetSelect = page.locator('[data-testid="preset-editor-select"]')
    await expect(editorPresetSelect).toContainText(uniquePresetName)

    // Close the Manage Presets modal
    await closeManagePresetsModal(page)

    // Back in the Generate Samples dialog, open the preset dropdown
    const jobDialogPresetSelect = page.locator('[data-testid="preset-select"]')
    await jobDialogPresetSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    // The new preset should appear in the dropdown
    await expect(popupMenu.getByText(uniquePresetName, { exact: true })).toBeVisible()
    // Close the popup
    await page.keyboard.press('Escape')
  })

  test('edits an existing preset and saves the update', async ({ page }) => {
    const uniquePresetName = `E2E Edit Test ${Date.now()}`
    const updatedName = `${uniquePresetName} Updated`

    await openGenerateSamplesDialog(page)
    await openManagePresetsEditor(page)

    // Create a preset first
    await page.locator('[data-testid="new-preset-button"]').click()
    await fillPresetName(page, uniquePresetName)
    await fillFirstPromptRow(page, 'portrait', 'a dramatic portrait')
    // Steps, CFGs, and seeds default to [30], [7.0], [42] via NDynamicTags; use defaults.
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    const saveButton = page.locator('[data-testid="save-preset-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    // After initial save, button shows "Update Preset"
    await expect(saveButton).toContainText('Update Preset')

    // Edit the preset name
    const nameInput = page.locator('[data-testid="preset-name-input"] input')
    await nameInput.fill(updatedName)

    // Save the update
    await saveButton.click()
    await expect(saveButton).toContainText('Update Preset')

    // Verify the updated name appears in the preset editor selector
    const editorPresetSelect = page.locator('[data-testid="preset-editor-select"]')
    await expect(editorPresetSelect).toContainText(updatedName)

    // Clean up: accept the delete confirmation and delete the preset
    page.on('dialog', (dialog) => dialog.accept())
    await page.locator('[data-testid="delete-preset-button"]').click()

    // After deletion the preset is removed from the editor selector
    await expect(editorPresetSelect).not.toContainText(updatedName)
  })

  test('deletes a preset and verifies it is removed from the dropdown', async ({ page }) => {
    const uniquePresetName = `E2E Delete Test ${Date.now()}`

    await openGenerateSamplesDialog(page)
    await openManagePresetsEditor(page)

    // Create a preset to delete
    await page.locator('[data-testid="new-preset-button"]').click()
    await fillPresetName(page, uniquePresetName)
    await fillFirstPromptRow(page, 'abstract', 'abstract art')
    // Steps, CFGs, and seeds default to [30], [7.0], [42] via NDynamicTags; use defaults.
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    const saveButton = page.locator('[data-testid="save-preset-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(saveButton).toContainText('Update Preset')

    // Verify preset exists in editor selector before deletion
    const editorPresetSelect = page.locator('[data-testid="preset-editor-select"]')
    await expect(editorPresetSelect).toContainText(uniquePresetName)

    // Register handler to accept the window.confirm dialog that deletePreset() triggers
    page.on('dialog', (dialog) => dialog.accept())

    // Click Delete Preset
    const deleteButton = page.locator('[data-testid="delete-preset-button"]')
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    // After deletion: no preset is selected, so the delete button disappears
    await expect(deleteButton).not.toBeVisible()

    // The deleted preset should no longer appear in the editor selector
    await expect(editorPresetSelect).not.toContainText(uniquePresetName)

    // Close the Manage Presets modal
    await closeManagePresetsModal(page)

    // Back in the Generate Samples dialog, open the preset dropdown
    const jobDialogPresetSelect = page.locator('[data-testid="preset-select"]')
    await jobDialogPresetSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    // The deleted preset should NOT appear in the dropdown
    await expect(popupMenu.getByText(uniquePresetName, { exact: true })).not.toBeVisible()
    // Close the popup
    await page.keyboard.press('Escape')
  })
})
