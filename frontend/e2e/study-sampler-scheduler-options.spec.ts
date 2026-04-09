import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  closeDrawer,
  openGenerateSamplesDialog,
  getManageStudiesDialog,
} from './helpers'

/**
 * Opens the Generate Samples dialog and then the Manage Studies editor.
 */
async function openManageStudiesEditor(page: Page): Promise<void> {
  await openGenerateSamplesDialog(page)
  const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
  await expect(manageStudiesButton).toBeVisible()
  await manageStudiesButton.click()
  await expect(getManageStudiesDialog(page)).toBeVisible()
}

/**
 * E2E tests verifying that the sampler and scheduler dropdowns in the Study Editor
 * display options (either from the ComfyUI backend or the static fallback list).
 *
 * Bug: B-137 — Scheduler and sampler dropdowns empty in Study Editor.
 *
 * The sampler/scheduler NSelect dropdowns rendered inside each NDynamicInput pair row
 * must have a non-empty options list whether or not ComfyUI is connected.
 */
test.describe('study editor sampler/scheduler dropdowns', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await closeDrawer(page)
  })

  // AC: Sampler dropdown in Study Editor displays all available sampler options
  // AC: Options are selectable for both new and existing studies
  test('sampler dropdown shows non-empty options list when a pair row is added', async ({ page }) => {
    await openManageStudiesEditor(page)

    // Click "New Study" to ensure the form is in create mode
    const newStudyButton = page.locator('[data-testid="new-study-button"]')
    await newStudyButton.click()

    // Add a sampler/scheduler pair by clicking the create button
    const pairsCreateButton = page.locator('[data-testid="pairs-create-button"]')
    await expect(pairsCreateButton).toBeVisible()
    await pairsCreateButton.click()

    // The first pair row should be visible
    const firstPairRow = page.locator('[data-testid="pair-row-0"]')
    await expect(firstPairRow).toBeVisible()

    // Click the sampler NSelect to open the dropdown
    const samplerSelect = firstPairRow.locator('[data-testid="pair-sampler-0"]')
    await expect(samplerSelect).toBeVisible()
    await samplerSelect.click()

    // The Naive UI NSelect popup should appear; wait for it
    const popup = page.locator('.n-select-menu, .n-base-select-menu').last()
    await expect(popup).toBeVisible({ timeout: 3000 })

    // The popup should contain at least one option (not empty)
    // Common sampler names like 'euler' should appear in the fallback list
    await expect(popup.getByText('euler', { exact: true })).toBeVisible({ timeout: 3000 })

    // Close the popup by pressing Escape
    await page.keyboard.press('Escape')
    await expect(popup).not.toBeVisible()
  })

  // AC: Scheduler dropdown in Study Editor displays all available scheduler options
  // AC: Options are selectable for both new and existing studies
  test('scheduler dropdown shows non-empty options list when a pair row is added', async ({ page }) => {
    await openManageStudiesEditor(page)

    // Click "New Study" to ensure the form is in create mode
    const newStudyButton = page.locator('[data-testid="new-study-button"]')
    await newStudyButton.click()

    // Add a sampler/scheduler pair by clicking the create button
    const pairsCreateButton = page.locator('[data-testid="pairs-create-button"]')
    await expect(pairsCreateButton).toBeVisible()
    await pairsCreateButton.click()

    // The first pair row should be visible
    const firstPairRow = page.locator('[data-testid="pair-row-0"]')
    await expect(firstPairRow).toBeVisible()

    // Click the scheduler NSelect to open the dropdown
    const schedulerSelect = firstPairRow.locator('[data-testid="pair-scheduler-0"]')
    await expect(schedulerSelect).toBeVisible()
    await schedulerSelect.click()

    // The Naive UI NSelect popup should appear; wait for it
    const popup = page.locator('.n-select-menu, .n-base-select-menu').last()
    await expect(popup).toBeVisible({ timeout: 3000 })

    // The popup should contain at least one option (not empty)
    // Common scheduler names like 'karras' should appear in the fallback list
    await expect(popup.getByText('karras', { exact: true })).toBeVisible({ timeout: 3000 })

    // Close the popup by pressing Escape
    await page.keyboard.press('Escape')
    await expect(popup).not.toBeVisible()
  })
})
