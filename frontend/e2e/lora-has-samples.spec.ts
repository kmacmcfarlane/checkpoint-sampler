import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for B-144: LoRA sample detection uses nested layout.
 *
 * The DiscoveryService.Discover() previously only checked the flat legacy
 * sample path ({sampleDir}/{checkpoint.safetensors}/), so has_samples was
 * always false for LoRA runs whose samples live under:
 *   {sampleDir}/{run}/{study}/{base_model}/{checkpoint.safetensors}/
 *
 * Test fixture data:
 *   - test-fixtures/loras/test-lora-step00001000.safetensors  (LoRA checkpoint)
 *   - test-fixtures/loras/test-lora-step00002000.safetensors  (LoRA checkpoint)
 *   - test-fixtures/samples/test-lora/study-1/sd15/
 *       test-lora-step00001000.safetensors/  (4-level LoRA layout sample dir)
 *
 * The flat legacy layout is covered by the existing my-model fixture
 * (samples/my-model-step00001000.safetensors/, etc.).
 */

test.describe('LoRA has_samples detection (B-144)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: BE: has_samples (and checkpoint validation status) correctly detects existing
  // samples for LoRA training runs
  // AC: BE: LoRA sample detection accounts for the additional {base_model_name}
  // directory level in the sample path layout
  test('training-runs API returns has_samples=true for LoRA run with 4-level nested samples', async ({ request }) => {
    // The test-lora fixture has samples under:
    //   samples/test-lora/study-1/sd15/test-lora-step00001000.safetensors/
    // This exercises the LoRA layout: {run}/{study}/{base_model}/{checkpoint.safetensors}/
    //
    // source=checkpoints returns both checkpoint and LoRA runs (via FSState.CheckpointRuns).
    // Use refresh=true to force a fresh filesystem scan (FSState cache may not have
    // picked up the re-seeded LoRA fixture dirs yet after resetDatabase()).
    const response = await request.get('/api/v1/training-runs?source=checkpoints&refresh=true')
    expect(response.ok()).toBeTruthy()

    const runs = await response.json() as Array<{ name: string; has_samples: boolean; kind: string; checkpoints: Array<{ filename: string; has_samples: boolean }> }>
    expect(runs.length).toBeGreaterThan(0)

    const loraRun = runs.find(r => r.name === 'test-lora')
    expect(loraRun).toBeDefined()

    // AC: LoRA run must report has_samples=true (not false as before B-144 fix)
    expect(loraRun!.has_samples).toBe(true)
    expect(loraRun!.kind).toBe('lora')

    // AC: The specific checkpoint with a sample dir must have has_samples=true
    const cp1 = loraRun!.checkpoints.find(c => c.filename === 'test-lora-step00001000.safetensors')
    expect(cp1).toBeDefined()
    expect(cp1!.has_samples).toBe(true)

    // The checkpoint without a sample dir must NOT have has_samples=true
    const cp2 = loraRun!.checkpoints.find(c => c.filename === 'test-lora-step00002000.safetensors')
    if (cp2) {
      // step-2000 has no sample dir in the fixture — must be false
      expect(cp2.has_samples).toBe(false)
    }
  })

  // AC: BE: non-LoRA checkpoint runs continue to detect samples (no regression)
  // The existing my-model fixture uses the flat legacy layout.
  test('training-runs API returns has_samples=true for checkpoint run with flat legacy samples (regression)', async ({ request }) => {
    // The my-model fixture uses the flat legacy layout:
    //   test-fixtures/samples/my-model-step00001000.safetensors/
    //   test-fixtures/samples/my-model-step00002000.safetensors/
    const response = await request.get('/api/v1/training-runs?source=checkpoints')
    expect(response.ok()).toBeTruthy()

    const runs = await response.json() as Array<{ name: string; has_samples: boolean; kind: string }>
    const checkpointRun = runs.find(r => r.name === 'my-model')
    expect(checkpointRun).toBeDefined()

    // AC: non-LoRA checkpoint run must still report has_samples=true
    expect(checkpointRun!.has_samples).toBe(true)
    expect(checkpointRun!.kind).toBe('checkpoint')
  })

  // AC: FE: the Jobs nav green bead appears for a LoRA run that has samples on disk
  // AC: FE: checkpoint validation status no longer reports 'no samples' when samples
  // exist and render in the grid
  //
  // The nav green bead is driven by beadStatus.ts which uses run.has_samples from
  // the training-runs API. When has_samples=true, getBeadStatus() returns 'complete'
  // (green) even with no jobs. We verify the API response drives the correct UI state.
  test('LoRA run with samples shows correct has_samples in API (drives green bead)', async ({ request }) => {
    // Verify the API response that the frontend uses to compute bead status.
    // source=checkpoints returns both checkpoint and LoRA runs.
    // Use refresh=true to force a fresh filesystem scan (FSState cache may not have
    // picked up the re-seeded LoRA fixture dirs yet after resetDatabase()).
    const response = await request.get('/api/v1/training-runs?source=checkpoints&refresh=true')
    expect(response.ok()).toBeTruthy()

    const runs = await response.json() as Array<{ name: string; has_samples: boolean }>
    const loraRun = runs.find(r => r.name === 'test-lora')
    expect(loraRun).toBeDefined()

    // beadStatus.ts line 29: `if (hasCompleted || run.has_samples) return 'complete'`
    // When has_samples=true and no jobs exist, the bead status is 'complete' (green).
    // This is the AC: LoRA run must report has_samples=true so beadStatus returns green.
    expect(loraRun!.has_samples).toBe(true)
  })
})
