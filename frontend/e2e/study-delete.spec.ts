import { test, expect, type APIRequestContext } from '@playwright/test'
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
 * E2E tests for study deletion with optional sample data removal (S-095).
 *
 * ## What is tested
 *
 * AC1: Delete button on study shows the standard confirmation dialog.
 * AC2: Confirmation dialog includes 'Also delete sample data' checkbox (default off).
 * AC3 (cancel): Cancelling the dialog does not delete the study.
 * AC3 (confirm, no data): Confirming without checking the checkbox deletes the DB record.
 *
 * ## Test data setup
 *
 * Studies are created directly via REST API to keep test setup simple and
 * avoid flakiness from nesting Manage Studies dialog → select → delete flows.
 * Each test navigates to the Manage Studies dialog, selects the study from
 * the dropdown, then verifies the delete flow.
 */

/** Create a minimal study via the REST API and return its ID. */
async function createStudyViaAPI(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/studies', {
    data: {
      name,
      prompt_prefix: '',
      prompts: [{ name: 'landscape', text: 'a beautiful landscape' }],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 512,
      height: 512,
    },
  })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return body.id as string
}

/**
 * Opens the Manage Studies dialog, selects the study with the given name,
 * and returns the locator for the dialog.
 */
async function openManageStudiesAndSelectStudy(
  page: import('@playwright/test').Page,
  studyName: string,
) {
  // Click "Manage Studies" to open the dialog
  const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
  await expect(manageStudiesButton).toBeVisible()
  await manageStudiesButton.click()

  const dialog = getManageStudiesDialog(page)
  await expect(dialog).toBeVisible()

  // Select the study from the dropdown
  const studySelect = dialog.locator('[data-testid="study-editor-select"]')
  await studySelect.click()
  const popup = page.locator('.n-base-select-menu:visible')
  await expect(popup).toBeVisible()
  await popup.getByText(studyName, { exact: true }).click()
  await expect(popup).not.toBeVisible()

  // Verify the delete button appears (study is loaded)
  const deleteButton = dialog.locator('[data-testid="delete-study-button"]')
  await expect(deleteButton).toBeVisible()

  return dialog
}

test.describe('study deletion with optional sample data removal (S-095)', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await openGenerateSamplesDialog(page)
  })

  // AC1: Delete button on study shows the standard confirmation dialog
  test('AC1: clicking Delete Study button opens the ConfirmDeleteDialog', async ({ page, request }) => {
    // AC: FE: Delete button on study shows the standard confirmation dialog
    const studyName = `E2E S-095 Dialog ${Date.now()}`
    await createStudyViaAPI(request, studyName)

    const dialog = await openManageStudiesAndSelectStudy(page, studyName)

    const deleteButton = dialog.locator('[data-testid="delete-study-button"]')
    await deleteButton.click()

    // AC1: The ConfirmDeleteDialog should appear. We locate it by data-testid placed on the
    // ConfirmDeleteDialog component element — NModal renders the card with the component's
    // attributes in the teleported DOM node.
    const confirmDialog = page.locator('[data-testid="delete-study-dialog"]')
    await expect(confirmDialog).toBeVisible()
  })

  // AC2: Confirmation dialog includes 'Also delete sample data' checkbox (default off)
  test('AC2: confirmation dialog has "Also delete sample data" checkbox unchecked by default', async ({ page, request }) => {
    // AC: FE: Confirmation dialog includes 'Also delete sample data' checkbox (default off)
    const studyName = `E2E S-095 Checkbox ${Date.now()}`
    await createStudyViaAPI(request, studyName)

    const dialog = await openManageStudiesAndSelectStudy(page, studyName)

    await dialog.locator('[data-testid="delete-study-button"]').click()

    // Locate the delete confirmation dialog by its data-testid
    const confirmDialog = page.locator('[data-testid="delete-study-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // AC2: Checkbox is present and unchecked by default
    const checkbox = confirmDialog.locator('[data-testid="confirm-delete-checkbox"]')
    await expect(checkbox).toBeVisible()
    // Naive UI unchecked state: does NOT have n-checkbox--checked class
    await expect(checkbox).not.toHaveClass(/n-checkbox--checked/)
  })

  // AC3 (cancel): Cancelling the dialog does not delete the study
  test('AC3 (cancel): cancelling the dialog does not delete the study', async ({ page, request }) => {
    // AC: BE: Deleting a study without the data flag removes only the database record
    const studyName = `E2E S-095 Cancel ${Date.now()}`
    await createStudyViaAPI(request, studyName)

    const dialog = await openManageStudiesAndSelectStudy(page, studyName)

    await dialog.locator('[data-testid="delete-study-button"]').click()

    const confirmDialog = page.locator('[data-testid="delete-study-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // Click Cancel
    const cancelButton = confirmDialog.locator('[data-testid="confirm-cancel-button"]')
    await cancelButton.click()
    await expect(confirmDialog).not.toBeVisible()

    // Study should still exist in the API
    const studiesResponse = await request.get('/api/studies')
    expect(studiesResponse.status()).toBe(200)
    const studiesData = await studiesResponse.json()
    const found = studiesData.some((s: { name: string }) => s.name === studyName)
    expect(found).toBe(true)
  })

  // AC3 (BE): Confirming deletion without data flag removes only the DB record
  test('AC3 (confirm, no data): confirming without checkbox deletes only the database record', async ({ page, request }) => {
    // AC: BE: Deleting a study without the data flag removes only the database record
    const studyName = `E2E S-095 Delete ${Date.now()}`
    await createStudyViaAPI(request, studyName)

    const dialog = await openManageStudiesAndSelectStudy(page, studyName)

    await dialog.locator('[data-testid="delete-study-button"]').click()

    const confirmDialog = page.locator('[data-testid="delete-study-dialog"]')
    await expect(confirmDialog).toBeVisible()

    // Do NOT check the checkbox (keep default: off = don't delete sample data)
    // Click "Yes, Delete"
    const confirmButton = confirmDialog.locator('[data-testid="confirm-delete-button"]')
    await confirmButton.click()
    await expect(confirmDialog).not.toBeVisible()

    // Study should be gone from the API
    const studiesResponse = await request.get('/api/studies')
    expect(studiesResponse.status()).toBe(200)
    const studiesData = await studiesResponse.json()
    const found = studiesData.some((s: { name: string }) => s.name === studyName)
    expect(found).toBe(false)
  })
})
