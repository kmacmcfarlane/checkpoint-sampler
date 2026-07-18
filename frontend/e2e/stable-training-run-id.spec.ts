import { test, expect } from '@playwright/test'

/**
 * E2E tests for S-155: stable training-run identifiers.
 *
 * Training-run ids were previously zero-based positional indices assigned at
 * discovery time, so a rescan that changed discovery order could make a held id
 * resolve to a different run. The id is now a stable, opaque string derived from
 * the run's relative path, so a held id addresses the same run across rescans.
 */

interface TrainingRunListItem {
  id: string
  name: string
  has_samples: boolean
}

test.describe('stable training-run identifiers (S-155)', () => {
  // AC1: training-run ids are opaque strings, not positional indices.
  test('GET /api/v1/training-runs returns opaque string ids', async ({ request }) => {
    const response = await request.get('/api/v1/training-runs')
    expect(response.ok()).toBeTruthy()

    const runs = (await response.json()) as TrainingRunListItem[]
    expect(runs.length).toBeGreaterThan(0)

    for (const run of runs) {
      // The id must be a non-empty string (not a number serialized by Goa).
      expect(typeof run.id).toBe('string')
      expect(run.id.length).toBeGreaterThan(0)
      // URL-safe base64 (RawURLEncoding) never contains '+', '/', or '=' padding.
      expect(run.id).not.toMatch(/[+/=]/)
    }

    // Ids are unique across the discovered set.
    const ids = runs.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // AC1: a held id targets the SAME run across a rescan (refresh) that re-runs
  // discovery. The id is recomputed from the run's stable identity, so even if
  // discovery order changes the held id still resolves to the originally listed run.
  test('held id scans the same run after a refresh re-runs discovery', async ({ request }) => {
    const listResponse = await request.get('/api/v1/training-runs')
    expect(listResponse.ok()).toBeTruthy()
    const runs = (await listResponse.json()) as TrainingRunListItem[]
    expect(runs.length).toBeGreaterThan(0)

    // Hold the id of the first discovered run.
    const held = runs[0]

    // Trigger a refresh (forces a fresh filesystem rescan on the backend).
    const refreshResponse = await request.get('/api/v1/training-runs?refresh=true')
    expect(refreshResponse.ok()).toBeTruthy()
    const refreshedRuns = (await refreshResponse.json()) as TrainingRunListItem[]

    // The held id must still be present and map to the same run name after the rescan.
    const sameRun = refreshedRuns.find((r) => r.id === held.id)
    expect(sameRun).toBeDefined()
    expect(sameRun!.name).toBe(held.name)

    // Scanning by the held id must succeed and address that run (not a 404 or a
    // different run shifted into the old positional slot).
    const scanResponse = await request.get(`/api/v1/training-runs/${encodeURIComponent(held.id)}/scan`)
    expect(scanResponse.status()).toBe(200)
    const scanResult = await scanResponse.json()
    expect(scanResult).toHaveProperty('images')
    expect(scanResult).toHaveProperty('dimensions')
  })

  // AC1: an unknown/stale id resolves to no run (not_found), rather than silently
  // addressing whatever run currently occupies that slot.
  test('an unknown id returns not_found from scan', async ({ request }) => {
    // A syntactically valid but unmatched opaque id.
    const response = await request.get('/api/v1/training-runs/bm9uZXhpc3RlbnQ/scan')
    expect(response.status()).toBe(404)
  })
})
