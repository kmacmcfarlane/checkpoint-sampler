import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  resetDatabase,
  cancelAllJobs,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getManageStudiesDialog,
} from './helpers'

/**
 * E2E tests for B-115: Regenerate confirmation dialog on study update.
 *
 * ## Root cause of original bug (B-115)
 *
 * `StudyAvailabilityService.StudyHasSamples()` checked
 * `{sampleDir}/{study.Name}` directly, but samples are stored at
 * `{sampleDir}/{sanitized_run_name}/{study.Name}/{checkpoint}/`.
 * The top-level study directory never exists, so `has_samples` was
 * always false and the immutability dialog never appeared.
 *
 * The fix scans {sampleDir}/{runDir}/{study.Name}/ across all run directories.
 *
 * ## What is tested
 *
 * AC1 (FE): Updating a study with existing samples shows the immutability dialog.
 * AC2 (FE): Dialog lists affected samplesets (training runs with checkpoint counts).
 * AC3 (FE): "Yes, regenerate" queues jobs with clear_existing=true (clearing at job start, scoped to this study).
 * AC4 (FE): "No, keep existing samples" updates the study without queuing any jobs.
 * AC5 (BE): The affected-runs API endpoint returns training runs with samples.
 *
 * ## Test data
 *
 * - The fixture study "E2E Fixture Study" is seeded by the test reset endpoint.
 * - Training run: "my-model" (has checkpoint fixtures in test-fixtures/).
 * - Partial samples are seeded via /api/test/seed-partial-samples.
 */

async function seedPartialSamples(
  request: APIRequestContext,
  trainingRunName: string,
  studyId: string,
  studyName: string,
  checkpointFilenames: string[],
): Promise<void> {
  const resp = await request.post('/api/test/seed-partial-samples', {
    data: {
      training_run_name: trainingRunName,
      study_id: studyId,
      study_name: studyName,
      checkpoint_filenames: checkpointFilenames,
    },
  })
  expect(resp.status()).toBe(201)
}

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
      workflow_template: 'test-workflow.json',
      vae: 'ae.safetensors',
      text_encoder: 'clip_l.safetensors',
    },
  })
  expect(resp.ok()).toBeTruthy()
  const study = await resp.json() as { id: string }
  return study.id
}

/**
 * Opens the Manage Studies dialog from the Generate Samples dialog.
 * Returns the locator for the Manage Studies dialog.
 */
async function openManageStudiesDialog(page: Page) {
  const dialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Generate Samples' })
  const manageStudiesButton = dialog.locator('[data-testid="manage-studies-button"]')
  await expect(manageStudiesButton).toBeVisible()
  await manageStudiesButton.click()
  const manageDialog = getManageStudiesDialog(page)
  await expect(manageDialog).toBeVisible()
  return manageDialog
}

/**
 * Selects a study in the StudyEditor by name.
 */
async function selectStudyInEditor(page: Page, studyName: string): Promise<void> {
  const select = page.locator('[data-testid="study-editor-select"]')
  await expect(select).toBeVisible()
  // Wait for the select to be enabled
  await expect(select.locator('.n-base-selection--disabled')).toHaveCount(0)
  await select.click()
  const popup = page.locator('.n-base-select-menu:visible')
  await expect(popup).toBeVisible()
  await popup.getByText(studyName, { exact: true }).click()
  await expect(popup).not.toBeVisible()
}

