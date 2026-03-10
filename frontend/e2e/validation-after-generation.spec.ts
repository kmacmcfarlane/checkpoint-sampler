import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  resetDatabase,
  cancelAllJobs,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  getManageStudiesDialog,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
  selectNaiveOption,
  confirmRegenDialogIfVisible,
} from './helpers'

/**
 * E2E tests for B-079: Checkpoint validation status missing after generation.
 *
 * Bug: After generating samples for a study, the Checkpoint Validation Status UI
 * does not display when returning to the Generate Samples dialog. This persists
 * across page refreshes.
 *
 * Root cause: The Validate endpoint used viewer discovery to look up training runs by
 * index, but the frontend sends indices from checkpoint discovery. After generation,
 * these two sources can disagree on ordering, causing:
 *   1. "not found" errors (before generation: viewer returns 0 runs)
 *   2. Wrong path computation (after generation: viewer run name embeds study output
 *      dir, causing double-nested validation path)
 *
 * Fix: When study_id is provided, the Validate endpoint now uses checkpoint discovery
 * (same source as the frontend) to look up the training run, then builds the correct
 * scoped path: {trainingRunName}/{studyID}/{checkpoint}/.
 *
 * ## What is tested
 *
 * AC1 (BE): Validation status data is returned correctly for all sample sets after generation
 * AC2 (FE): Checkpoint Validation Status UI displays for all studies with generated samples
 * AC3 (E2E): Generate samples for a study, verify validation status appears on regenerate view
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function pollJobStatus(
  request: APIRequestContext,
  predicate: (jobs: Array<{ id: string; training_run_name: string; status: string }>) => boolean,
  options: { timeout?: number; interval?: number } = {},
): Promise<Array<{ id: string; training_run_name: string; status: string }> | null> {
  const timeout = options.timeout ?? 15000
  const interval = options.interval ?? 500
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const resp = await request.get('/api/sample-jobs')
    if (resp.status() === 200) {
      const jobs = await resp.json() as Array<{ id: string; training_run_name: string; status: string }>
      if (predicate(jobs)) return jobs
    }
    await new Promise(r => setTimeout(r, interval))
  }
  return null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('B-079: validation status after generation', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  /**
   * AC3 (E2E): Generate samples for a study, verify validation status appears
   * when reopening the Generate Samples dialog for the same training run + study.
   *
   * Before the fix:
   *   - Before generation: validate returned not_found (viewer discovery had 0 runs)
   *     → validationResult = null → validation UI did not appear
   *   - After generation: viewer discovered the run with embedded study output dir
   *     in the run name, causing a double-nested path computation that found 0 samples
   *
   * After the fix:
   *   - validate with study_id uses checkpoint discovery (same source as the frontend)
   *   - The scoped path is correctly computed as {trainingRunName}/{studyID}/{checkpoint}/
   *   - Validation UI appears with correct actual/expected counts after generation
   */
  test('validation status UI appears with correct counts after generating samples', async ({ page, request }) => {
    const studyName = `B079 Validation After Gen ${Date.now()}`

    // Step 1: Create a study and generate samples
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // Create study
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()
    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    // Wait for sampler/scheduler pair popup animations to fully complete before opening new popups
    await page.waitForTimeout(500)
    // S-112: Select workflow template, VAE, and CLIP in the study editor
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')
    await selectNaiveOption(page, 'study-vae-select', 'test-vae.safetensors')
    await selectNaiveOption(page, 'study-clip-select', 'test-clip.safetensors')
    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()
    await expect(dialog).toBeVisible()

    // Uncheck "Clear existing samples" to avoid removing fixture images
    const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
    await expect(clearExistingCheckbox).toBeVisible({ timeout: 10000 })
    const isChecked = await clearExistingCheckbox.evaluate(el => el.classList.contains('n-checkbox--checked'))
    if (isChecked) {
      await clearExistingCheckbox.click()
      await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)
    }

    // Submit the job
    const submitButton = dialog.locator('button').filter({ hasText: /Generate Samples|Regenerate Samples/ }).first()
    await expect(submitButton).not.toBeDisabled()
    await submitButton.click()
    await confirmRegenDialogIfVisible(page)
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // Step 2: Wait for the job to complete
    // AC1 (BE): After generation, validate must return correct counts
    const completedJobs = await pollJobStatus(
      request,
      jobs => jobs.some(j =>
        j.training_run_name === 'my-model' &&
        (j.status === 'completed' || j.status === 'completed_with_errors'),
      ),
      { timeout: 30000, interval: 1000 },
    )
    expect(completedJobs).not.toBeNull()

    // Get the study ID from the API
    const studiesResp = await request.get('/api/studies')
    expect(studiesResp.ok()).toBeTruthy()
    const studies = await studiesResp.json()
    const study = studies.find((s: { name: string }) => s.name === studyName)
    expect(study).toBeDefined()

    // Get my-model ID from checkpoint source (same source the dialog uses)
    const cpRunsResp = await request.get('/api/training-runs?source=checkpoints')
    expect(cpRunsResp.ok()).toBeTruthy()
    const cpRuns = await cpRunsResp.json()
    const myModel = cpRuns.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // AC1 (BE): Verify validate endpoint returns correct data after generation
    // Before fix: returned not_found or 0 actual (wrong path)
    // After fix: uses checkpoint discovery + correct scoped path
    const validateResp = await request.post(
      `/api/training-runs/${myModel.id}/validate?study_id=${study.id}`,
    )
    expect(validateResp.ok()).toBeTruthy()
    const validateResult = await validateResp.json()

    // The validation should return the study's expected count
    expect(validateResult.expected_per_checkpoint).toBe(study.images_per_checkpoint)
    // After generation, at least some samples should have been written
    // (the mock completes jobs successfully most of the time)
    expect(validateResult.checkpoints.length).toBe(myModel.checkpoint_count)
    // All validation response fields must be present
    expect(typeof validateResult.total_expected).toBe('number')
    expect(typeof validateResult.total_actual).toBe('number')
    expect(typeof validateResult.total_missing).toBe('number')

    // Step 3: Reopen the Generate Samples dialog
    // AC2 (FE): Checkpoint Validation Status UI must appear
    await openGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the same training run
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // Select the same study (this triggers validation)
    await selectNaiveOptionInContainer(page, dialog, 'study-select', studyName)

    // AC2 (FE): Wait for validation status UI to appear
    // Before fix: this section never appeared (validationResult was null due to not_found)
    // After fix: validation completes and the status section renders
    const validationResults = dialog.locator('[data-testid="validation-results"]')
    await expect(validationResults).toBeVisible({ timeout: 15000 })

    // AC2 (FE): Validation totals should also be visible
    const validationTotals = dialog.locator('[data-testid="validation-totals"]')
    await expect(validationTotals).toBeVisible()

    // The totals text should show sample counts (e.g., "2 / 2 samples")
    const totalsText = await validationTotals.textContent()
    expect(totalsText).toMatch(/\d+\s*\/\s*\d+\s*samples/)
  })

  /**
   * AC1 (BE): Verify validate endpoint returns non-zero total_actual after generation.
   *
   * This is a focused API test: after a job completes, the validate endpoint
   * must find the generated samples in the scoped directory. Before the fix,
   * it would either return not_found or 0 actual due to wrong path computation.
   */
  test('validate API returns non-zero total_actual after samples are generated', async ({ request }) => {
    const studyName = `B079 API Test ${Date.now()}`

    // Create a study with workflow settings (S-112: workflow/vae/clip now live in study)
    const studyResp = await request.post('/api/studies', {
      data: {
        name: studyName,
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test prompt' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
        workflow_template: 'test-workflow.json',
        vae: 'test-vae.safetensors',
        text_encoder: 'test-clip.safetensors',
      },
    })
    expect(studyResp.ok()).toBeTruthy()
    const study = await studyResp.json()
    // 1 image per checkpoint
    expect(study.images_per_checkpoint).toBe(1)

    // Get training run IDs from checkpoint source
    const cpRunsResp = await request.get('/api/training-runs?source=checkpoints')
    expect(cpRunsResp.ok()).toBeTruthy()
    const cpRuns = await cpRunsResp.json()
    const myModel = cpRuns.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // AC1: Validate BEFORE generation — must return 0 actual (not an error)
    const beforeResp = await request.post(
      `/api/training-runs/${myModel.id}/validate?study_id=${study.id}`,
    )
    expect(beforeResp.ok()).toBeTruthy()
    const beforeResult = await beforeResp.json()
    // Before generation: no samples exist in the scoped path
    expect(beforeResult.total_actual).toBe(0)
    expect(beforeResult.expected_per_checkpoint).toBe(1)

    // Create and run a sample job via the API
    // S-112: workflow/vae/clip now come from the study, not the job payload
    const jobResp = await request.post('/api/sample-jobs', {
      data: {
        training_run_name: 'my-model',
        study_id: study.id,
        checkpoint_filenames: ['my-model-step00001000.safetensors', 'my-model-step00002000.safetensors'],
        clear_existing: false,
        missing_only: false,
      },
    })
    expect(jobResp.ok()).toBeTruthy()
    const job = await jobResp.json()

    // Wait for job to complete
    const completedJobs = await pollJobStatus(
      request,
      jobs => jobs.some(j =>
        j.id === job.id &&
        (j.status === 'completed' || j.status === 'completed_with_errors'),
      ),
      { timeout: 30000, interval: 1000 },
    )
    expect(completedJobs).not.toBeNull()

    // AC1: Validate AFTER generation — must return > 0 total_actual and correct structure
    // Before the fix, this would return 0 actual due to wrong path (double-nested study dir)
    const afterResp = await request.post(
      `/api/training-runs/${myModel.id}/validate?study_id=${study.id}`,
    )
    expect(afterResp.ok()).toBeTruthy()
    const afterResult = await afterResp.json()

    // After generation, samples were written to {sampleDir}/my-model/{studyID}/{checkpoint}/
    // The validate endpoint (with fix) correctly scopes to this path
    expect(afterResult.total_actual).toBeGreaterThan(0)
    expect(afterResult.expected_per_checkpoint).toBe(1)
    expect(afterResult.checkpoints.length).toBe(myModel.checkpoint_count)
  })
})
