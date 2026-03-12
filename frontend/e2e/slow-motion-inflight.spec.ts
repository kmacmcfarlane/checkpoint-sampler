import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  resetDatabase,
  cancelAllJobs,
  selectTrainingRun,
  closeDrawer,
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
 * E2E tests for W-018: Slow-motion mock mode for in-flight timing tests.
 *
 * ## Problem
 *
 * The ComfyUI mock completes prompts in ~100ms (immediate WS events), which is
 * too fast to reliably observe the "running" UI phase in CI. Tests that want to
 * verify mid-generation state (e.g. current_sample_params, Stop button, running
 * status bead) must either rely on polling luck or have a way to slow down the mock.
 *
 * ## Solution
 *
 * W-018 adds a configurable delay to the ComfyUI mock:
 *   - COMFYUI_MOCK_DELAY_MS env var (startup configuration)
 *   - POST /mock/config {"delay_ms": N} endpoint (runtime configuration per test)
 *
 * ## What is tested
 *
 * AC1: BE: ComfyUI mock supports configurable delay via env var (COMFYUI_MOCK_DELAY_MS)
 *          and runtime POST /mock/config endpoint.
 * AC2: E2E: Tests for in-flight state can reliably observe the running phase by
 *           setting mock delay to 5000ms before launching a job.
 * AC3: E2E: At least one test uses slow-motion mode to verify mid-generation UI state:
 *           - Job status tag shows "running"
 *           - Stop button is visible during the running phase
 *           - Current sample params section is visible while the job is running
 *
 * ## Mock config endpoint
 *
 * Tests call POST http://comfyui-mock:8188/mock/config {"delay_ms": N} directly.
 * The mock URL is injected via COMFYUI_MOCK_URL env var in docker-compose.test.yml.
 * After each test the delay is reset to 0 so subsequent tests are not affected.
 */

// ---------------------------------------------------------------------------
// Mock config helpers
// ---------------------------------------------------------------------------

const MOCK_URL = process.env.COMFYUI_MOCK_URL || 'http://comfyui-mock:8188'

/**
 * Set the ComfyUI mock delay at runtime.
 * Uses the test-only POST /mock/config endpoint (W-018).
 */
async function setMockDelay(request: APIRequestContext, delayMs: number): Promise<void> {
  const response = await request.post(`${MOCK_URL}/mock/config`, {
    data: { delay_ms: delayMs },
  })
  expect(response.status()).toBe(200)
  const body = await response.json() as { delay_ms: number }
  expect(body.delay_ms).toBe(delayMs)
}

/**
 * Get the current mock delay setting.
 * Uses the test-only GET /mock/config endpoint (W-018).
 */
