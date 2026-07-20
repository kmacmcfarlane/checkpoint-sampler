import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  resetDatabase,
  cancelAllJobs,
  closeDrawer,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getManageStudiesDialog,
} from './helpers'

/**
 * E2E regression tests for R-021: component split scoped-CSS safety net.
 *
 * ## Why this spec exists
 *
 * R-021 decomposed JobProgressPanel.vue and StudyEditor.vue into child
 * components. In doing so, ~35 `<style scoped>` rules were physically moved out
 * of JobProgressPanel.vue into JobProgressItem.vue, and 2 out of StudyEditor.vue
 * into StudyImmutabilityDialog.vue.
 *
 * Vue scoped CSS is enforced by a per-component `data-v-<hash>` attribute. A
 * parent's scoped styles do NOT apply to a child component's internal (non-root)
 * elements. So if a style rule is left behind in the parent while its target
 * markup moves into a child — or vice versa — the rule silently stops applying.
 *
 * This failure mode is invisible to every other gate in the pipeline:
 *   - vue-tsc / eslint do not resolve CSS selectors against markup.
 *   - Unit tests (jsdom) do not apply stylesheets or compute layout at all.
 *   - Existing E2E tests assert on text and data-testid presence, not on
 *     computed style, so an unstyled-but-present element still passes.
 *
 * The result would ship as a visually broken layout with a fully green test
 * suite. These tests assert the relocated declarations actually reach their
 * elements at runtime, in a real browser.
 *
 * ## What is asserted
 *
 * Deliberately targets NON-ROOT descendants. A child component's ROOT element
 * inherits the parent's scope attribute as well, so `.job-item` (the root of
 * JobProgressItem) would still be styled from either location and therefore
 * proves nothing. `.job-header`, `.job-title`, `.job-actions` and `.job-meta`
 * only ever carry JobProgressItem's own scope ID — they are the real signal.
 *
 * Expected px values are the rem declarations resolved against the default
 * 16px root font size (the app sets no custom html/:root font-size):
 *   0.25rem = 4px, 0.5rem = 8px, 0.75rem = 12px, 0.875rem = 14px, 1rem = 16px
 */

/** Seeds a sample job directly via the test endpoint. */
async function seedJob(request: APIRequestContext, studyName: string): Promise<void> {
  const resp = await request.post('/api/test/seed-jobs', {
    data: [{
      training_run_name: 'my-model',
      study_id: 'r021-style-study',
      study_name: studyName,
      workflow_name: 'test-workflow.json',
      status: 'pending',
      total_items: 4,
      completed_items: 0,
    }],
  })
  expect(resp.status()).toBe(201)
}

/** Opens the Job Progress Panel modal. */
async function openJobProgressPanel(page: Page): Promise<void> {
  await closeDrawer(page)
  const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
  await expect(jobsButton).toBeVisible()
  await jobsButton.click()
  const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
  await expect(modal).toBeVisible()
}

async function createStudy(request: APIRequestContext, name: string): Promise<string> {
  const resp = await request.post('/api/v1/studies', {
    data: {
      name,
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'a test prompt' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      resolutions: [{ width: 512, height: 512 }],
      workflow_template: 'test-workflow.json',
      vaes: ['ae.safetensors'],
      text_encoders: ['clip_l.safetensors'],
    },
  })
  expect(resp.ok()).toBeTruthy()
  const study = await resp.json() as { id: string }
  return study.id
}

