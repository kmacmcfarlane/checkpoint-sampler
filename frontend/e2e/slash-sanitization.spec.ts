import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for B-088: Sanitize training run directory names (replace slashes with underscores).
 *
 * Training run names can contain directory separators (e.g. "test-run/my-model" from
 * a checkpoint at test-run/my-model-step*.safetensors). When constructing filesystem
 * paths for sample output directories, all forward and backward slashes in the training
 * run name must be replaced with underscores so that the path remains a single directory
 * level. The DB and API continue to store and return the original name with slashes.
 *
 * Test fixture data:
 *   - test-fixtures/checkpoints/test-run/my-model-step*.safetensors → training run "test-run/my-model"
 *   - FixtureSeeder creates: samples/test-run_my-model/{study_id}/{checkpoint}/ (sanitized path)
 *
 * Verified behaviors:
 *   - AC1: Checkpoint API returns "test-run/my-model" (slash preserved in API response)
 *   - AC2: DB/API keeps the original name with slashes
 *   - AC3: Viewer-discovery finds "test-run_my-model" directory (sanitized on disk)
 *   - AC4: Fixture data includes a training run name with slashes (test-run/my-model)
 */

const SLASH_TRAINING_RUN_NAME = 'test-run/my-model'
const SANITIZED_DIR_NAME = 'test-run_my-model'

test.describe('B-088: slash sanitization in training run directory names', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC4 + AC1: Fixture data includes a training run name with slashes in checkpoint_dir.
  // The API (source=checkpoints) must return the original name with the slash intact.
  test('checkpoint API returns training run name with forward slash', async ({ request }) => {
    // AC: source=checkpoints discovers "test-run/my-model" from the
    // test-fixtures/checkpoints/test-run/ subdirectory
    const response = await request.get('/api/training-runs?source=checkpoints')
    expect(response.ok()).toBeTruthy()

    const runs = await response.json()
    const slashRun = runs.find(
      (r: { name: string }) => r.name === SLASH_TRAINING_RUN_NAME,
    )
    expect(slashRun).toBeDefined()

    // AC2: DB and API must return the original name with the slash intact
    expect(slashRun.name).toBe(SLASH_TRAINING_RUN_NAME)
    expect(slashRun.checkpoint_count).toBeGreaterThanOrEqual(1)
  })

  // AC3: After the FixtureSeeder runs, samples exist at the sanitized path.
  // Viewer-discovery finds training runs from sample dirs, so the viewer API
  // should return the sanitized name (since that is the directory on disk).
  test('viewer-discovery finds samples at sanitized directory path', async ({ request }) => {
    // The fixture seeder (called by resetDatabase) creates:
    //   samples/test-run_my-model/{study_id}/{checkpoint}/
    // Viewer-discovery scans sample_dir and constructs the run name from directories.
    // It will see: test-run_my-model/{study_id}/{checkpoint} → run name includes study_id prefix.
    const response = await request.get('/api/training-runs')
    expect(response.ok()).toBeTruthy()

    const runs = await response.json()

    // Verify the sanitized directory "test-run_my-model" appears in viewer-discovered runs.
    // Viewer-discovery builds the run name from directory components, so the run name
    // will be something like "test-run_my-model/{study_id}/my-model".
    const hasSlashRun = runs.some(
      (r: { name: string }) => r.name.includes(SANITIZED_DIR_NAME),
    )
    expect(hasSlashRun).toBe(true)

    // The raw slash-containing name "test-run/my-model" must NOT appear as a
    // viewer-discovered run (it is a sanitized directory on disk, not a slash path).
    const hasUnsanitizedRun = runs.some(
      (r: { name: string }) => r.name === SLASH_TRAINING_RUN_NAME,
    )
    expect(hasUnsanitizedRun).toBe(false)
  })

  // AC1 + AC4: The checkpoint source returns names with slashes (original training run names);
  // the samples source returns names derived from sanitized directory structure.
  // This confirms the two sources reflect different naming conventions as expected.
  test('checkpoint source returns slash names; samples source returns sanitized names', async ({
    request,
  }) => {
    const [cpResponse, sampleResponse] = await Promise.all([
      request.get('/api/training-runs?source=checkpoints'),
      request.get('/api/training-runs'),
    ])

    expect(cpResponse.ok()).toBeTruthy()
    expect(sampleResponse.ok()).toBeTruthy()

    const cpRuns = await cpResponse.json()
    const sampleRuns = await sampleResponse.json()

    // Checkpoint source: must return "test-run/my-model" (with slash)
    const cpSlashRun = cpRuns.find(
      (r: { name: string }) => r.name === SLASH_TRAINING_RUN_NAME,
    )
    expect(cpSlashRun).toBeDefined()

    // Samples source: must NOT return "test-run/my-model" (the directory is sanitized)
    const sampleSlashRun = sampleRuns.find(
      (r: { name: string }) => r.name === SLASH_TRAINING_RUN_NAME,
    )
    expect(sampleSlashRun).toBeUndefined()

    // Samples source: must include a run derived from the sanitized "test-run_my-model" directory
    const sampleSanitizedRun = sampleRuns.some(
      (r: { name: string }) => r.name.includes(SANITIZED_DIR_NAME),
    )
    expect(sampleSanitizedRun).toBe(true)
  })

  // AC1 + AC5: Unit test coverage already verifies path construction in job_executor.go
  // and study_availability.go. This test verifies the validate API endpoint correctly
  // uses the sanitized path when a study_id is provided for a slash-containing training run.
  test('validate API with study_id uses sanitized path for slash-containing training run', async ({
    request,
  }) => {
    // Get training runs from the checkpoint source (same source the frontend uses
    // for the Generate Samples dialog).
    const runsResponse = await request.get('/api/training-runs?source=checkpoints')
    expect(runsResponse.ok()).toBeTruthy()
    const runs = await runsResponse.json()

    // Find "test-run/my-model" (slash-containing training run from fixture)
    const slashRun = runs.find(
      (r: { name: string }) => r.name === SLASH_TRAINING_RUN_NAME,
    )
    expect(slashRun).toBeDefined()

    // Create a minimal study
    const studyResp = await request.post('/api/studies', {
      data: {
        name: `B088 Slash Test ${Date.now()}`,
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test prompt' }],
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

    // Call validate with study_id for the slash-containing training run.
    // The backend must sanitize the training run name when building the sample path.
    // If it did NOT sanitize, it would try to read from "test-run/my-model/{study_id}/"
    // (two directory levels) instead of "test-run_my-model/{study_id}/" (one level).
    const validateResp = await request.post(
      `/api/training-runs/${slashRun.id}/validate?study_id=${study.id}`,
    )
    expect(validateResp.ok()).toBeTruthy()

    const result = await validateResp.json()

    // Response must include all required fields
    expect(typeof result.total_expected).toBe('number')
    expect(typeof result.total_actual).toBe('number')
    expect(typeof result.total_missing).toBe('number')
    expect(Array.isArray(result.checkpoints)).toBe(true)
    expect(result.checkpoints.length).toBe(slashRun.checkpoint_count)
  })
})
