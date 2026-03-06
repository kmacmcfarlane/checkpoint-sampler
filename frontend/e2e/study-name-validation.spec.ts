import { test, expect } from '@playwright/test'
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
 * E2E tests for study name filename character validation (B-050).
 *
 * Verifies:
 *   - AC 1: BE rejects study names with filesystem-unsafe characters
 *   - AC 2: BE validation error message lists the specific disallowed characters
 *   - AC 3: FE shows inline validation error when disallowed characters are entered
 */

// Minimal valid study payload for API-level tests
function makeStudyPayload(name: string) {
  return {
    name,
    prompt_prefix: '',
    prompts: [{ name: 'test', text: 'a test prompt' }],
    negative_prompt: '',
    steps: [30],
    cfgs: [7.0],
    sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
    seeds: [42],
    width: 512,
    height: 512,
  }
}

test.describe('study name filename character validation (B-050)', () => {
  test.describe('backend validation via API', () => {
    test.beforeEach(async ({ request }) => {
      await resetDatabase(request)
    })

    const disallowedChars = [
      ['open parenthesis', '('],
      ['close parenthesis', ')'],
      ['forward slash', '/'],
      ['backslash', '\\'],
      ['colon', ':'],
      ['asterisk', '*'],
      ['question mark', '?'],
      ['less-than', '<'],
      ['greater-than', '>'],
      ['pipe', '|'],
      ['double quote', '"'],
    ]

    for (const [description, char] of disallowedChars) {
      test(`rejects study name containing ${description} (${char})`, async ({ request }) => {
        const name = `Bad${char}Name`
        const resp = await request.post('/api/studies', { data: makeStudyPayload(name) })
        expect(resp.status()).toBe(400)
        const body = await resp.json()
        // AC 2: error message must mention disallowed characters
        expect(body.message).toContain('disallowed')
      })
    }

    test('error message lists the specific disallowed characters', async ({ request }) => {
      // AC 2: the error message enumerates the specific disallowed chars
      const resp = await request.post('/api/studies', { data: makeStudyPayload('Study(bad)Name') })
      expect(resp.status()).toBe(400)
      const body = await resp.json()
      // The error should mention the disallowed characters string
      expect(body.message).toContain('disallowed characters')
      // Spot-check: parentheses should appear in the message
      expect(body.message).toContain('(')
    })

    test('accepts a valid study name without disallowed characters', async ({ request }) => {
      const resp = await request.post('/api/studies', { data: makeStudyPayload(`Valid Study Name ${Date.now()}`) })
      expect(resp.status()).toBe(201)
    })

    test('accepts study name with hyphens, underscores, and spaces', async ({ request }) => {
      const name = `My-Study_Config v2 ${Date.now()}`
      const resp = await request.post('/api/studies', { data: makeStudyPayload(name) })
      expect(resp.status()).toBe(201)
    })

    test('fork endpoint also rejects disallowed characters in fork name', async ({ request }) => {
      // Create a valid source study first
      const sourceResp = await request.post('/api/studies', { data: makeStudyPayload(`Fork Source ${Date.now()}`) })
      expect(sourceResp.status()).toBe(201)
      const source = await sourceResp.json()

      // Attempt to fork with an invalid name (parentheses — old style)
      const forkPayload = {
        ...makeStudyPayload(`${source.name} (copy)`),
        source_id: source.id,
      }
      const forkResp = await request.post(`/api/studies/${source.id}/fork`, { data: forkPayload })
      expect(forkResp.status()).toBe(400)
      const body = await forkResp.json()
      expect(body.message).toContain('disallowed')
    })

    test('fork endpoint accepts a valid fork name', async ({ request }) => {
      // Create a valid source study first
      const sourceResp = await request.post('/api/studies', { data: makeStudyPayload(`Fork Source Valid ${Date.now()}`) })
      expect(sourceResp.status()).toBe(201)
      const source = await sourceResp.json()

      // Fork with a valid name using ' - copy' suffix (no parentheses)
      const forkPayload = {
        ...makeStudyPayload(`${source.name} - copy`),
        source_id: source.id,
      }
      const forkResp = await request.post(`/api/studies/${source.id}/fork`, { data: forkPayload })
      expect(forkResp.status()).toBe(201)
    })
  })

  test.describe('frontend inline validation (AC 3)', () => {
    test.beforeEach(async ({ page, request }) => {
      await resetDatabase(request)
      await page.goto('/')
      await selectTrainingRun(page, 'my-model')
      await expect(page.getByText('Dimensions')).toBeVisible()
    })

    async function openManageStudiesEditor(page: Parameters<typeof openGenerateSamplesDialog>[0]) {
      await openGenerateSamplesDialog(page)
      const manageStudiesButton = page.locator('[data-testid="manage-studies-button"]')
      await expect(manageStudiesButton).toBeVisible()
      await manageStudiesButton.click()
      await expect(getManageStudiesDialog(page)).toBeVisible()
    }

    test('shows inline validation error for parentheses in study name', async ({ page }) => {
      await openManageStudiesEditor(page)
      await page.locator('[data-testid="new-study-button"]').click()

      // Enter a name with disallowed parentheses
      await fillStudyName(page, 'Bad (Name)')

      // Fill required fields so the form would otherwise be saveable
      await fillFirstPromptRow(page, 'test', 'a test prompt')
      await addSamplerSchedulerPair(page, 'euler', 'normal')

      // The local validation error should appear
      const validationAlert = page.locator('[data-testid="local-validation-error"]')
      await expect(validationAlert).toBeVisible()
      await expect(validationAlert).toContainText('disallowed characters')

      // The save button must be disabled
      const saveButton = page.locator('[data-testid="save-study-button"]')
      await expect(saveButton).toBeDisabled()
    })

    test('shows inline validation error for forward slash in study name', async ({ page }) => {
      await openManageStudiesEditor(page)
      await page.locator('[data-testid="new-study-button"]').click()

      await fillStudyName(page, 'Bad/Name')
      await fillFirstPromptRow(page, 'test', 'a test prompt')
      await addSamplerSchedulerPair(page, 'euler', 'normal')

      const validationAlert = page.locator('[data-testid="local-validation-error"]')
      await expect(validationAlert).toBeVisible()
      await expect(validationAlert).toContainText('disallowed characters')

      const saveButton = page.locator('[data-testid="save-study-button"]')
      await expect(saveButton).toBeDisabled()
    })

    test('inline validation error disappears when disallowed character is removed', async ({ page }) => {
      await openManageStudiesEditor(page)
      await page.locator('[data-testid="new-study-button"]').click()

      // Enter invalid name
      await fillStudyName(page, 'Bad:Name')
      await fillFirstPromptRow(page, 'test', 'a test prompt')
      await addSamplerSchedulerPair(page, 'euler', 'normal')

      const validationAlert = page.locator('[data-testid="local-validation-error"]')
      await expect(validationAlert).toBeVisible()

      // Fix the name — remove the colon
      await fillStudyName(page, 'GoodName')

      // Validation error should disappear and save should be enabled
      await expect(validationAlert).not.toBeVisible()
      const saveButton = page.locator('[data-testid="save-study-button"]')
      await expect(saveButton).not.toBeDisabled()
    })

    test('valid study name with hyphens and spaces saves successfully', async ({ page }) => {
      await openManageStudiesEditor(page)
      await page.locator('[data-testid="new-study-button"]').click()

      const validName = `My Valid Study - v2 ${Date.now()}`
      await fillStudyName(page, validName)
      await fillFirstPromptRow(page, 'test', 'a test prompt')
      await addSamplerSchedulerPair(page, 'euler', 'normal')

      // No validation error
      const validationAlert = page.locator('[data-testid="local-validation-error"]')
      await expect(validationAlert).not.toBeVisible()

      // Save button enabled and study saves successfully
      const saveButton = page.locator('[data-testid="save-study-button"]')
      await expect(saveButton).not.toBeDisabled()
      await saveButton.click()

      // Modal closes after successful save
      await expect(getManageStudiesDialog(page)).not.toBeVisible()
    })
  })
})
