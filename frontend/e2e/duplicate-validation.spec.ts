import { test, expect, type Page } from '@playwright/test'
import {
  resetDatabase,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getManageStudiesDialog,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
} from './helpers'

/**
 * E2E tests for duplicate value validation in the study editor (B-043).
 *
 * Verifies:
 *   - AC 3/4: Duplicate study name shows a validation warning and disables save
 *   - AC 1/2: Duplicate dimension values (steps) show a validation warning and disable save
 *   - Backend rejects duplicate study names with a validation error
 */

/**
 * Opens the Manage Studies editor from within the Generate Samples dialog.
 */
async function openManageStudiesEditor(page: Page): Promise<void> {
  const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
  await expect(manageStudiesButton).toBeVisible()
  await manageStudiesButton.click()
  await expect(getManageStudiesDialog(page)).toBeVisible()
}

test.describe('duplicate value validation (B-043)', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test('shows validation warning when study name matches an existing study', async ({ page }) => {
    // Step 1: Create a study with a known name
    const studyName = `Duplicate Test ${Date.now()}`

    await openGenerateSamplesDialog(page)
    await openManageStudiesEditor(page)

    await page.locator('[data-testid="new-study-button"]').click()
    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()

    // Modal auto-closes after save
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // Step 2: Re-open the editor and try to create another study with the same name
    await openManageStudiesEditor(page)
    await page.locator('[data-testid="new-study-button"]').click()

    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'portrait', 'a dramatic portrait')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // The local validation error alert should appear
    const validationAlert = page.locator('[data-testid="local-validation-error"]')
    await expect(validationAlert).toBeVisible()
    await expect(validationAlert).toContainText('already exists')

    // The save button should be disabled
    await expect(saveButton).toBeDisabled()
  })

  test('allows saving a study with a unique name after fixing duplicate', async ({ page }) => {
    // Step 1: Create a study with a known name
    const studyName = `Unique Fix Test ${Date.now()}`

    await openGenerateSamplesDialog(page)
    await openManageStudiesEditor(page)

    await page.locator('[data-testid="new-study-button"]').click()
    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()

    // Modal auto-closes after save
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // Step 2: Re-open and enter the duplicate name
    await openManageStudiesEditor(page)
    await page.locator('[data-testid="new-study-button"]').click()
    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'portrait', 'a dramatic portrait')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    const validationAlert = page.locator('[data-testid="local-validation-error"]')
    await expect(validationAlert).toBeVisible()
    await expect(saveButton).toBeDisabled()

    // Step 3: Fix the name to a unique one
    const uniqueName = `${studyName} Fixed`
    await fillStudyName(page, uniqueName)

    // Validation alert should disappear
    await expect(validationAlert).not.toBeVisible()

    // Save should be enabled
    await expect(saveButton).not.toBeDisabled()

    // Save should succeed
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()
  })

  test('backend rejects duplicate study name via API', async ({ request }) => {
    // Create a study via API
    const studyName = `API Duplicate Test ${Date.now()}`
    const payload = {
      name: studyName,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'test prompt' }],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 512,
      height: 512,
    }

    const createResponse = await request.post('/api/studies', { data: payload })
    expect(createResponse.status()).toBe(201)

    // Try to create another study with the same name -- should fail
    const duplicateResponse = await request.post('/api/studies', { data: payload })
    expect(duplicateResponse.status()).toBe(400)
    const body = await duplicateResponse.json()
    expect(body.message).toContain('already exists')
  })

  test('backend rejects duplicate step values via API', async ({ request }) => {
    const payload = {
      name: `Step Dup Test ${Date.now()}`,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'test prompt' }],
      negative_prompt: '',
      steps: [30, 20, 30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 512,
      height: 512,
    }

    const response = await request.post('/api/studies', { data: payload })
    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.message).toContain('duplicate step value 30')
  })

  test('backend rejects duplicate seed values via API', async ({ request }) => {
    const payload = {
      name: `Seed Dup Test ${Date.now()}`,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'test prompt' }],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42, 100, 42],
      width: 512,
      height: 512,
    }

    const response = await request.post('/api/studies', { data: payload })
    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.message).toContain('duplicate seed value 42')
  })

  test('backend rejects duplicate CFG values via API', async ({ request }) => {
    const payload = {
      name: `CFG Dup Test ${Date.now()}`,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'test prompt' }],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0, 3.0, 7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 512,
      height: 512,
    }

    const response = await request.post('/api/studies', { data: payload })
    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.message).toContain('duplicate CFG value 7')
  })

  test('backend rejects duplicate sampler/scheduler pairs via API', async ({ request }) => {
    const payload = {
      name: `Pair Dup Test ${Date.now()}`,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'test prompt' }],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [
        { sampler: 'euler', scheduler: 'normal' },
        { sampler: 'heun', scheduler: 'simple' },
        { sampler: 'euler', scheduler: 'normal' },
      ],
      seeds: [42],
      width: 512,
      height: 512,
    }

    const response = await request.post('/api/studies', { data: payload })
    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.message).toContain('duplicate sampler/scheduler pair')
  })

  test('backend rejects duplicate prompt names via API', async ({ request }) => {
    const payload = {
      name: `Prompt Dup Test ${Date.now()}`,
      prompt_prefix: '',
      prompts: [
        { name: 'forest', text: 'a forest scene' },
        { name: 'city', text: 'a city scene' },
        { name: 'forest', text: 'another forest scene' },
      ],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 512,
      height: 512,
    }

    const response = await request.post('/api/studies', { data: payload })
    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.message).toContain('duplicate prompt name')
  })
})
