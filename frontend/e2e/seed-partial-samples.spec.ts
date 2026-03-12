import { test, expect, type APIRequestContext } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for W-017: Incomplete-set E2E test infra (partial sample seeding).
 *
 * These tests verify that the /api/test/seed-partial-samples endpoint can be used
 * to create partial sample directory structures for a study, enabling E2E coverage
 * of the incomplete-set (sample_status='partial') code path without running a
 * full generation job.
 *
 * ## What is tested
 *
 * AC1: BE: Test-only API endpoint seeds partial sample directories for a study
 * AC2: BE: Endpoint is only available in test mode
 * AC3: E2E: At least one E2E test uses partial seeding to verify incomplete-set behavior
 */

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
 * Seeds partial sample directories via the test-only endpoint.
 * Returns the list of created directory paths.
 */
async function seedPartialSamples(
  request: APIRequestContext,
  trainingRunName: string,
  studyId: string,
  checkpointFilenames: string[],
): Promise<string[]> {
  const resp = await request.post('/api/test/seed-partial-samples', {
    data: {
      training_run_name: trainingRunName,
      study_id: studyId,
      checkpoint_filenames: checkpointFilenames,
    },
  })
  // AC2: Endpoint is available in test mode (ENABLE_TEST_ENDPOINTS=true in docker-compose.test.yml)
  expect(resp.status()).toBe(201)
  const body = await resp.json() as { created_dirs: string[] }
  return body.created_dirs
}

/**
 * Gets the training run ID for a named run from the API.
 */
async function getTrainingRunId(request: APIRequestContext, runName: string): Promise<number> {
  const resp = await request.get('/api/training-runs?source=checkpoints')
  expect(resp.ok()).toBeTruthy()
  const runs = await resp.json() as Array<{ id: number; name: string }>
  const run = runs.find(r => r.name === runName)
  expect(run).toBeDefined()
  return run!.id
}

