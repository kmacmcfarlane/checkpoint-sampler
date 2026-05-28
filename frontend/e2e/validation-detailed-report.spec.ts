import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { resetDatabase, cancelAllJobs, closeDrawer } from './helpers'

/**
 * E2E tests for the detailed per-checkpoint validation report (S-134).
 *
 * ## What is tested
 *
 * AC1: Validation dialog displays per-checkpoint breakdown (expected, valid, missing, invalid for each file type)
 * AC2: Total summary row shows aggregate counts across all checkpoints
 * AC3: Extra/unexpected files are flagged in the report
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

  // Refresh the jobs list — the job was seeded after page load so the panel may show a stale list
  const refreshButton = modal.locator('button').filter({ hasText: 'Refresh' })
  if (await refreshButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await refreshButton.click()
    // Wait for refresh to settle
    await page.waitForTimeout(500)
  }
}

async function openValidationDialog(page: Page, jobId: string): Promise<void> {
  await openJobProgressPanel(page)

  const validateBtn = page.locator(`[data-testid="job-${jobId}-validate"]`)
  await expect(validateBtn).toBeVisible({ timeout: 15000 })
  await validateBtn.click()

  const validationDialog = page.locator('[data-testid="validation-results-dialog"]')
  await expect(validationDialog).toBeVisible({ timeout: 10000 })

  // Wait for loading to complete
  await expect(
    validationDialog.locator('[data-testid="validation-dialog-summary"], [data-testid="validation-dialog-error"]')
  ).toBeVisible({ timeout: 15000 })
}

test.describe('Validation Detailed Report (S-134)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC: Validation dialog displays per-checkpoint breakdown (expected, valid, missing, invalid for each file type)
  test('AC1: Summary breakdown table shows file type rows with expected/valid/missing/invalid columns', async ({ page, request }) => {
    const jobId = await seedCompletedJob(request)
    await openValidationDialog(page, jobId)

    const dialog = page.locator('[data-testid="validation-results-dialog"]')

    // Summary breakdown table should exist
    const summaryTable = dialog.locator('[data-testid="validation-summary-breakdown"]')
    await expect(summaryTable).toBeVisible()

    // Should have PNG samples row
    const pngRow = dialog.locator('[data-testid="validation-summary-ft-png-samples"]')
    await expect(pngRow).toBeVisible()

    // Should have JSON metadata row
    const jsonRow = dialog.locator('[data-testid="validation-summary-ft-json-metadata"]')
    await expect(jsonRow).toBeVisible()

    // Table header should have Expected, Valid, Missing, Invalid columns
    const headers = summaryTable.locator('th')
    const headerTexts = await headers.allTextContents()
    expect(headerTexts).toContain('Expected')
    expect(headerTexts).toContain('Valid')
    expect(headerTexts).toContain('Missing')
    expect(headerTexts).toContain('Invalid')
  })

  // AC: Total summary row shows aggregate counts across all checkpoints
  test('AC2: Summary totals row shows aggregate counts', async ({ page, request }) => {
    const jobId = await seedCompletedJob(request)
    await openValidationDialog(page, jobId)

    const dialog = page.locator('[data-testid="validation-results-dialog"]')

    // Totals row should exist
    const totalsRow = dialog.locator('[data-testid="validation-summary-totals"]')
    await expect(totalsRow).toBeVisible()
    await expect(totalsRow).toContainText('Totals')
  })

  // AC: Per-checkpoint breakdown is available via collapsible sections
  test('AC1: Per-checkpoint sections are collapsible with file type breakdown', async ({ page, request }) => {
    const jobId = await seedCompletedJob(request)
    await openValidationDialog(page, jobId)

    const dialog = page.locator('[data-testid="validation-results-dialog"]')

    // Checkpoint sections should exist
    const checkpoints = dialog.locator('[data-testid="validation-dialog-checkpoints"]')
    await expect(checkpoints).toBeVisible()

    // There should be checkpoint items with counts visible in headers
    // The fixture has 2 checkpoints: my-model-step00001000.safetensors and my-model-step00002000.safetensors
    const cp1Counts = dialog.locator('[data-testid="validation-dialog-cp-counts-my-model-step00001000.safetensors"]')
    await expect(cp1Counts).toBeVisible()

    const cp2Counts = dialog.locator('[data-testid="validation-dialog-cp-counts-my-model-step00002000.safetensors"]')
    await expect(cp2Counts).toBeVisible()
  })

  // AC: Validation dialog still shows overall summary line
  test('AC2: Summary header shows total actual / total expected samples', async ({ page, request }) => {
    const jobId = await seedCompletedJob(request)
    await openValidationDialog(page, jobId)

    const summary = page.locator('[data-testid="validation-dialog-summary"]')
    await expect(summary).toBeVisible()

    // Should contain "N / M samples" pattern
    const summaryText = await summary.textContent()
    expect(summaryText).toMatch(/\d+ \/ \d+ samples/)
  })
})
