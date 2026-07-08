import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import {
  resetDatabase,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
} from './helpers'

/**
 * E2E tests for B-141: Job launch dialog error display.
 *
 * AC: FE: Job launch dialog shows an error message when job creation fails
 * due to unresolvable paths (or any other backend error).
 *
 * Strategy: Create a study whose workflow_template references a non-existent
 * workflow file. When the user attempts to create a job, the backend will
 * return an error because the workflow cannot be loaded. This exercises
 * the same doSubmit error handling path as the path-matching failure case.
 */

/**
 * Wait for training runs API to return data, then navigate and open dialog.
 */
async function ensureDataAndOpenDialog(page: Page, request: APIRequestContext): Promise<void> {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://frontend:3000'

  // Poll API until training runs are available (FSState scan after resetDatabase)
  await expect(async () => {
    const resp = await request.get(`${baseUrl}/api/training-runs?source=checkpoints`)
    const data = await resp.json()
    expect(data.length).toBeGreaterThan(0)
  }).toPass({ timeout: 15000, intervals: [500, 1000, 2000] })

  await page.goto('/', { waitUntil: 'networkidle' })
  await openGenerateSamplesDialog(page)
}

/**
 * Select a training run option by clicking the dropdown and picking an option.
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
 * Select a study option by clicking the dropdown and picking an option.
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

test.describe('Job launch error display (B-141)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: FE: Job launch dialog shows an error message when job creation fails
  test('shows error alert when job creation fails due to invalid study config', async ({ page, request }) => {
    // Create a study with a non-existent workflow template to trigger a backend error
    const studyResp = await request.post('/api/studies', {
      data: {
        name: 'Bad Workflow Study',
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test prompt' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'simple' }],
        seeds: [42],
        resolutions: [{ width: 512, height: 512 }],
        workflow_template: '', // empty workflow to trigger "no workflow template" error
      },
    })
    expect(studyResp.status()).toBe(201)

    await ensureDataAndOpenDialog(page, request)
    const dialog = getGenerateSamplesDialog(page)

    // Select the training run
    await pickTrainingRun(page, 'my-model')

    // Select the study with the bad workflow
    await pickStudy(page, 'Bad Workflow Study')

    // Click the Generate Samples button — should fail because workflow is empty
    const submitButton = dialog.locator('button').filter({ hasText: /Generate Samples|Regenerate Samples/ })
    await expect(submitButton).toBeVisible({ timeout: 5000 })
    await submitButton.click()

    // AC: The error alert should appear with the data-testid
    const errorAlert = dialog.getByTestId('job-launch-error')
    await expect(errorAlert).toBeVisible({ timeout: 10000 })
    // The error message should indicate the workflow configuration issue
    await expect(errorAlert).toContainText(/workflow/i)
  })
})
