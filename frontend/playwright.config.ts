import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Increased from 30s to 60s: tests may exceed 30s under parallel shard load
  // due to CPU contention. Serial runs pass at 30s, but 4-shard parallel runs
  // hit the limit for FSState scanning, grid rendering, and dialog data loading.
  timeout: 60000,
  // Increase expect timeout from the 5s default to 15s to accommodate slower
  // element appearance under parallel shard resource contention.
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            // Chromium in Docker defaults to a 64 MB /dev/shm.  After ~100
            // tests the shared-memory region fills up, making the browser
            // sluggish and causing late-running tests to hit the 15 s timeout.
            // This flag moves shared memory to /tmp which has no fixed cap.
            '--disable-dev-shm-usage',
            // No GPU compositing is needed in headless Docker — disabling it
            // avoids GPU-process memory growth over long test runs.
            '--disable-gpu',
          ],
          chromiumSandbox: false,
        },
      },
    },
  ],
})
