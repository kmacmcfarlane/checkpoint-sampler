import { type APIRequestContext, type Page, expect } from '@playwright/test'

/**
 * Retries an async operation with exponential backoff. Used to handle
 * transient DNS (ENOTFOUND) and connection (ECONNREFUSED) errors that
 * occur when Docker's embedded DNS resolver hasn't propagated service
 * hostnames yet — common when many parallel compose stacks start
 * simultaneously (B-108).
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 5, initialDelayMs = 500, maxDelayMs = 10000, label = 'operation' } = {},
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error: unknown) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const isTransient = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message)
      if (!isTransient || attempt === maxAttempts) {
        throw error
      }
      // Exponential backoff capped at maxDelayMs to avoid excessively long
      // waits when maxAttempts is high (B-134).
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
      // eslint-disable-next-line no-console
      console.warn(`[${label}] Attempt ${attempt}/${maxAttempts} failed (${message}), retrying in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastError // unreachable, but satisfies TypeScript
}

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
 *
 * Retries with exponential backoff to handle transient DNS/connection
 * errors when Docker's embedded DNS hasn't propagated hostnames yet
 * (B-108: parallel E2E shards starting simultaneously).
 */
export async function resetDatabase(request: APIRequestContext): Promise<void> {
  // Increased from 5/1000ms to 8/2000ms to survive prolonged DNS propagation
  // delays when 12 parallel compose stacks saturate Docker's embedded DNS
  // resolver (B-134). With 10s cap: 2+4+8+10+10+10+10 = ~54s total window.
  await withRetry(
    async () => {
      const response = await request.delete('/api/test/reset')
      expect(response.status()).toBe(200)
    },
    { label: 'resetDatabase', maxAttempts: 8, initialDelayMs: 2000 },
  )

  // Verify backend is healthy after reset — the executor has resumed and
  // the fresh schema is ready to serve requests.
  await withRetry(
    async () => {
      const healthResponse = await request.get('/health')
      expect(healthResponse.status()).toBe(200)
    },
    { label: 'resetDatabase/health', maxAttempts: 5, initialDelayMs: 1000 },
  )
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
  const listResponse = await request.get('/api/v1/sample-jobs')
  if (listResponse.status() !== 200) return

  const jobs = await listResponse.json() as Array<{ id: string; status: string }>
  for (const job of jobs) {
    if (job.status === 'pending' || job.status === 'running') {
      await request.delete(`/api/v1/sample-jobs/${job.id}`)
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
  const statusResponse = await request.get('/api/v1/demo/status')
  if (statusResponse.status() !== 200) return

  const status = await statusResponse.json()
  if (status.installed) {
    await request.delete('/api/v1/demo')
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
  // Use an extended timeout (15s) because under 12-shard parallel load the
  // frontend can take longer than the default 5s to finish its initial fetch.
  await expect(selectTrigger.locator('.n-base-selection--disabled')).toHaveCount(0, { timeout: 15000 })

  // Retry the full open→select flow up to MAX_RETRIES times.
  // Under 12-shard parallel load the popup can dismiss unexpectedly between
  // the trigger click and the option click due to CPU starvation or a transient
  // Naive UI re-render. Each outer retry reopens the popup from scratch.
  const popupMenu = page.locator('.n-base-select-menu:visible')
  const MAX_RETRIES = 5
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Step 1: open the popup, retrying once if the first click is swallowed.
    await selectTrigger.click()
    const popupVisible = await expect(popupMenu).toBeVisible({ timeout: 4000 }).then(() => true).catch(() => false)
    if (!popupVisible) {
      // First click was swallowed — dismiss any partial state and retry the open step.
      // Wait for the popup to be fully gone (detached) rather than a fixed delay,
      // so the retry click cannot land mid-teardown.
      await page.keyboard.press('Escape')
      await expect(popupMenu).toHaveCount(0, { timeout: 5000 })
      await selectTrigger.click()
      try {
        await expect(popupMenu).toBeVisible({ timeout: 4000 })
      } catch {
        if (attempt === MAX_RETRIES) {
          throw new Error(
            `selectTrainingRun: popup menu did not appear after ${MAX_RETRIES} attempts on [data-testid="training-run-select"]`
          )
        }
        await page.keyboard.press('Escape')
        await expect(popupMenu).toHaveCount(0, { timeout: 5000 })
        continue // try the whole open→select flow again
      }
    }

    // Step 2: click the option. If the popup dismisses before the click lands
    // (CPU starvation causing a race), retry the entire flow.
    try {
      await popupMenu.getByText(runName, { exact: true }).click({ timeout: 5000 })
      await expect(popupMenu).not.toBeVisible({ timeout: 3000 })
      return // success
    } catch {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `selectTrainingRun: failed to click option "${runName}" after ${MAX_RETRIES} attempts`
        )
      }
      // Popup dismissed before we could click — dismiss stale state and retry.
      // Wait for the popup to be detached so the next attempt starts from a clean slate.
      await page.keyboard.press('Escape').catch(() => undefined)
      await expect(popupMenu).toHaveCount(0, { timeout: 5000 })
    }
  }
}

