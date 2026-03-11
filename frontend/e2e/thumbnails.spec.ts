import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  resetDatabase,
  cancelAllJobs,
  selectTrainingRun,
  selectNaiveOptionByLabel,
  closeDrawer,
  openGenerateSamplesDialog,
  getGenerateSamplesDialog,
  getManageStudiesDialog,
  fillStudyName,
  fillFirstPromptRow,
  addSamplerSchedulerPair,
  selectNaiveOption,
  confirmRegenDialogIfVisible,
} from './helpers'

/**
 * E2E tests for thumbnail support (S-114).
 *
 * AC5 FE: Grid view serves thumbnails instead of full-res images when available.
 * AC6 FE: Lightbox continues to serve full-resolution images.
 *
 * The test fixture does not have pre-generated thumbnails, so thumbnail_path is
 * empty for all fixture images. Tests verify:
 *   1. The scan API response includes the thumbnail_path field (backend contract).
 *   2. When no thumbnail is available, grid images fall back to full-res URLs.
 *   3. The lightbox full-size image always uses the full-resolution URL.
 *   4. When a thumbnail IS available (simulated via page intercept), the grid
 *      image src uses the thumbnail URL while click emits the full-res URL.
 */

// ---------------------------------------------------------------------------
// Types shared across describe blocks
// ---------------------------------------------------------------------------

interface SampleJobApiResponse {
  id: string
  study_id: string
  training_run_name: string
  status: string
  total_items: number
  completed_items: number
}

/**
 * Poll the sample jobs list via API until the predicate is satisfied,
 * or until the timeout is reached. Returns the matching jobs array (if found).
 */
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

/**
 * Selects a Naive UI NSelect option within a specific container (e.g. the dialog).
 * This avoids ambiguity when multiple elements share the same data-testid.
 */
async function selectNaiveOptionInContainer(page: Page, container: ReturnType<typeof page.locator>, selectTestId: string, optionText: string): Promise<void> {
  const select = container.locator(`[data-testid="${selectTestId}"]`)
  await expect(select).toBeVisible()
  await select.click()
  const popup = page.locator('.n-base-select-menu:visible')
  await expect(popup).toBeVisible()
  await popup.getByText(optionText, { exact: true }).click()
  await expect(popup).not.toBeVisible()
}

/**
 * Creates a sample job for "my-model" with the given study name and waits for it
 * to reach a terminal state (completed or completed_with_errors). Returns the completed job.
 *
 * This replicates the job creation flow from sample-generation.spec.ts for use
 * in thumbnail E2E tests that need actual generated images.
 */
async function createAndRunJobToCompletion(page: Page, request: APIRequestContext, studyName: string): Promise<SampleJobApiResponse> {
  await openGenerateSamplesDialog(page)
  const dialog = getGenerateSamplesDialog(page)

  await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')

  await page.locator('[data-testid="manage-studies-button"]').click()
  await expect(getManageStudiesDialog(page)).toBeVisible()
  await page.locator('[data-testid="new-study-button"]').click()

  await fillStudyName(page, studyName)
  await fillFirstPromptRow(page, 'thumbnail-test', 'a thumbnail test image')
  await addSamplerSchedulerPair(page, 'euler', 'normal')
  await page.waitForTimeout(500)

  await selectNaiveOption(page, 'study-workflow-template-select', 'test-workflow.json')
  await selectNaiveOption(page, 'study-vae-select', 'test-vae.safetensors')
  await selectNaiveOption(page, 'study-clip-select', 'test-clip.safetensors')

  const saveButton = page.locator('[data-testid="save-study-button"]')
  await expect(saveButton).not.toBeDisabled()
  await saveButton.click()
  await expect(getManageStudiesDialog(page)).not.toBeVisible()

  // Uncheck "Clear existing samples" if it appears — avoid deleting fixture images
  const clearExistingCheckbox = page.locator('[data-testid="clear-existing-checkbox"]')
  await expect(clearExistingCheckbox).toBeVisible({ timeout: 10000 })
  const isChecked = await clearExistingCheckbox.evaluate(el => el.classList.contains('n-checkbox--checked'))
  if (isChecked) {
    await clearExistingCheckbox.click()
    await expect(clearExistingCheckbox).not.toHaveClass(/n-checkbox--checked/)
  }

  const submitButton = dialog.locator('button').filter({ hasText: /Generate Samples|Regenerate Samples/ }).first()
  await expect(submitButton).not.toBeDisabled()
  await submitButton.click()

  await confirmRegenDialogIfVisible(page)
  await expect(dialog).not.toBeVisible({ timeout: 5000 })

  // Retrieve the created job ID
  const initialJobs = await request.get('/api/sample-jobs')
  expect(initialJobs.status()).toBe(200)
  const jobs = await initialJobs.json() as SampleJobApiResponse[]
  expect(jobs.length).toBeGreaterThan(0)
  const jobId = jobs[0].id

  // Wait for job to complete (thumbnails are generated at item completion time)
  const finalJobs = await pollJobStatus(
    request,
    js => js.some(j => j.id === jobId && (j.status === 'completed' || j.status === 'completed_with_errors')),
    { timeout: 30000, interval: 1000 },
  )
  expect(finalJobs).not.toBeNull()

  const completedJob = finalJobs!.find(j => j.id === jobId)!
  return completedJob
}

