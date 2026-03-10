import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  resetDatabase,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  closeDrawer,
  selectTrainingRun,
} from './helpers'

/**
 * E2E tests for S-116: Training run and study status beads in Generate Samples.
 *
 * Verifies dual-bead state rendering in the Generate Samples dialog for:
 *   - Training run dropdown (slot 1: activity, slot 2: problem)
 *   - Study dropdown (slot 1: activity, slot 2: problem)
 *
 * Bead rules:
 *   Training Run:
 *     Slot 1 (activity): blue = running/pending job, green = all studies complete. Blue wins.
 *     Slot 2 (problem):  red = failed job, yellow = completed_with_errors without running. Red wins.
 *
 *   Study:
 *     Slot 1 (activity): blue = running/pending job for this study, green = complete status. Blue wins.
 *     Slot 2 (problem):  red = failed job for this study, yellow = partial without running. Red wins.
 *
 * ## Test infrastructure
 *
 * The /api/test/seed-jobs endpoint is used to create jobs with controlled statuses,
 * enabling bead state verification without requiring ComfyUI to be running.
 */

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface SeededJob {
  id: string
}

/**
 * Seeds sample jobs with specified statuses via the test-only endpoint.
 */
async function seedJobs(request: APIRequestContext, jobs: Array<{
  training_run_name?: string
  study_id?: string
  study_name?: string
  workflow_name?: string
  status: string
  total_items?: number
  completed_items?: number
}>): Promise<string[]> {
  const payload = jobs.map(j => ({
    training_run_name: j.training_run_name ?? 'my-model',
    study_id: j.study_id ?? 'test-study-1',
    study_name: j.study_name ?? 'Test Study',
    workflow_name: j.workflow_name ?? 'test-workflow.json',
    status: j.status,
    total_items: j.total_items ?? 4,
    completed_items: j.completed_items ?? 0,
  }))

  const response = await request.post('/api/test/seed-jobs', { data: payload })
  expect(response.status()).toBe(201)
  const body = await response.json() as { job_ids: string[] }
  return body.job_ids
}

/**
 * Creates a minimal study via the API and returns its ID.
 */
async function createStudy(request: APIRequestContext, name: string): Promise<string> {
  const resp = await request.post('/api/studies', {
    data: {
      name,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'a test prompt' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 512,
      height: 512,
    },
  })
  expect(resp.ok()).toBeTruthy()
  const study = await resp.json() as { id: string }
  return study.id
}

/**
 * Gets the training run ID for "my-model" from the API.
 */