/**
 * Clicks a select trigger and waits for the popup menu to appear, with retry.
 *
 * Naive UI's NSelect popup renders via Teleport outside the trigger element.
 * Under parallel shard load — or while a drawer/modal transition is in progress —
 * the first click may be swallowed before Naive UI registers it, so the popup
 * never opens. This helper retries up to MAX_RETRIES times, dismissing any
 * partial state with Escape between attempts.
 *
 * Returns the visible popup menu locator so callers can immediately interact
 * with the rendered options.
 */
async function clickSelectAndWaitForPopup(
  page: Page,
  selectTrigger: ReturnType<typeof page.locator>,
  label = 'select',
): Promise<ReturnType<typeof page.locator>> {
  const popupMenu = page.locator('.n-base-select-menu:visible')
  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Scroll the trigger into view and click with an explicit, bounded timeout.
      //
      // Without a timeout, Playwright's actionability wait on click() blocks up
      // to the entire test timeout when the trigger is transiently unstable —
      // e.g. the XYGrid re-renders/relayouts after thumbnails finish loading,
      // shifting the drawer's "Mode for <dim>" select trigger while the click's
      // stability check is running. That hang defeats this retry loop and
      // surfaces as "element is not stable / not visible" only at the 90s test
      // timeout (B-177). Bounding the click lets a failed attempt fall through
      // to the retry below, which re-clicks once the layout has settled.
      await selectTrigger.scrollIntoViewIfNeeded({ timeout: 5000 })
      await selectTrigger.click({ timeout: 5000 })
      await expect(popupMenu).toBeVisible({ timeout: 3000 })
      return popupMenu
    } catch {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `clickSelectAndWaitForPopup(${label}): popup did not appear after ${MAX_RETRIES} click attempts`,
        )
      }
      // Wait for any partially-open popup to be fully dismissed before retrying,
      // rather than guessing at an animation duration.
      await page.keyboard.press('Escape').catch(() => undefined)
      await expect(popupMenu).toHaveCount(0, { timeout: 5000 })
    }
  }
  // Unreachable but TypeScript requires a return
  return popupMenu
}

/**
 * Select a study from the Study dropdown (second cascading dropdown).
 * Only needed when a training run has multiple studies. The study dropdown
 * is hidden when a group has exactly one run with no study label.
 */
export async function selectStudy(page: Page, studyLabel: string): Promise<void> {
  const selectTrigger = page.locator('[data-testid="study-select"]')
  await expect(selectTrigger).toBeVisible()

  const popupMenu = await clickSelectAndWaitForPopup(page, selectTrigger, 'study-select')
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
    // Wait for the mask to be detached rather than sleeping for the animation.
    // Naive UI unmounts .n-drawer-mask once the leave transition finishes; until
    // then it still intercepts pointer events on elements underneath (B-111/B-112).
    await expect(page.locator('.n-drawer-mask:visible')).toHaveCount(0, { timeout: 5000 })
  }
}

