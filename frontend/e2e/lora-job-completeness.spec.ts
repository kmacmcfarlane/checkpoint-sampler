import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import {
  resetDatabase,
  cancelAllJobs,
  selectTrainingRun,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  getManageStudiesDialog,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
  selectNaiveOption,
  selectNaiveMultiOption,
  confirmRegenDialogIfVisible,
} from './helpers'

/**
 * E2E test for B-162: Job progress Completeness section reports 0/N missing
 * for LoRA jobs — completeness check and manifest write omit the base_model
 * directory level.
 *
 * Root cause: verifyCheckpointCompleteness() and writeManifest() reconstructed
 * the study output directory inline, omitting the base_model directory level
 * that the image-write path correctly appended for LoRA jobs. This test drives
 * a real LoRA sample job end-to-end (via the comfyui-mock service) and
 * verifies the job progress panel's Completeness section reports N/N verified
 * with no 'missing' lines once the job completes.
 *
 * Test data:
 * - Training run: "test-lora" (LoRA, from test-fixtures/loras)
 * - Base model: "my-model-step00001000.safetensors" (base_model_dir falls back
 *   to checkpoint_dirs[0] per test-fixtures/config-with-comfyui.yaml)
 * - Workflow: "test-workflow-lora.json" (LoRA-capable; has a lora_loader node)
 * - comfyui-mock now serves GET /object_info/LoraLoader (B-162 QA infra fix)
 *   seeded with LORA_FILENAMES so LoraPathMatcher can resolve
 *   test-lora-step0000*.safetensors — previously only UNETLoader/VAELoader/
 *   CLIPLoader/KSampler were served, so any LoRA job would fail path
 *   resolution and never reach 'completed'.
 */

async function ensureDataAndOpenDialog(page: Page, request: APIRequestContext): Promise<void> {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://frontend:3000'

  await expect(async () => {
    const resp = await request.get(`${baseUrl}/api/training-runs?source=checkpoints`)
    const data = await resp.json()
    expect(data.length).toBeGreaterThan(0)
  }).toPass({ timeout: 15000, intervals: [500, 1000, 2000] })

  await page.goto('/', { waitUntil: 'networkidle' })
  // Select the sidebar training run first. The app's WebSocket connection
  // (which carries job_progress/checkpoint_completeness events) is only
  // established once a training run is selected on the main page (see
  // useWebSocket() in App.vue, gated on selectedTrainingRun). Without this,
  // the Generate Samples dialog's own training-run-select (picked below)
  // does not establish that connection, and the job progress panel would
  // never receive completeness updates for the job we create.
  await selectTrainingRun(page, 'test-lora')
  await expect(page.getByText('Dimensions')).toBeVisible()
  await openGenerateSamplesDialog(page)
}

async function pickTrainingRun(page: Page, nameSubstring: string): Promise<void> {
  const dialog = getGenerateSamplesDialog(page)
  const select = dialog.getByTestId('training-run-select')
  await select.click()
  const popup = page.locator('.n-base-select-menu').last()
  await expect(popup).toBeVisible({ timeout: 5000 })
  const option = popup.locator('.n-base-select-option').filter({ hasText: nameSubstring }).first()
  await expect(option).toBeVisible({ timeout: 5000 })
  await option.click()
  await expect(popup).not.toBeVisible({ timeout: 5000 })
}

async function pickBaseModel(page: Page, nameSubstring: string): Promise<void> {
  const dialog = getGenerateSamplesDialog(page)
  const select = dialog.getByTestId('base-model-select')
  await expect(select).toBeVisible({ timeout: 5000 })
  await select.click()
  const popup = page.locator('.n-base-select-menu').last()
  await expect(popup).toBeVisible({ timeout: 5000 })
  const option = popup.locator('.n-base-select-option').filter({ hasText: nameSubstring }).first()
  await expect(option).toBeVisible({ timeout: 5000 })
  await option.click()
  await expect(popup).not.toBeVisible({ timeout: 5000 })
}

interface SampleJobApiResponse {
  id: string
  training_run_name: string
  status: string
  total_items: number
  completed_items: number
}

async function pollJobStatus(
  request: APIRequestContext,
  predicate: (jobs: SampleJobApiResponse[]) => boolean,
  options: { timeout?: number; interval?: number } = {},
): Promise<SampleJobApiResponse[] | null> {
  const timeout = options.timeout ?? 10000
  const interval = options.interval ?? 500
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const resp = await request.get('/api/sample-jobs')
    if (resp.status() === 200) {
      const jobs = await resp.json() as SampleJobApiResponse[]
      if (predicate(jobs)) return jobs
    }
    await new Promise(r => setTimeout(r, interval))
  }
  return null
}