async function getMyModelRunId(request: APIRequestContext): Promise<number> {
  const resp = await request.get('/api/training-runs?source=checkpoints')
  expect(resp.ok()).toBeTruthy()
  const runs = await resp.json() as Array<{ id: number; name: string }>
  const run = runs.find(r => r.name === 'my-model')
  expect(run).toBeDefined()
  return run!.id
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Opens the Generate Samples dialog and selects the "my-model" training run.
 */
async function openDialogWithRun(page: Page): Promise<ReturnType<typeof getGenerateSamplesDialog>> {
  await page.goto('/', { waitUntil: 'networkidle' })
  await selectTrainingRun(page, 'my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()
  await openGenerateSamplesDialog(page)
  const dialog = getGenerateSamplesDialog(page)
  await expect(dialog).toBeVisible()

  // Select "my-model" in the dialog's training run dropdown
  const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
  await expect(trainingRunSelect).toBeVisible()
  await trainingRunSelect.click()
  const popup = page.locator('.n-base-select-menu:visible')
  await expect(popup).toBeVisible()
  await popup.getByText('my-model', { exact: true }).click()
  await expect(popup).not.toBeVisible()

  return dialog
}

/**
 * Counts bead elements in the training run select trigger (the selected value display).
 * The bead spans are rendered by renderLabel and have data-testid attributes.
 */
async function getTrainingRunBeadInTrigger(dialog: ReturnType<typeof getGenerateSamplesDialog>, beadType: 'activity' | 'problem') {
  // The selected value in NSelect is rendered via renderLabel in the trigger area
  const triggerArea = dialog.locator('[data-testid="training-run-select"] .n-base-selection')
  return triggerArea.locator(`[data-testid="run-bead-${beadType}"]`)
}

/**
 * Opens the training run dropdown and inspects bead spans in the popup options.
 */
async function getBeadsInRunDropdown(page: Page, dialog: ReturnType<typeof getGenerateSamplesDialog>, runName: string, beadType: 'activity' | 'problem') {
  const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
  await trainingRunSelect.click()
  const popup = page.locator('.n-base-select-menu:visible')
  await expect(popup).toBeVisible()

  // Find the option for the named run
  const option = popup.locator('.n-base-select-option').filter({ hasText: runName })
  const bead = option.locator(`[data-testid="run-bead-${beadType}"]`)

  // Close popup
  await page.keyboard.press('Escape')
  await expect(popup).not.toBeVisible()

  return bead
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Generate Samples dual beads (S-116)', () => {
  test.setTimeout(30000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: FE: Training run items display up to two beads based on status rules
  // AC: Blue bead when there is a running job for the training run
  test('AC training run: blue activity bead when a running job exists', async ({ page, request }) => {
    // AC: Blue bead = running job for the sample set
    await seedJobs(request, [{ status: 'running', training_run_name: 'my-model' }])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Wait for dialog data to fully load (training runs + jobs)
    // The dialog fetches data on mount; we use network idle to ensure completion
    await page.waitForLoadState('networkidle')

    // Open the training run dropdown and check for the blue bead on "my-model"
    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await trainingRunSelect.click()
    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()

    // Use exact text match for "my-model" (not "test-run/my-model" which also contains "my-model")
    const option = popup.locator('.n-base-select-option').filter({ hasText: /^my-model$/ })
    const activityBead = option.locator('[data-testid="run-bead-activity"]')
    // AC: blue bead for running job
    await expect(activityBead).toBeVisible()
    await expect(activityBead).toHaveAttribute('title', 'running')

    // No problem bead for a running job (not failed)
    const problemBead = option.locator('[data-testid="run-bead-problem"]')
    await expect(problemBead).toHaveCount(0)

    await page.keyboard.press('Escape')
  })

  // AC: Yellow problem bead when there are incomplete sample sets without running jobs
  test('AC training run: yellow problem bead for completed_with_errors without running jobs', async ({ page, request }) => {
    // AC: Yellow bead = incomplete sample sets without running jobs
    await seedJobs(request, [{ status: 'completed_with_errors', training_run_name: 'my-model' }])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Wait for dialog data to fully load
    await page.waitForLoadState('networkidle')

    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await trainingRunSelect.click()
    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()

    // Use regex for exact match (avoids matching "test-run/my-model")
    const option = popup.locator('.n-base-select-option').filter({ hasText: /^my-model$/ })
    const problemBead = option.locator('[data-testid="run-bead-problem"]')
    // AC: yellow bead for incomplete without running
    await expect(problemBead).toBeVisible()
    await expect(problemBead).toHaveAttribute('title', 'incomplete')

    // No activity bead since no running/pending jobs
    const activityBead = option.locator('[data-testid="run-bead-activity"]')
    await expect(activityBead).toHaveCount(0)

    await page.keyboard.press('Escape')
  })

  // AC: Red problem bead when there is a failed job with missing samples
  test('AC training run: red problem bead for failed job', async ({ page, request }) => {
    // AC: Red bead = failed job with missing samples
    await seedJobs(request, [{ status: 'failed', training_run_name: 'my-model' }])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Wait for dialog data to fully load
    await page.waitForLoadState('networkidle')

    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await trainingRunSelect.click()
    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()

    // Use regex for exact match (avoids matching "test-run/my-model")
    const option = popup.locator('.n-base-select-option').filter({ hasText: /^my-model$/ })
    const problemBead = option.locator('[data-testid="run-bead-problem"]')
    // AC: red bead for failed job
    await expect(problemBead).toBeVisible()
    await expect(problemBead).toHaveAttribute('title', 'failed')

    await page.keyboard.press('Escape')
  })

  // AC: FE: Blue bead takes priority over green; red takes priority over yellow
  test('AC priority: red problem bead beats yellow (failed + completed_with_errors)', async ({ page, request }) => {
    // Seed both a failed and a completed_with_errors job for the same training run
    // AC: Red takes priority over yellow
    await seedJobs(request, [
      { status: 'failed', training_run_name: 'my-model' },
      { status: 'completed_with_errors', training_run_name: 'my-model' },
    ])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Wait for dialog data to fully load
    await page.waitForLoadState('networkidle')

    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await trainingRunSelect.click()
    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()

    // Use regex for exact match (avoids matching "test-run/my-model")
    const option = popup.locator('.n-base-select-option').filter({ hasText: /^my-model$/ })
    // Should show red, not yellow (red wins)
    const problemBead = option.locator('[data-testid="run-bead-problem"]')
    await expect(problemBead).toBeVisible()
    await expect(problemBead).toHaveAttribute('title', 'failed')

    await page.keyboard.press('Escape')
  })

  // AC: FE: No beads when there are no jobs
  test('AC no beads: empty training run shows no beads', async ({ page }) => {
    // No jobs seeded — training run has no status beads
    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Wait for dialog data to fully load
    await page.waitForLoadState('networkidle')

    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await trainingRunSelect.click()
    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()

    // Use regex for exact match (avoids matching "test-run/my-model")
    const option = popup.locator('.n-base-select-option').filter({ hasText: /^my-model$/ })
    // No beads for an empty training run
    await expect(option.locator('[data-testid="run-bead-activity"]')).toHaveCount(0)
    await expect(option.locator('[data-testid="run-bead-problem"]')).toHaveCount(0)

    await page.keyboard.press('Escape')
  })

  // AC: FE: Study items display up to two beads based on status rules
  // Study red bead: failed job for this study
  test('AC study: red problem bead for failed job for the study', async ({ page, request }) => {
    const studyId = await createStudy(request, `Bead Study Failed ${Date.now()}`)

    // Seed a failed job for this specific study
    await seedJobs(request, [{
      status: 'failed',
      training_run_name: 'my-model',
      study_id: studyId,
    }])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select training run to trigger study availability fetch
    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await trainingRunSelect.click()
    const runPopup = page.locator('.n-base-select-menu:visible')
    await expect(runPopup).toBeVisible()
    await runPopup.getByText('my-model', { exact: true }).click()
    await expect(runPopup).not.toBeVisible()

    // Wait for study data to load (studyAvailability + sampleJobs)
    await page.waitForLoadState('networkidle')

    // Open the study dropdown
    const studySelect = dialog.locator('[data-testid="study-select"]')
    await studySelect.click()
    const studyPopup = page.locator('.n-base-select-menu:visible')
    await expect(studyPopup).toBeVisible()

    // The study with a failed job should show a red problem bead
    // (failed job → problem=red regardless of sampleStatus)
    const studyOption = studyPopup.locator('.n-base-select-option').filter({ hasText: new RegExp('Bead Study Failed') })
    const problemBead = studyOption.locator('[data-testid="study-bead-problem"]')
    // AC: Red bead = failed job with missing samples
    await expect(problemBead).toBeVisible()
    await expect(problemBead).toHaveAttribute('title', 'failed')

    await page.keyboard.press('Escape')
  })

  // AC: FE: Blue bead takes priority over green for studies
  test('AC study: blue activity bead for running job for the study', async ({ page, request }) => {
    const studyId = await createStudy(request, `Bead Study Blue ${Date.now()}`)

    // Seed a running job for this study (activity=blue)
    await seedJobs(request, [{
      status: 'running',
      training_run_name: 'my-model',
      study_id: studyId,
    }])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select training run
    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await trainingRunSelect.click()
    const runPopup = page.locator('.n-base-select-menu:visible')
    await expect(runPopup).toBeVisible()
    await runPopup.getByText('my-model', { exact: true }).click()
    await expect(runPopup).not.toBeVisible()

    // Wait for all data to load
    await page.waitForLoadState('networkidle')

    // Open the study dropdown
    const studySelect = dialog.locator('[data-testid="study-select"]')
    await studySelect.click()
    const studyPopup = page.locator('.n-base-select-menu:visible')
    await expect(studyPopup).toBeVisible()

    // The study with a running job should show a blue activity bead
    const studyOption = studyPopup.locator('.n-base-select-option').filter({ hasText: new RegExp('Bead Study Blue') })
    const activityBead = studyOption.locator('[data-testid="study-bead-activity"]')
    // AC: Blue bead = running job for selected sample set
    await expect(activityBead).toBeVisible()
    await expect(activityBead).toHaveAttribute('title', 'running')

    await page.keyboard.press('Escape')
  })

  // AC: BE: API exposes sufficient data for frontend to compute bead states
  test('AC BE: jobs API returns study_id and status enabling dual-bead computation', async ({ request }) => {
    const studyId = await createStudy(request, `API Data Check ${Date.now()}`)

    await seedJobs(request, [{
      status: 'running',
      training_run_name: 'my-model',
      study_id: studyId,
    }])

    // The jobs API must return study_id and status fields
    const resp = await request.get('/api/sample-jobs')
    expect(resp.ok()).toBeTruthy()
    const jobs = await resp.json() as Array<{ study_id: string; status: string; training_run_name: string }>

    expect(jobs.length).toBeGreaterThan(0)
    const job = jobs.find(j => j.study_id === studyId)
    expect(job).toBeDefined()
    // AC: BE: API exposes sufficient data for frontend to compute bead states
    expect(job?.status).toBe('running')
    expect(job?.training_run_name).toBe('my-model')
    expect(typeof job?.study_id).toBe('string')
  })
})
