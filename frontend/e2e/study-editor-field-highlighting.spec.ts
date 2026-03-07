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

  // AC 1: Steps field highlighted when duplicates present
  test('steps tags wrapper gets error border when duplicate step values are added', async ({ page }) => {
    // AC: FE: Fields with validation errors are visually highlighted (red border or similar)
    await fillStudyName(page, 'Test Steps Highlight')
    await fillFirstPromptRow(page, 'test', 'a test prompt')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // Add a duplicate step: default is 30, add another 30
    const stepsAddButton = page.locator('[data-testid="steps-tags-add"]')
    await stepsAddButton.click()
    const stepsInput = page.locator('[data-testid="steps-tags"] input').last()
    await stepsInput.fill('30')
    await stepsInput.press('Enter')

    // The steps wrapper should have the error border class
    const stepsWrapper = page.locator('[data-testid="steps-tags-wrapper"]')
    await expect(stepsWrapper).toHaveClass(/tags-error-wrapper/)
  })

  // AC 3: Steps error clears when duplicate is removed
  test('steps tags wrapper error border clears when duplicate step is removed', async ({ page }) => {
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

    const stepsWrapper = page.locator('[data-testid="steps-tags-wrapper"]')
    await expect(stepsWrapper).toHaveClass(/tags-error-wrapper/)

    // Remove the duplicate tag (close button on the second tag)
    const stepsTags = page.locator('[data-testid="steps-tags"] .n-tag')
    // There should now be 2 tags: both showing '30'
    const tagCount = await stepsTags.count()
    expect(tagCount).toBeGreaterThanOrEqual(2)
    // Click the close button on the last tag to remove the duplicate
    await stepsTags.last().locator('.n-tag__close').click()

    // Error border should be gone
    await expect(stepsWrapper).not.toHaveClass(/tags-error-wrapper/)
  })

  // AC 2: For duplicate values, all duplicate occurrences except the first are highlighted
  // (This is more granular than E2E can easily verify per-tag, but we verify the container behavior)
  test('only the duplicate-containing fields are highlighted, not all fields', async ({ page }) => {
    // AC: FE: For duplicate values, all duplicate occurrences except the first are highlighted
    await fillStudyName(page, 'Test Only Highlighted')
    await fillFirstPromptRow(page, 'test', 'a test prompt')
    await addSamplerSchedulerPair(page, 'euler', 'normal')

    // Add a duplicate step
    const stepsAddButton = page.locator('[data-testid="steps-tags-add"]')
    await stepsAddButton.click()
    const stepsInput = page.locator('[data-testid="steps-tags"] input').last()
    await stepsInput.fill('30')
    await stepsInput.press('Enter')

    // Steps should be highlighted
    const stepsWrapper = page.locator('[data-testid="steps-tags-wrapper"]')
    await expect(stepsWrapper).toHaveClass(/tags-error-wrapper/)

    // CFGs and seeds should NOT be highlighted (they have no duplicates)
    const cfgsWrapper = page.locator('[data-testid="cfgs-tags-wrapper"]')
    await expect(cfgsWrapper).not.toHaveClass(/tags-error-wrapper/)

    const seedsWrapper = page.locator('[data-testid="seeds-tags-wrapper"]')
    await expect(seedsWrapper).not.toHaveClass(/tags-error-wrapper/)
  })
})
