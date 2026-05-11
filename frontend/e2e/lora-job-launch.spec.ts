import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import {
  resetDatabase,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
} from './helpers'

/**
 * E2E tests for LoRA training run badge and job launch UX (S-148).
 *
 * Test data:
 * - Training runs: "my-model" (checkpoint, from test-fixtures/checkpoints)
 *                  "test-lora" (lora, from test-fixtures/loras)
 * - Workflows: test-workflow.json (checkpoint), test-workflow-lora.json (LoRA)
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
 * Select a training run option in the Generate Samples dialog by clicking
 * the dropdown and picking an option that contains the given text.
 * Uses filter (not exact match) to handle LoRA badges prepended to option text.
 * Scoped to the dialog to avoid conflict with the sidebar's training run select.
 */
async function pickTrainingRun(page: Page, nameSubstring: string): Promise<void> {
  const dialog = getGenerateSamplesDialog(page)
  const select = dialog.getByTestId('training-run-select')
  await select.click()
  // Popup renders outside the dialog (Naive UI Teleport), query from page root
  const popup = page.locator('.n-base-select-menu').last()
  await expect(popup).toBeVisible({ timeout: 5000 })
  const option = popup.locator('.n-base-select-option').filter({ hasText: nameSubstring }).first()
  await expect(option).toBeVisible({ timeout: 5000 })
  await option.click()
  await expect(popup).not.toBeVisible({ timeout: 5000 })
}

test.describe('LoRA job launch UX (S-148)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: Training run list shows LoRA/Checkpoint badge based on kind field
  test('shows LoRA badge for LoRA training runs in Generate Samples dialog', async ({ page, request }) => {
    await page.goto('/')
    await ensureDataAndOpenDialog(page, request)

    // Open the training run dropdown (scoped to dialog to avoid sidebar duplicate)
    const dialog = getGenerateSamplesDialog(page)
    const trainingRunSelect = dialog.getByTestId('training-run-select')
    await trainingRunSelect.click()

    // Wait for popup
    const popup = page.locator('.n-base-select-menu').last()
    await expect(popup).toBeVisible({ timeout: 5000 })

    // Look for the LoRA badge in the dropdown options
    const loraBadge = page.getByTestId('training-run-kind-badge')
    await expect(loraBadge.first()).toBeVisible({ timeout: 5000 })
    await expect(loraBadge.first()).toHaveText('LoRA')

    // Close the popup
    await page.keyboard.press('Escape')
  })

  // AC: Job launch dialog shows base model dropdown when training run kind is lora
  test('shows base model dropdown when LoRA training run is selected', async ({ page, request }) => {
    await page.goto('/')
    await ensureDataAndOpenDialog(page, request)

    const dialog = getGenerateSamplesDialog(page)

    // Base model field should not be visible initially
    await expect(dialog.getByTestId('base-model-field')).not.toBeVisible()

    // Select the LoRA training run
    await pickTrainingRun(page, 'test-lora')
    await page.waitForTimeout(500) // wait for base model fetch

    // Base model dropdown should now be visible
    await expect(dialog.getByTestId('base-model-field')).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByTestId('base-model-select')).toBeVisible({ timeout: 5000 })
  })

  // AC: Job launch dialog hides base model dropdown for checkpoint training runs
  test('hides base model dropdown for checkpoint training runs', async ({ page, request }) => {
    await page.goto('/')
    await ensureDataAndOpenDialog(page, request)

    const dialog = getGenerateSamplesDialog(page)

    // Select a checkpoint training run (first "my-model" match)
    await pickTrainingRun(page, 'my-model')

    // Base model dropdown should NOT be visible
    await expect(dialog.getByTestId('base-model-field')).not.toBeVisible()
  })

  // AC: Workflow template dropdown filters to show only lora-capable workflows for LoRA runs
  test('filters studies by workflow compatibility for LoRA runs', async ({ page, request }) => {
    await page.goto('/')
    await ensureDataAndOpenDialog(page, request)

    // Select the LoRA training run
    await pickTrainingRun(page, 'test-lora')

    // Open the study dropdown
    const dialog = getGenerateSamplesDialog(page)
    const studySelect = dialog.getByTestId('study-select')
    await studySelect.click()
    const popup = page.locator('.n-base-select-menu').last()
    await expect(popup).toBeVisible({ timeout: 5000 })

    // The seeded E2E Fixture Study uses test-workflow.json (non-LoRA).
    // For a LoRA run, it should be filtered out.
    const fixtureStudyOption = popup.locator('.n-base-select-option').filter({ hasText: 'E2E Fixture Study' })
    await expect(fixtureStudyOption).not.toBeVisible()

    // Close the popup
    await page.keyboard.press('Escape')
  })
})
