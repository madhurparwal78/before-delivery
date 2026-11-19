import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'public/spec',
  testMatch: /.*\.spec\.ts$/,
  outputDir: '.playwright/results',
  timeout: 30000,
  retries: 0,
  workers: 1,
  globalSetup: './public/spec/global-setup.ts',
  use: {
    baseURL: process.env.HIGHWATER_BASE_URL ?? 'http://127.0.0.1:4173',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  reporter: [['list']],
});
