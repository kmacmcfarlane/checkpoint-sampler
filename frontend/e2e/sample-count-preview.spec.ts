import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
} from './helpers'

/**
 * E2E tests for S-084: Sample count preview and missing-sample generation.
 *
 * Verifies:
 * - AC1: Generate Samples dialog shows validation preview with expected sample counts
 * - AC2: Main controls side-panel shows validation totals and "Generate Missing"
 *         button when validation reveals missing samples
 * - AC3: Validate API returns total_expected, total_actual, total_missing fields
 * - AC4: API supports missing_only parameter in create-sample-job payload
 *
 * Test fixture data:
 *   - Training run "my-model" has 2 checkpoints, each with 2 PNG sample files
 *     in the initial fixtures. However, other E2E tests in the same suite
 *     (sample-generation.spec.ts) may generate additional images on the shared
 *     writable volume. Because both checkpoints always have equal PNG counts,
 *     validation consistently shows 0 missing -- but the exact total varies.
 *   - For missing-sample scenarios, we test the negative case (no missing)
 *     at the E2E level; the positive case is covered by unit tests.
 */

/**
 * Selects a Naive UI NSelect option within a specific container.
 */
async function selectNaiveOptionInContainer(
  page: Page,
  container: ReturnType<typeof page.locator>,
  selectTestId: string,
  optionText: string,
): Promise<void> {
  const select = container.locator(`[data-testid="${selectTestId}"]`)
  await expect(select).toBeVisible()
  await select.click()
  const popup = page.locator('.n-base-select-menu:visible')
  await expect(popup).toBeVisible()
  await popup.getByText(optionText, { exact: true }).click()
  await expect(popup).not.toBeVisible()
}

