import { test, expect, type APIRequestContext } from '@playwright/test'
import { resetDatabase, closeDrawer } from './helpers'

/**
 * E2E tests for the job card title click → parameter detail panel (S-099).
 *
 * ## What is tested
 *
 * AC1: FE: Clicking a job card title opens a detail view showing all job parameters.
 * AC2: FE: Parameters include training run, workflow, preset name, VAE, CLIP, shift,
 *          and checkpoint list.
 * AC3: FE: Detail view is dismissible (click outside or close button).
 *
 * ## Test data setup
 *
 * Jobs are created directly via REST API to keep test setup simple.
 * Each test navigates to the Jobs panel, locates the job card, and interacts
 * with the title button to verify the detail panel.
 */

const STUDY_PAYLOAD = {
  name: 'S-099 Params Test Study',
  prompt_prefix: '',
  prompts: [{ name: 'landscape', text: 'a beautiful landscape' }],
  negative_prompt: '',
  steps: [20],
  cfgs: [7.0],
  sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
  seeds: [42],
  width: 512,
  height: 512,
  // S-112: Workflow settings are now part of the study definition
  workflow_template: 'test-workflow.json',
  vae: 'test-vae.safetensors',
  text_encoder: 'test-clip.safetensors',
}

/** Create a study via the REST API and return its ID. */
async function createStudyViaAPI(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/studies', { data: STUDY_PAYLOAD })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return body.id as string
}

/** Create a sample job via the REST API and return its ID. */
// S-112: workflow_name/vae/clip come from the study definition, not the job payload
async function createJobViaAPI(request: APIRequestContext, studyId: string): Promise<string> {
  const response = await request.post('/api/sample-jobs', {
    data: {
      training_run_name: 'my-model',
      study_id: studyId,
    },
  })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return body.id as string
}

/**
 * Opens the Job Progress Panel (the "Jobs" button in the header).
 * Closes the sidebar drawer first to unblock the header controls.
 */
async function openJobProgressPanel(page: import('@playwright/test').Page): Promise<void> {
  await closeDrawer(page)

  const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
  await expect(jobsButton).toBeVisible()
  await jobsButton.click()

  // Wait for the Jobs modal to appear (NModal with title "Sample Jobs")
  const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  await expect(modal).toBeVisible()
}

