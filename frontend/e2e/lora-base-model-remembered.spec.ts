import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for B-145: Base model remembered when selecting a training-run/study
 * with existing samples.
 *
 * The studies availability endpoint now reports the base-model directory names
 * that produced existing LoRA samples (derived from the LoRA output layout
 * {sampleDir}/{run}/{study}/{base_model}/{checkpoint}/). The Generate Samples
 * dialog uses this to pre-select the remembered base model when a LoRA run +
 * study with existing samples is chosen and no loaded job exists.
 *
 * Fixture data (seeded by FixtureSeeder after resetDatabase):
 *   - training run "test-lora" (kind=lora)
 *   - study "study-1" (E2ELoRAFixtureStudyID)
 *   - samples at samples/test-lora/study-1/sd15/test-lora-step00001000.safetensors/
 *     → base model directory name "sd15"
 */

test.describe('LoRA base model remembered from existing samples (B-145)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC: BE — prior base model for a run/study can be resolved from existing
  // sample metadata. The availability endpoint reports base_models derived from
  // the on-disk LoRA layout.
  test('availability endpoint reports base_models for the LoRA run/study with existing samples', async ({ request }) => {
    // Locate the test-lora run index. source=checkpoints returns both checkpoint
    // and LoRA runs. refresh=true forces a fresh FS scan after reset.
    const runsResp = await request.get('/api/training-runs?source=checkpoints&refresh=true')
    expect(runsResp.ok()).toBeTruthy()
    // S-155: address the run by its stable opaque id, not a positional index.
    const runs = await runsResp.json() as Array<{ id: string; name: string }>
    const loraRun = runs.find(r => r.name === 'test-lora')
    expect(loraRun).toBeDefined()

    const availResp = await request.get(`/api/studies/availability?training_run_id=${encodeURIComponent(loraRun!.id)}`)
    expect(availResp.ok()).toBeTruthy()
    const availability = await availResp.json() as Array<{
      study_id: string
      study_name: string
      has_samples: boolean
      base_models?: string[]
    }>

    // The study "study-1" has LoRA samples under base model dir "sd15".
    const study1 = availability.find(a => a.study_name === 'study-1')
    expect(study1).toBeDefined()
    expect(study1!.has_samples).toBe(true)
    expect(study1!.base_models).toBeDefined()
    expect(study1!.base_models).toContain('sd15')
  })

  // AC: FE — when no prior base model exists, the dropdown remains empty without
  // error. A checkpoint run/study combination must not report any base_models.
  test('availability reports no base_models for a checkpoint run/study (graceful empty)', async ({ request }) => {
    const runsResp = await request.get('/api/training-runs?source=checkpoints&refresh=true')
    expect(runsResp.ok()).toBeTruthy()
    // S-155: address the run by its stable opaque id, not a positional index.
    const runs = await runsResp.json() as Array<{ id: string; name: string }>
    const checkpointRun = runs.find(r => r.name === 'my-model')
    expect(checkpointRun).toBeDefined()

    const availResp = await request.get(`/api/studies/availability?training_run_id=${encodeURIComponent(checkpointRun!.id)}`)
    expect(availResp.ok()).toBeTruthy()
    const availability = await availResp.json() as Array<{
      study_name: string
      base_models?: string[]
    }>

    // The flat-layout checkpoint fixture study must report no LoRA base models.
    for (const a of availability) {
      expect(a.base_models ?? []).toHaveLength(0)
    }
  })
})
