import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun } from './helpers'

/**
 * E2E tests for on-demand dataset validation (S-083).
 *
 * Verifies:
 * - AC1: Sidebar label reads "Training Run"
 * - AC2: Validate button appears beneath the Training Run selector
 * - AC3: API endpoint triggers validation of the selected sample set
 * - AC5: Validation results returned (per-checkpoint completeness counts)
 * - AC6: Validation results displayed inline with pass/warning status
 *
 * Test fixture data:
 *   - sample_dir contains:
 *       my-model-step00001000.safetensors/ (2 PNGs)
 *       my-model-step00002000.safetensors/ (2 PNGs)
 *   - Both checkpoints have equal file counts, so validation should show all complete.
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

  // AC2: Validate button appears after selecting a sample set
  test('Validate button appears after selecting a sample set', async ({ page }) => {
    await page.goto('/')

    // Before selection, validate button should not exist
    await expect(page.locator('[data-testid="validate-button"]')).toHaveCount(0)

    // Select a training run
    await selectTrainingRun(page, 'my-model')

    // After selection, validate button should appear
    const validateBtn = page.locator('[data-testid="validate-button"]')
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

  // AC6: Display validation results inline with pass/warning status
  test('clicking Validate shows per-checkpoint results inline', async ({ page }) => {
    await page.goto('/')

    // Select a training run
    await selectTrainingRun(page, 'my-model')

    // Click the Validate button
    const validateBtn = page.locator('[data-testid="validate-button"]')
    await expect(validateBtn).toBeVisible()
    await validateBtn.click()

    // Wait for validation results to appear
    const results = page.locator('[data-testid="validation-results"]')
    await expect(results).toBeVisible()

    // Both checkpoints in test fixtures have equal file counts,
    // so both should show as pass (green checkmark, no warning class)
    const checkpoints = results.locator('.validation-checkpoint')
    await expect(checkpoints).toHaveCount(2)

    // Each checkpoint row should show verified/expected counts
    const firstCounts = checkpoints.first().locator('.validation-checkpoint-counts')
    await expect(firstCounts).toBeVisible()
    // The counts should be in the format "N/N" (e.g., "2/2")
    const countsText = await firstCounts.textContent()
    expect(countsText).toMatch(/^\d+\/\d+$/)

    // No warning classes should be present (both checkpoints are complete)
    await expect(results.locator('.validation-checkpoint--warning')).toHaveCount(0)
  })

  // AC3: Validate endpoint returns 404 for invalid ID
  test('validate API returns 404 for non-existent training run', async ({ request }) => {
    const response = await request.post('/api/training-runs/999/validate')
    expect(response.status()).toBe(404)
  })
})