test.describe('seed-partial-samples endpoint (W-017)', () => {
  test.setTimeout(30000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: BE: Test-only API endpoint seeds partial sample directories for a study
  // AC2: BE: Endpoint is only available in test mode
  test('AC1+AC2: endpoint creates partial sample directories and returns their paths', async ({ request }) => {
    // AC: BE: Test-only API endpoint seeds partial sample directories for a study
    const studyId = await createStudy(request, `Partial Seed Test ${Date.now()}`)

    // The training run "my-model" has 2 checkpoints in test-fixtures.
    // We seed only 1 of them to produce a partial set.
    const createdDirs = await seedPartialSamples(
      request,
      'my-model',
      studyId,
      ['my-model-step00001000.safetensors'],
    )

    // AC1: Created directories are reported in the response
    expect(createdDirs).toHaveLength(1)
    expect(createdDirs[0]).toContain('my-model-step00001000.safetensors')
    expect(createdDirs[0]).toContain(studyId)
  })

  // AC3: E2E: At least one E2E test uses partial seeding to verify incomplete-set behavior
  test('AC3: partial seeding produces sample_status=partial in the availability API', async ({ request }) => {
    // AC: E2E: Partial seeding enables verification of incomplete-set UI behavior
    const studyId = await createStudy(request, `Partial Status Test ${Date.now()}`)
    const runId = await getTrainingRunId(request, 'my-model')

    // Before seeding: availability should report 'none' (no sample dirs exist)
    const beforeResp = await request.get(`/api/studies/availability?training_run_id=${runId}`)
    expect(beforeResp.ok()).toBeTruthy()
    const beforeAvailabilities = await beforeResp.json() as Array<{
      study_id: string
      sample_status: string
      has_samples: boolean
      checkpoints_with_samples: number
      total_checkpoints: number
    }>
    const beforeStudyAvail = beforeAvailabilities.find(a => a.study_id === studyId)
    expect(beforeStudyAvail).toBeDefined()
    // AC3: Before seeding, the study has no samples
    expect(beforeStudyAvail!.sample_status).toBe('none')
    expect(beforeStudyAvail!.has_samples).toBe(false)
    expect(beforeStudyAvail!.checkpoints_with_samples).toBe(0)

    // Seed partial samples: only 1 of the 2 checkpoints in "my-model"
    await seedPartialSamples(
      request,
      'my-model',
      studyId,
      ['my-model-step00001000.safetensors'],
    )

    // After seeding 1 of 2 checkpoints: availability must report 'partial'
    const afterResp = await request.get(`/api/studies/availability?training_run_id=${runId}`)
    expect(afterResp.ok()).toBeTruthy()
    const afterAvailabilities = await afterResp.json() as Array<{
      study_id: string
      sample_status: string
      has_samples: boolean
      checkpoints_with_samples: number
      total_checkpoints: number
    }>
    const afterStudyAvail = afterAvailabilities.find(a => a.study_id === studyId)
    expect(afterStudyAvail).toBeDefined()

    // AC3: After partial seeding, sample_status must be 'partial' (incomplete set)
    expect(afterStudyAvail!.sample_status).toBe('partial')
    expect(afterStudyAvail!.has_samples).toBe(true)
    // 1 of 2 checkpoints has samples
    expect(afterStudyAvail!.checkpoints_with_samples).toBe(1)
    expect(afterStudyAvail!.total_checkpoints).toBe(2)
  })

  // AC3: The yellow problem bead is shown for a study with partial sample_status
  // and no running/pending jobs (incomplete set without in-flight activity).
  test('AC3: partial seeding enables verification of yellow study bead (incomplete-set UI behavior)', async ({ request, page }) => {
    // AC: E2E: At least one E2E test uses partial seeding to verify incomplete-set behavior
    const studyId = await createStudy(request, `Yellow Bead Study ${Date.now()}`)

    // Seed only 1 of 2 checkpoints → availability = 'partial'
    await seedPartialSamples(
      request,
      'my-model',
      studyId,
      ['my-model-step00001000.safetensors'],
    )

    await page.goto('/', { waitUntil: 'networkidle' })

    // Open the sidebar drawer to select training run
    const trainingRunSelect = page.locator('[data-testid="training-run-select"]')
    await expect(trainingRunSelect).toBeVisible()
    // Wait for select to be enabled
    await expect(trainingRunSelect.locator('.n-base-selection--disabled')).toHaveCount(0)
    await trainingRunSelect.click()
    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()
    await popup.getByText('my-model', { exact: true }).click()
    await expect(popup).not.toBeVisible()

    // Wait for the main content to load
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Close the sidebar drawer so header controls are accessible
    const drawerCloseButton = page.locator('[aria-label="close"]').first()
    if (await drawerCloseButton.isVisible()) {
      await drawerCloseButton.click()
      await expect(drawerCloseButton).not.toBeVisible()
      await page.waitForTimeout(300)
    }

    // Open the Generate Samples dialog
    const generateButton = page.locator('[data-testid="generate-samples-button"]')
    await expect(generateButton).toBeVisible()
    await generateButton.click()

    const dialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Generate Samples' })
    await expect(dialog).toBeVisible()

    // Select "my-model" in the dialog's training run dropdown
    const dialogTrainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await expect(dialogTrainingRunSelect).toBeVisible()
    await dialogTrainingRunSelect.click()
    const runPopup = page.locator('.n-base-select-menu:visible')
    await expect(runPopup).toBeVisible()
    await runPopup.getByText('my-model', { exact: true }).click()
    await expect(runPopup).not.toBeVisible()

    // Wait for study data to load (availability API call)
    await page.waitForLoadState('networkidle')

    // Open the study dropdown
    const studySelect = dialog.locator('[data-testid="study-select"]')
    await studySelect.click()
    const studyPopup = page.locator('.n-base-select-menu:visible')
    await expect(studyPopup).toBeVisible()

    // Find the study option we seeded partial samples for
    const studyOption = studyPopup.locator('.n-base-select-option').filter({ hasText: /Yellow Bead Study/ })
    await expect(studyOption).toBeVisible()

    // AC3: The yellow problem bead should be visible because sample_status='partial'
    // and there are no running/pending jobs for this study.
    const problemBead = studyOption.locator('[data-testid="study-bead-problem"]')
    await expect(problemBead).toBeVisible()
    // Yellow bead title shows checkpoint counts, e.g. "1/2 checkpoints have samples"
    // (or falls back to 'incomplete' when counts are unavailable)
    const problemBeadTitle = await problemBead.getAttribute('title')
    expect(problemBeadTitle).toBeTruthy()
    // Title must indicate incompleteness: either count-based or the fallback 'incomplete'
    const isIncompleteTitle =
      problemBeadTitle === 'incomplete' ||
      (problemBeadTitle !== null && /\d+\/\d+ checkpoints have samples/.test(problemBeadTitle))
    expect(isIncompleteTitle).toBe(true)

    // No activity bead (no running/pending jobs)
    const activityBead = studyOption.locator('[data-testid="study-bead-activity"]')
    await expect(activityBead).toHaveCount(0)

    await page.keyboard.press('Escape')
  })

  // AC1: Seeding all checkpoints produces sample_status='complete' (full set)
  test('AC1: seeding all checkpoints produces sample_status=complete', async ({ request }) => {
    // AC: BE: Test-only API endpoint seeds partial (or full) sample directories for a study
    const studyId = await createStudy(request, `Full Seed Test ${Date.now()}`)
    const runId = await getTrainingRunId(request, 'my-model')

    // Seed both checkpoints in "my-model"
    await seedPartialSamples(
      request,
      'my-model',
      studyId,
      [
        'my-model-step00001000.safetensors',
        'my-model-step00002000.safetensors',
      ],
    )

    const resp = await request.get(`/api/studies/availability?training_run_id=${runId}`)
    expect(resp.ok()).toBeTruthy()
    const availabilities = await resp.json() as Array<{
      study_id: string
      sample_status: string
      checkpoints_with_samples: number
      total_checkpoints: number
    }>
    const studyAvail = availabilities.find(a => a.study_id === studyId)
    expect(studyAvail).toBeDefined()

    // All checkpoints seeded → 'complete'
    expect(studyAvail!.sample_status).toBe('complete')
    expect(studyAvail!.checkpoints_with_samples).toBe(2)
    expect(studyAvail!.total_checkpoints).toBe(2)
  })

  // AC1: Seeding an empty checkpoint list produces sample_status='none' (no set)
  test('AC1: seeding no checkpoints leaves sample_status=none', async ({ request }) => {
    // AC: BE: Endpoint handles empty checkpoint list gracefully
    const studyId = await createStudy(request, `Empty Seed Test ${Date.now()}`)
    const runId = await getTrainingRunId(request, 'my-model')

    const createdDirs = await seedPartialSamples(request, 'my-model', studyId, [])
    expect(createdDirs).toHaveLength(0)

    const resp = await request.get(`/api/studies/availability?training_run_id=${runId}`)
    expect(resp.ok()).toBeTruthy()
    const availabilities = await resp.json() as Array<{
      study_id: string
      sample_status: string
    }>
    const studyAvail = availabilities.find(a => a.study_id === studyId)
    expect(studyAvail).toBeDefined()
    expect(studyAvail!.sample_status).toBe('none')
  })
})
