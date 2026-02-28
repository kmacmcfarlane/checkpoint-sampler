import { test, expect } from '@playwright/test'
import { resetDatabase } from './helpers'

// AC: Each E2E test is independent -- reset database before each test
test.beforeEach(async ({ request }) => {
  await resetDatabase(request)
})

test('app loads and displays the title', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Checkpoint Sampler/)
})

test('health endpoint returns 200 through frontend proxy', async ({ request }) => {
  const response = await request.get('/health')
  expect(response.status()).toBe(200)
})
