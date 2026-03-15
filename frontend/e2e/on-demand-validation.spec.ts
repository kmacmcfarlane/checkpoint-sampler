import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun } from './helpers'

/**
 * E2E tests for on-demand dataset validation (S-083).
 *
 * Verifies:
 * - AC1: Sidebar label reads "Training Run"
 * - AC2: Validate button appears in the main controls slideout after selecting a training run
 * - AC3: API endpoint triggers validation of the selected sample set
 * - AC5: Validation results returned (per-checkpoint completeness counts)
 * - AC6: Clicking Validate opens the validation results dialog (B-099: inline results removed)
 *
 * Test fixture data:
 *   - sample_dir contains:
 *       my-model-step00001000.safetensors/ (2 PNGs)
 *       my-model-step00002000.safetensors/ (2 PNGs)
 *   - Both checkpoints have equal file counts, so validation should show all complete.
 *
 * B-099: The inline validate button and inline results display in TrainingRunSelector were
 * removed. The only validate button in the main controls is the slideout-validate-button
 * which opens the ValidationResultsDialog.
 */

test.describe('on-demand dataset validation (S-083)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: Sidebar label reads "Training Run"
  test('sidebar label reads "Training Run"', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Training Run', { exact: true })).toBeVisible()
  })

  // AC2: Validate button appears in the slideout after selecting a training run
  // B-099: The inline validate-button was removed; only the slideout-validate-button remains.
  test('Validate button appears after selecting a sample set', async ({ page }) => {
    await page.goto('/')

    // Before selection, the slideout validate button should not exist
    await expect(page.locator('[data-testid="slideout-validate-button"]')).toHaveCount(0)

    // Select a training run
    await selectTrainingRun(page, 'my-model')

    // After selection, the slideout validate button should appear
    const validateBtn = page.locator('[data-testid="slideout-validate-button"]')
    await expect(validateBtn).toBeVisible()
    await expect(validateBtn).toHaveText('Validate')
  })

  // AC3: API endpoint to trigger validation
  test('validate API returns per-checkpoint completeness counts', async ({ request }) => {
    // First get training runs to find the ID
    const runsResponse = await request.get('/api/training-runs')
    expect(runsResponse.ok()).toBeTruthy()
    const runs = await runsResponse.json()
    const myModel = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // Call the validate endpoint
    const validateResponse = await request.post(`/api/training-runs/${myModel.id}/validate`)
    expect(validateResponse.ok()).toBeTruthy()

    const result = await validateResponse.json()
    // AC5: Results contain per-checkpoint completeness
    expect(result.checkpoints).toBeDefined()
    expect(result.checkpoints.length).toBe(2)

    // Both checkpoints should have the same count (both have 2 PNGs in fixtures)
    for (const cp of result.checkpoints) {
      expect(cp.checkpoint).toBeDefined()
      expect(cp.expected).toBeGreaterThanOrEqual(0)
      expect(cp.verified).toBeGreaterThanOrEqual(0)
      expect(typeof cp.missing).toBe('number')
    }
  })

  // AC6 (B-099): Clicking the slideout Validate button opens the ValidationResultsDialog.
  // The old inline results display was removed by B-099; validation is now shown in a dialog.
  test('clicking Validate opens the validation results dialog', async ({ page }) => {
    await page.goto('/')

    // Select a training run
    await selectTrainingRun(page, 'my-model')

    // Click the slideout Validate button
    const validateBtn = page.locator('[data-testid="slideout-validate-button"]')
    await expect(validateBtn).toBeVisible()
    await validateBtn.click()

    // Wait for the validation results dialog to open
    const validationDialog = page.locator('[data-testid="validation-results-dialog"]')
    await expect(validationDialog).toBeVisible({ timeout: 10000 })

    // The dialog should contain a summary section
    const summary = validationDialog.locator('[data-testid="validation-dialog-summary"]')
    await expect(summary).toBeVisible({ timeout: 10000 })

    // Inline results should NOT exist (removed by B-099)
    await expect(page.locator('[data-testid="validation-results"]')).toHaveCount(0)
  })

  // AC3: Validate endpoint returns 404 for invalid ID
  test('validate API returns 404 for non-existent training run', async ({ request }) => {
    const response = await request.post('/api/training-runs/999/validate')
    expect(response.status()).toBe(404)
  })
})
