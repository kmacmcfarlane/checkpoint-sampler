import { test, expect } from '@playwright/test'
import { resetDatabase, uninstallDemo } from './helpers'

/**
 * E2E tests for B-078: Sample output directory restructure + per-training-run manifest
 * + validation count scoping.
 *
 * Verifies:
 * - AC3: Checkpoint validation only shows checkpoints from the selected training run
 * - AC4: Checkpoint validation only shows sample counts from the selected study
 * - AC7: Validation counts are correct for multi-training-run, multi-study scenarios
 *
 * Key scenarios tested:
 * - Demo checkpoints do NOT appear in validation counts for non-demo training runs
 * - A study validated against training run A does not count samples from training run B
 * - A study validated against one study_id does not count samples from another study_id
 * - Training run with no samples for a given study returns 0 verified (not inflated count)
 */

test.beforeEach(async ({ request }) => {
  await resetDatabase(request)
})

test.afterEach(async ({ request }) => {
  await uninstallDemo(request)
})

test.describe('B-078: validation count scoping', () => {
  /**
   * AC4: Study-scoped validation must scope to the selected study only.
   *
   * When validating "my-model" (which has legacy root-level samples) with a study_id,
   * the validation should look in the new per-training-run path:
   * sample_dir/my-model/{study_id}/checkpoint/
   *
   * Since no samples exist at that path, total_actual should be 0.
   * The legacy samples at sample_dir/checkpoint/ must NOT be counted.
   */
  test('validation scopes to training_run/study_id path — legacy samples are not counted for new-layout validation', async ({ request }) => {
    // AC4: Create a study with known images_per_checkpoint
    const studyResp = await request.post('/api/studies', {
      data: {
        name: `B078 Scoping Test ${Date.now()}`,
        prompt_prefix: '',
        prompts: [{ name: 'landscape', text: 'a landscape scene' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(studyResp.ok()).toBeTruthy()
    const study = await studyResp.json()
    // 1 prompt × 1 step × 1 cfg × 1 pair × 1 seed = 1 image per checkpoint
    expect(study.images_per_checkpoint).toBe(1)

    // Get the "my-model" training run using checkpoint source (same source the frontend
    // uses for the Generate Samples dialog). B-079: validate with study_id uses
    // checkpoint discovery, so the ID must come from the same source.
    const runsResp = await request.get('/api/training-runs?source=checkpoints')
    expect(runsResp.ok()).toBeTruthy()
    const runs = await runsResp.json()
    const myModel = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // AC4: Validate with study_id — must scope to my-model/{study.id}/ path
    // No samples exist at that path, so total_actual must be 0.
    // Legacy samples at root level MUST NOT be counted.
    const validateResp = await request.post(
      `/api/training-runs/${myModel.id}/validate?study_id=${study.id}`,
    )
    expect(validateResp.ok()).toBeTruthy()
    const result = await validateResp.json()

    // AC4: The study expects 1 image per checkpoint
    expect(result.expected_per_checkpoint).toBe(1)

    // AC4: No samples exist at my-model/{study_id}/checkpoint/ path
    // Legacy samples at the root level are NOT counted for study-scoped validation
    expect(result.total_actual).toBe(0)
    expect(result.total_verified).toBe(0)
    expect(result.total_missing).toBe(result.total_expected)

    // Each checkpoint should have 0 verified samples
    for (const cp of result.checkpoints) {
      expect(cp.verified).toBe(0)
      expect(cp.missing).toBe(1) // Expected 1, found 0
    }
  })

  /**
   * AC3 + AC7: Demo checkpoints must NOT appear in validation counts for non-demo training runs.
   *
   * Install the demo dataset (creates demo-model/demo-study/checkpoint/ structure).
   * Then validate the "my-model" training run with a study.
   * The demo's samples MUST NOT be counted for "my-model" validation.
   */
  test('demo samples are not counted when validating non-demo training runs', async ({ request }) => {
    // Install demo dataset (creates demo-model/demo-study/ structure)
    const installResp = await request.post('/api/demo/install')
    expect(installResp.ok()).toBeTruthy()

    // Create a study for testing
    const studyResp = await request.post('/api/studies', {
      data: {
        name: `B078 Demo Isolation Test ${Date.now()}`,
        prompt_prefix: '',
        prompts: [{ name: 'landscape', text: 'a landscape' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(studyResp.ok()).toBeTruthy()
    const study = await studyResp.json()

    // Get the "my-model" training run using checkpoint source (same source the frontend
    // uses for the Generate Samples dialog). B-079: validate with study_id uses
    // checkpoint discovery, so the ID must come from the same source.
    const cpRunsResp = await request.get('/api/training-runs?source=checkpoints')
    expect(cpRunsResp.ok()).toBeTruthy()
    const cpRuns = await cpRunsResp.json()
    const myModel = cpRuns.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // Validate "my-model" with study_id
    // The demo has samples at demo-model/demo-study/{cp}/ which must NOT be counted
    const validateResp = await request.post(
      `/api/training-runs/${myModel.id}/validate?study_id=${study.id}`,
    )
    expect(validateResp.ok()).toBeTruthy()
    const result = await validateResp.json()

    // AC3+AC7: Demo samples must NOT appear in validation of my-model
    // The correct scoped path my-model/{study_id}/{cp}/ has no samples
    expect(result.total_actual).toBe(0)
    expect(result.total_verified).toBe(0)

    // Confirm demo run exists separately via viewer discovery (installed correctly)
    const viewerRunsResp = await request.get('/api/training-runs')
    expect(viewerRunsResp.ok()).toBeTruthy()
    const viewerRuns = await viewerRunsResp.json()
    const demoRun = viewerRuns.find((r: { name: string }) => r.name === 'demo-model/demo-study/demo-model')
    expect(demoRun).toBeDefined()
  })

  /**
   * AC7: Verify that the validate API returns correct structure for multi-study scenarios.
   *
   * Two different studies are created. Validating my-model with study-A must NOT
   * include samples that would exist for study-B's scoped path.
   */
  test('validate API scopes results to specific study_id — two different studies return independent counts', async ({ request }) => {
    // Create study A and study B
    const studyAResp = await request.post('/api/studies', {
      data: {
        name: `B078 Study A ${Date.now()}`,
        prompt_prefix: '',
        prompts: [{ name: 'landscape', text: 'landscape' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 512,
        height: 512,
      },
    })
    expect(studyAResp.ok()).toBeTruthy()
    const studyA = await studyAResp.json()

    const studyBResp = await request.post('/api/studies', {
      data: {
        name: `B078 Study B ${Date.now()}`,
        prompt_prefix: '',
        prompts: [
          { name: 'landscape', text: 'landscape' },
          { name: 'portrait', text: 'portrait' },
          { name: 'abstract', text: 'abstract' },
        ],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42, 43],
        width: 512,
        height: 512,
      },
    })
    expect(studyBResp.ok()).toBeTruthy()
    const studyB = await studyBResp.json()

    // Study A: 1 prompt × 1 step × 1 cfg × 1 pair × 1 seed = 1 image per cp
    expect(studyA.images_per_checkpoint).toBe(1)
    // Study B: 3 prompts × 1 step × 1 cfg × 1 pair × 2 seeds = 6 images per cp
    expect(studyB.images_per_checkpoint).toBe(6)

    // Get my-model training run using checkpoint source (same source the frontend uses).
    // B-079: validate with study_id uses checkpoint discovery for correct path scoping.
    const runsResp = await request.get('/api/training-runs?source=checkpoints')
    expect(runsResp.ok()).toBeTruthy()
    const runs = await runsResp.json()
    const myModel = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // Validate with study A
    const resultAResp = await request.post(
      `/api/training-runs/${myModel.id}/validate?study_id=${studyA.id}`,
    )
    expect(resultAResp.ok()).toBeTruthy()
    const resultA = await resultAResp.json()

    // Validate with study B
    const resultBResp = await request.post(
      `/api/training-runs/${myModel.id}/validate?study_id=${studyB.id}`,
    )
    expect(resultBResp.ok()).toBeTruthy()
    const resultB = await resultBResp.json()

    // AC7: Each study uses its own expected count, scoped to its path
    expect(resultA.expected_per_checkpoint).toBe(1)
    expect(resultB.expected_per_checkpoint).toBe(6)

    // AC7: Neither validation finds samples (paths don't exist yet for either study)
    expect(resultA.total_actual).toBe(0)
    expect(resultB.total_actual).toBe(0)

    // AC7: Missing counts match expected (total_expected = expected_per_cp × num_checkpoints)
    expect(resultA.total_expected).toBe(1 * myModel.checkpoint_count)
    expect(resultB.total_expected).toBe(6 * myModel.checkpoint_count)

    // AC7: The two studies' results are independent — study B's larger expected count
    // does NOT bleed into study A's validation (they are fully scoped)
    expect(resultA.total_expected).not.toEqual(resultB.total_expected)
  })

  /**
   * AC4: Legacy validate (no study_id) still works for runs with root-level samples.
   *
   * The my-model run has legacy samples at root level. Without study_id,
   * the heuristic (max file count) should still detect them correctly.
   */
  test('legacy validate without study_id still detects root-level samples correctly', async ({ request }) => {
    const runsResp = await request.get('/api/training-runs')
    expect(runsResp.ok()).toBeTruthy()
    const runs = await runsResp.json()
    const myModel = runs.find((r: { name: string }) => r.name === 'my-model')
    expect(myModel).toBeDefined()

    // AC4: Legacy validation (no study_id) uses max-file-count heuristic
    const validateResp = await request.post(`/api/training-runs/${myModel.id}/validate`)
    expect(validateResp.ok()).toBeTruthy()
    const result = await validateResp.json()

    // Legacy validation finds 2 samples per checkpoint (from root-level legacy fixtures)
    expect(result.expected_per_checkpoint).toBe(2)
    expect(result.total_actual).toBe(4) // 2 checkpoints × 2 samples each
    expect(result.total_missing).toBe(0)
  })
})
