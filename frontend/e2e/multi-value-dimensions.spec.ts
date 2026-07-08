import { test, expect } from '@playwright/test'
import {
  resetDatabase,
  cancelAllJobs,
  selectTrainingRun,
  selectNaiveOption,
  selectNaiveOptionByLabel,
  openGenerateSamplesDialog,
  getManageStudiesDialog,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
  closeDrawer,
} from './helpers'

/**
 * E2E tests for S-157: promote Resolution, VAE, Text Encoder, and Shift to
 * multi-value study dimensions.
 *
 * This spec is the AC8 gate — it is the only E2E coverage that exercises a
 * genuinely SWEPT (multi-value) dimension end-to-end. All other study-create
 * payloads across the suite use single-value dimensions.
 *
 * AC8: create a study with multiple resolutions and multiple shift values,
 *      verify the generated sample count equals the full cross-product, and
 *      verify the new fields appear as assignable grid dimensions in the viewer.
 *
 * Coverage:
 *   - Test 1 (API): multi-value resolutions × multi-value shifts expand into the
 *     full cross-product of work items (job.total_items).
 *   - Test 2 (API): an empty/undeclared dimension does NOT multiply the
 *     cross-product (story testing requirement).
 *   - Test 3 (UI): the StudyEditor multi-value inputs (resolution list + shift
 *     tags), gated by the AuraFlow workflow's roles, drive the total-images
 *     preview by the correct cross-product.
 *   - Test 4 (viewer): resolution and shift surface as assignable grid
 *     dimensions in the viewer for a fixture run whose samples encode them.
 *
 * Fixture note: the "s157demo" viewer training run is provided by
 * test-fixtures/samples/s157demo-step0000{1000,2000}.safetensors/, whose PNG
 * filenames encode resolution={512x512,768x768} and shift={1,2} so the scanner
 * surfaces both as multi-value (assignable) dimensions.
 */

