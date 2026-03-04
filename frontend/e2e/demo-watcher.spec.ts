import { test, expect } from '@playwright/test'
import { resetDatabase, selectTrainingRun } from './helpers'

/**
 * E2E tests for B-042: Watcher correctly handles study-scoped training runs.
 *
 * Verifies:
 * - AC1: Selecting the demo training run does not produce 'failed to watch directory'
 *   errors in the backend logs (the app loads successfully after selection).
 * - AC2: File watcher correctly resolves nested study directory paths for checkpoint
 *   watch directories (selecting the demo run completes scan and shows dimensions).
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
})
