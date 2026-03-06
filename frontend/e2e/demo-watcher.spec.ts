import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, uninstallDemo } from './helpers'

/**
 * E2E tests for B-042: Watcher correctly handles study-scoped training runs.
 * Also covers S-078 UAT rework: demo images render without broken paths.
 *
 * Verifies:
 * - AC1: Selecting the demo training run does not produce 'failed to watch directory'
 *   errors in the backend logs (the app loads successfully after selection).
 * - AC2: File watcher correctly resolves nested study directory paths for checkpoint
 *   watch directories (selecting the demo run completes scan and shows dimensions).
 * - S-078 UAT: Demo images render correctly (not broken/404) after the scanner
 *   includes the study name prefix in relative paths.
 *
 * The demo dataset creates a study-scoped training run "demo-study/demo-model"
 * with checkpoint sample directories nested under sample_dir/demo-study/.
 * Before this fix, the watcher would try to watch sample_dir/checkpoint.safetensors
 * instead of sample_dir/demo-study/checkpoint.safetensors, causing errors.
 */

test.beforeEach(async ({ request }) => {
  await resetDatabase(request)
  // Ensure the demo dataset is installed (creates study-scoped directories)
  await request.post('/api/demo/install')
})

// Uninstall the demo dataset after each test to prevent filesystem artifacts
// (demo-study/ directory, demo images) from leaking into subsequent spec files.
test.afterEach(async ({ request }) => {
  await uninstallDemo(request)
})

test.describe('study-scoped watcher paths (B-042)', () => {
  // AC1: Selecting the demo training run does not produce 'failed to watch directory' errors
  // AC2: File watcher correctly resolves nested study directory paths
  test('selecting the demo training run loads successfully without watcher errors', async ({ page }) => {
    await page.goto('/')

    // Select the study-scoped demo training run
    await selectTrainingRun(page, 'demo-study/demo-model')

    // After selection, the app should scan and show the Dimensions panel.
    // If the watcher failed to resolve the study-scoped paths, the backend
    // would log 'failed to watch directory' errors. A successful scan
    // completing and rendering the Dimensions panel confirms the watcher
    // resolved the nested paths correctly.
    await expect(page.getByText('Dimensions')).toBeVisible()

    // The placeholder text should be gone (run is selected and scanned)
    await expect(page.getByText('Select a training run to get started.')).not.toBeVisible()
  })

  // AC2: Verify that the demo training run has study-scoped checkpoint structure via API
  test('demo training run API returns study-scoped checkpoints with samples', async ({ request }) => {
    const response = await request.get('/api/training-runs')
    expect(response.ok()).toBeTruthy()

    const runs = await response.json()
    const demoRun = runs.find((r: { name: string }) => r.name === 'demo-study/demo-model')
    expect(demoRun).toBeDefined()

    // The demo run should have 3 checkpoints, all with samples
    expect(demoRun.checkpoint_count).toBe(3)
    expect(demoRun.has_samples).toBe(true)

    for (const cp of demoRun.checkpoints) {
      expect(cp.has_samples).toBe(true)
    }
  })

  // S-078 UAT rework: Verify demo images render (not broken/404)
  // The scanner must include the study name prefix ("demo-study/") in relative
  // paths so that /api/images/{relPath} resolves to the correct file.
  test('demo images render in the grid without broken paths (S-078 UAT)', async ({ page }) => {
    await page.goto('/')

    // Select the demo training run
    await selectTrainingRun(page, 'demo-study/demo-model')

    // Wait for dimension panel (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Assign axes: cfg -> X, prompt_name -> Y (matching demo preset layout)
    await selectNaiveOptionByLabel(page, 'Role for cfg', 'X Axis')
    await selectNaiveOptionByLabel(page, 'Role for prompt_name', 'Y Axis')

    // Wait for grid images to appear
    const images = page.locator('.xy-grid [role="gridcell"] img')
    await expect(images.first()).toBeVisible()

    // Verify that image src attributes contain the study name prefix.
    // Before the fix, paths were missing "demo-study/" causing 404s.
    const firstImageSrc = await images.first().getAttribute('src')
    expect(firstImageSrc).toContain('demo-study')

    // Verify images actually loaded (not broken) by checking naturalWidth > 0.
    // A broken image (404) will have naturalWidth === 0.
    const imageCount = await images.count()
    expect(imageCount).toBeGreaterThan(0)
    for (let i = 0; i < imageCount; i++) {
      const naturalWidth = await images.nth(i).evaluate(
        (img: HTMLImageElement) => img.naturalWidth
      )
      expect(naturalWidth).toBeGreaterThan(0)
    }
  })

  // S-078 UAT rework: Verify demo image API paths resolve correctly
  test('demo image API returns 200 for study-scoped paths (S-078 UAT)', async ({ request }) => {
    // List training runs to find the demo run ID
    const runsResponse = await request.get('/api/training-runs')
    expect(runsResponse.ok()).toBeTruthy()
    const runs = await runsResponse.json()
    const demoRun = runs.find((r: { name: string }) => r.name === 'demo-study/demo-model')
    expect(demoRun).toBeDefined()

    // Scan the demo run via GET /api/training-runs/{id}/scan
    const scanResponse = await request.get(`/api/training-runs/${demoRun.id}/scan`)
    expect(scanResponse.ok()).toBeTruthy()
    const scanResult = await scanResponse.json()

    // Verify the scan returned images with study-scoped paths
    expect(scanResult.images.length).toBeGreaterThan(0)
    const firstImage = scanResult.images[0]
    expect(firstImage.relative_path).toContain('demo-study/')

    // Fetch the image via API and verify it returns 200 (not 404)
    const imageResponse = await request.get(`/api/images/${firstImage.relative_path}`)
    expect(imageResponse.status()).toBe(200)

    // Verify the response is a PNG image
    const contentType = imageResponse.headers()['content-type']
    expect(contentType).toContain('image/png')
  })
})