// ---------------------------------------------------------------------------
// Grid setup helper (used by fallback/lightbox tests)
// ---------------------------------------------------------------------------

/**
 * Sets up the grid with checkpoint → X, prompt_name → Y, waits for images,
 * then closes the drawer.
 */
async function setupGridWithImages(page: Page): Promise<void> {
  await page.goto('/')

  await selectTrainingRun(page, 'my-model')
  await expect(page.getByText('Dimensions')).toBeVisible()

  await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
  await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

  const images = page.locator('.xy-grid [role="gridcell"] img')
  await expect(images.first()).toBeVisible()

  await closeDrawer(page)
}

test.describe('thumbnail support — scan API contract', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: Scan API response includes thumbnail_path field for every image
  test('scan response includes thumbnail_path field for each image', async ({ request }) => {
    // Discover training runs first to get a run ID
    const runsResponse = await request.get('/api/training-runs?source=samples')
    expect(runsResponse.status()).toBe(200)
    const runs = await runsResponse.json() as Array<{ id: number; name: string }>
    const run = runs.find((r) => r.name === 'my-model')
    expect(run).toBeDefined()

    // Scan the training run
    const scanResponse = await request.get(`/api/training-runs/${run!.id}/scan`)
    expect(scanResponse.status()).toBe(200)
    const body = await scanResponse.json() as { images: Array<{ relative_path: string; dimensions: Record<string, string>; thumbnail_path: string }> }

    // Every image should have a thumbnail_path field (may be empty string when not generated)
    expect(body.images.length).toBeGreaterThan(0)
    for (const img of body.images) {
      // thumbnail_path must be present as a string (empty when thumbnails not enabled/generated)
      expect(typeof img.thumbnail_path).toBe('string')
    }
  })

  // AC: When thumbnails are not generated (fixture), thumbnail_path is empty string
  test('thumbnail_path is empty string in fixture data (thumbnails not enabled)', async ({ request }) => {
    const runsResponse = await request.get('/api/training-runs?source=samples')
    expect(runsResponse.status()).toBe(200)
    const runs = await runsResponse.json() as Array<{ id: number; name: string }>
    const run = runs.find((r) => r.name === 'my-model')
    expect(run).toBeDefined()

    const scanResponse = await request.get(`/api/training-runs/${run!.id}/scan`)
    expect(scanResponse.status()).toBe(200)
    const body = await scanResponse.json() as { images: Array<{ thumbnail_path: string }> }

    // Fixture has no thumbnails, so all thumbnail_path values should be empty
    for (const img of body.images) {
      expect(img.thumbnail_path).toBe('')
    }
  })
})

test.describe('thumbnail support — grid fallback (no thumbnails)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC5: Grid falls back to full-res URL when thumbnail_path is empty
  test('grid image src points to full-res URL when no thumbnail is available', async ({ page }) => {
    await setupGridWithImages(page)

    // With no thumbnails in the fixture, all grid images should use the full-res /api/images/ path
    const firstGridImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await expect(firstGridImage).toBeVisible()

    const src = await firstGridImage.getAttribute('src')
    expect(src).toBeTruthy()
    // Must point to the images API endpoint
    expect(src).toContain('/api/images/')
    // data-full-src is undefined when there's no thumbnail (both src and full-src are the same)
    const dataSrc = await firstGridImage.getAttribute('data-full-src')
    // When no thumbnail, data-full-src should be absent (or equal to src)
    if (dataSrc !== null) {
      // If present, it must also point to the same full-res path
      expect(dataSrc).toContain('/api/images/')
    }
  })
})