test.describe('S-084: sample count preview and missing-sample generation', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC3: Validate API returns total_expected, total_actual, total_missing fields
  test('validate API returns total_expected, total_actual, total_missing fields', async ({ request }) => {
    // Get training runs to find the ID for "my-model"
    const runsResponse = await request.get('/api/training-runs')
    expect(runsResponse.ok()).toBeTruthy()
    const runs = await runsResponse.json()
    const myModel = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // Call the validate endpoint
    const validateResponse = await request.post(`/api/training-runs/${myModel.id}/validate`)
    expect(validateResponse.ok()).toBeTruthy()

    const result = await validateResponse.json()

    // AC3: API returns total fields with correct types
    expect(typeof result.total_expected).toBe('number')
    expect(typeof result.total_actual).toBe('number')
    expect(typeof result.total_missing).toBe('number')

    // Both checkpoints have equal PNG counts (at least 2 from fixtures, possibly
    // more from other E2E tests in this suite), so expected = actual, missing = 0.
    expect(result.total_expected).toBeGreaterThanOrEqual(4)
    expect(result.total_actual).toBe(result.total_expected)
    expect(result.total_missing).toBe(0)
  })

  // AC1: Generate Samples dialog shows validation preview after selecting a training run AND study.
  // S-086 changed the validation trigger to require both training run and study selection.
  test('Generate Samples dialog shows validation preview with sample counts', async ({ page, request }) => {
    // Create a study via API so we can select it in the dialog
    const createStudyResp = await request.post('/api/studies', {
      data: {
        name: `Preview Test ${Date.now()}`,
        prompt_prefix: '',
        prompts: [{ name: 'landscape', text: 'a landscape' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(createStudyResp.ok()).toBeTruthy()
    const study = await createStudyResp.json()

    await page.goto('/')

    // Select a training run so the "Generate Samples" button appears
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Open the Generate Samples dialog
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the training run in the dialog
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // S-086: Select the study — validation preview now requires both training run + study
    await selectNaiveOptionInContainer(page, dialog, 'study-select', study.name)

    // Wait for the validation preview to appear
    const preview = dialog.locator('[data-testid="validation-preview"]')
    await expect(preview).toBeVisible({ timeout: 5000 })

    // Verify the preview shows the "X / Y expected" format.
    // Both checkpoints have equal PNG counts, so actual = expected (no missing).
    // Exact count varies because other E2E tests may generate additional images.
    await expect(preview).toContainText(/\d+ \/ \d+ expected/)

    // No missing samples, so "missing" text should not appear
    await expect(preview).not.toContainText('missing')
  })

  // AC2: Sidebar validation totals appear after clicking Validate
  test('sidebar shows validation totals after clicking Validate', async ({ page }) => {
    await page.goto('/')

    // Select a training run
    await selectTrainingRun(page, 'my-model')

    // Click the Validate button
    const validateBtn = page.locator('[data-testid="validate-button"]')
    await expect(validateBtn).toBeVisible()
    await validateBtn.click()

    // Wait for validation totals to appear
    const totals = page.locator('[data-testid="validation-totals"]')
    await expect(totals).toBeVisible()

    // Both checkpoints have equal PNG counts, so totals show "N / N samples".
    // Exact count varies because other E2E tests may generate additional images.
    await expect(totals).toContainText(/\d+ \/ \d+ samples/)

    // No missing samples, so "missing" text should not appear
    await expect(totals).not.toContainText('missing')
  })

  // AC2: "Generate Missing" button does NOT appear when no samples are missing
  test('"Generate Missing" button does not appear when all samples are present', async ({ page }) => {
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

    // "Generate Missing" button should NOT appear (0 missing samples)
    await expect(page.locator('[data-testid="generate-missing-button"]')).toHaveCount(0)
  })

  // AC4: API accepts missing_only parameter in create-sample-job payload
  test('create-sample-job API accepts missing_only parameter', async ({ request }) => {
    // First create a study to use in the payload
    const createStudyResponse = await request.post('/api/studies', {
      data: {
        name: `E2E Missing Only Test ${Date.now()}`,
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test image' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 1024,
        height: 1024,
      },
    })
    expect(createStudyResponse.ok()).toBeTruthy()
    const study = await createStudyResponse.json()

    // Get training runs to find the name for "my-model"
    const runsResponse = await request.get('/api/training-runs?source=checkpoints')
    expect(runsResponse.ok()).toBeTruthy()
    const runs = await runsResponse.json()
    const myModel = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // Get the list of valid workflows
    const workflowsResponse = await request.get('/api/workflows')
    expect(workflowsResponse.ok()).toBeTruthy()
    const workflows = await workflowsResponse.json()
    const validWorkflow = workflows.find((w: { validation_state: string }) => w.validation_state === 'valid')
    expect(validWorkflow).toBeDefined()

    // Create a sample job with missing_only=true
    const createJobResponse = await request.post('/api/sample-jobs', {
      data: {
        training_run_name: myModel.name,
        study_id: study.id,
        workflow_name: validWorkflow.name,
        vae: 'test-vae.safetensors',
        clip: 'test-clip.safetensors',
        missing_only: true,
      },
    })

    // The API should accept the payload (200 OK).
    // Since all samples already exist on disk (fixture has 2 PNGs per checkpoint),
    // the missing_only filter would skip items whose output files exist.
    // The job is still created (may have 0 items if all exist, or the full set if
    // the output filenames don't match the fixture file naming convention).
    expect(createJobResponse.ok()).toBeTruthy()
    const job = await createJobResponse.json()
    expect(job.id).toBeDefined()
    expect(job.status).toBe('pending')
  })

  // AC1: Validation preview clears when dialog is closed and reopened without a selection
  test('validation preview is not shown when no training run is selected in dialog', async ({ page }) => {
    await page.goto('/')

    // Select a training run so the "Generate Samples" button appears
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Open the Generate Samples dialog
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Before selecting a training run in the dialog, no preview should be visible
    const preview = dialog.locator('[data-testid="validation-preview"]')
    await expect(preview).toHaveCount(0)
  })
})
