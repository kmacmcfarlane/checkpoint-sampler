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
  selectNaiveMultiOption,
} from './helpers'

/**
 * E2E tests for B-126: VAE/TE autopopulate on workflow auto-select + Shift MRU persistence.
 *
 * ## What is tested
 *
 * AC: VAE and TE fields autopopulate when workflow is auto-selected (same as manual select)
 * AC: Shift value is persisted to and restored from MRU localStorage
 */

test.describe('study MRU auto-fill (B-126)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
  })

  // AC: VAE and TE fields autopopulate when workflow is auto-selected via New Study
  test('VAE and TE auto-fill from MRU when clicking New Study after saving', async ({ page }) => {
    // Step 1: Create a study with workflow + VAE + TE to seed the MRU
    await openGenerateSamplesDialog(page)
    await expect(getGenerateSamplesDialog(page)).toBeVisible()

    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    await fillStudyName(page, 'MRU Seed Study')
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    await page.waitForTimeout(500)

    // Select workflow, VAE, and CLIP
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')
    await selectNaiveMultiOption(page, 'study-vae-select', 'test-vae.safetensors')
    await selectNaiveMultiOption(page, 'study-clip-select', 'test-clip.safetensors')

    // Save the study (which persists MRU for this workflow)
    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // Step 2: Re-open study editor and click "New Study"
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    // Step 3: Verify MRU workflow is auto-selected AND VAE/TE are auto-filled
    const workflowSelect = page.locator('[data-testid="study-workflow-template-select"]')
    await expect(workflowSelect).toContainText('test-workflow.json')

    // AC: VAE and TE should be auto-populated from MRU (not null)
    const vaeSelect = page.locator('[data-testid="study-vae-select"]')
    await expect(vaeSelect).toContainText('test-vae.safetensors')

    const clipSelect = page.locator('[data-testid="study-clip-select"]')
    await expect(clipSelect).toContainText('test-clip.safetensors')
  })

  // AC: Shift value is persisted to and restored from MRU localStorage
  test('shift value persists in MRU and restores on workflow re-select', async ({ page }) => {
    // Step 1: Create a study with AuraFlow workflow (has shift role) + shift value
    await openGenerateSamplesDialog(page)
    await expect(getGenerateSamplesDialog(page)).toBeVisible()

    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    await fillStudyName(page, 'Shift MRU Study')
    await fillFirstPromptRow(page, 'landscape', 'a beautiful landscape')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    await page.waitForTimeout(500)

    // Select AuraFlow workflow (has shift role)
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow-auraflow.json')

    // Set shift value. S-157: shift is now a multi-value NDynamicTags list
    // (mirrors the steps/seeds tags pattern), not a single NInputNumber.
    const shiftInput = page.locator('[data-testid="study-shift-input"]')
    await expect(shiftInput).toBeVisible()
    const shiftAddButton = page.locator('[data-testid="study-shift-add"]')
    await shiftAddButton.click()
    const shiftTagInput = shiftInput.locator('input').last()
    await shiftTagInput.fill('3.5')
    await shiftTagInput.press('Enter')

    // Select VAE and CLIP
    await selectNaiveMultiOption(page, 'study-vae-select', 'test-vae.safetensors')
    await selectNaiveMultiOption(page, 'study-clip-select', 'test-clip.safetensors')

    // Save the study
    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()

    // Step 2: Re-open study editor, click New Study, then select AuraFlow again
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    // If MRU workflow was AuraFlow, it should be auto-selected with shift restored.
    // If MRU workflow was different, manually select AuraFlow.
    const workflowSelect = page.locator('[data-testid="study-workflow-template-select"]')
    const workflowText = await workflowSelect.textContent()
    if (!workflowText?.includes('test-workflow-auraflow.json')) {
      await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow-auraflow.json')
    }

    // AC: Shift value should be restored from MRU. S-157: shift is now a
    // multi-value NDynamicTags list; the restored value renders as a tag.
    const restoredShiftInput = page.locator('[data-testid="study-shift-input"]')
    await expect(restoredShiftInput).toBeVisible()
    await expect(restoredShiftInput).toContainText('3.5')
  })
})