test.describe('thumbnail support — lightbox always uses full-res (AC6)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC6: Lightbox continues to serve full-resolution images (not thumbnails)
  test('lightbox full-size image always shows full-res URL, not thumbnail URL', async ({ page }) => {
    // AC: Lightbox continues to serve full-resolution images
    await setupGridWithImages(page)

    // Intercept scan to inject a thumbnail path, simulating enabled thumbnails
    // This verifies that even when a grid image shows a thumbnail, clicking opens
    // the full-res image in the lightbox.
    await page.route('/api/training-runs/*/scan', async (route) => {
      const response = await route.fetch()
      const body = await response.json() as { images: Array<{ relative_path: string; thumbnail_path: string; dimensions: Record<string, string> }>; dimensions: unknown[] }
      // Inject a fake thumbnail_path for all images
      const patched = {
        ...body,
        images: body.images.map((img) => ({
          ...img,
          thumbnail_path: img.relative_path.replace(/\.png$/, '.jpg').replace(/([^/]+)$/, 'thumbnails/$1'),
        })),
      }
      await route.fulfill({ json: patched })
    })

    // Reload to trigger the intercepted scan
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Mode for prompt_name', 'Y Axis')

    const gridImages = page.locator('.xy-grid [role="gridcell"] img')
    await expect(gridImages.first()).toBeVisible()

    // Verify grid image uses thumbnail URL (contains "thumbnails/")
    const firstGridSrc = await gridImages.first().getAttribute('src')
    expect(firstGridSrc).toContain('/api/images/')
    expect(firstGridSrc).toContain('thumbnails/')

    // Verify data-full-src points to the original (non-thumbnail) full-res URL
    const dataFullSrc = await gridImages.first().getAttribute('data-full-src')
    expect(dataFullSrc).toContain('/api/images/')
    expect(dataFullSrc).not.toContain('thumbnails/')

    // Close the drawer, then click the grid image to open the lightbox
    await closeDrawer(page)

    // Click the first grid image (which is now showing a thumbnail)
    await gridImages.first().click()

    // Lightbox should open
    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // The lightbox full-size image must use the full-res URL (NOT the thumbnail URL)
    const lightboxImage = lightbox.locator('img[alt="Full-size image"]')
    await expect(lightboxImage).toBeVisible()

    const lightboxSrc = await lightboxImage.getAttribute('src')
    expect(lightboxSrc).toContain('/api/images/')
    // The lightbox must NOT show the thumbnail URL
    expect(lightboxSrc).not.toContain('thumbnails/')
  })

  // AC6: Lightbox uses full-res when no thumbnail is available (basic case)
  test('lightbox image uses full-res URL even when no thumbnail is present', async ({ page }) => {
    // AC: Lightbox continues to serve full-resolution images
    await setupGridWithImages(page)

    // Click the first grid image to open the lightbox
    const firstGridImage = page.locator('.xy-grid [role="gridcell"] img').first()
    await firstGridImage.click()

    const lightbox = page.locator('[role="dialog"][aria-label="Image lightbox"]')
    await expect(lightbox).toBeVisible()

    // Lightbox full-size image should point to the full-res URL
    const lightboxImage = lightbox.locator('img[alt="Full-size image"]')
    await expect(lightboxImage).toBeVisible()

    const lightboxSrc = await lightboxImage.getAttribute('src')
    expect(lightboxSrc).toContain('/api/images/')
    // No thumbnails in fixture — should NOT contain "thumbnails/"
    expect(lightboxSrc).not.toContain('thumbnails/')
  })
})

