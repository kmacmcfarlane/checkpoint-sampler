import { test, expect, type APIRequestContext } from '@playwright/test'
import { resetDatabase, cancelAllJobs } from './helpers'

/**
 * E2E tests for S-161: queue sample jobs when ComfyUI is offline, resolve
 * checkpoint paths lazily at execution time.
 *
 * ## Simulating "ComfyUI offline"
 *
 * The comfyui-mock service exposes an always-on control plane (separate from
 * its main API port) that can close/reopen the main port at the TCP level:
 *   POST http://comfyui-mock:8189/control/comfyui {"down": true|false}
 * Closing the port causes real connection-refused errors on the backend side,
 * which is what the backend's isConnectionError() classifies as a transient
 * outage (as opposed to an HTTP error response from a live ComfyUI).
 *
 * AC: BE: creating a job while ComfyUI is unreachable succeeds and persists a
 *     pending job with items (no eager path-match rejection).
 * AC: E2E: with ComfyUI stopped, launching a job creates a pending job that
 *     begins processing once ComfyUI is reachable.
 */

const CONTROL_URL = process.env.COMFYUI_MOCK_CONTROL_URL || 'http://comfyui-mock:8189'

async function setComfyUIDown(request: APIRequestContext, down: boolean): Promise<void> {
  const resp = await request.post(`${CONTROL_URL}/control/comfyui`, { data: { down } })
  expect(resp.status()).toBe(200)
}

test.describe('Queue sample jobs when ComfyUI is offline (S-161)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test.afterEach(async ({ request }) => {
    // Always restore ComfyUI before cleaning up jobs/tearing down, so later
    // specs in this shard are unaffected.
    await setComfyUIDown(request, false)
    await cancelAllJobs(request)
  })

  test('creates a pending job while ComfyUI is offline, then processes it once ComfyUI returns', async ({ request }) => {
    // Step 1: create a study to launch a job against.
    const studyPayload = {
      name: 'Offline Queue Study',
      prompt_prefix: '',
      prompts: [{ name: 'offline-test', text: 'a test prompt for offline queueing' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      resolutions: [{ width: 512, height: 512 }],
      workflow_template: 'test-workflow.json',
      vaes: ['test-vae.safetensors'],
      text_encoders: ['test-clip.safetensors'],
    }
    const createStudyResp = await request.post('/api/studies', { data: studyPayload })
    expect(createStudyResp.status()).toBe(201)
    const study = await createStudyResp.json()

    // Step 2: take ComfyUI offline (close the mock's main port at the TCP level).
    await setComfyUIDown(request, true)

    try {
      // Step 3: creating a job must still succeed — no eager path-match rejection.
      const jobResp = await request.post('/api/sample-jobs', {
        data: {
          training_run_name: 'my-model',
          study_id: study.id,
        },
      })
      expect(jobResp.status()).toBe(201)
      const job = await jobResp.json()
      expect(job.id).toBeTruthy()

      // The job is created as pending (not yet auto-started, since the executor
      // will fail to connect and leave items pending on the first tick).
      // Poll briefly to allow at least one executor tick to occur, and confirm
      // the job never fails/completes while ComfyUI is down — it stays
      // pending/running with all items still pending.
      await new Promise(resolve => setTimeout(resolve, 3000))

      const getJobResp = await request.get(`/api/sample-jobs/${job.id}`)
      expect(getJobResp.status()).toBe(200)
      const jobAfterWait = (await getJobResp.json()).job
      expect(['pending', 'running']).toContain(jobAfterWait.status)
      expect(jobAfterWait.failed_items).toBe(0)
      expect(jobAfterWait.completed_items).toBe(0)

      // Step 4: bring ComfyUI back online — the queued job should begin
      // processing and eventually complete successfully.
      await setComfyUIDown(request, false)

      await expect(async () => {
        const resp = await request.get(`/api/sample-jobs/${job.id}`)
        const j = (await resp.json()).job
        expect(j.status).toBe('completed')
        expect(j.completed_items).toBeGreaterThan(0)
        expect(j.failed_items).toBe(0)
      }).toPass({ timeout: 20000, intervals: [500, 1000, 2000] })
    } finally {
      // Ensure ComfyUI is back up even if an assertion above throws.
      await setComfyUIDown(request, false)
    }
  })
})
