import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:1420',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run site:dev',
      url: 'http://127.0.0.1:1421',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
