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
 *
 * The reset endpoint:
 *   1. Pauses the job executor (clears active job/item/prompt state)
 *   2. Drops all tables and reruns migrations
 *   3. Removes study-generated sample directories from sample_dir
 *   4. Resumes the job executor
 *
 * After the reset returns 200, we verify the backend is healthy by
 * hitting /health. This guards against races where a subsequent API call
 * arrives before the backend has fully stabilized after the reset.
 */
export async function resetDatabase(request: APIRequestContext): Promise<void> {
  const response = await request.delete('/api/test/reset')
  expect(response.status()).toBe(200)

  // Verify backend is healthy after reset — the executor has resumed and
  // the fresh schema is ready to serve requests.
  const healthResponse = await request.get('/health')
  expect(healthResponse.status()).toBe(200)
}

/**
 * Cancels all running or pending sample jobs via the API.
 *
 * Use this in afterEach hooks of spec files that create sample jobs
 * (e.g., sample-generation.spec.ts, sample-jobs-api.spec.ts) to ensure
 * no background job processing leaks into subsequent tests.
 *
 * The job executor may be mid-item when this is called. Deleting the job
 * via the API marks it as cancelled and the executor will skip it on the
 * next polling tick.
 */
export async function cancelAllJobs(request: APIRequestContext): Promise<void> {
  const listResponse = await request.get('/api/sample-jobs')
  if (listResponse.status() !== 200) return

  const jobs = await listResponse.json() as Array<{ id: string; status: string }>
  for (const job of jobs) {
    if (job.status === 'pending' || job.status === 'running') {
      await request.delete(`/api/sample-jobs/${job.id}`)
    }
  }
}

/**
 * Uninstalls the demo dataset if it is currently installed.
 *
 * Use this in afterEach hooks of spec files that install the demo dataset
 * (e.g., demo-settings.spec.ts, demo-watcher.spec.ts) to ensure the demo
 * filesystem artifacts (directories, images, presets) do not leak into
 * subsequent tests.
 */
export async function uninstallDemo(request: APIRequestContext): Promise<void> {
  const statusResponse = await request.get('/api/demo/status')
  if (statusResponse.status() !== 200) return

  const status = await statusResponse.json()
  if (status.installed) {
    await request.delete('/api/demo')
  }
}

/**
 * Selects a training run from the sidebar NSelect dropdown.
 *
 * Waits for the NSelect to finish loading (the component is disabled while
 * the training runs API call is in flight) before clicking, which prevents
 * the dropdown popup from failing to open due to a race with data loading.
 *
 * Uses retry logic for the click-to-open step because the NDrawer's opening
 * transition can cause the first click to not reliably open the popup. This
 * manifests as a flaky failure in sample-generation.spec.ts where tests 2-4
 * fail after the first test creates a sample job: the page reloads, the
 * drawer opens with its slide-in animation, and the NSelect trigger click
 * fires before the drawer transition completes — Naive UI swallows the
 * click without opening the popup menu.
 */
export async function selectTrainingRun(page: Page, runName: string): Promise<void> {
  const selectTrigger = page.locator('[data-testid="training-run-select"]')
  await expect(selectTrigger).toBeVisible()

  // Wait for the select to finish loading — Naive UI adds the
  // .n-base-selection--disabled class while loading is true.
  // We wait for that class to disappear before clicking.
  await expect(selectTrigger.locator('.n-base-selection--disabled')).toHaveCount(0)

  // Retry clicking the trigger up to 3 times. The NDrawer's slide-in
  // animation can cause the first click to be swallowed before the drawer
  // content is fully interactive. Each retry waits briefly, then dismisses
  // any stale focus state with Escape before re-clicking.
  const popupMenu = page.locator('.n-base-select-menu:visible')
  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await selectTrigger.click()
    try {
      await expect(popupMenu).toBeVisible({ timeout: 3000 })
      break // popup appeared, exit the retry loop
    } catch {
      if (attempt === MAX_RETRIES) {
        // Final attempt failed — throw a clear error
        throw new Error(
          `selectTrainingRun: popup menu did not appear after ${MAX_RETRIES} click attempts on [data-testid="training-run-select"]`
        )
      }
      // Dismiss any partial state (e.g. focused input without popup) before retrying
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
  }

  await popupMenu.getByText(runName, { exact: true }).click()
  await expect(popupMenu).not.toBeVisible()
}

