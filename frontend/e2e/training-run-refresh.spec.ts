import { test, expect } from '@playwright/test'
import { closeDrawer, getGenerateSamplesDialog } from './helpers'

/**
 * E2E tests for B-142: Generate Samples refresh button serves stale FSState cache on NFS mounts.
 *
 * AC1: Backend accepts ?refresh=true query parameter on the training-runs list endpoint
 *      and returns a successful response (HTTP 200).
 * AC2: The refresh button in JobLaunchDialog is present and clickable; after clicking
 *      it, the dialog remains operational (no errors, loading state clears).
 * AC3: The ?refresh=true query triggers a fresh disk rescan on the backend (NFS-specific
 *      behavior cannot be simulated in E2E, but the API round-trip succeeds end-to-end).
 */

test.describe('training run refresh button (B-142)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  // AC1: Backend accepts ?refresh=true and returns HTTP 200 (end-to-end API smoke test).
  test('GET /api/v1/training-runs?source=checkpoints&refresh=true returns HTTP 200', async ({ request }) => {
    // AC1: The backend must accept the refresh query parameter without error.
    const response = await request.get('/api/v1/training-runs?source=checkpoints&refresh=true')
    expect(response.status()).toBe(200)

    const body = await response.json() as unknown[]
    // Result is an array (may be empty if no checkpoints in test fixtures).
    expect(Array.isArray(body)).toBe(true)
  })

  // AC2: The refresh button is visible and clickable inside the Generate Samples dialog.
  // After clicking, the dialog remains open and functional (no crash or error).
  test('refresh button is visible and clickable in the Generate Samples dialog', async ({ page }) => {
    await closeDrawer(page)

    // Open Generate Samples dialog
    const generateBtn = page.locator('[data-testid="generate-samples-button"]')
    await expect(generateBtn).toBeVisible()
    await generateBtn.click()

    const dialog = getGenerateSamplesDialog(page)
    await expect(dialog).toBeVisible()

    // AC2: Refresh button must be present.
    const refreshBtn = dialog.locator('[data-testid="refresh-training-run-button"]')
    await expect(refreshBtn).toBeVisible()

    // AC2: Clicking the refresh button must not crash or close the dialog.
    await refreshBtn.click()

    // Wait for the loading state to finish (button re-enables after fetch completes).
    await expect(refreshBtn).toBeEnabled({ timeout: 10000 })

    // Dialog must remain open and operational after the refresh.
    await expect(dialog).toBeVisible()
  })

  // AC3: The API round-trip for forced rescan completes successfully end-to-end.
  // (The NFS-specific case of picking up new files cannot be simulated, but
  // verifying the backend returns a 200 with an array proves the rescan pathway
  // executes without error.)
  test('backend forced rescan returns a valid training run list', async ({ request }) => {
    // First call without refresh (cached path).
    const cachedResponse = await request.get('/api/v1/training-runs?source=checkpoints')
    expect(cachedResponse.status()).toBe(200)
    const cachedBody = await cachedResponse.json() as unknown[]
    expect(Array.isArray(cachedBody)).toBe(true)

    // Second call with refresh=true (forced rescan path).
    const refreshResponse = await request.get('/api/v1/training-runs?source=checkpoints&refresh=true')
    expect(refreshResponse.status()).toBe(200)
    const refreshBody = await refreshResponse.json() as unknown[]
    expect(Array.isArray(refreshBody)).toBe(true)

    // The number of training runs must be consistent between the two calls
    // (test fixtures are static — no new files added between calls).
    expect(refreshBody.length).toBe(cachedBody.length)
  })
})
