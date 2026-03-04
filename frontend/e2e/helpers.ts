import { type APIRequestContext, type Page, expect } from '@playwright/test'

/**
 * Resets the backend database to a clean initial state by calling the
 * test-only DELETE /api/test/reset endpoint. This endpoint is only available
 * when the backend is started with ENABLE_TEST_ENDPOINTS=true (set in
 * docker-compose.test.yml).
 *
 * Call this in a beforeEach hook to ensure each test starts with a
 * predictable, empty database -- no leftover presets, jobs, or other
 * state from previous tests.
 */
export async function resetDatabase(request: APIRequestContext): Promise<void> {
  const response = await request.delete('/api/test/reset')
  expect(response.status()).toBe(200)
}

/**
 * Selects a training run from the sidebar NSelect dropdown.
 */
export async function selectTrainingRun(page: Page, runName: string): Promise<void> {
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
export async function closeDrawer(page: Page): Promise<void> {
  const drawerCloseButton = page.locator('[aria-label="close"]').first()
  if (await drawerCloseButton.isVisible()) {
    await drawerCloseButton.click()
    // Wait for the drawer to close (close button disappears)
    await expect(drawerCloseButton).not.toBeVisible()
    await page.waitForTimeout(300)
  }
}

/**
 * Opens the Generate Samples dialog from the header button.
 * Closes the sidebar drawer first to unblock the header controls.
 * Requires a training run to already be selected.
 */
export async function openGenerateSamplesDialog(page: Page): Promise<void> {
  // Close the drawer so its mask doesn't intercept clicks on header buttons
  await closeDrawer(page)

  const generateButton = page.locator('[data-testid="generate-samples-button"]')
  await expect(generateButton).toBeVisible()
  await generateButton.click()

  // Wait for the Generate Samples dialog to appear
  await expect(getGenerateSamplesDialog(page)).toBeVisible()
}

/**
 * Returns the Generate Samples dialog locator.
 * Naive UI NModal preset="card" renders an NCard with role="dialog" and aria-modal="true".
 */
export function getGenerateSamplesDialog(page: Page) {
  return page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Generate Samples' })
}

/**
 * Returns the Manage Studies dialog locator.
 * Uses the study-editor-select data-testid as a unique child to distinguish
 * from the outer Generate Samples dialog (which also contains the text
 * "Manage Studies" in its button label).
 */
export function getManageStudiesDialog(page: Page) {
  return page.locator('[role="dialog"][aria-modal="true"]').filter({
    has: page.locator('[data-testid="study-editor-select"]'),
  })
}

/**
 * Fills in the study name field in the StudyEditor.
 */
export async function fillStudyName(page: Page, name: string): Promise<void> {
  const nameInput = page.locator('[data-testid="study-name-input"] input')
  await nameInput.fill(name)
}

/**
 * Fills in the first prompt row (name and text) in the NDynamicInput.
 * The NDynamicInput renders prompt rows with two inputs: name and text.
 */
export async function fillFirstPromptRow(page: Page, promptName: string, promptText: string): Promise<void> {
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
export async function addSamplerSchedulerPair(page: Page, sampler: string, scheduler: string): Promise<void> {
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
 * Selects an option from a Naive UI NSelect dropdown identified by data-testid.
 * The option may be a tag (filterable mode) or a regular option.
 */
export async function selectNaiveOption(page: Page, selectTestId: string, optionText: string): Promise<void> {
  const select = page.locator(`[data-testid="${selectTestId}"]`)
  await expect(select).toBeVisible()
  await select.click()
  const popup = page.locator('.n-base-select-menu:visible')
  await expect(popup).toBeVisible()
  await popup.getByText(optionText, { exact: true }).click()
  await expect(popup).not.toBeVisible()
}

/**
 * Opens the right-side Filters drawer by clicking the "Filters" button in the header.
 * The button is only visible after a training run is selected and scanned.
 * Filters inside the drawer are always expanded (no individual toggle needed).
 */
export async function openFiltersDrawer(page: Page): Promise<void> {
  const filtersButton = page.locator('[data-testid="filters-button"]')
  await expect(filtersButton).toBeVisible()
  await filtersButton.click()
  // Wait for the drawer content to appear (NDrawerContent title="Filters")
  await expect(page.locator('.n-drawer-body-content-wrapper')).toBeVisible()
}

/**
 * Closes the right-side Filters drawer if it is open.
 * The NDrawerContent has a close button with aria-label="close".
 * Since the sidebar drawer also has a close button, we target the last one
 * (the filters drawer renders after the sidebar drawer in the DOM).
 */
export async function closeFiltersDrawer(page: Page): Promise<void> {
  // The filters drawer close button is the last aria-label="close" button
  const closeButtons = page.locator('[aria-label="close"]')
  const count = await closeButtons.count()
  if (count > 0) {
    const lastClose = closeButtons.last()
    if (await lastClose.isVisible()) {
      await lastClose.click()
      await page.waitForTimeout(300)
    }
  }
}
