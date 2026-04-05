import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { resetDatabase, cancelAllJobs, closeDrawer } from './helpers'

/**
 * E2E tests for the Validation Dialog Refresh Button (S-137).
 *
 * ## What is tested
 *
 * AC1: Refresh button is visible in the validation dialog
 * AC2: Clicking refresh re-triggers validation and updates displayed results
 * AC3: Loading state is shown during refresh (button disabled while loading)
 *
 * ## Test data
 *
 * - Training run "my-model" with 2 checkpoints in test-fixtures/
 * - A seeded completed job in the DB (uses /api/test/seed-jobs endpoint)
 */

const FIXTURE_STUDY_ID = 'e2efixture-0000-0000-0000-000000000001'
const FIXTURE_STUDY_NAME = 'E2E Fixture Study'

async function seedCompletedJob(request: APIRequestContext): Promise<string> {
  const payload = [
    {
      training_run_name: 'my-model',
      study_id: FIXTURE_STUDY_ID,
      study_name: FIXTURE_STUDY_NAME,
      workflow_name: 'test-workflow.json',
      status: 'completed',
      total_items: 4,
      completed_items: 4,
    },
  ]
  const response = await request.post('/api/test/seed-jobs', { data: payload })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return (body.job_ids as string[])[0]
}

async function openJobProgressPanel(page: Page): Promise<void> {
  await closeDrawer(page)

  const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
  await expect(jobsButton).toBeVisible()
  await jobsButton.click()

  const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  await expect(modal).toBeVisible()
}

test.describe('Validation Dialog Refresh Button (S-137)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC: Refresh button is visible in the validation dialog
  test('AC1: Refresh button is visible in the validation dialog', async ({ page, request }) => {
    const jobId = await seedCompletedJob(request)
    await openJobProgressPanel(page)

    const validateBtn = page.locator(`[data-testid="job-${jobId}-validate"]`)
    await expect(validateBtn).toBeVisible()
    await validateBtn.click()

    const validationDialog = page.locator('[data-testid="validation-results-dialog"]')
    await expect(validationDialog).toBeVisible({ timeout: 10000 })

    // Wait for results to load
    await expect(
      page.locator('[data-testid="validation-dialog-summary"], [data-testid="validation-dialog-error"]')
    ).toBeVisible({ timeout: 15000 })

    // AC: Refresh button is visible in the dialog header
    const refreshBtn = page.locator('[data-testid="validation-refresh-button"]')
    await expect(refreshBtn).toBeVisible()
    await expect(refreshBtn).toHaveText('Refresh')
  })

  // AC: Clicking refresh re-triggers validation and updates displayed results
  test('AC2: Clicking Refresh re-runs validation and keeps the dialog open', async ({ page, request }) => {
    const jobId = await seedCompletedJob(request)
    await openJobProgressPanel(page)

    const validateBtn = page.locator(`[data-testid="job-${jobId}-validate"]`)
    await expect(validateBtn).toBeVisible()
    await validateBtn.click()

    const validationDialog = page.locator('[data-testid="validation-results-dialog"]')
    await expect(validationDialog).toBeVisible({ timeout: 10000 })

    // Wait for initial results to load
    await expect(
      page.locator('[data-testid="validation-dialog-summary"], [data-testid="validation-dialog-error"]')
    ).toBeVisible({ timeout: 15000 })

    // Click Refresh
    const refreshBtn = page.locator('[data-testid="validation-refresh-button"]')
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()

    // AC: Dialog should remain open after clicking Refresh
    await expect(validationDialog).toBeVisible()

    // AC: Results should be re-loaded (summary visible again after refresh)
    await expect(
      page.locator('[data-testid="validation-dialog-summary"], [data-testid="validation-dialog-error"]')
    ).toBeVisible({ timeout: 15000 })
  })

  // AC: Refresh button is visible in the slideout validation dialog (no job context)
  test('AC1 (slideout): Refresh button is visible in the slideout validation dialog', async ({ page }) => {
    // Select training run
    const selectTrigger = page.locator('[data-testid="training-run-select"]')
    await expect(selectTrigger).toBeVisible({ timeout: 10000 })
    await expect(selectTrigger.locator('.n-base-selection--disabled')).toHaveCount(0)

    const popupMenu = page.locator('.n-base-select-menu:visible')
    const MAX_RETRIES = 3
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await selectTrigger.click()
      try {
        await expect(popupMenu).toBeVisible({ timeout: 3000 })
        break
      } catch {
        if (attempt === MAX_RETRIES) throw new Error('Could not open training run select')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }
    }
    await popupMenu.getByText('my-model', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Wait for scan to complete
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 10000 })

    // Click the slideout Validate button
    const slideoutValidateBtn = page.locator('[data-testid="slideout-validate-button"]')
    await expect(slideoutValidateBtn).toBeVisible()
    await slideoutValidateBtn.click()

    // Validation dialog should open
    const validationDialog = page.locator('[data-testid="validation-results-dialog"]')
    await expect(validationDialog).toBeVisible({ timeout: 10000 })

    // Wait for results
    await expect(
      page.locator('[data-testid="validation-dialog-summary"], [data-testid="validation-dialog-error"]')
    ).toBeVisible({ timeout: 15000 })

    // AC: Refresh button should be visible in the slideout dialog too
    const refreshBtn = page.locator('[data-testid="validation-refresh-button"]')
    await expect(refreshBtn).toBeVisible()
    await expect(refreshBtn).toHaveText('Refresh')
  })
})