test.describe('LoRA job completeness in job progress panel (B-162)', () => {
  test.setTimeout(90000)

  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC6: A completed sample job for a run with a base model shows N/N verified
  // in the Completeness section of the job progress panel, with no 'missing' lines.
  test('LoRA job with base model shows N/N verified with no missing lines', async ({ page, request }) => {
    const studyName = `E2E LoRA Completeness ${Date.now()}`

    await ensureDataAndOpenDialog(page, request)
    const dialog = getGenerateSamplesDialog(page)

    // Select the LoRA training run and its base model
    await pickTrainingRun(page, 'test-lora')
    await pickBaseModel(page, 'my-model-step00001000.safetensors')

    // Create a LoRA-capable study
    await page.locator('[data-testid="manage-studies-button"]').click()
    await expect(getManageStudiesDialog(page)).toBeVisible()
    await page.locator('[data-testid="new-study-button"]').click()

    await fillStudyName(page, studyName)
    await fillFirstPromptRow(page, 'lora-completeness', 'a test prompt for lora completeness')
    await addSamplerSchedulerPair(page, 'euler', 'normal')
    await page.waitForTimeout(500)

    // LoRA-capable workflow (has a lora_loader cs_role node)
    await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow-lora.json')
    await selectNaiveMultiOption(page, 'study-vae-select', 'test-vae.safetensors')
    await selectNaiveMultiOption(page, 'study-clip-select', 'test-clip.safetensors')

    const saveButton = page.locator('[data-testid="save-study-button"]')
    await expect(saveButton).not.toBeDisabled()
    await saveButton.click()
    await expect(getManageStudiesDialog(page)).not.toBeVisible()
    await expect(dialog).toBeVisible()

    const studySelect = dialog.locator('[data-testid="study-select"]')
    await expect(studySelect).toContainText(studyName)

    // Uncheck "Clear existing samples" if auto-checked, to avoid wiping fixture data
    const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
    const clearVisible = await clearExistingCheckbox.isVisible({ timeout: 10000 }).catch(() => false)
    if (clearVisible) {
      const isChecked = await clearExistingCheckbox.evaluate(el => el.classList.contains('n-checkbox--checked'))
      if (isChecked) {
        await clearExistingCheckbox.click()
        await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)
      }
    }

    // Submit the job
    const submitButton = dialog.locator('button').filter({ hasText: /Generate Samples|Regenerate Samples/ }).first()
    await expect(submitButton).not.toBeDisabled()
    await submitButton.click()
    await confirmRegenDialogIfVisible(page)
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // Find the created job
    const jobsAfterCreate = await pollJobStatus(
      request,
      jobs => jobs.some(j => j.training_run_name === 'test-lora'),
      { timeout: 10000 },
    )
    expect(jobsAfterCreate).not.toBeNull()
    const createdJob = jobsAfterCreate!.find(j => j.training_run_name === 'test-lora')!
    expect(createdJob).toBeDefined()

    // Wait for the job to complete. The comfyui-mock now serves
    // /object_info/LoraLoader (B-162 QA infra fix) so LoraPathMatcher can
    // resolve the LoRA checkpoint filenames and the job can actually run
    // to completion instead of failing path resolution.
    const jobsCompleted = await pollJobStatus(
      request,
      jobs => jobs.some(j => j.id === createdJob.id && (j.status === 'completed' || j.status === 'completed_with_errors' || j.status === 'failed')),
      { timeout: 60000, interval: 1000 },
    )
    expect(jobsCompleted).not.toBeNull()
    const finalJob = jobsCompleted!.find(j => j.id === createdJob.id)!
    // AC3/AC4 (BE): a completed LoRA job must fully verify — no failed items,
    // which would indicate the completeness/manifest path regression.
    expect(finalJob.status).toBe('completed')
    expect(finalJob.completed_items).toBe(finalJob.total_items)

    // Open the job progress panel and inspect the Completeness section for this job.
    const jobsButton = page.locator('[aria-label="Toggle sample jobs panel"]')
    await expect(jobsButton).toBeVisible()
    const jobsPanel = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Sample Jobs' })
    const panelAlreadyOpen = await jobsPanel.isVisible({ timeout: 500 }).catch(() => false)
    if (!panelAlreadyOpen) {
      await jobsButton.click()
      await expect(jobsPanel).toBeVisible()
    }

    // AC6: Completeness section shows N/N verified, with no 'missing' lines.
    const completenessSection = page.locator(`[data-testid="job-${createdJob.id}-completeness"]`)
    await expect(completenessSection).toBeVisible({ timeout: 15000 })

    // No line should indicate missing images (i.e. no 'X missing' text and no
    // 'completeness-line--missing' class, which is the visual regression this
    // bug produced: 0/N verified, N missing for LoRA jobs).
    await expect(completenessSection).not.toContainText('missing')
    await expect(completenessSection.locator('.completeness-line--missing')).toHaveCount(0)

    // At least one completeness line reports full verification (N/N verified,
    // never 0/N as the pre-fix bug would show).
    const completenessLines = completenessSection.locator('.completeness-line')
    const lineCount = await completenessLines.count()
    expect(lineCount).toBeGreaterThan(0)
    for (let i = 0; i < lineCount; i++) {
      const text = await completenessLines.nth(i).innerText()
      expect(text).toMatch(/verified/)
      const match = text.match(/(\d+)\/(\d+) verified/)
      expect(match).not.toBeNull()
      const [, verified, expected] = match!
      expect(verified).not.toBe('0')
      expect(verified).toBe(expected)
    }
  })
})