async function getMockDelay(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${MOCK_URL}/mock/config`)
  expect(response.status()).toBe(200)
  const body = await response.json() as { delay_ms: number }
  return body.delay_ms
}

// ---------------------------------------------------------------------------
// UI helpers
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

interface SampleJobApiResponse {
  id: string
  training_run_name: string
  status: string
  total_items: number
  completed_items: number
}

async function pollJobStatus(
  request: APIRequestContext,
  predicate: (jobs: SampleJobApiResponse[]) => boolean,
  options: { timeout?: number; interval?: number } = {},
): Promise<SampleJobApiResponse[] | null> {
  const timeout = options.timeout ?? 15000
  const interval = options.interval ?? 200
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const resp = await request.get('/api/sample-jobs')
    if (resp.status() === 200) {
      const jobs = await resp.json() as SampleJobApiResponse[]
      if (predicate(jobs)) return jobs
    }
    await new Promise(r => setTimeout(r, interval))
  }
  return null
}

async function openJobProgressPanel(page: Page): Promise<void> {
  await closeDrawer(page)
  const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
  await expect(jobsButton).toBeVisible()
  await jobsButton.click()
  const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  await expect(modal).toBeVisible()
}

/**
 * Launch a job via the UI: open Generate Samples, create a study, submit.
 * Returns the job ID of the newly created job.
 */
async function launchJobViaUI(page: Page, request: APIRequestContext, studyName: string): Promise<string> {
  await openGenerateSamplesDialog(page)
  const dialog = getGenerateSamplesDialog(page)
  await expect(dialog).toBeVisible()

  await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

  const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
  await manageStudiesButton.click()
  await expect(getManageStudiesDialog(page)).toBeVisible()

  await page.locator('[data-testid="new-study-button"]').click()
  await fillStudyName(page, studyName)
  await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
  await addSamplerSchedulerPair(page, 'euler', 'normal')
  await page.waitForTimeout(500)

  await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')
  await selectNaiveOption(page, 'study-vae-select', 'test-vae.safetensors')
  await selectNaiveOption(page, 'study-clip-select', 'test-clip.safetensors')

  const saveButton = page.locator('[data-testid="save-study-button"]')
  await expect(saveButton).not.toBeDisabled()
  await saveButton.click()
  await expect(getManageStudiesDialog(page)).not.toBeVisible()
  await expect(getGenerateSamplesDialog(page)).toBeVisible()

  const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
  await expect(clearExistingCheckbox).toBeVisible({ timeout: 10000 })
  const isChecked = await clearExistingCheckbox.evaluate(el => el.classList.contains('n-checkbox--checked'))
  if (isChecked) {
    await clearExistingCheckbox.click()
    await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)
  }

  const submitButton = dialog.locator('button').filter({ hasText: /Generate Samples|Regenerate Samples/ }).first()
  await expect(submitButton).not.toBeDisabled()
  await submitButton.click()
  await confirmRegenDialogIfVisible(page)
  await expect(dialog).not.toBeVisible({ timeout: 5000 })

  // Wait for the job to appear in the API
  const jobs = await pollJobStatus(
    request,
    j => j.length > 0 && j.some(j => j.training_run_name === 'my-model'),
    { timeout: 5000 },
  )
  expect(jobs).not.toBeNull()
  const job = jobs!.find(j => j.training_run_name === 'my-model')!
  return job.id
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('slow-motion mock mode for in-flight state (W-018)', () => {
  // Allow ample time: setup + slow-mock execution (5s delay × up to 2 items) + assertions
  test.setTimeout(120000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test.afterEach(async ({ request }) => {
    // Always reset mock delay to 0 so subsequent tests are not slowed down
    // AC1: Runtime config endpoint must be resettable
    await setMockDelay(request, 0)
    await cancelAllJobs(request)
  })

  // AC1: ComfyUI mock supports configurable delay via runtime POST /mock/config endpoint
  test('AC1: mock config endpoint sets and reads delay_ms', async ({ request }) => {
    // AC: BE: ComfyUI mock supports configurable delay via env var / runtime endpoint

    // Verify initial state (should be 0 from env default)
    const initialDelay = await getMockDelay(request)
    expect(initialDelay).toBe(0)

    // Set a delay
    await setMockDelay(request, 3000)
    const updatedDelay = await getMockDelay(request)
    expect(updatedDelay).toBe(3000)

    // Reset to 0
    await setMockDelay(request, 0)
    const resetDelay = await getMockDelay(request)
    expect(resetDelay).toBe(0)
  })

  // AC2 + AC3: Use slow-motion mode to reliably observe the running phase
  // Sets mock delay to 5000ms so the job stays in "running" long enough for
  // the test to open the Jobs panel and verify the in-flight UI state.
  test('AC2+AC3: slow-motion mode allows reliable observation of running phase', async ({ page, request }) => {
    // AC2: Tests for in-flight state can reliably observe the running phase
    // AC3: At least one test uses slow-motion mode to verify mid-generation UI state

    // Step 1: Set slow-motion delay BEFORE launching the job.
    // 5000ms per prompt × 2 checkpoints × 1 combination = ~10s total execution window.
    // The test has 120s to work within, so this is well within budget.
    await setMockDelay(request, 5000)

    // Step 2: Launch the job
    const studyName = `W-018 Slow-Motion Test ${Date.now()}`
    const jobId = await launchJobViaUI(page, request, studyName)

    // Step 3: Poll until the job transitions to running status
    // AC2: The running phase is now reliably observable because the mock adds a 5s delay
    const runningJobs = await pollJobStatus(
      request,
      jobs => jobs.some(j => j.id === jobId && j.status === 'running'),
      { timeout: 15000, interval: 200 },
    )
    expect(runningJobs).not.toBeNull()
    const runningJob = runningJobs!.find(j => j.id === jobId)!
    expect(runningJob.status).toBe('running')

    // Step 4: Open the Jobs panel and verify the in-flight UI state while running
    await openJobProgressPanel(page)
    const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
    await expect(modal).toBeVisible()

    // AC3: Job status tag shows "running"
    const statusTag = modal.locator(`[data-testid="job-${jobId}-status"]`)
    await expect(statusTag).toBeVisible()
    await expect(statusTag).toContainText('running')

    // AC3: Stop button is visible during the running phase (proves in-flight UI)
    const stopButton = modal.locator(`[data-testid="job-${jobId}-stop"]`)
    await expect(stopButton).toBeVisible()

    // AC3: current_sample_params section is visible while the job is running
    // The panel shows per-sample parameters (CFG, steps, sampler, etc.) during execution.
    // With a 5s delay per prompt, we have a reliable window to check this.
    const paramsSection = modal.locator(`[data-testid="job-${jobId}-sample-params"]`)
    await expect(paramsSection).toBeVisible({ timeout: 10000 })

    // Verify the individual parameter fields are populated
    await expect(modal.locator(`[data-testid="job-${jobId}-param-cfg"]`)).toBeVisible()
    await expect(modal.locator(`[data-testid="job-${jobId}-param-steps"]`)).toBeVisible()
    await expect(modal.locator(`[data-testid="job-${jobId}-param-sampler"]`)).toBeVisible()
    await expect(modal.locator(`[data-testid="job-${jobId}-param-scheduler"]`)).toBeVisible()
    await expect(modal.locator(`[data-testid="job-${jobId}-param-prompt-name"]`)).toBeVisible()
    await expect(modal.locator(`[data-testid="job-${jobId}-param-seed"]`)).toBeVisible()
    await expect(modal.locator(`[data-testid="job-${jobId}-param-size"]`)).toBeVisible()

    // Step 5: Reset mock delay now so the job completes quickly (afterEach also resets)
    await setMockDelay(request, 0)

    // Step 6: Wait for job completion (now that delay is reset to 0)
    const completedJobs = await pollJobStatus(
      request,
      jobs => jobs.some(j => j.id === jobId && (j.status === 'completed' || j.status === 'completed_with_errors')),
      { timeout: 30000, interval: 500 },
    )
    expect(completedJobs).not.toBeNull()
  })

  // AC3: Verify the Stop button is present and functional during the running phase
  test('AC3: Stop button works during running phase in slow-motion mode', async ({ page, request }) => {
    // AC3: At least one test uses slow-motion mode to verify mid-generation UI state

    // Set a long delay so the job stays running long enough for the stop action
    await setMockDelay(request, 10000)

    const studyName = `W-018 Stop Test ${Date.now()}`
    const jobId = await launchJobViaUI(page, request, studyName)

    // Wait for the job to be running
    const runningJobs = await pollJobStatus(
      request,
      jobs => jobs.some(j => j.id === jobId && j.status === 'running'),
      { timeout: 15000, interval: 200 },
    )
    expect(runningJobs).not.toBeNull()

    // Open the Jobs panel
    await openJobProgressPanel(page)
    const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })

    // AC3: Stop button must be visible during running phase
    const stopButton = modal.locator(`[data-testid="job-${jobId}-stop"]`)
    await expect(stopButton).toBeVisible({ timeout: 5000 })

    // Click Stop and verify the job transitions to stopped
    await stopButton.click()

    // Reset mock delay so the current in-flight prompt can complete (if any)
    await setMockDelay(request, 0)

    // Poll until job reaches a non-running terminal or stopped state
    const stoppedJobs = await pollJobStatus(
      request,
      jobs => jobs.some(j =>
        j.id === jobId &&
        j.status !== 'running' &&
        j.status !== 'pending',
      ),
      { timeout: 20000, interval: 500 },
    )
    expect(stoppedJobs).not.toBeNull()
    const stoppedJob = stoppedJobs!.find(j => j.id === jobId)!
    // Job should be stopped (or completed if it finished before the stop took effect)
    expect(['stopped', 'completed', 'completed_with_errors']).toContain(stoppedJob.status)
  })
})
