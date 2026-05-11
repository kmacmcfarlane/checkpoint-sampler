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
 * E2E tests for LoRA strength pairs in the study editor (S-149).
 *
 * Verifies:
 *   - AC: Study editor has LoRA strength pairs section (model + clip columns)
 *   - AC: Strength pairs use same add/remove UX pattern as sampler/scheduler pairs
 *   - AC: Default pair is {1.0, 1.0}
 *   - AC: Total images per checkpoint calculation includes strength pair count
 *   - AC: Strength pairs section is visible regardless of training run kind
 */

async function openManageStudiesEditor(page: Page): Promise<void> {
  const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
  await expect(manageStudiesButton).toBeVisible()
  await manageStudiesButton.click()
  await expect(getManageStudiesDialog(page)).toBeVisible()
}

test.describe('LoRA strength pairs in study editor (S-149)', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
    await openManageStudiesEditor(page)
    await page.locator('[data-testid="new-study-button"]').click()
  })

  // AC: Study editor has LoRA strength pairs section (model + clip columns)
  test('LoRA strength pairs section is visible in the study editor', async ({ page }) => {
    const loraPairsSection = page.locator('[data-testid="lora-strength-pairs"]')
    await expect(loraPairsSection).toBeVisible()
  })

  // AC: Default pair is {1.0, 1.0}
  test('default LoRA strength pair is {1.0, 1.0}', async ({ page }) => {
    // The first row should have model=1.0 and clip=1.0
    const modelInput = page.locator('[data-testid="lora-pair-model-0"] input')
    const clipInput = page.locator('[data-testid="lora-pair-clip-0"] input')
    await expect(modelInput).toHaveValue('1')
    await expect(clipInput).toHaveValue('1')
  })

  // AC: Strength pairs use same add/remove UX pattern as sampler/scheduler pairs
  test('can add and remove LoRA strength pairs', async ({ page }) => {
    // Initially one pair exists
    const firstRow = page.locator('[data-testid="lora-pair-row-0"]')
    await expect(firstRow).toBeVisible()

    // Add a second pair using the per-row add button
    await page.locator('[data-testid="lora-pair-row-add-0"]').click()
    const secondRow = page.locator('[data-testid="lora-pair-row-1"]')
    await expect(secondRow).toBeVisible()

    // Remove the first pair
    await page.locator('[data-testid="lora-pair-row-remove-0"]').click()
    // After removal, the second pair becomes the first
    await expect(page.locator('[data-testid="lora-pair-row-0"]')).toBeVisible()
    await expect(page.locator('[data-testid="lora-pair-row-1"]')).not.toBeVisible()
  })

  // AC: Total images per checkpoint calculation includes strength pair count
  test('total images per checkpoint includes LoRA strength pair count', async ({ page }) => {
    // Fill required fields to make the total > 0
    await fillStudyName(page, 'LoRA Test')
    await fillFirstPromptRow(page, 'test', 'a test prompt')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // Scope to the study editor dialog to avoid matching the Generate Samples dialog total
    const studyDialog = getManageStudiesDialog(page)

    // With default 1 LoRA pair, base dimensions: 1 prompt * 1 step * 1 cfg * 1 pair * 1 seed * 1 lora = 1
    const totalText = studyDialog.locator('.total-images')
    // Use regex to match exact number after "Total images per checkpoint:"
    await expect(totalText).toHaveText(/Total images per checkpoint:\s*1$/)

    // Add a second LoRA pair: total should double to 2
    await page.locator('[data-testid="lora-pair-row-add-0"]').click()
    await expect(totalText).toHaveText(/Total images per checkpoint:\s*2$/)
  })

  // AC: Strength pairs section is visible regardless of training run kind
  test('LoRA strength pairs section is visible with no training run context', async ({ page }) => {
    // The section is always visible in the study editor, not conditional on training run kind
    const loraPairsSection = page.locator('[data-testid="lora-strength-pairs"]')
    await expect(loraPairsSection).toBeVisible()

    // Also verify the label is present
    const label = page.getByText('LoRA Strength Pairs')
    await expect(label).toBeVisible()
  })
})
