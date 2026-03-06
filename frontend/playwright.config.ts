import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 15000,
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
