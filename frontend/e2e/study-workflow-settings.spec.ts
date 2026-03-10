import { test, expect } from '@playwright/test'
import {
  resetDatabase,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  getManageStudiesDialog,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
  selectNaiveOption,
} from './helpers'

/**
 * E2E tests for S-112: Workflow template, VAE, text encoder, and shift in study definition.
 *
 * ## What is tested
 *
 * AC: StudyEditor shows workflow template, VAE, CLIP, and (conditionally) shift fields
 * AC: Workflow settings are persisted in the study (round-trip via API)
 * AC: Pre-fill on Regenerate uses study values (no separate dialog fields)
 * AC: MRU workflow template is applied when creating a new study
 */

test.describe('study workflow settings (S-112)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  // AC: StudyEditor shows workflow template, VAE, and CLIP selects when opened
  test('study editor shows workflow template, VAE, and CLIP selects', async ({ page }) => {
    // AC: Workflow settings fields are visible in the study editor
    await openGenerateSamplesDialog(page)
    await expect(getGenerateSamplesDialog(page)).toBeVisible()

    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()

    // New study form should show workflow/VAE/CLIP fields
    await page.locator('[data-testid="new-study-button"]').click()

    const workflowSelect = page.locator('[data-testid="study-workflow-template-select"]')
    await expect(workflowSelect).toBeVisible()

    const vaeSelect = page.locator('[data-testid="study-vae-select"]')
    await expect(vaeSelect).toBeVisible()

    const clipSelect = page.locator('[data-testid="study-clip-select"]')
    await expect(clipSelect).toBeVisible()

    // Shift input should NOT be visible (no workflow selected)
    const shiftInput = page.locator('[data-testid="study-shift-input"]')
    await expect(shiftInput).not.toBeVisible()
  })

  // AC: Workflow settings are persisted when creating a study
  test('workflow template, VAE, and CLIP settings are persisted in the study', async ({ page, request }) => {
    // AC: Creating a study with workflow settings stores them on the study
    const studyName = `S112 Workflow Test ${Date.now()}`

    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)

    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    // Wait for sampler/scheduler pair popup animations to fully complete
    await page.waitForTimeout(500)

    // AC: Select workflow, VAE, and CLIP in the study editor
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')
    await selectNaiveOption(page, 'study-vae-select', 'test-vae.safetensors')
    await selectNaiveOption(page, 'study-clip-select', 'test-clip.safetensors')

    // Verify selected values appear in the form
    const workflowSelect = page.locator('[data-testid="study-workflow-template-select"]')
    await expect(workflowSelect).toContainText('test-workflow.json')

    const vaeSelect = page.locator('[data-testid="study-vae-select"]')
    await expect(vaeSelect).toContainText('test-vae.safetensors')

    const clipSelect = page.locator('[data-testid="study-clip-select"]')
    await expect(clipSelect).toContainText('test-clip.safetensors')

    // Save the study
    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()
    await expect(dialog).toBeVisible()

    // AC: Verify the study was saved with workflow settings via API
    const studiesResp = await request.get('/api/studies')
    expect(studiesResp.status()).toBe(200)
    const studies = await studiesResp.json() as Array<{
      name: string
      workflow_template: string
      vae: string
      text_encoder: string
    }>
    const savedStudy = studies.find(s => s.name === studyName)
    expect(savedStudy).toBeDefined()
    expect(savedStudy!.workflow_template).toBe('test-workflow.json')
    expect(savedStudy!.vae).toBe('test-vae.safetensors')
    expect(savedStudy!.text_encoder).toBe('test-clip.safetensors')
  })

  // AC: Loading a study with workflow settings pre-fills the editor fields
  test('loading an existing study pre-fills workflow, VAE, and CLIP fields', async ({ page, request }) => {
    // AC: When re-opening the study editor for a saved study, workflow settings are pre-filled
    const studyName = `S112 Reload Test ${Date.now()}`

    // Create a study with workflow settings via API
    const createResp = await request.post('/api/studies', {
      data: {
        name: studyName,
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test prompt' }],
        negative_prompt: '',
        steps: [30],
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
    expect(createResp.status()).toBe(201)

    // Open the study editor and select the study
    await openGenerateSamplesDialog(page)
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()

    // Select the created study from the dropdown
    await selectNaiveOption(page, 'study-editor-select', studyName)

    // AC: Workflow settings are pre-filled from the saved study
    const workflowSelect = page.locator('[data-testid="study-workflow-template-select"]')
    await expect(workflowSelect).toContainText('test-workflow.json')

    const vaeSelect = page.locator('[data-testid="study-vae-select"]')
    await expect(vaeSelect).toContainText('test-vae.safetensors')

    const clipSelect = page.locator('[data-testid="study-clip-select"]')
    await expect(clipSelect).toContainText('test-clip.safetensors')
  })

  // AC: JobLaunchDialog no longer shows workflow/VAE/CLIP selectors; only training run + study needed
  test('job launch dialog only requires training run and study, no workflow/VAE/CLIP', async ({ page, request }) => {
    // AC: Submit button is enabled after selecting training run and study (no workflow/VAE/CLIP required)
    const studyName = `S112 Submit Test ${Date.now()}`

    // Create a study (no workflow settings needed)
    await request.post('/api/studies', {
      data: {
        name: studyName,
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test prompt' }],
        negative_prompt: '',
        steps: [30],
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

    await page.reload({ waitUntil: 'networkidle' })
    await openGenerateSamplesDialog(page)
    const dialog = getGenerateSamplesDialog(page)

    // Select training run
    const trainingRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await expect(trainingRunSelect).toBeVisible()
    await trainingRunSelect.click()
    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()
    await popup.getByText('my-model', { exact: true }).click()

    // AC: Workflow/VAE/CLIP selects should NOT be present in the dialog
    const dialogWorkflowSelect = dialog.locator('[data-testid="workflow-select"]')
    await expect(dialogWorkflowSelect).not.toBeVisible()

    const dialogVaeSelect = dialog.locator('[data-testid="vae-select"]')
    await expect(dialogVaeSelect).not.toBeVisible()

    const dialogClipSelect = dialog.locator('[data-testid="clip-select"]')
    await expect(dialogClipSelect).not.toBeVisible()

    // Select study
    const studySelect = dialog.locator('[data-testid="study-select"]')
    await expect(studySelect).toBeVisible()
    await studySelect.click()
    const studyPopup = page.locator('.n-base-select-menu:visible')
    await expect(studyPopup).toBeVisible()
    await studyPopup.getByText(studyName, { exact: true }).click()

    // AC: Submit button should now be enabled (only training run + study needed)
    const submitButton = dialog.locator('button').filter({ hasText: /Generate Samples|Regenerate Samples/ }).first()
    await expect(submitButton).not.toBeDisabled({ timeout: 10000 })
  })
})
