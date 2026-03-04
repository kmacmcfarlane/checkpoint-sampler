import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

// AC: SampleJobsService methods return an empty result (or appropriate error)
//     when no jobs exist
// AC: No panic occurs when /api/sample-jobs endpoints are called
// Note: docker-compose.test.yml uses config-with-comfyui.yaml, so ComfyUI IS
//       configured in the test environment. These tests verify API behaviour
//       for empty/invalid requests, not the "no ComfyUI" code path.

test.describe('sample-jobs API (ComfyUI configured in test environment)', () => {
  // AC: Each E2E test is independent -- reset database before each test
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('GET /api/sample-jobs returns 200 with empty array', async ({ request }) => {
    const response = await request.get('/api/sample-jobs')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  test('POST /api/sample-jobs returns error (not a panic)', async ({ request }) => {
    const response = await request.post('/api/sample-jobs', {
      data: {
        training_run_name: 'nonexistent',
        study_id: 'nonexistent',
        workflow_name: 'test.json',
      },
    })
    // Should get an error response, not a 502/503 from a crashed backend
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(response.status()).toBeLessThan(500)
  })

  // S-062 UAT rework: deleting a study that has associated sample_jobs must
  // succeed (return 204) rather than returning 500 with FK constraint error.
  // Previously, the study_id FK on sample_jobs did not have ON DELETE CASCADE,
  // so the DELETE would fail with "FOREIGN KEY constraint failed (787)".
  test('DELETE /api/studies/{id} returns 204 when study has associated sample jobs', async ({ request }) => {
    // Step 1: Create a study via the API
    const studyPayload = {
      name: 'Cascade Test Study',
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'a test prompt' }],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 512,
      height: 512,
    }
    const createStudyResp = await request.post('/api/studies', { data: studyPayload })
    expect(createStudyResp.status()).toBe(201)
    const study = await createStudyResp.json()
    expect(study.id).toBeTruthy()

    // Step 2: Create a sample job referencing this study.
    const jobResp = await request.post('/api/sample-jobs', {
      data: {
        training_run_name: 'my-model',
        study_id: study.id,
        workflow_name: 'test-workflow.json',
      },
    })
    // The job should be created successfully (ComfyUI mock is running)
    expect(jobResp.status()).toBe(201)

    // Verify the job exists and references our study
    const jobsResp = await request.get('/api/sample-jobs')
    expect(jobsResp.status()).toBe(200)
    const jobs = await jobsResp.json()
    expect(jobs.length).toBeGreaterThanOrEqual(1)
    expect(jobs.some((j: { study_id: string }) => j.study_id === study.id)).toBe(true)

    // Step 3: Delete the study — this previously returned 500 with FK constraint error.
    // With the ON DELETE CASCADE migration, it should return 204.
    const deleteResp = await request.delete(`/api/studies/${study.id}`)
    expect(deleteResp.status()).toBe(204)

    // Step 4: Verify the study is gone
    const studiesResp = await request.get('/api/studies')
    expect(studiesResp.status()).toBe(200)
    const studies = await studiesResp.json()
    expect(studies.every((s: { id: string }) => s.id !== study.id)).toBe(true)
  })
})
