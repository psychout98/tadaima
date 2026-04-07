import { defineConfig, devices } from "@playwright/test";
import os from "os";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // 20 workers overwhelms the dev server — scale to available CPUs
  // but cap at 8 to avoid connection exhaustion on the single-threaded relay
  workers: process.env.CI ? 4 : Math.min(8, os.cpus().length),
  reporter: [
    ["list"],
    ["html"],
    ...(process.env.CI
      ? [["junit", { outputFile: "results.xml" }] as const]
      : []),
  ],
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "setup",
      testMatch: /setup-wizard\.spec\.ts/,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testMatch: /^(?!.*setup-wizard).*\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    // Uncomment to test cross-browser:
    // { name: "firefox", dependencies: ["setup"], use: { ...devices["Desktop Firefox"] } },
    // { name: "mobile", dependencies: ["setup"], use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: "pnpm dev:e2e",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? "test",
      PORT: "3000",
    },
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
});
