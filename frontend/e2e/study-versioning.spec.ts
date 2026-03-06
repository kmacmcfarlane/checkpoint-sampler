import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for study immutability + fork (S-085 rework).
 *
 * Verifies:
 * - Studies no longer have a version field
 * - Fork endpoint creates a new study from an existing one
 * - Has-samples endpoint returns sample status
 */

// Helper: minimal valid study payload for API calls
function makeStudyPayload(name: string) {
  return {
    name,
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
}

test.describe('study immutability + fork (S-085)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  test('newly created study does not have a version field', async ({ request }) => {
    const payload = makeStudyPayload(`No Version Test ${Date.now()}`)
    const createResp = await request.post('/api/studies', { data: payload })
    expect(createResp.status()).toBe(201)

    const study = await createResp.json()
    expect(study.id).toBeTruthy()
    expect(study.name).toContain('No Version Test')
    expect(study).not.toHaveProperty('version')
  })

  test('fork creates a new study from an existing one', async ({ request }) => {
    const payload = makeStudyPayload(`Fork Source ${Date.now()}`)
    const createResp = await request.post('/api/studies', { data: payload })
    expect(createResp.status()).toBe(201)
    const source = await createResp.json()

    const forkPayload = {
      ...payload,
      source_id: source.id,
      name: `${source.name} - fork`,
      steps: [10, 20],
    }
    const forkResp = await request.post(`/api/studies/${source.id}/fork`, { data: forkPayload })
    expect(forkResp.status()).toBe(201)
    const forked = await forkResp.json()

    expect(forked.id).not.toBe(source.id)
    expect(forked.name).toContain('- fork')
    expect(forked.steps).toEqual([10, 20])
  })

  test('fork returns 404 for non-existent source', async ({ request }) => {
    const payload = makeStudyPayload(`Fork Missing ${Date.now()}`)
    const forkResp = await request.post('/api/studies/non-existent-id/fork', { data: { ...payload, source_id: 'non-existent-id' } })
    expect(forkResp.status()).toBe(404)
  })

  test('has-samples returns false for study without generated samples', async ({ request }) => {
    const payload = makeStudyPayload(`Has Samples Test ${Date.now()}`)
    const createResp = await request.post('/api/studies', { data: payload })
    expect(createResp.status()).toBe(201)
    const study = await createResp.json()

    const hasSamplesResp = await request.get(`/api/studies/${study.id}/has-samples`)
    expect(hasSamplesResp.status()).toBe(200)
    const result = await hasSamplesResp.json()
    expect(result.has_samples).toBe(false)
  })

  test('has-samples returns 404 for non-existent study', async ({ request }) => {
    const resp = await request.get('/api/studies/non-existent-id/has-samples')
    expect(resp.status()).toBe(404)
  })

  test('updating a study does not include version in response', async ({ request }) => {
    const studyName = `Update No Version ${Date.now()}`
    const payload = makeStudyPayload(studyName)
    const createResp = await request.post('/api/studies', { data: payload })
    expect(createResp.status()).toBe(201)
    const created = await createResp.json()

    const updatePayload = { ...payload, id: created.id, steps: [20, 40] }
    const updateResp = await request.put(`/api/studies/${created.id}`, { data: updatePayload })
    expect(updateResp.status()).toBe(200)
    const updated = await updateResp.json()
    expect(updated).not.toHaveProperty('version')
    expect(updated.steps).toEqual([20, 40])
  })
})
