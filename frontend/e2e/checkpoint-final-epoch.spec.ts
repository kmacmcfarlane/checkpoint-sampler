import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E test for B-161: checkpoint slider omits the final epoch.
 *
 * Verifies that assignFinalCheckpointStep correctly recognizes an 'epochs-N'
 * token in the run name (not just 'steps-N') so that the unsuffixed final
 * checkpoint is assigned the correct step number and sorts last, instead of
 * colliding with (or being dropped behind) the highest numbered checkpoint.
 *
 * Test fixture data (test-fixtures/checkpoints/):
 *   - b161-epochs-demo-epochs-100.safetensors          (final, unsuffixed)
 *   - b161-epochs-demo-epochs-100-000010.safetensors
 *   - b161-epochs-demo-epochs-100-000050.safetensors
 *   - b161-epochs-demo-epochs-100-000090.safetensors
 *   Training run name: "b161-epochs-demo-epochs-100"
 */

test.describe('checkpoint slider surfaces final epoch checkpoint (B-161)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('checkpoint-based discovery assigns the final checkpoint StepNumber 100 from the epochs-N run name', async ({
    request,
  }) => {
    const response = await request.get('/api/training-runs?source=checkpoints')
    expect(response.ok()).toBeTruthy()

    const runs = await response.json()
    const run = runs.find((r: { name: string }) => r.name === 'b161-epochs-demo-epochs-100')
    expect(run).toBeDefined()
    expect(run.checkpoint_count).toBe(4)

    const steps = run.checkpoints.map((cp: { step_number: number }) => cp.step_number)
    expect(steps).toEqual([10, 50, 90, 100])

    // The unsuffixed final checkpoint must resolve to step 100 and sort last,
    // without colliding with the numbered -000090 checkpoint.
    const finalCheckpoint = run.checkpoints[run.checkpoints.length - 1]
    expect(finalCheckpoint.filename).toBe('b161-epochs-demo-epochs-100.safetensors')
    expect(finalCheckpoint.step_number).toBe(100)
  })
})