test.describe('job card title click shows parameter detail panel (S-099)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  // AC1: Clicking a job card title opens a detail view showing all job parameters
  test('AC1: clicking the job card title opens the parameter panel', async ({ page, request }) => {
    // AC: FE: Clicking a job card title opens a detail view showing all job parameters
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    const jobCard = page.locator(`[data-testid="job-${jobId}"]`)
    await expect(jobCard).toBeVisible()

    // Parameter panel should not be visible initially
    const paramsPanel = page.locator(`[data-testid="job-${jobId}-params"]`)
    await expect(paramsPanel).not.toBeVisible()

    // Click the title button to open parameters
    const titleBtn = page.locator(`[data-testid="job-${jobId}-title"]`)
    await expect(titleBtn).toBeVisible()
    await titleBtn.click()

    // AC1: Parameter panel should now be visible
    await expect(paramsPanel).toBeVisible()
  })

  // AC2: Parameters include training run, workflow, preset name, VAE, CLIP, and checkpoint list
  test('AC2: parameter panel shows training run, workflow, and study name', async ({ page, request }) => {
    // AC: FE: Parameters include training run, workflow, preset name, VAE, CLIP, shift, checkpoint list
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    const titleBtn = page.locator(`[data-testid="job-${jobId}-title"]`)
    await expect(titleBtn).toBeVisible()
    await titleBtn.click()

    const paramsPanel = page.locator(`[data-testid="job-${jobId}-params"]`)
    await expect(paramsPanel).toBeVisible()

    // Training run
    const trainingRun = page.locator(`[data-testid="job-${jobId}-param-training-run"]`)
    await expect(trainingRun).toBeVisible()
    await expect(trainingRun).toContainText('my-model')

    // Workflow
    const workflow = page.locator(`[data-testid="job-${jobId}-param-workflow"]`)
    await expect(workflow).toBeVisible()
    await expect(workflow).toContainText('test-workflow.json')

    // Study (preset) name
    const study = page.locator(`[data-testid="job-${jobId}-param-study"]`)
    await expect(study).toBeVisible()
    await expect(study).toContainText('S-099 Params Test Study')

    // Checkpoints — S-123: individual filenames are displayed
    const checkpoints = page.locator(`[data-testid="job-${jobId}-param-checkpoints"]`)
    await expect(checkpoints).toBeVisible()
    // The job was created for the 'my-model' training run which has 2 checkpoint files
    const checkpointList = page.locator(`[data-testid="job-${jobId}-param-checkpoint-list"]`)
    await expect(checkpointList).toBeVisible()
    const filenames = page.locator(`[data-testid="job-${jobId}-param-checkpoint-filename"]`)
    await expect(filenames).toHaveCount(2)
    await expect(filenames.nth(0)).toContainText('.safetensors')
    await expect(filenames.nth(1)).toContainText('.safetensors')
  })

  // AC3: Detail view is dismissible via the close button
  test('AC3: clicking the close button dismisses the parameter panel', async ({ page, request }) => {
    // AC: FE: Detail view is dismissible (click outside or close button)
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    const titleBtn = page.locator(`[data-testid="job-${jobId}-title"]`)
    await expect(titleBtn).toBeVisible()
    await titleBtn.click()

    const paramsPanel = page.locator(`[data-testid="job-${jobId}-params"]`)
    await expect(paramsPanel).toBeVisible()

    // AC3: Close via the X button
    const closeBtn = page.locator(`[data-testid="job-${jobId}-params-close"]`)
    await expect(closeBtn).toBeVisible()
    await closeBtn.click()

    await expect(paramsPanel).not.toBeVisible()
  })

  // AC3: Detail view is dismissible by clicking the title again (toggle)
  test('AC3: clicking the title again toggles the parameter panel closed', async ({ page, request }) => {
    // AC: FE: Detail view is dismissible (click outside or close button)
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    const titleBtn = page.locator(`[data-testid="job-${jobId}-title"]`)
    await expect(titleBtn).toBeVisible()

    // Open the panel
    await titleBtn.click()
    const paramsPanel = page.locator(`[data-testid="job-${jobId}-params"]`)
    await expect(paramsPanel).toBeVisible()

    // AC3: Click title again to close
    await titleBtn.click()
    await expect(paramsPanel).not.toBeVisible()
  })
})

test.describe('checkpoint filenames in job params panel (S-123)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  // AC4: FE: Job parameter detail panel displays individual checkpoint names
  test('AC4: params panel displays individual checkpoint filenames', async ({ page, request }) => {
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    await openJobProgressPanel(page)

    const titleBtn = page.locator(`[data-testid="job-${jobId}-title"]`)
    await expect(titleBtn).toBeVisible()
    await titleBtn.click()

    const paramsPanel = page.locator(`[data-testid="job-${jobId}-params"]`)
    await expect(paramsPanel).toBeVisible()

    // AC4: Individual checkpoint filenames should be displayed in a list
    const checkpointList = page.locator(`[data-testid="job-${jobId}-param-checkpoint-list"]`)
    await expect(checkpointList).toBeVisible()

    const filenames = page.locator(`[data-testid="job-${jobId}-param-checkpoint-filename"]`)
    await expect(filenames).toHaveCount(2)
    // The 'my-model' training run has two checkpoint files in test-fixtures
    await expect(filenames.nth(0)).toHaveText('my-model-step00001000.safetensors')
    await expect(filenames.nth(1)).toHaveText('my-model-step00002000.safetensors')
  })

  // AC2: BE: SampleJob API response includes checkpoint filename list
  test('AC2: API response includes checkpoint_filenames array', async ({ request }) => {
    const studyId = await createStudyViaAPI(request)
    const jobId = await createJobViaAPI(request, studyId)

    const response = await request.get('/api/sample-jobs')
    expect(response.status()).toBe(200)
    const jobs = await response.json() as Array<Record<string, unknown>>
    const job = jobs.find(j => j.id === jobId)
    expect(job).toBeDefined()

    // AC1+AC2: checkpoint_filenames is present and contains the expected filenames
    const filenames = job!.checkpoint_filenames as string[]
    expect(filenames).toBeDefined()
    expect(Array.isArray(filenames)).toBe(true)
    expect(filenames.length).toBe(2)
    expect(filenames).toContain('my-model-step00001000.safetensors')
    expect(filenames).toContain('my-model-step00002000.safetensors')
  })
})