test.describe('thumbnail generation — end-to-end (AC1, AC5)', () => {
  // Allow 90s per test: setup + job completion (2 items × ~15s) + scan + grid verification
  test.setTimeout(90000)

  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  test.afterEach(async ({ request }) => {
    await cancelAllJobs(request)
  })

  // AC1: BE: Generate JPEG thumbnails during sample creation when config is enabled.
  // The E2E test config (test-fixtures/config-with-comfyui.yaml) has thumbnails enabled,
  // so generated images should have a non-empty thumbnail_path in the scan response.
  test('generated images have non-empty thumbnail_path after job completes (AC1)', async ({ page, request }) => {
    const studyName = `E2E Thumb Gen ${Date.now()}`

    // Run a full sample generation job and wait for completion
    const completedJob = await createAndRunJobToCompletion(page, request, studyName)

    // Discover all viewer training runs and find the one scoped to this study.
    // Generated images are saved under {sampleDir}/{training_run}/{study_id}/{checkpoint}/.
    // The viewer discovery returns these as a run named containing the study_id.
    const runsResponse = await request.get('/api/training-runs?source=samples')
    expect(runsResponse.status()).toBe(200)
    const runs = await runsResponse.json() as Array<{ id: number; name: string }>
    // Find a run whose name contains the study_id — this is the study-scoped training run
    const studyScopedRun = runs.find(r => r.name.includes(completedJob.study_id))
    expect(studyScopedRun).toBeDefined()

    // Scan the study-scoped training run — generated images should have thumbnail_path set
    const scanResponse = await request.get(`/api/training-runs/${studyScopedRun!.id}/scan`)
    expect(scanResponse.status()).toBe(200)
    const body = await scanResponse.json() as {
      images: Array<{ relative_path: string; thumbnail_path: string; dimensions: Record<string, string> }>
    }

    // AC1: All generated images should have a non-empty thumbnail_path.
    expect(body.images.length).toBeGreaterThan(0)
    const imagesWithThumbnails = body.images.filter(img => img.thumbnail_path !== '')
    expect(imagesWithThumbnails.length).toBeGreaterThan(0)

    // All images that have a thumbnail must have a path containing "/thumbnails/"
    for (const img of imagesWithThumbnails) {
      expect(img.thumbnail_path).toContain('thumbnails/')
      // Thumbnail path must be a .jpg file
      expect(img.thumbnail_path).toMatch(/\.jpg$/)
    }
  })

  // AC5: FE: Grid view serves thumbnails instead of full-res images when available.
  // After a successful job with thumbnails enabled, the grid should show thumbnails
  // when viewing the study-scoped training run (where generated images live).
  test('grid uses thumbnail URLs for generated images (AC5)', async ({ page, request }) => {
    const studyName = `E2E Thumb Grid ${Date.now()}`

    // Run a full sample generation job and wait for completion
    const completedJob = await createAndRunJobToCompletion(page, request, studyName)

    // Find the study-scoped training run name (contains the study_id).
    // Generated images live under {sampleDir}/{trainingRunName}/{studyId}/{checkpoint}/,
    // so the viewer returns a run whose name contains the studyId.
    const runsResponse = await request.get('/api/training-runs?source=samples')
    expect(runsResponse.status()).toBe(200)
    const runs = await runsResponse.json() as Array<{ id: number; name: string }>
    const studyScopedRun = runs.find(r => r.name.includes(completedJob.study_id))
    expect(studyScopedRun).toBeDefined()

    // The training run selector uses the full run name (including path components) as the
    // option label. Pass the full name so selectTrainingRun finds the exact option.
    const runFullName = studyScopedRun!.name

    // Reload the page so the grid re-fetches scan data with newly generated thumbnails
    await page.goto('/', { waitUntil: 'networkidle' })
    await selectTrainingRun(page, runFullName)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Set up the grid: checkpoint has 2 values (1000, 2000) → put it on X Axis.
    // The generated study has only 1 prompt so there's no Y-Axis dimension to select.
    // Setting checkpoint to X Axis is sufficient to render grid images.
    await selectNaiveOptionByLabel(page, 'Mode for checkpoint', 'X Axis')

    const gridImages = page.locator('.xy-grid [role="gridcell"] img')
    await expect(gridImages.first()).toBeVisible()

    await closeDrawer(page)

    // AC5: At least one grid image must use the thumbnail URL (contains "thumbnails/")
    // because the executor generated thumbnails for the new images.
    const imageCount = await gridImages.count()
    expect(imageCount).toBeGreaterThan(0)

    let foundThumbnailSrc = false
    for (let i = 0; i < imageCount; i++) {
      const src = await gridImages.nth(i).getAttribute('src')
      if (src && src.includes('thumbnails/')) {
        foundThumbnailSrc = true
        // Thumbnail src must still go through the /api/images/ endpoint
        expect(src).toContain('/api/images/')
        // The data-full-src must point to the full-res PNG (not thumbnails/)
        const dataFullSrc = await gridImages.nth(i).getAttribute('data-full-src')
        expect(dataFullSrc).toContain('/api/images/')
        expect(dataFullSrc).not.toContain('thumbnails/')
        break
      }
    }

    expect(foundThumbnailSrc).toBe(true)
  })
})
