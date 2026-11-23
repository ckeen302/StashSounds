import { defineConfig, devices } from "@playwright/test";

/**
 * Three gates share one config:
 *   pnpm e2e     core journeys + accessibility scan      (e2e/journeys)
 *   pnpm visual  screenshots at 1440, 1024 and 380 wide  (e2e/visual)
 *   pnpm perf    performance budgets from limits.json    (e2e/perf)
 * The web app is built and started for the run unless STASH_BASE_URL points at a running one.
 */
const baseURL = process.env.STASH_BASE_URL ?? "http://localhost:3100";
const widths = { desktop: 1440, laptop: 1024, phone: 380 } as const;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "off" },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: "disabled" } },
  snapshotPathTemplate: "e2e/visual/__screenshots__/{arg}-{projectName}{ext}",
  projects: [
    { name: "e2e", testDir: "e2e/journeys", use: { ...devices["Desktop Chrome"] } },
    ...Object.entries(widths).map(([name, width]) => ({
      name: `visual-${name}`,
      testDir: "e2e/visual",
      use: { ...devices["Desktop Chrome"], viewport: { width, height: 900 }, deviceScaleFactor: 1 },
    })),
    { name: "visual", testDir: "e2e/visual", testMatch: /$^/, dependencies: ["visual-desktop", "visual-laptop", "visual-phone"] },
    { name: "perf", testDir: "e2e/perf", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.STASH_BASE_URL
    ? undefined
    : {
        command: "pnpm --filter @stash/web build && pnpm --filter @stash/web exec next start --port 3100",
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