test.describe('R-021 scoped style relocation', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // Guards the ~35 rules moved from JobProgressPanel.vue into JobProgressItem.vue.
  test('relocated JobProgressItem scoped styles apply to non-root descendants', async ({ page, request }) => {
    const studyName = 'R021 Style Study'
    await seedJob(request, studyName)

    await page.goto('/')
    await openJobProgressPanel(page)

    const modal = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
    const jobItem = modal.locator('.job-item').first()
    await expect(jobItem).toBeVisible()
    await expect(jobItem).toContainText(studyName)

    // .job-header — flex row with actions pushed to the far edge. If this rule
    // failed to move, the header would collapse to default block layout.
    const header = jobItem.locator('.job-header').first()
    await expect(header).toHaveCSS('display', 'flex')
    await expect(header).toHaveCSS('justify-content', 'space-between')
    await expect(header).toHaveCSS('align-items', 'center')
    await expect(header).toHaveCSS('margin-bottom', '12px')

    // .job-title — wrapping flex row of title button + status tag.
    const title = jobItem.locator('.job-title').first()
    await expect(title).toHaveCSS('display', 'flex')
    await expect(title).toHaveCSS('align-items', 'center')
    await expect(title).toHaveCSS('flex-wrap', 'wrap')

    // .job-actions — the action button row (stop/resume/retry/delete...).
    const actions = jobItem.locator('.job-actions').first()
    await expect(actions).toHaveCSS('display', 'flex')
    await expect(actions).toHaveCSS('gap', '8px')

    // .job-meta — the created/updated metadata line.
    const meta = jobItem.locator('.job-meta').first()
    await expect(meta).toHaveCSS('font-size', '14px')
    await expect(meta).toHaveCSS('display', 'flex')
    await expect(meta).toHaveCSS('flex-wrap', 'wrap')

    // The scoped mechanism itself: the descendant must carry a data-v-* scope
    // attribute. A styled-by-accident global rule would not produce one.
    const hasScopeAttr = await header.evaluate(el =>
      Array.from(el.attributes).some(a => a.name.startsWith('data-v-')),
    )
    expect(hasScopeAttr).toBe(true)
  })

  // Guards the 2 rules moved from StudyEditor.vue into StudyImmutabilityDialog.vue.
  test('relocated StudyImmutabilityDialog scoped styles apply', async ({ page, request }) => {
    const studyName = `R021 Immutability Style ${Date.now()}`
    const studyId = await createStudy(request, studyName)

    // Seed samples so the study is treated as having existing output, which is
    // what triggers the immutability dialog on update.
    const seedResp = await request.post('/api/test/seed-partial-samples', {
      data: {
        training_run_name: 'my-model',
        study_id: studyId,
        study_name: studyName,
        checkpoint_filenames: ['my-model-step00001000.safetensors'],
      },
    })
    expect(seedResp.status()).toBe(201)

    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    await openGenerateSamplesDialog(page)
    const genDialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Generate Samples' })
    const manageStudiesButton = genDialog.locator('[data-testid="manage-studies-button"]')
    await expect(manageStudiesButton).toBeVisible()
    await manageStudiesButton.click()
    await expect(getManageStudiesDialog(page)).toBeVisible()

    // Select the study that has samples.
    const select = page.locator('[data-testid="study-editor-select"]')
    await expect(select).toBeVisible()
    await expect(select.locator('.n-base-selection--disabled')).toHaveCount(0)
    await select.click()
    const popup = page.locator('.n-base-select-menu:visible')
    await expect(popup).toBeVisible()
    await popup.getByText(studyName, { exact: true }).click()
    await expect(popup).not.toBeVisible()

    // Trigger the has-samples check.
    const updateButton = page.locator('[data-testid="save-study-button"]')
    await expect(updateButton).toBeVisible()
    await expect(updateButton).toContainText('Update Study')
    await updateButton.click()

    const immutabilityDialog = page.locator('[data-testid="immutability-dialog"]')
    await expect(immutabilityDialog).toBeVisible({ timeout: 10000 })

    // .immutability-option-row — clone-name input and clone button side by side.
    const optionRow = immutabilityDialog.locator('.immutability-option-row').first()
    await expect(optionRow).toBeVisible()
    await expect(optionRow).toHaveCSS('display', 'flex')
    await expect(optionRow).toHaveCSS('gap', '8px')
    await expect(optionRow).toHaveCSS('align-items', 'center')

    // .immutability-option-hint — the smaller explanatory text under each option.
    const hint = immutabilityDialog.locator('.immutability-option-hint').first()
    await expect(hint).toBeVisible()
    await expect(hint).toHaveCSS('font-size', '13px')
    await expect(hint).toHaveCSS('margin-top', '4px')
  })
})
