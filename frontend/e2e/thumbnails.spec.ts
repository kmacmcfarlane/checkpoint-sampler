import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, closeDrawer } from './helpers'

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
