import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  getManageStudiesDialog,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
} from './helpers'

/**
 * E2E tests for S-086: Study selector UX and sample availability.
 * E2E tests for S-088: Study dropdown status beads.
 *
 * Verifies:
 * - AC1: Checkpoint picker requires study selection (not just training run)
 * - AC2: Study availability API returns sample status for the availability bead
 * - AC5: API returns flat availability with has_samples boolean per study
 * - S-088 AC4: API returns per-study sample_status field ('none'|'partial'|'complete')
 *
 * Test fixture data:
 *   - Training run "my-model" with 2 checkpoints (from test-fixtures/)
 *   - No study sample directories exist in test-fixtures/samples/ so
 *     availability returns has_samples=false and sample_status='none' for
 *     newly-created studies
 */

/**
 * Selects a Naive UI NSelect option within a specific container.
 */
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

test.describe('study availability and selector (S-086)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC5: Availability API returns flat availability with has_samples boolean per study
  test('availability API returns study availability with has_samples boolean', async ({ request }) => {
    // Create a study so the availability response has at least one entry
    const studyResp = await request.post('/api/studies', {
      data: {
        name: `Avail Test ${Date.now()}`,
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test prompt' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(studyResp.ok()).toBeTruthy()
    const study = await studyResp.json()

    // Get training runs to find a valid training_run_id
    const runsResp = await request.get('/api/training-runs')
    expect(runsResp.ok()).toBeTruthy()
    const runs = await runsResp.json()
    expect(runs.length).toBeGreaterThan(0)
    const runId = runs[0].id

    // AC5: Call the availability endpoint
    const availResp = await request.get(`/api/studies/availability?training_run_id=${runId}`)
    expect(availResp.ok()).toBeTruthy()

    const availabilities = await availResp.json()
    expect(Array.isArray(availabilities)).toBe(true)
    expect(availabilities.length).toBeGreaterThan(0)

    // Find our study in the response
    const studyAvail = availabilities.find((a: { study_id: string }) => a.study_id === study.id)
    expect(studyAvail).toBeDefined()
    expect(studyAvail.study_name).toBe(study.name)

    // has_samples should be a boolean (false since no sample directories exist on disk)
    expect(typeof studyAvail.has_samples).toBe('boolean')
    expect(studyAvail.has_samples).toBe(false)

    // S-088 AC4: sample_status field must be present and be one of the valid enum values
    expect(studyAvail.sample_status).toBeDefined()
    expect(['none', 'partial', 'complete']).toContain(studyAvail.sample_status)
    // No sample directories exist in test fixtures, so status must be 'none'
    expect(studyAvail.sample_status).toBe('none')
  })

  // S-088 AC4: sample_status field is present for every study in the response
  test('availability API returns sample_status for every study in the response', async ({ request }) => {
    // Create two studies to verify sample_status is present on all entries
    const ts = Date.now()
    const study1Resp = await request.post('/api/studies', {
      data: {
        name: `Status Check A ${ts}`,
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test prompt' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(study1Resp.ok()).toBeTruthy()

    const study2Resp = await request.post('/api/studies', {
      data: {
        name: `Status Check B ${ts}`,
        prompt_prefix: '',
        prompts: [{ name: 'portrait', text: 'a portrait prompt' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [5.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [1],
        width: 512,
        height: 512,
      },
    })
    expect(study2Resp.ok()).toBeTruthy()

    const runsResp = await request.get('/api/training-runs')
    expect(runsResp.ok()).toBeTruthy()
    const runs = await runsResp.json()
    expect(runs.length).toBeGreaterThan(0)
    const runId = runs[0].id

    const availResp = await request.get(`/api/studies/availability?training_run_id=${runId}`)
    expect(availResp.ok()).toBeTruthy()

    const availabilities = await availResp.json() as Array<{ study_id: string; sample_status: string }>
    expect(Array.isArray(availabilities)).toBe(true)
    expect(availabilities.length).toBeGreaterThanOrEqual(2)

    // Every entry must have a valid sample_status value
    for (const entry of availabilities) {
      expect(['none', 'partial', 'complete']).toContain(entry.sample_status)
    }
  })

  // Availability API returns 404 for invalid training_run_id
  test('availability API returns 404 for non-existent training run', async ({ request }) => {
    const resp = await request.get('/api/studies/availability?training_run_id=9999')
    expect(resp.status()).toBe(404)
  })

  // AC1: Checkpoint picker is hidden when no study is selected, even with a run with samples.
  // When exactly 1 study exists, the dialog auto-selects it (convenience UX), so we create
  // 2 studies to prevent auto-selection and test the gating behavior explicitly.
  test('checkpoint picker is hidden until study is selected in Generate Samples dialog', async ({ page, request }) => {
    const ts = Date.now()
    // Create 2 studies so the dialog does NOT auto-select one
    const study1Resp = await request.post('/api/studies', {
      data: {
        name: `Gate Test A ${ts}`,
        prompt_prefix: '',
        prompts: [{ name: 'landscape', text: 'a landscape' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(study1Resp.ok()).toBeTruthy()
    const study1 = await study1Resp.json()

    await request.post('/api/studies', {
      data: {
        name: `Gate Test B ${ts}`,
        prompt_prefix: '',
        prompts: [{ name: 'portrait', text: 'a portrait' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [5.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [1],
        width: 512,
        height: 512,
      },
    })

    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select training run (which has samples) but do NOT select a study
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // AC1: Checkpoint picker should NOT be visible without a study selected
    const picker = dialog.locator('[data-testid="checkpoint-picker"]')
    await expect(picker).toHaveCount(0)

    // Now select a study
    await selectNaiveOptionInContainer(page, dialog, 'study-select', study1.name)

    // AC1: Checkpoint picker should now be visible (training run has samples + study selected)
    await expect(picker).toBeVisible({ timeout: 5000 })
  })

  // AC2/AC3: Study select shows study options with renderLabel (bead rendering)
  // In the test environment, no study sample dirs exist, so has_samples is false for all.
  // This test verifies the study select renders options with the study name visible.
  test('study select shows available studies in Generate Samples dialog', async ({ page, request }) => {
    const studyName = `Bead Check ${Date.now()}`
    const studyResp = await request.post('/api/studies', {
      data: {
        name: studyName,
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(studyResp.ok()).toBeTruthy()

    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select training run to trigger availability fetch
    await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

    // Open the study dropdown and verify our study is listed
    const studySelect = dialog.locator('[data-testid="study-select"]')
    await expect(studySelect).toBeVisible()
    await studySelect.click()

    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()

    // The study should be visible in the dropdown options
    await expect(popup.getByText(studyName)).toBeVisible()

    // Close the popup
    await studySelect.click()
  })
})
