import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
  },
});
