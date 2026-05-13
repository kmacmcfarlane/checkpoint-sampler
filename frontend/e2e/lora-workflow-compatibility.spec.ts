import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import {
  resetDatabase,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
} from './helpers'

/**
 * E2E tests for LoRA workflow compatibility filtering in the job launch dialog (B-140).
 *
 * Test data:
 * - Training runs: "my-model" (checkpoint), "test-lora" (lora)
 * - Workflows: test-workflow.json (non-LoRA), test-workflow-lora.json (LoRA)
 * - Seeded study: "E2E Fixture Study" uses test-workflow.json (non-LoRA)
 */

/**
 * Wait for training runs API to return data, then reload and reopen dialog.
 * After resetDatabase(), the FSState async scan may not be ready yet.
 */
async function ensureDataAndOpenDialog(page: Page, request: APIRequestContext): Promise<void> {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://frontend:3000'

  // Poll API until training runs are available (FSState scan after resetDatabase)
  await expect(async () => {
    const resp = await request.get(`${baseUrl}/api/training-runs?source=checkpoints`)
    const data = await resp.json()
    expect(data.length).toBeGreaterThan(0)
  }).toPass({ timeout: 15000, intervals: [500, 1000, 2000] })

  // Navigate fresh so the app loads with data already available
  await page.goto('/', { waitUntil: 'networkidle' })
  await openGenerateSamplesDialog(page)
}

/**
 * Select a training run option in the Generate Samples dialog.
 * Scoped to the dialog to avoid conflict with the sidebar's training run select.
 */
async function pickTrainingRun(page: Page, nameSubstring: string): Promise<void> {
  const dialog = getGenerateSamplesDialog(page)
  const select = dialog.getByTestId('training-run-select')
  await select.click()
  const popup = page.locator('.n-base-select-menu').last()
  await expect(popup).toBeVisible({ timeout: 5000 })
  const option = popup.locator('.n-base-select-option').filter({ hasText: nameSubstring }).first()
  await expect(option).toBeVisible({ timeout: 5000 })
  await option.click()
  await expect(popup).not.toBeVisible({ timeout: 5000 })
}

/**
 * Select a study option in the Generate Samples dialog.
 */
async function pickStudy(page: Page, nameSubstring: string): Promise<void> {
  const dialog = getGenerateSamplesDialog(page)
  const select = dialog.getByTestId('study-select')
  await select.click()
  const popup = page.locator('.n-base-select-menu').last()
  await expect(popup).toBeVisible({ timeout: 5000 })
  const option = popup.locator('.n-base-select-option').filter({ hasText: nameSubstring }).first()
  await expect(option).toBeVisible({ timeout: 5000 })
  await option.click()
  await expect(popup).not.toBeVisible({ timeout: 5000 })
}

test.describe('LoRA workflow compatibility (B-140)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: Study options show incompatibility badge when LoRA run is selected with
  // a study whose workflow lacks lora_loader
  test('shows incompatible badge on non-LoRA studies when LoRA run is selected', async ({ page, request }) => {
    await ensureDataAndOpenDialog(page, request)

    // Select the LoRA training run
    await pickTrainingRun(page, 'test-lora')

    // Open the study dropdown
    const dialog = getGenerateSamplesDialog(page)
    const studySelect = dialog.getByTestId('study-select')
    await studySelect.click()
    const popup = page.locator('.n-base-select-menu').last()
    await expect(popup).toBeVisible({ timeout: 5000 })

    // The seeded "E2E Fixture Study" uses test-workflow.json (non-LoRA).
    // It should show an incompatibility badge ("Not LoRA").
    const incompatibleBadge = popup.getByTestId('study-incompatible-badge')
    await expect(incompatibleBadge.first()).toBeVisible({ timeout: 5000 })
    await expect(incompatibleBadge.first()).toHaveText('Not LoRA')

    await page.keyboard.press('Escape')
  })

  // AC: Incompatibility warning shown when non-LoRA study is selected for LoRA run
  test('shows incompatibility warning when non-LoRA study is selected for LoRA run', async ({ page, request }) => {
    await ensureDataAndOpenDialog(page, request)

    // Select LoRA training run then non-LoRA study
    await pickTrainingRun(page, 'test-lora')
    await pickStudy(page, 'E2E Fixture Study')

    // Warning alert should be visible
    const dialog = getGenerateSamplesDialog(page)
    const warning = dialog.getByTestId('study-incompatible-warning')
    await expect(warning).toBeVisible({ timeout: 5000 })
    await expect(warning).toContainText('not LoRA-capable')
  })

  // AC: Launch button is disabled when selected study workflow is incompatible
  test('disables launch button when incompatible study is selected for LoRA run', async ({ page, request }) => {
    await ensureDataAndOpenDialog(page, request)

    // Select LoRA training run
    await pickTrainingRun(page, 'test-lora')
    await pickStudy(page, 'E2E Fixture Study')

    // The Generate/Regenerate button should be disabled
    const dialog = getGenerateSamplesDialog(page)
    const submitButton = dialog.locator('button').filter({ hasText: /Generate|Regenerate/ }).first()
    await expect(submitButton).toBeDisabled({ timeout: 5000 })
  })

  // AC: No incompatibility warning for non-LoRA training runs (checkpoint runs unaffected)
  test('does not show incompatibility warning for checkpoint training runs', async ({ page, request }) => {
    await ensureDataAndOpenDialog(page, request)

    // Select checkpoint training run
    await pickTrainingRun(page, 'my-model')
    await pickStudy(page, 'E2E Fixture Study')

    // No incompatibility warning
    const dialog = getGenerateSamplesDialog(page)
    const warning = dialog.getByTestId('study-incompatible-warning')
    await expect(warning).not.toBeVisible()
  })
})
