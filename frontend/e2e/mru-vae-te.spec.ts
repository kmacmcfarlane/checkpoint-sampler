import { test, expect } from '@playwright/test'
import {
  resetDatabase,
  openGenerateSamplesDialog,
  getManageStudiesDialog,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
  selectNaiveOption,
} from './helpers'

/**
 * E2E tests for S-113: MRU defaults for VAE and text encoder selections (local storage).
 *
 * ## What is tested
 *
 * AC1: VAE and text encoder MRU values stored in local storage per workflow template
 * AC2: Selecting a workflow auto-fills VAE and text encoder from stored MRU values
 * AC3: MRU defaults do not override values when dialog is pre-filled from existing study load
 * AC4: Select workflow, choose VAE/TE, save, reopen dialog — MRU values are restored
 */

const MRU_VAE_TE_KEY = 'checkpoint-sampler:mru-workflow-vae-te'
const MRU_WORKFLOW_KEY = 'checkpoint-sampler:mru-workflow-template'

test.describe('MRU VAE and text encoder (S-113)', () => {
  test.setTimeout(90000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  // AC4: Select workflow, choose VAE/TE, save, reopen dialog — MRU values are restored
  test('selecting workflow, saving with VAE/TE, then reopening restores MRU values', async ({ page, request }) => {
    const studyName = `S113 MRU Test ${Date.now()}`

    // Open Generate Samples → Manage Studies
    await openGenerateSamplesDialog(page)
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()

    // Click New Study to get a fresh form
    await page.locator('[data-testid="new-study-button"]').click()

    // Fill required fields
    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    await page.waitForTimeout(500)

    // AC1+AC2: Select workflow, then VAE and TE
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')
    await selectNaiveOption(page, 'study-vae-select', 'test-vae.safetensors')
    await selectNaiveOption(page, 'study-clip-select', 'test-clip.safetensors')

    // Save the study (closes Manage Studies dialog)
    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // AC1: Verify MRU was persisted to localStorage
    const mruRaw = await page.evaluate((key) => localStorage.getItem(key), MRU_VAE_TE_KEY)
    expect(mruRaw).not.toBeNull()
    const mru = JSON.parse(mruRaw!)
    expect(mru['test-workflow.json']).toBeDefined()
    expect(mru['test-workflow.json'].vae).toBe('test-vae.safetensors')
    expect(mru['test-workflow.json'].textEncoder).toBe('test-clip.safetensors')

    // AC4: Open Manage Studies again and create a new study
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    // AC2: Select the same workflow — VAE and TE should be auto-filled from MRU
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')

    // Verify VAE and TE were auto-filled
    const vaeSelect = page.locator('[data-testid="study-vae-select"]')
    await expect(vaeSelect).toContainText('test-vae.safetensors')

    const clipSelect = page.locator('[data-testid="study-clip-select"]')
    await expect(clipSelect).toContainText('test-clip.safetensors')
  })

  // AC2: MRU auto-fills VAE and TE when switching between workflows
  test('switching workflows auto-fills VAE/TE per workflow from MRU', async ({ page }) => {
    // Pre-seed MRU with two workflows' values
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: MRU_VAE_TE_KEY,
      value: JSON.stringify({
        'test-workflow.json': { vae: 'test-vae.safetensors', textEncoder: 'test-clip.safetensors' },
      }),
    })

    await openGenerateSamplesDialog(page)
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    // Select workflow that has MRU
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')

    // VAE and TE should be auto-filled from MRU
    const vaeSelect = page.locator('[data-testid="study-vae-select"]')
    await expect(vaeSelect).toContainText('test-vae.safetensors')

    const clipSelect = page.locator('[data-testid="study-clip-select"]')
    await expect(clipSelect).toContainText('test-clip.safetensors')
  })

  // AC3: MRU does not override values when loading an existing study (pre-fill scenario)
  test('loading an existing study does not apply MRU over study values', async ({ page, request }) => {
    const studyName = `S113 PreFill Test ${Date.now()}`

    // Create a study via API with specific VAE/TE values
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

    // Pre-seed MRU with DIFFERENT values for the same workflow
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: MRU_VAE_TE_KEY,
      value: JSON.stringify({
        'test-workflow.json': { vae: 'other-vae.safetensors', textEncoder: 'other-clip.safetensors' },
      }),
    })

    await page.reload({ waitUntil: 'networkidle' })
    await openGenerateSamplesDialog(page)
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()

    // Load the existing study from the dropdown
    await selectNaiveOption(page, 'study-editor-select', studyName)

    // AC3: The study's own VAE/TE values should be shown, NOT the MRU values
    const vaeSelect = page.locator('[data-testid="study-vae-select"]')
    await expect(vaeSelect).toContainText('test-vae.safetensors')
    await expect(vaeSelect).not.toContainText('other-vae.safetensors')

    const clipSelect = page.locator('[data-testid="study-clip-select"]')
    await expect(clipSelect).toContainText('test-clip.safetensors')
    await expect(clipSelect).not.toContainText('other-clip.safetensors')
  })

  // AC4: MRU survives a page refresh (localStorage persistence)
  test('MRU values persist across page refresh', async ({ page, request }) => {
    const studyName = `S113 Refresh Test ${Date.now()}`

    // Create and save a study with workflow/VAE/TE via the UI
    await openGenerateSamplesDialog(page)
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'subject', 'a cool subject')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    await page.waitForTimeout(500)

    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')
    await selectNaiveOption(page, 'study-vae-select', 'test-vae.safetensors')
    await selectNaiveOption(page, 'study-clip-select', 'test-clip.safetensors')

    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // Reload the page to verify localStorage persists
    await page.reload({ waitUntil: 'networkidle' })

    // Verify MRU key is still in localStorage after reload
    const mruRaw = await page.evaluate((key) => localStorage.getItem(key), MRU_VAE_TE_KEY)
    expect(mruRaw).not.toBeNull()
    const mru = JSON.parse(mruRaw!)
    expect(mru['test-workflow.json']).toBeDefined()
    expect(mru['test-workflow.json'].vae).toBe('test-vae.safetensors')
    expect(mru['test-workflow.json'].textEncoder).toBe('test-clip.safetensors')

    // Also verify that opening a new study and selecting the workflow auto-fills
    await openGenerateSamplesDialog(page)
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')

    const vaeSelect = page.locator('[data-testid="study-vae-select"]')
    await expect(vaeSelect).toContainText('test-vae.safetensors')

    const clipSelect = page.locator('[data-testid="study-clip-select"]')
    await expect(clipSelect).toContainText('test-clip.safetensors')
  })

  // AC1: MRU workflow key is also still saved (regression guard)
  test('MRU workflow template key is still stored when saving a study', async ({ page }) => {
    await openGenerateSamplesDialog(page)
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    await fillStudyName(page, `S113 Workflow MRU ${Date.now()}`)
    await fillFirstPromptRow(page, 'subject', 'a subject')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    await page.waitForTimeout(500)

    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')

    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // The workflow MRU key (from S-112) must still be written
    const workflowMru = await page.evaluate((key) => localStorage.getItem(key), MRU_WORKFLOW_KEY)
    expect(workflowMru).toBe('test-workflow.json')
  })
})
