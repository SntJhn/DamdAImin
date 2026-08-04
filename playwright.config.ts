import { defineConfig, devices } from '@playwright/test';

const playwrightPort = Number(process.env.PLAYWRIGHT_PORT ?? 3_100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${playwrightPort}`,
    permissions: ['microphone'],
    trace: 'on-first-retry',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: `pnpm --filter @damdai/web exec next start --port ${playwrightPort}`,
    url: `http://127.0.0.1:${playwrightPort}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
