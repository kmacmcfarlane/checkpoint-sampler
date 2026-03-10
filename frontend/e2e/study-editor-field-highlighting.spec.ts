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
 * E2E tests for field-level validation error highlighting in the study editor (S-101).
 *
 * Verifies:
 *   - AC 1: Fields with validation errors are visually highlighted (red border or similar)
 *   - AC 2: For duplicate values, all duplicate occurrences except the first are highlighted
 *   - AC 3: Highlight clears when the validation error is resolved
 *
 * For NDynamicTags (steps, cfgs, seeds), individual duplicate tags are highlighted using
 * NTag type="error" via the renderTag prop. Naive UI renders error-type NTags with red
 * CSS custom properties (e.g. --n-border with red color). We verify the duplicate tag has
 * a different border color (reddish) than a non-duplicate tag.
 */

async function openManageStudiesEditor(page: Page): Promise<void> {
  const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
  await expect(manageStudiesButton).toBeVisible()
  await manageStudiesButton.click()
  await expect(getManageStudiesDialog(page)).toBeVisible()
}

test.describe('study editor field validation highlighting (S-101)', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
    await openManageStudiesEditor(page)
    await page.locator('[data-testid="new-study-button"]').click()
  })

  // AC 1: Fields with validation errors are visually highlighted
  test('study name input gets error status when disallowed character is entered', async ({ page }) => {
    // AC: FE: Fields with validation errors are visually highlighted (red border or similar)
    // We verify: (a) the validation error alert appears (proof of error state)
    // and (b) the NInput wrapper has the Naive UI error-status CSS class (visual highlight).
    await fillStudyName(page, 'Bad(Name)')
    await fillFirstPromptRow(page, 'test', 'a test prompt')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // The validation error alert confirms the field is in error state
    const validationAlert = page.locator('[data-testid="local-validation-error"]')
    await expect(validationAlert).toBeVisible()
    await expect(validationAlert).toContainText('disallowed characters')

    // The NInput with status="error" gets n-input--error-status on its root element.
    // The data-testid is on the NInput component which renders the root div.
    const studyNameWrapper = page.locator('[data-testid="study-name-input"]')
    await expect(studyNameWrapper).toBeVisible()
    await expect(studyNameWrapper).toHaveClass(/n-input--error-status/)
  })

  // AC 3: Highlight clears when the validation error is resolved
  test('study name error styling clears when invalid characters are removed', async ({ page }) => {
    // AC: FE: Highlight clears when the validation error is resolved
    await fillStudyName(page, 'Bad:Name')
    await fillFirstPromptRow(page, 'test', 'a test prompt')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // Confirm error state is active
    const validationAlert = page.locator('[data-testid="local-validation-error"]')
    await expect(validationAlert).toBeVisible()

    const studyNameWrapper = page.locator('[data-testid="study-name-input"]')
    await expect(studyNameWrapper).toHaveClass(/n-input--error-status/)

    // Fix the name
    await fillStudyName(page, 'GoodName')

    // Error styling and alert should be gone
    await expect(studyNameWrapper).not.toHaveClass(/n-input--error-status/)
    await expect(validationAlert).not.toBeVisible()
  })

  // AC 1 + AC 2: The specific duplicate tag is highlighted, not just a container
  test('duplicate step tag is highlighted with error styling, first occurrence is not', async ({ page }) => {
    // AC: FE: Fields with validation errors are visually highlighted (red border or similar)
    // AC: FE: For duplicate values, all duplicate occurrences except the first are highlighted
    await fillStudyName(page, 'Test Steps Highlight')
    await fillFirstPromptRow(page, 'test', 'a test prompt')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // Add a duplicate step: default is 30, add another 30
    const stepsAddButton = page.locator('[data-testid="steps-tags-add"]')
    await stepsAddButton.click()
    const stepsInput = page.locator('[data-testid="steps-tags"] input').last()
    await stepsInput.fill('30')
    await stepsInput.press('Enter')

    // The first tag (index 0, original '30') should NOT be highlighted
    const firstTag = page.locator('[data-testid="step-tag-0"]')
    await expect(firstTag).toBeVisible()

    // The second tag (index 1, duplicate '30') SHOULD be highlighted (error border color)
    const duplicateTag = page.locator('[data-testid="step-tag-1"]')
    await expect(duplicateTag).toBeVisible()

    // Verify duplicate tag has a reddish border (Naive UI error type uses rgba(208,48,80,...))
    const duplicateBorder = await duplicateTag.evaluate(
      el => getComputedStyle(el).getPropertyValue('--n-border').trim()
    )
    expect(duplicateBorder).toMatch(/208.*48.*80|d03050/i)

    // Verify first tag does NOT have a reddish border
    const firstBorder = await firstTag.evaluate(
      el => getComputedStyle(el).getPropertyValue('--n-border').trim()
    )
    expect(firstBorder).not.toMatch(/208.*48.*80|d03050/i)
  })

  // AC 3: Steps error clears when duplicate is removed
  test('duplicate step tag error styling clears when duplicate is removed', async ({ page }) => {
    // AC: FE: Highlight clears when the validation error is resolved
    await fillStudyName(page, 'Test Steps Clear')
    await fillFirstPromptRow(page, 'test', 'a test prompt')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // Add a duplicate step
    const stepsAddButton = page.locator('[data-testid="steps-tags-add"]')
    await stepsAddButton.click()
    const stepsInput = page.locator('[data-testid="steps-tags"] input').last()
    await stepsInput.fill('30')
    await stepsInput.press('Enter')

    // Confirm duplicate tag (index 1) is highlighted
    const duplicateTag = page.locator('[data-testid="step-tag-1"]')
    await expect(duplicateTag).toBeVisible()
    const borderBefore = await duplicateTag.evaluate(
      el => getComputedStyle(el).getPropertyValue('--n-border').trim()
    )
    expect(borderBefore).toMatch(/208.*48.*80|d03050/i)

    // Remove the duplicate tag using its close button
    await duplicateTag.locator('.n-tag__close').click()

    // The duplicate tag should be gone; only the original tag remains at index 0
    await expect(duplicateTag).not.toBeVisible()
    const firstTag = page.locator('[data-testid="step-tag-0"]')
    await expect(firstTag).toBeVisible()
    const borderAfter = await firstTag.evaluate(
      el => getComputedStyle(el).getPropertyValue('--n-border').trim()
    )
    expect(borderAfter).not.toMatch(/208.*48.*80|d03050/i)
  })

  // AC 2: Only the duplicate-containing field tags are highlighted, not all tags
  test('only duplicate step tags are highlighted, not cfg or seed tags', async ({ page }) => {
    // AC: FE: For duplicate values, all duplicate occurrences except the first are highlighted
    await fillStudyName(page, 'Test Only Highlighted')
    await fillFirstPromptRow(page, 'test', 'a test prompt')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // Add a duplicate step: default is 30, add another 30
    const stepsAddButton = page.locator('[data-testid="steps-tags-add"]')
    await stepsAddButton.click()
    const stepsInput = page.locator('[data-testid="steps-tags"] input').last()
    await stepsInput.fill('30')
    await stepsInput.press('Enter')

    // The duplicate step tag (index 1) should be highlighted
    const duplicateStepTag = page.locator('[data-testid="step-tag-1"]')
    await expect(duplicateStepTag).toBeVisible()
    const stepBorder = await duplicateStepTag.evaluate(
      el => getComputedStyle(el).getPropertyValue('--n-border').trim()
    )
    expect(stepBorder).toMatch(/208.*48.*80|d03050/i)

    // The CFG tag (index 0, no duplicates) should NOT be highlighted
    const cfgTag = page.locator('[data-testid="cfg-tag-0"]')
    await expect(cfgTag).toBeVisible()
    const cfgBorder = await cfgTag.evaluate(
      el => getComputedStyle(el).getPropertyValue('--n-border').trim()
    )
    expect(cfgBorder).not.toMatch(/208.*48.*80|d03050/i)

    // The seed tag (index 0, no duplicates) should NOT be highlighted
    const seedTag = page.locator('[data-testid="seed-tag-0"]')
    await expect(seedTag).toBeVisible()
    const seedBorder = await seedTag.evaluate(
      el => getComputedStyle(el).getPropertyValue('--n-border').trim()
    )
    expect(seedBorder).not.toMatch(/208.*48.*80|d03050/i)
  })
})
