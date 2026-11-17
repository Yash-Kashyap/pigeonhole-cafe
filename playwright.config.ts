import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.checks/playwright',
  reporter: 'line',
  projects: [{ name: 'chromium', use: { channel: 'chrome' } }],
  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'retain-on-failure',
  },
  webServer:
    process.env.PW_MANUAL_SERVER === '1'
      ? undefined
      : {
          command: 'node scripts/astro.mjs dev --host 127.0.0.1',
          url: 'http://127.0.0.1:4321/_kit',
          reuseExistingServer: true,
          timeout: 120000,
        },
});
