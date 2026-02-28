import { type APIRequestContext, expect } from '@playwright/test'

/**
 * Resets the backend database to a clean initial state by calling the
 * test-only DELETE /api/test/reset endpoint. This endpoint is only available
 * when the backend is started with ENABLE_TEST_ENDPOINTS=true (set in
 * docker-compose.e2e.yml).
 *
 * Call this in a beforeEach hook to ensure each test starts with a
 * predictable, empty database -- no leftover presets, jobs, or other
 * state from previous tests.
 */
export async function resetDatabase(request: APIRequestContext): Promise<void> {
  const response = await request.delete('/api/test/reset')
  expect(response.status()).toBe(200)
}
