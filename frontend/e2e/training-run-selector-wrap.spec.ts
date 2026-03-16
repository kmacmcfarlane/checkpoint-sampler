import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun } from './helpers'

/**
 * E2E tests for B-098 (UAT rework): Training run selector long-name wrapping.
 *
 * Acceptance criteria:
 *   AC1: Training run selector wraps long names to multiple lines instead of truncating.
 *   AC2: Dropdown options also display full names without truncation.
 *   AC3: Layout remains clean with wrapped names.
 *   AC4 (UAT rework): Closed-state selected value wraps via renderTag — the
 *        selected tag span is rendered in the trigger so the control scales
 *        vertically to contain the full label.
 *
 * The fixture training run is "my-model" (short name). These E2E tests verify that
 * the renderTag/renderLabel mechanisms are active in a real browser environment by
 * checking for the data-testid sentinel spans injected by each renderer function.
 */

test.describe('B-098: Training run selector wrapping', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('training-run-selected-tag span is rendered in the closed trigger after selection', async ({ page }) => {
    await page.goto('/')

    // Select the fixture training run
    await selectTrainingRun(page, 'my-model')

    // AC (UAT rework): after selection the closed-state trigger should contain the
    // renderTag-generated span with data-testid="training-run-selected-tag".
    // This confirms that renderTag is wired up and active in the real browser.
    const selectedTag = page.locator('[data-testid="training-run-select"] [data-testid="training-run-selected-tag"]')
    await expect(selectedTag).toBeVisible()

    // The span should contain the selected run name
    await expect(selectedTag).toContainText('my-model')
  })

  test('dropdown option labels use renderLabel span (data-testid=training-run-option-label) when open', async ({ page }) => {
    await page.goto('/')

    const selectTrigger = page.locator('[data-testid="training-run-select"]')
    await expect(selectTrigger).toBeVisible()

    // Wait for loading to finish
    await expect(selectTrigger.locator('.n-base-selection--disabled')).toHaveCount(0)

    // Open the dropdown
    await selectTrigger.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()

    // AC2: Dropdown options should use renderLabel — the span with
    // data-testid="training-run-option-label" must be visible inside the popup.
    const optionLabel = popupMenu.locator('[data-testid="training-run-option-label"]').first()
    await expect(optionLabel).toBeVisible()

    // Close the dropdown
    await page.keyboard.press('Escape')
  })

  test('training run selector layout remains intact after selecting a run', async ({ page }) => {
    await page.goto('/')

    await selectTrainingRun(page, 'my-model')

    // AC3: Layout remains clean — the training run selector container should still
    // be visible and not overflow the sidebar.
    const selectorContainer = page.locator('[data-testid="training-run-select"]')
    await expect(selectorContainer).toBeVisible()

    // Dimensions panel should appear (scan completes successfully after selection)
    await expect(page.getByText('Dimensions')).toBeVisible()
  })
})
