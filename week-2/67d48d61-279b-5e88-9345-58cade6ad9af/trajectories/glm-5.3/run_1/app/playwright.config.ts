import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  globalSetup: "./tests/global-setup.ts",
  workers: 1,
});