/**
 * Select a study from the Study dropdown (second cascading dropdown).
 * Only needed when a training run has multiple studies. The study dropdown
 * is hidden when a group has exactly one run with no study label.
 */
export async function selectStudy(page: Page, studyLabel: string): Promise<void> {
  const selectTrigger = page.locator('[data-testid="study-select"]')
  await expect(selectTrigger).toBeVisible()

  const popupMenu = page.locator('.n-base-select-menu:visible')
  await selectTrigger.click()
  await expect(popupMenu).toBeVisible({ timeout: 3000 })
  await popupMenu.getByText(studyLabel, { exact: true }).click()
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
 * Also closes the Sample Jobs panel if it is open (B-106: the panel auto-opens
 * after job creation, which would cause its modal mask to block header buttons).
 * Requires a training run to already be selected.
 */
export async function openGenerateSamplesDialog(page: Page): Promise<void> {
  // Close the drawer so its mask doesn't intercept clicks on header buttons
  await closeDrawer(page)

  // Close the Sample Jobs panel if it is open (its modal mask would block the
  // generate-samples button; B-106 auto-opens the panel after job creation).
  const jobsPanel = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  if (await jobsPanel.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press('Escape')
    await expect(jobsPanel).not.toBeVisible({ timeout: 3000 })
  }

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
 * Handles the S-093 regeneration confirmation dialog if it appears after
 * clicking the submit button in the Generate Samples dialog.
 *
 * When all expected samples already exist for the selected training run
 * (isCompleteValidation), clicking "Regenerate Samples" shows a confirmation
 * dialog instead of immediately submitting. This helper clicks "Yes, Regenerate"
 * to confirm and proceed.
 *
 * If the confirmation dialog does not appear (e.g. because the validation
 * shows missing samples), this function is a no-op.
 */
export async function confirmRegenDialogIfVisible(page: Page): Promise<void> {
  const confirmDialog = page.locator('[data-testid="confirm-regen-dialog"]')
  if (await confirmDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    const confirmButton = page.locator('[data-testid="confirm-regen-button"]')
    await confirmButton.click()
    await expect(confirmDialog).not.toBeVisible()
  }
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
 * Saves a dimension preset via the NModal input dialog.
 * Clicks the Save button to open the dialog, fills in the preset name, then confirms.
 *
 * AC: S-121: Save preset flow uses an NModal input dialog instead of window.prompt.
 */
export async function savePresetViaDialog(page: Page, presetName: string): Promise<void> {
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

  // Confirm save — wait for the POST /api/presets API response to complete before returning.
  // The dialog closes at the START of onConfirmSave() (before the API call), so waiting only
  // for the dialog to close is insufficient: dirty tracking (snapshotAssignments) runs after
  // the API call resolves, causing a race where the Save button remains enabled briefly.
  const confirmButton = saveDialog.locator('[data-testid="preset-save-dialog-confirm"]')
  await expect(confirmButton).toBeEnabled()
  await Promise.all([
    page.waitForResponse(
      resp =>
        resp.url().includes('/api/presets') &&
        resp.request().method() === 'POST' &&
        resp.status() === 201,
    ),
    confirmButton.click(),
  ])

  // Dialog should close (the API response resolving triggers dialog close + state update)
  await expect(saveDialog).not.toBeVisible()
}

/**
 * Selects an option from a Naive UI NSelect dropdown identified by aria-label.
 * Used for dimension selects (e.g., aria-label="Mode for checkpoint").
 */
export async function selectNaiveOptionByLabel(page: Page, selectAriaLabel: string, optionText: string): Promise<void> {
  const select = page.locator(`[aria-label="${selectAriaLabel}"]`)
  await select.click()
  const popupMenu = page.locator('.n-base-select-menu:visible')
  await expect(popupMenu).toBeVisible()
  await popupMenu.getByText(optionText, { exact: true }).click()
  await expect(popupMenu).not.toBeVisible()
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
  // Wait for the filters drawer content to appear using a stable data-testid selector.
  // NDrawerContent renders data-testid="filters-drawer-content" on the drawer body.
  await expect(page.locator('[data-testid="filters-drawer-content"]')).toBeVisible()
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
