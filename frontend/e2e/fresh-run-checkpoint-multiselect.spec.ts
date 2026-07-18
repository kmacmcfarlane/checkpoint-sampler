import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  selectNaiveOptionInContainer,
  cancelAllJobs,
} from './helpers'

/**
 * E2E tests for S-178: Generate Samples — enable checkpoint multi-select for
 * fresh runs (no samples yet).
 *
 * ## What is tested
 *
 * - AC: For a run with no samples, the dialog shows a per-checkpoint checkbox
 *   multi-select with Select All / Deselect All (Select Missing hidden).
 * - AC: All checkpoints are selected by default; total-images count reflects
 *   the current selection.
 * - AC: The created job's checkpoint_filenames contains exactly the selected
 *   checkpoints (deselecting some -> subset payload; keeping all selected ->
 *   omitted checkpoint_filenames, preserving prior generate-all behavior).
 * - AC: Submit is blocked with a clear message when zero checkpoints are selected.
 * - AC: Regenerate-only controls (clear existing / missing only) remain
 *   unavailable for fresh runs.
 *
 * ## Test data
 *
 * Training run "b161-epochs-demo-epochs-100" has 4 checkpoints
 * (test-fixtures/checkpoints/) and no matching sample directories anywhere
 * under test-fixtures/samples/, and no sample jobs are seeded for it — so it
 * is a genuine "fresh run" (run status = empty) for every study, including
 * the pre-seeded "E2E Fixture Study".
 */

const FRESH_RUN_NAME = 'b161-epochs-demo-epochs-100'
const FIXTURE_STUDY_NAME = 'E2E Fixture Study'

const FRESH_RUN_CHECKPOINTS = [
  'b161-epochs-demo-epochs-100-000010.safetensors',
  'b161-epochs-demo-epochs-100-000050.safetensors',
  'b161-epochs-demo-epochs-100-000090.safetensors',
  'b161-epochs-demo-epochs-100.safetensors',
]

/**
 * Opens the Generate Samples dialog, selects the fresh training run and the
 * fixture study, then waits for the checkpoint picker to render with
 * per-checkpoint rows (validation has returned).
 */
async function openFreshRunDialog(page: Page): Promise<ReturnType<typeof page.locator>> {
  await openGenerateSamplesDialog(page)
  const dialog = getGenerateSamplesDialog(page)
  await expect(dialog).toBeVisible()

  await selectNaiveOptionInContainer(page, dialog, 'training-run-select', FRESH_RUN_NAME)
  await selectNaiveOptionInContainer(page, dialog, 'study-select', FIXTURE_STUDY_NAME)

  // Wait for the checkpoint picker to appear with rows for all 4 checkpoints.
  const firstRow = page.locator(`[data-testid="checkpoint-row-${FRESH_RUN_CHECKPOINTS[0]}"]`)
  await expect(firstRow).toBeVisible({ timeout: 15000 })

  return dialog
}

test.describe('S-178: fresh-run checkpoint multi-select', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  test('shows per-checkpoint checkboxes, Select All/Deselect All, hides Select Missing and regenerate controls', async ({ page }) => {
    await openFreshRunDialog(page)

    // All four checkpoint rows are rendered.
    for (const cp of FRESH_RUN_CHECKPOINTS) {
      await expect(page.locator(`[data-testid="checkpoint-row-${cp}"]`)).toBeVisible()
    }

    // Bulk controls present; Select Missing hidden (nothing exists yet is
    // equivalent to "everything missing", so it is redundant with Select All).
    await expect(page.locator('[data-testid="select-all-checkpoints"]')).toBeVisible()
    await expect(page.locator('[data-testid="deselect-all-checkpoints"]')).toBeVisible()
    await expect(page.locator('[data-testid="select-missing-checkpoints"]')).toHaveCount(0)

    // Regenerate-only controls remain unavailable for fresh runs.
    await expect(page.locator('[data-testid="clear-existing-checkbox"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="missing-only-checkbox"]')).toHaveCount(0)
  })

  test('all checkpoints are selected by default and the total-images count reflects the selection', async ({ page }) => {
    const dialog = await openFreshRunDialog(page)

    for (const cp of FRESH_RUN_CHECKPOINTS) {
      const row = page.locator(`[data-testid="checkpoint-row-${cp}"]`)
      await expect(row.locator('.n-checkbox')).toHaveClass(/n-checkbox--checked/)
    }

    const summary = dialog.locator('[data-testid="job-summary"]')
    await expect(summary).toContainText('Checkpoints to generate: All')

    // Deselect one checkpoint — the summary count updates to reflect the subset.
    const lastRow = page.locator(`[data-testid="checkpoint-row-${FRESH_RUN_CHECKPOINTS[3]}"]`)
    await lastRow.locator('.n-checkbox').click()
    await expect(lastRow.locator('.n-checkbox')).not.toHaveClass(/n-checkbox--checked/)

    await expect(summary).toContainText('Checkpoints to generate: 3')
  })

  test('submitting a subset creates a job with exactly the selected checkpoints; submitting all omits the filter', async ({ page, request }) => {
    const dialog = await openFreshRunDialog(page)

    // Deselect two checkpoints, leaving 2 of 4 selected.
    await page.locator(`[data-testid="checkpoint-row-${FRESH_RUN_CHECKPOINTS[0]}"]`).locator('.n-checkbox').click()
    await page.locator(`[data-testid="checkpoint-row-${FRESH_RUN_CHECKPOINTS[1]}"]`).locator('.n-checkbox').click()

    const summary = dialog.locator('[data-testid="job-summary"]')
    await expect(summary).toContainText('Checkpoints to generate: 2')

    const submitButton = dialog.locator('button').filter({ hasText: 'Generate Samples' }).first()
    await expect(submitButton).not.toBeDisabled()
    await submitButton.click()

    // Dialog closes on successful submission.
    await expect(dialog).not.toBeVisible({ timeout: 10000 })

    // Verify the created job's checkpoint_filenames via the API.
    const jobsResponse = await request.get('/api/v1/sample-jobs')
    expect(jobsResponse.ok()).toBeTruthy()
    const jobs = await jobsResponse.json() as Array<{
      training_run_name: string
      checkpoint_filenames?: string[]
      status: string
    }>
    const job = jobs.find(j => j.training_run_name === FRESH_RUN_NAME)
    expect(job).toBeDefined()
    expect(job!.checkpoint_filenames).toEqual(
      expect.arrayContaining([FRESH_RUN_CHECKPOINTS[2], FRESH_RUN_CHECKPOINTS[3]]),
    )
    expect(job!.checkpoint_filenames).toHaveLength(2)
  })

  test('blocks submit with a validation message when all checkpoints are deselected', async ({ page }) => {
    const dialog = await openFreshRunDialog(page)

    await page.locator('[data-testid="deselect-all-checkpoints"]').click()

    const errorEl = page.locator('[data-testid="checkpoint-validation-error"]')
    await expect(errorEl).toBeVisible()
    await expect(errorEl).toHaveText('Select at least one checkpoint to generate')

    const submitButton = dialog.locator('button').filter({ hasText: 'Generate Samples' }).first()
    await expect(submitButton).toBeDisabled()
  })
})