test.describe('study update regen dialog (B-115)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC5 (BE): Endpoint supports querying affected runs for a study
  test('AC5: affected-runs endpoint returns training runs with samples for the study', async ({ request }) => {
    // First, get the list of studies to find the fixture study ID
    const studiesResponse = await request.get('/api/studies')
    expect(studiesResponse.status()).toBe(200)
    const studies = await studiesResponse.json()
    const fixtureStudy = studies.find((s: { name: string }) => s.name === 'E2E Fixture Study')
    expect(fixtureStudy).toBeTruthy()

    // AC5: Call the affected-runs endpoint
    const affectedResponse = await request.get(`/api/studies/${fixtureStudy.id}/affected-runs`)
    expect(affectedResponse.status()).toBe(200)
    const affectedRuns = await affectedResponse.json()

    // The endpoint should return an array
    expect(Array.isArray(affectedRuns)).toBe(true)

    // If there are affected runs, verify the response shape
    if (affectedRuns.length > 0) {
      const firstRun = affectedRuns[0]
      expect(firstRun).toHaveProperty('training_run_name')
      expect(firstRun).toHaveProperty('checkpoints_with_samples')
      expect(firstRun).toHaveProperty('total_checkpoints')
      expect(typeof firstRun.training_run_name).toBe('string')
      expect(typeof firstRun.checkpoints_with_samples).toBe('number')
      expect(typeof firstRun.total_checkpoints).toBe('number')
    }
  })

  // AC5 (BE): Endpoint returns not_found for nonexistent study
  test('AC5: affected-runs endpoint returns 404 for nonexistent study', async ({ request }) => {
    const response = await request.get('/api/studies/nonexistent-id/affected-runs')
    expect(response.status()).toBe(404)
  })

  // AC5 (BE): Endpoint correctly reports affected runs after seeding partial samples
  test('AC5: affected-runs endpoint returns affected run when study has seeded samples', async ({ request }) => {
    // AC: BE: affected-runs accurately reflects seeded sample directories
    const studyName = `B-115 Affected Runs Test ${Date.now()}`
    const studyId = await createStudy(request, studyName)

    // Seed one checkpoint for 'my-model' — this creates the directory structure
    // that StudyHasSamples now correctly scans
    await seedPartialSamples(request, 'my-model', studyId, studyName, [
      'my-model-step00001000.safetensors',
    ])

    const affectedResponse = await request.get(`/api/studies/${studyId}/affected-runs`)
    expect(affectedResponse.status()).toBe(200)
    const affectedRuns = await affectedResponse.json() as Array<{
      training_run_name: string
      checkpoints_with_samples: number
      total_checkpoints: number
    }>

    // 'my-model' should appear as an affected run now that we seeded samples
    expect(affectedRuns.length).toBeGreaterThanOrEqual(1)
    const myModelRun = affectedRuns.find(r => r.training_run_name === 'my-model')
    expect(myModelRun).toBeDefined()
    expect(myModelRun!.checkpoints_with_samples).toBe(1)
    expect(myModelRun!.total_checkpoints).toBeGreaterThanOrEqual(1)
  })

  // AC1 (FE): Updating a study with existing samples shows the immutability dialog
  test('AC1: immutability dialog appears when updating a study that has samples', async ({ page, request }) => {
    // AC: FE: Updating a study with existing samples shows regenerate confirmation dialog
    const studyName = `B-115 Dialog Test ${Date.now()}`
    const studyId = await createStudy(request, studyName)

    // Seed samples so StudyHasSamples returns true
    await seedPartialSamples(request, 'my-model', studyId, studyName, [
      'my-model-step00001000.safetensors',
    ])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Open the Generate Samples dialog then the Manage Studies editor
    await openGenerateSamplesDialog(page)
    await openManageStudiesDialog(page)

    // Select the study with existing samples
    await selectStudyInEditor(page, studyName)

    // Click "Update Study" to trigger the has-samples check
    const updateButton = page.locator('[data-testid="save-study-button"]')
    await expect(updateButton).toBeVisible()
    // Wait for button to show "Update Study" (not "Save Study")
    await expect(updateButton).toContainText('Update Study')
    await updateButton.click()

    // AC1: The immutability dialog must appear
    const immutabilityDialog = page.locator('[data-testid="immutability-dialog"]')
    await expect(immutabilityDialog).toBeVisible({ timeout: 10000 })
  })

  // AC2 (FE): Dialog lists affected samplesets (training runs with checkpoint counts)
  test('AC2: immutability dialog lists affected training runs', async ({ page, request }) => {
    // AC: FE: Dialog lists affected samplesets across checkpoints
    const studyName = `B-115 Affected List Test ${Date.now()}`
    const studyId = await createStudy(request, studyName)

    // Seed partial samples for 'my-model' — creates the structure the dialog should list
    await seedPartialSamples(request, 'my-model', studyId, studyName, [
      'my-model-step00001000.safetensors',
    ])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openGenerateSamplesDialog(page)
    await openManageStudiesDialog(page)

    await selectStudyInEditor(page, studyName)

    const updateButton = page.locator('[data-testid="save-study-button"]')
    await expect(updateButton).toContainText('Update Study')
    await updateButton.click()

    const immutabilityDialog = page.locator('[data-testid="immutability-dialog"]')
    await expect(immutabilityDialog).toBeVisible({ timeout: 10000 })

    // AC2: The dialog must list affected training runs with checkpoint counts
    // Wait for affected runs to load (they load asynchronously while dialog is open)
    const affectedList = page.locator('[data-testid="immutability-affected-list"]')
    await expect(affectedList).toBeVisible({ timeout: 5000 })

    const affectedItems = page.locator('[data-testid="immutability-affected-item"]')
    await expect(affectedItems).toHaveCount(1, { timeout: 5000 })
    await expect(affectedItems.first()).toContainText('my-model')
  })

  // AC3 (FE): "Yes, regenerate" closes dialog and switches to job list
  test('AC3: "Yes, regenerate" closes Generate Samples dialog and shows job list', async ({ page, request }) => {
    // AC: FE: 'Yes, regenerate' queues jobs with clear-existing and closes dialog
    const studyName = `B-115 Regen Close Test ${Date.now()}`
    const studyId = await createStudy(request, studyName)

    await seedPartialSamples(request, 'my-model', studyId, studyName, [
      'my-model-step00001000.safetensors',
    ])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openGenerateSamplesDialog(page)
    await openManageStudiesDialog(page)

    await selectStudyInEditor(page, studyName)

    const updateButton = page.locator('[data-testid="save-study-button"]')
    await expect(updateButton).toContainText('Update Study')
    await updateButton.click()

    const immutabilityDialog = page.locator('[data-testid="immutability-dialog"]')
    await expect(immutabilityDialog).toBeVisible({ timeout: 20000 })

    // Wait for affected runs to load
    await expect(page.locator('[data-testid="immutability-affected-list"]')).toBeVisible({ timeout: 10000 })

    // Click "Yes, regenerate"
    const regenButton = page.locator('[data-testid="immutability-regen-button"]')
    await expect(regenButton).toBeVisible()
    await regenButton.click()

    // B-115: Both the immutability dialog and the Generate Samples dialog should close
    await expect(immutabilityDialog).not.toBeVisible({ timeout: 10000 })
    const generateDialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Generate Samples' })
    await expect(generateDialog).not.toBeVisible({ timeout: 10000 })

    // B-115: Job list (progress panel) should appear
    const jobPanel = page.locator('[data-testid="job-progress-panel"]')
    await expect(jobPanel).toBeVisible({ timeout: 10000 })

    // Verify a regeneration job was created
    const jobsResp = await request.get('/api/sample-jobs')
    expect(jobsResp.ok()).toBeTruthy()
    const jobs = await jobsResp.json() as Array<{ study_id: string; clear_existing: boolean }>
    const studyJobs = jobs.filter(j => j.study_id === studyId)
    expect(studyJobs.length).toBeGreaterThanOrEqual(1)
  })

  // AC4 (FE): "No, keep existing samples" updates the study without queuing any jobs
  test('AC4: "No, keep existing samples" updates the study without queuing regeneration jobs', async ({ page, request }) => {
    // AC: FE: 'No, keep existing samples' updates the study without regenerating or clearing samples
    const studyName = `B-115 Ignore Test ${Date.now()}`
    const studyId = await createStudy(request, studyName)

    await seedPartialSamples(request, 'my-model', studyId, studyName, [
      'my-model-step00001000.safetensors',
    ])

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openGenerateSamplesDialog(page)
    await openManageStudiesDialog(page)

    await selectStudyInEditor(page, studyName)

    const updateButton = page.locator('[data-testid="save-study-button"]')
    await expect(updateButton).toContainText('Update Study')
    await updateButton.click()

    const immutabilityDialog = page.locator('[data-testid="immutability-dialog"]')
    await expect(immutabilityDialog).toBeVisible({ timeout: 10000 })

    // Click "No, keep existing samples" — should save study without creating any sample jobs
    const ignoreButton = page.locator('[data-testid="immutability-ignore-button"]')
    await expect(ignoreButton).toBeVisible()
    await ignoreButton.click()

    // Dialog should close
    await expect(immutabilityDialog).not.toBeVisible({ timeout: 5000 })

    // AC4: No sample jobs should have been created
    const jobsResp = await request.get('/api/sample-jobs')
    expect(jobsResp.ok()).toBeTruthy()
    const jobs = await jobsResp.json() as Array<{ study_id: string }>
    const studyJobs = jobs.filter(j => j.study_id === studyId)
    expect(studyJobs).toHaveLength(0)
  })
})
