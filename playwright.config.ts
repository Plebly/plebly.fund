import { defineConfig, devices } from "@playwright/test";

/**
 * Donate / claim-chrome smoke against a live or preview deployment.
 * Base URL: PLEBLY_BASE_URL (default https://signet.plebly.fund).
 */
const baseURL = process.env.PLEBLY_BASE_URL || "https://signet.plebly.fund";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
