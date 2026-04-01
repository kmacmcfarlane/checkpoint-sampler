import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun, openGenerateSamplesDialog, getGenerateSamplesDialog } from './helpers'

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

test.describe('B-098 UAT rework v2: Gen Samples dialog study selector', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC (B-098 UAT rework v2): Study selector in Gen Samples dialog shows the selected
  // study name when collapsed. The study NSelect must be filterable so that the
  // renderTag/CSS overrides apply and the closed-state trigger renders correctly.
  test('study-selected-tag span visible in closed trigger after selecting a study', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await openGenerateSamplesDialog(page)

    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the training run inside the dialog
    const dialogRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await dialogRunSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('my-model', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Wait for study selector to appear and be ready
    const studySelectTrigger = dialog.locator('[data-testid="study-select"]')
    await expect(studySelectTrigger).toBeVisible()

    // Select a study
    await studySelectTrigger.click()
    const studyPopup = page.locator('.n-base-select-menu:visible')
    await expect(studyPopup).toBeVisible()
    await studyPopup.locator('.n-base-select-option').first().click()
    await expect(studyPopup).not.toBeVisible()

    // AC: After selection, the closed-state trigger must contain the renderTag-generated
    // span with data-testid="study-selected-tag". This verifies that:
    //   1. The study select is filterable (enabling the renderTag path)
    //   2. The selected study name is visible (not hidden by broken CSS)
    const studySelectedTag = studySelectTrigger.locator('[data-testid="study-selected-tag"]')
    await expect(studySelectedTag).toBeVisible()
  })

  // AC (B-098 UAT rework v2): The study selector in Gen Samples dialog does not grow
  // taller than a single-row trigger when no study is selected (collapsed + empty state).
  test('study selector in Gen Samples dialog has normal height when empty', async ({ page }) => {
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await openGenerateSamplesDialog(page)

    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // Select the training run so the study selector is visible
    const dialogRunSelect = dialog.locator('[data-testid="training-run-select"]')
    await dialogRunSelect.click()
    const popupMenu = page.locator('.n-base-select-menu:visible')
    await expect(popupMenu).toBeVisible()
    await popupMenu.getByText('my-model', { exact: true }).click()
    await expect(popupMenu).not.toBeVisible()

    // Wait for study selector
    const studySelectTrigger = dialog.locator('[data-testid="study-select"]')
    await expect(studySelectTrigger).toBeVisible()

    // AC: The study selector trigger height should not grow proportionally with the
    // number of studies. A reasonable max height for an unselected trigger is 80px.
    // (Naive UI's default single-select height is ~34px; with height-auto it may wrap
    // to ~50px, but should never approach 80px without a selected value.)
    const box = await studySelectTrigger.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeLessThan(80)
  })
})