test.describe('S-157: multi-value study dimensions (AC8)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC8: generated sample count equals the full cross-product.
  // 2 checkpoints × 2 resolutions × 2 shifts × (1 prompt·step·cfg·pair·seed) = 8.
  test('multi-value resolutions × shifts expand to the full cross-product of work items', async ({ request }) => {
    const studyName = `S157 CrossProduct ${Date.now()}`
    const createResp = await request.post('/api/studies', {
      data: {
        name: studyName,
        prompt_prefix: '',
        prompts: [{ name: 'demo', text: 'a demo prompt' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        resolutions: [
          { width: 512, height: 512 },
          { width: 768, height: 768 },
        ],
        shifts: [1.0, 2.0],
        // AuraFlow workflow declares vae_loader / clip_loader / shift roles.
        workflow_template: 'test-workflow-auraflow.json',
      },
    })
    expect(createResp.status()).toBe(201)
    const study = await createResp.json() as { id: string; images_per_checkpoint: number }

    // images_per_checkpoint must reflect resolutions(2) × shifts(2) = 4.
    expect(study.images_per_checkpoint).toBe(4)

    // Create a sample job for the "my-model" checkpoint run (2 checkpoints).
    const jobResp = await request.post('/api/sample-jobs', {
      data: {
        training_run_name: 'my-model',
        study_id: study.id,
      },
    })
    expect(jobResp.status()).toBe(201)
    const job = await jobResp.json() as { total_items: number }

    // Full cross-product: 2 checkpoints × 4 images-per-checkpoint = 8.
    expect(job.total_items).toBe(8)
  })

  // Story testing requirement: an empty list for a dimension must NOT multiply
  // the cross-product (factor of 1) and must not emit a spurious dimension.
  test('empty shift/vae dimensions do not multiply the cross-product', async ({ request }) => {
    const studyName = `S157 SingleValue ${Date.now()}`
    const createResp = await request.post('/api/studies', {
      data: {
        name: studyName,
        prompt_prefix: '',
        prompts: [{ name: 'demo', text: 'a demo prompt' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        // Single resolution, no shifts / vaes / text_encoders.
        resolutions: [{ width: 512, height: 512 }],
        workflow_template: 'test-workflow-auraflow.json',
      },
    })
    expect(createResp.status()).toBe(201)
    const study = await createResp.json() as { id: string; images_per_checkpoint: number }

    // Single-value everything → 1 image per checkpoint (no spurious multiplication).
    expect(study.images_per_checkpoint).toBe(1)

    const jobResp = await request.post('/api/sample-jobs', {
      data: {
        training_run_name: 'my-model',
        study_id: study.id,
      },
    })
    expect(jobResp.status()).toBe(201)
    const job = await jobResp.json() as { total_items: number }

    // 2 checkpoints × 1 = 2 (unchanged by the empty promoted dimensions).
    expect(job.total_items).toBe(2)
  })

  // AC6 / AC1: the StudyEditor multi-value inputs drive the total-images preview
  // by the correct cross-product. Uses AuraFlow so the Shift input is offered
  // (role gating), and adds a second resolution row plus two shift values.
  test('StudyEditor multi-value resolution + shift inputs update the total-images preview', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await openGenerateSamplesDialog(page)
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    await fillStudyName(page, `S157 UI ${Date.now()}`)
    await fillFirstPromptRow(page, 'demo', 'a demo prompt')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    await page.waitForTimeout(300)

    // Select AuraFlow so the shift role is declared and the Shift input appears.
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow-auraflow.json')

    const studyDialog = getManageStudiesDialog(page)
    const totalText = studyDialog.locator('.total-images')

    // Baseline: 1 resolution, 0 shifts → 1 image per checkpoint.
    await expect(totalText).toHaveText(/Total images per checkpoint:\s*1$/)

    // Add a second resolution row → 2 resolutions.
    await page.locator('[data-testid="resolution-row-add-0"]').click()
    await expect(page.locator('[data-testid="resolution-row-1"]')).toBeVisible()
    // 2 resolutions × 0 shifts → 2.
    await expect(totalText).toHaveText(/Total images per checkpoint:\s*2$/)

    // Add two shift values via the NDynamicTags shift input.
    const shiftInput = page.locator('[data-testid="study-shift-input"]')
    await expect(shiftInput).toBeVisible()
    for (const value of ['1', '2']) {
      await page.locator('[data-testid="study-shift-add"]').click()
      const tagInput = shiftInput.locator('input')
      await tagInput.fill(value)
      await tagInput.press('Enter')
    }

    // 2 resolutions × 2 shifts → 4 images per checkpoint (full cross-product).
    await expect(totalText).toHaveText(/Total images per checkpoint:\s*4$/)
  })

  // AC8: the new dimensions appear as assignable grid dimensions in the viewer.
  test('resolution and shift surface as assignable grid dimensions in the viewer', async ({ page }) => {
    await page.goto('/')
    // The s157demo fixture run's samples encode resolution and shift dimensions.
    await selectTrainingRun(page, 's157demo')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Both promoted dimensions must appear as their own dimension rows.
    const resolutionRow = page.locator('[data-testid="dimension-row-resolution"]')
    const shiftRow = page.locator('[data-testid="dimension-row-shift"]')
    await expect(resolutionRow).toBeVisible()
    await expect(shiftRow).toBeVisible()

    // They are multi-value (512x512/768x768 and 1/2), so they must NOT be
    // disabled — i.e. they are assignable to a grid axis / slider role.
    await expect(resolutionRow).not.toHaveClass(/dimension-row--disabled/)
    await expect(shiftRow).not.toHaveClass(/dimension-row--disabled/)

    // Assign resolution → X Axis and shift → Y Axis and confirm the grid renders.
    await selectNaiveOptionByLabel(page, 'Mode for resolution', 'X Axis')
    await expect(resolutionRow.locator('.dimension-mode-select')).toContainText('X Axis')

    await selectNaiveOptionByLabel(page, 'Mode for shift', 'Y Axis')
    await expect(shiftRow.locator('.dimension-mode-select')).toContainText('Y Axis')

    await closeDrawer(page)
    await expect(page.locator('.xy-grid-container')).toBeVisible()
  })
})
