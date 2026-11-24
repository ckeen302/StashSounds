import { defineConfig, devices } from "@playwright/test";

/**
 * Three gates share one config:
 *   pnpm e2e     core journeys + accessibility scan      (e2e/journeys)
 *   pnpm visual  screenshots at 1440, 1024 and 380 wide  (e2e/visual)
 *   pnpm perf    performance budgets from limits.json    (e2e/perf)
 * The web app is built and started for the run unless STASH_BASE_URL points at a running one.
 */
/** STASH_E2E_PORT lets parallel worktrees run their own server without clashing on 3100. */
const port = Number(process.env.STASH_E2E_PORT ?? 3100);
const baseURL = process.env.STASH_BASE_URL ?? `http://localhost:${port}`;
// Sign-in links are built from this origin (request 101-site-url-env); the built server inherits it.
process.env.NEXT_PUBLIC_SITE_URL ??= baseURL;
// Public settings the proxy needs on every page (request 135-e2e-supabase-env). CI sets real ones
// from `supabase status`; locally, with no stack on 54321, getUser() fails fast and visitors are
// signed out. Previews point at the host the e2e fixtures route (page.route on media.stash.local).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "e2e-placeholder";
process.env.NEXT_PUBLIC_PREVIEWS_BASE_URL ??= "https://media.stash.local";
const widths = { desktop: 1440, laptop: 1024, tablet: 800, phone: 380 } as const;

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
    { name: "visual", testDir: "e2e/visual", testMatch: /$^/, dependencies: ["visual-desktop", "visual-laptop", "visual-tablet", "visual-phone"] },
    { name: "perf", testDir: "e2e/perf", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.STASH_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @stash/web build && pnpm --filter @stash/web exec next start --port ${port}`,
        url: `${baseURL}/api/health`,
        // Never test against another worktree's server: a busy port fails loudly (use STASH_E2E_PORT).
        reuseExistingServer: false,
        timeout: 240_000,
        // Test-only pages such as /dev/player (request 132-dev-pages-flag); never set in production.
        env: { ...process.env, STASH_DEV_PAGES: "1" } as Record<string, string>,
      },
});
