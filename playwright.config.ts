import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Rule 4 of e2e/verdict-audit.ts: the helpers write down the assertions they execute and
  // the teardown requires every recorded mutation's assertion to be among them. Setup
  // empties that sink and stamps the run; teardown throws, which fails the run.
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4686/crypto-lab-proof-tally/',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4686 --strictPort',
    url: 'http://localhost:4686/crypto-lab-proof-tally/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})