/**
 * Dismisses any overlays (NDrawer masks, modal dialogs, settings dialog)
 * that could intercept pointer events on header buttons. Under resource
 * contention in parallel shards, NDrawer close animations take longer
 * than the 300ms fixed wait in closeDrawer (B-111, B-112).
 *
 * Call this after closeDrawer and before clicking header buttons like
 * the settings button. The 5s timeout on mask disappearance accommodates
 * slow animations under CPU contention.
 */
export async function dismissOverlays(page: Page): Promise<void> {
  // Dismiss any visible NDrawer masks — these intercept all pointer events
  // while the drawer close animation is in progress.
  const drawerMask = page.locator('.n-drawer-mask')
  const maskCount = await drawerMask.count()
  for (let i = 0; i < maskCount; i++) {
    await expect(drawerMask.nth(i)).not.toBeVisible({ timeout: 5000 })
  }

  // Dismiss the settings dialog if left open by a prior test
  const settingsDialog = page.locator('[data-testid="settings-dialog"]')
  if (await settingsDialog.isVisible({ timeout: 200 }).catch(() => false)) {
    await page.keyboard.press('Escape')
    await expect(settingsDialog).not.toBeVisible()
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
 *
 * Uses retry logic to handle popup open failures under parallel shard load
 * or during drawer/modal transition animations.
 */
export async function selectNaiveOption(page: Page, selectTestId: string, optionText: string): Promise<void> {
  const select = page.locator(`[data-testid="${selectTestId}"]`)
  await expect(select).toBeVisible()
  const popup = await clickSelectAndWaitForPopup(page, select, selectTestId)
  await popup.getByText(optionText, { exact: true }).click()
  await expect(popup).not.toBeVisible()
}

/**
 * Selects an option from a Naive UI NSelect dropdown in `multiple` mode
 * (S-157: VAE/text-encoder selects became multi-value). Unlike a single-value
 * NSelect, the popup does NOT close automatically after clicking an option —
 * the menu stays open so the user can pick more values. This helper clicks
 * the option, then presses Escape to explicitly dismiss the popup, and
 * asserts the selection was recorded via the rendered tag inside the select
 * trigger rather than asserting the popup closed.
 */
export async function selectNaiveMultiOption(page: Page, selectTestId: string, optionText: string): Promise<void> {
  const select = page.locator(`[data-testid="${selectTestId}"]`)
  await expect(select).toBeVisible()
  const popup = await clickSelectAndWaitForPopup(page, select, selectTestId)
  await popup.getByText(optionText, { exact: true }).click()
  // Multi-select popups remain open after a selection; dismiss explicitly.
  await page.keyboard.press('Escape')
  await expect(popup).not.toBeVisible()
  // Verify the selected value now renders as a tag inside the select trigger.
  await expect(select.locator('.n-base-selection-tag-wrapper', { hasText: optionText })).toBeVisible()
}

/**
 * Selects an option from a Naive UI NSelect dropdown within a specific container,
 * identified by data-testid relative to that container.
 *
 * The popup menu renders outside the container (Naive UI Teleport), so the popup
 * is always queried from the page root.
 *
 * Uses retry logic to handle popup open failures under parallel shard load
 * or during drawer/modal transition animations.
 */
export async function selectNaiveOptionInContainer(
  page: Page,
  container: ReturnType<typeof page.locator>,
  selectTestId: string,
  optionText: string,
): Promise<void> {
  const select = container.locator(`[data-testid="${selectTestId}"]`)
  await expect(select).toBeVisible()
  const popup = await clickSelectAndWaitForPopup(page, select, selectTestId)
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

  // Confirm save — wait for the POST /api/v1/presets API response to complete before returning.
  // The dialog closes at the START of onConfirmSave() (before the API call), so waiting only
  // for the dialog to close is insufficient: dirty tracking (snapshotAssignments) runs after
  // the API call resolves, causing a race where the Save button remains enabled briefly.
  const confirmButton = saveDialog.locator('[data-testid="preset-save-dialog-confirm"]')
  await expect(confirmButton).toBeEnabled()
  await Promise.all([
    page.waitForResponse(
      resp =>
        resp.url().includes('/api/v1/presets') &&
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
 *
 * Uses retry logic to handle popup open failures under parallel shard load
 * or during drawer/modal transition animations.
 */
export async function selectNaiveOptionByLabel(page: Page, selectAriaLabel: string, optionText: string): Promise<void> {
  const select = page.locator(`[aria-label="${selectAriaLabel}"]`)
  await expect(select).toBeVisible()
  const popupMenu = await clickSelectAndWaitForPopup(page, select, selectAriaLabel)
  await popupMenu.getByText(optionText, { exact: true }).click()
  await expect(popupMenu).not.toBeVisible()
}

/**
 * Waits until every currently-rendered grid image in the main content area has
 * finished loading (img.complete && naturalWidth > 0).
 *
 * Grid images have no intrinsic reserved height until they load, so while they
 * are still fetching the main content — and, on wide screens where the sidebar
 * runs beside the grid, the surrounding layout — keeps reflowing. That reflow
 * repositions the drawer's "Mode for <dim>" select trigger and makes it fail
 * Playwright's actionability stability check (B-177). Calling this before
 * interacting with the dimension-mode selects lets the layout settle first.
 *
 * Tolerates the case where no grid images are present yet (returns immediately).
 */
export async function waitForGridImagesLoaded(page: Page, timeout = 15000): Promise<void> {
  await page
    .waitForFunction(
      () => {
        // Every rendered grid image is wrapped by ImageCell's `.image-cell`
        // element, which is present in BOTH XYGrid render branches: the
        // axis-assigned `.xy-grid-container` grid AND the no-axis
        // `.xy-grid-flat` grid. A `.xy-grid img` selector would miss the flat
        // branch (exact class-token matching), silently turning this wait into
        // a no-op exactly at the AC5 call site — right after selectStudy, when
        // no axis is assigned and the flat grid is showing.
        const imgs = Array.from(
          document.querySelectorAll<HTMLImageElement>('.image-cell img'),
        )
        // No images rendered yet: nothing to stabilize on this pass.
        if (imgs.length === 0) return true
        return imgs.every((img) => img.complete && img.naturalWidth > 0)
      },
      { timeout },
    )
    .catch(() => undefined)
}

/**
 * Opens the right-side Filters drawer by clicking the "Filters" button in the header.
 * The button is only visible after a training run is selected and scanned.
 * Filters inside the drawer are always expanded (no individual toggle needed).
 *
 * Calls dismissOverlays before clicking to ensure the sidebar NDrawer mask has fully
 * disappeared. Under parallel shard CPU contention, the sidebar mask leave-animation
 * (0.2s CSS transition) can outlast the fixed 300ms delay in closeDrawer, making the
 * mask an actionability blocker for the filters button click (B-128).
 */
export async function openFiltersDrawer(page: Page): Promise<void> {
  // Dismiss any lingering sidebar mask before clicking a header button
  await dismissOverlays(page)
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
      // Wait for the filters drawer body to disappear and its mask to detach,
      // rather than sleeping for the leave animation. openFiltersDrawer calls
      // dismissOverlays first, so the filters mask is the only mask in play here.
      await expect(page.locator('[data-testid="filters-drawer-content"]')).not.toBeVisible({ timeout: 5000 })
      await expect(page.locator('.n-drawer-mask:visible')).toHaveCount(0, { timeout: 5000 })
    }
  }
}
