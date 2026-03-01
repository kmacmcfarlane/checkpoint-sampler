import { test, expect, type Page } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for the study CRUD lifecycle via the job launch dialog.
 * (Renamed from "sample preset" to "study" per S-074.)
 *
 * User journey:
 *   1. Open the "Generate Samples" dialog from the header button.
 *   2. Click "Manage Studies" to open the study editor modal.
 *   3. Create a new study with a unique name and save it.
 *   4. Verify the new study appears in the study selector dropdown.
 *   5. Edit the study (change a field) and save.
 *   6. Delete the study and verify it is removed from the dropdown.
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
  const selectTrigger = page.locator('[data-testid="training-run-select"]')
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
 * The close button has aria-label="close" (set by Naive UI's NBaseClose).
 */
async function closeDrawer(page: Page): Promise<void> {
  const drawerCloseButton = page.locator('[aria-label="close"]').first()
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    // Wait for the drawer to close (close button disappears)
    await expect(drawerCloseButton).not.toBeVisible()
    await page.waitForTimeout(300)
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
 * Fills in the study name field in the StudyEditor.
 */
async function fillStudyName(page: Page, name: string): Promise<void> {
  const nameInput = page.locator('[data-testid="study-name-input"] input')
  await nameInput.fill(name)
}

/**
 * Adds a value as a tag in a Naive UI NDynamicTags component.
 * Clicks the custom "+" add button (data-testid="{tagsTestId}-add") to reveal
 * the inline input, types the value, then presses Enter.
 */
async function addTagToNDynamicTags(page: Page, tagsTestId: string, value: string): Promise<void> {
  const container = page.locator(`[data-testid="${tagsTestId}"]`)
  // Click the custom add button rendered by the trigger slot
  const addButton = page.locator(`[data-testid="${tagsTestId}-add"]`)
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
 * Clicks the "+" button to create a new pair row, then fills in the
 * sampler and scheduler NSelect inputs using tag mode.
 *
 * When the pairs list is empty (min=0), NDynamicInput renders a dashed "create"
 * button (data-testid="pairs-create-button"). When the list is non-empty, each row
 * renders a per-row add button (data-testid="pair-row-add-{index}").
 * Both are rendered via data-testid for test stability.
 */
async function addSamplerSchedulerPair(page: Page, sampler: string, scheduler: string): Promise<void> {
  const pairsContainer = page.locator('[data-testid="sampler-scheduler-pairs"]')
  await expect(pairsContainer).toBeVisible()

  // Determine which add button to click:
  // - Empty list: "pairs-create-button" (dashed create button rendered by NDynamicInput)
  // - Non-empty list: "pair-row-add-{last-index}" (per-row action button)
  const perRowAddButtons = page.locator('[data-testid^="pair-row-add-"]')
  const emptyStateButton = page.locator('[data-testid="pairs-create-button"]')

  if (await perRowAddButtons.last().isVisible().catch(() => false)) {
    await perRowAddButtons.last().click()
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
 * Returns the Manage Studies dialog locator.
 * Uses the study-editor-select data-testid as a unique child to distinguish
 * from the outer Generate Samples dialog (which also contains the text
 * "Manage Studies" in its button label).
 */
function getManageStudiesDialog(page: Page) {
  return page.locator('[role="dialog"][aria-modal="true"]').filter({
    has: page.locator('[data-testid="study-editor-select"]'),
  })
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
 * Opens the Manage Studies editor from within the Generate Samples dialog.
 */
async function openManageStudiesEditor(page: Page): Promise<void> {
  const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
  await expect(manageStudiesButton).toBeVisible()
  await manageStudiesButton.click()

  // Wait for the Manage Studies dialog to appear
  await expect(getManageStudiesDialog(page)).toBeVisible()
}

/**
 * Closes the Manage Studies modal by clicking its close button.
 * Naive UI NCard (preset="card") renders a close button in the card header
 * with aria-label="close" (set by NBaseClose).
 */
async function closeManageStudiesModal(page: Page): Promise<void> {
  const manageStudiesDialog = getManageStudiesDialog(page)
  // The close button has aria-label="close" (set by Naive UI's NBaseClose)
  const closeButton = manageStudiesDialog.locator('[aria-label="close"]').first()
  await expect(closeButton).toBeVisible()
  await closeButton.click()
  await expect(manageStudiesDialog).not.toBeVisible()
}

// AC 7: FE: All UI labels, component names, and variable names updated from 'sample preset' to 'study'
// AC 8: FE: Study selector appears at the top of the Generate Samples dialog
// AC 12: FE: SamplePresetEditor renamed to StudyEditor (or equivalent) with all references updated
test.describe('study CRUD via job launch dialog', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/')
    // Select the fixture training run so the "Generate Samples" button appears
    await selectTrainingRun(page, 'test-run/my-model')
    // Wait for scan to complete (Dimensions panel appears in the drawer)
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test('opens the Generate Samples dialog', async ({ page }) => {
    // AC 8: Study selector appears at the top of the Generate Samples dialog
    await openGenerateSamplesDialog(page)

    // The Generate Samples dialog should be visible
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // The study select dropdown should be present
    await expect(page.locator('[data-testid="study-select"]')).toBeVisible()

    // The "Manage Studies" button should be visible
    await expect(page.locator('[data-testid="manage-studies-button"]')).toBeVisible()
  })

  test('opens the study editor by clicking Manage Studies', async ({ page }) => {
    // AC 12: SamplePresetEditor renamed to StudyEditor
    await openGenerateSamplesDialog(page)
    await openManageStudiesEditor(page)

    // The Manage Studies dialog should be visible
    const editorDialog = getManageStudiesDialog(page)
    await expect(editorDialog).toBeVisible()

    // The study name input should be present inside the editor
    await expect(page.locator('[data-testid="study-name-input"]')).toBeVisible()

    // The save button should be present
    await expect(page.locator('[data-testid="save-study-button"]')).toBeVisible()
  })

  test('creates a new study and verifies it appears in the study selector', async ({ page }) => {
    // AC: After saving, the Manage Studies modal auto-closes and returns focus
    // to the job launch dialog.
    // AC: The newly saved study is auto-selected in the job dialog dropdown.
    const uniqueStudyName = `E2E Test Study ${Date.now()}`

    await openGenerateSamplesDialog(page)
    await openManageStudiesEditor(page)

    // Click "New Study" to ensure the form is in create mode
    const newStudyButton = page.locator('[data-testid="new-study-button"]')
    await expect(newStudyButton).toBeVisible()
    await newStudyButton.click()

    // Fill in the study name
    await fillStudyName(page, uniqueStudyName)

    // Fill in the first prompt row (required for saving)
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')

    // Steps, CFGs, and seeds default to [30], [7.0], [42] respectively via NDynamicTags.
    // The defaults are sufficient; no additional tags need to be added.

    // Add a sampler/scheduler pair (ComfyUI may not be available; tag mode allows custom values)
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // The Save Study button should now be enabled
    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()

    // Save the study
    await saveButton.click()

    // The Manage Studies modal should auto-close after saving
    const manageStudiesDialog = getManageStudiesDialog(page)
    await expect(manageStudiesDialog).not.toBeVisible()

    // Back in the Generate Samples dialog, the newly saved study should be
    // auto-selected in the job dialog dropdown
    const jobDialogStudySelect = page.locator('[data-testid="study-select"]')
    await expect(jobDialogStudySelect).toContainText(uniqueStudyName)
  })

  test('edits an existing study and saves the update', async ({ page }) => {
    // After each save, the Manage Studies modal auto-closes.
    // To edit after creating, we must re-open the modal.
    const uniqueStudyName = `E2E Edit Test ${Date.now()}`
    const updatedName = `${uniqueStudyName} Updated`

    await openGenerateSamplesDialog(page)
    await openManageStudiesEditor(page)

    // Create a study first
    await page.locator('[data-testid="new-study-button"]').click()
    await fillStudyName(page, uniqueStudyName)
    await fillFirstPromptRow(page, 'portrait', 'a dramatic portrait')
    // Steps, CFGs, and seeds default to [30], [7.0], [42] via NDynamicTags; use defaults.
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()

    // Modal auto-closes after save
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // Re-open the Manage Studies modal to edit the study
    await openManageStudiesEditor(page)

    // The previously saved study should be loaded (it was auto-selected in
    // the job dialog, and the editor receives it as initialStudyId).
    // Select it in the editor if not already selected.
    const editorStudySelect = page.locator('[data-testid="study-editor-select"]')
    await editorStudySelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText(uniqueStudyName, { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Edit the study name
    const nameInput = page.locator('[data-testid="study-name-input"] input')
    await nameInput.fill(updatedName)

    // Save the update
    const updateButton = page.locator('[data-testid="save-study-button"]')
    await expect(updateButton).toContainText('Update Study')
    await updateButton.click()

    // Modal auto-closes again after update
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // The updated study should be auto-selected in the job dialog dropdown
    const jobDialogStudySelect = page.locator('[data-testid="study-select"]')
    await expect(jobDialogStudySelect).toContainText(updatedName)

    // Clean up: re-open the editor and delete the study
    await openManageStudiesEditor(page)
    await editorStudySelect.click()
    const cleanupMenu = page.locator('.n-base-select-menu:visible')
    await expect(cleanupMenu).toBeVisible()
    await cleanupMenu.getByText(updatedName, { exact: true }).click()
    await expect(cleanupMenu).not.toBeVisible()

    page.on('dialog', (dialog) => dialog.accept())
    await page.locator('[data-testid="delete-study-button"]').click()

    // After deletion the study is removed from the editor selector
    await expect(editorStudySelect).not.toContainText(updatedName)
  })

  test('deletes a study and verifies it is removed from the dropdown', async ({ page }) => {
    // After save, the modal auto-closes. We re-open it to delete the study.
    const uniqueStudyName = `E2E Delete Test ${Date.now()}`

    await openGenerateSamplesDialog(page)
    await openManageStudiesEditor(page)

    // Create a study to delete
    await page.locator('[data-testid="new-study-button"]').click()
    await fillStudyName(page, uniqueStudyName)
    await fillFirstPromptRow(page, 'abstract', 'abstract art')
    // Steps, CFGs, and seeds default to [30], [7.0], [42] via NDynamicTags; use defaults.
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()

    // Modal auto-closes after save
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // Re-open the Manage Studies modal to delete the study
    await openManageStudiesEditor(page)

    // Select the study we just created in the editor
    const editorStudySelect = page.locator('[data-testid="study-editor-select"]')
    await editorStudySelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText(uniqueStudyName, { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Verify study exists in editor selector before deletion
    await expect(editorStudySelect).toContainText(uniqueStudyName)

    // Register handler to accept the window.confirm dialog that deleteStudy() triggers
    page.on('dialog', (dialog) => dialog.accept())

    // Click Delete Study
    const deleteButton = page.locator('[data-testid="delete-study-button"]')
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    // After deletion: no study is selected, so the delete button disappears
    await expect(deleteButton).not.toBeVisible()

    // The deleted study should no longer appear in the editor selector
    await expect(editorStudySelect).not.toContainText(uniqueStudyName)

    // Close the Manage Studies modal
    await closeManageStudiesModal(page)

    // Back in the Generate Samples dialog, open the study dropdown
    const jobDialogStudySelect = page.locator('[data-testid="study-select"]')
    await jobDialogStudySelect.click()
    const studyPopup = page.locator('.n-base-select-menu:visible')
    await expect(studyPopup).toBeVisible()
    // The deleted study should NOT appear in the dropdown
    await expect(studyPopup.getByText(uniqueStudyName, { exact: true })).not.toBeVisible()
    // Close the popup
    await page.keyboard.press('Escape')
  })

  test('creates a study with prompt prefix and verifies it round-trips', async ({ page }) => {
    // AC: StudyEditor has a 'Prompt Prefix' text input field above the prompts list
    // AC: Prompt prefix is saved/loaded with the study
    const uniqueStudyName = `E2E Prefix Test ${Date.now()}`
    const promptPrefixValue = 'photo of a person, '

    await openGenerateSamplesDialog(page)
    await openManageStudiesEditor(page)

    // Click "New Study" to ensure the form is in create mode
    await page.locator('[data-testid="new-study-button"]').click()

    // Verify the prompt prefix input is visible
    const prefixInput = page.locator('[data-testid="prompt-prefix-input"] input')
    await expect(prefixInput).toBeVisible()

    // Fill in study name
    await fillStudyName(page, uniqueStudyName)

    // Fill in the prompt prefix
    await prefixInput.fill(promptPrefixValue)

    // Fill in a prompt (required for saving)
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')

    // Add a sampler/scheduler pair
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // Save the study
    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()

    // Modal auto-closes after save
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // Re-open the editor and verify the prompt prefix round-trips
    await openManageStudiesEditor(page)

    // Select the study we just created in the editor
    const editorStudySelect = page.locator('[data-testid="study-editor-select"]')
    await editorStudySelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText(uniqueStudyName, { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Verify the prompt prefix was loaded correctly from the backend
    const loadedPrefixInput = page.locator('[data-testid="prompt-prefix-input"] input')
    await expect(loadedPrefixInput).toHaveValue(promptPrefixValue)

    // Clean up: delete the study
    page.on('dialog', (dialog) => dialog.accept())
    await page.locator('[data-testid="delete-study-button"]').click()
    await expect(page.locator('[data-testid="delete-study-button"]')).not.toBeVisible()
  })
})
