import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

/**
 * E2E tests for study versioning (S-085).
 *
 * Verifies:
 * - AC1: Studies have a version number field (integer, starting at 1)
 * - AC2: Updating a study's configuration increments the version number
 * - AC7: Migration adds version column (implicit — if studies API works, migration ran)
 *
 * These tests exercise the studies REST API directly since versioning is a
 * backend concern. The version field is returned in the StudyResponse type
 * and is validated here end-to-end.
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

test.describe('study versioning (S-085)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1: Studies have a version number field (integer, starting at 1)
  // AC7: Migration adds version column to studies table (implicit)
  test('newly created study has version 1', async ({ request }) => {
    const payload = makeStudyPayload(`Version Test ${Date.now()}`)
    const createResp = await request.post('/api/studies', { data: payload })
    expect(createResp.status()).toBe(201)

    const study = await createResp.json()
    expect(study.id).toBeTruthy()
    // AC1: version starts at 1
    expect(study.version).toBe(1)
    expect(typeof study.version).toBe('number')
  })

  // AC2: Updating a study's configuration increments the version number
  test('updating a study increments version from 1 to 2', async ({ request }) => {
    const studyName = `Version Update Test ${Date.now()}`
    const payload = makeStudyPayload(studyName)
    const createResp = await request.post('/api/studies', { data: payload })
    expect(createResp.status()).toBe(201)
    const created = await createResp.json()
    expect(created.version).toBe(1)

    // Update the study (change steps to trigger version increment)
    const updatePayload = {
      ...payload,
      id: created.id,
      name: studyName,
      steps: [20, 40],
    }
    const updateResp = await request.put(`/api/studies/${created.id}`, { data: updatePayload })
    expect(updateResp.status()).toBe(200)
    const updated = await updateResp.json()
    // AC2: version incremented
    expect(updated.version).toBe(2)
  })

  // AC2 (continued): Successive updates increment the version each time
  test('successive updates increment version each time', async ({ request }) => {
    const studyName = `Successive Version Test ${Date.now()}`
    const payload = makeStudyPayload(studyName)
    const createResp = await request.post('/api/studies', { data: payload })
    expect(createResp.status()).toBe(201)
    const created = await createResp.json()
    expect(created.version).toBe(1)

    // First update: v1 -> v2
    const update1 = { ...payload, id: created.id, steps: [10] }
    const resp1 = await request.put(`/api/studies/${created.id}`, { data: update1 })
    expect(resp1.status()).toBe(200)
    const v2 = await resp1.json()
    expect(v2.version).toBe(2)

    // Second update: v2 -> v3
    const update2 = { ...payload, id: created.id, steps: [20] }
    const resp2 = await request.put(`/api/studies/${created.id}`, { data: update2 })
    expect(resp2.status()).toBe(200)
    const v3 = await resp2.json()
    expect(v3.version).toBe(3)
  })

  // AC1: version field is present in list response
  test('version field is present in study list response', async ({ request }) => {
    const payload = makeStudyPayload(`List Version Test ${Date.now()}`)
    const createResp = await request.post('/api/studies', { data: payload })
    expect(createResp.status()).toBe(201)
    const created = await createResp.json()

    // Update once to get version 2
    const updatePayload = { ...payload, id: created.id, steps: [5, 10] }
    await request.put(`/api/studies/${created.id}`, { data: updatePayload })

    // List studies and verify version is in the response
    const listResp = await request.get('/api/studies')
    expect(listResp.status()).toBe(200)
    const studies = await listResp.json()
    const found = studies.find((s: { id: string }) => s.id === created.id)
    expect(found).toBeDefined()
    expect(found.version).toBe(2)
  })
})
