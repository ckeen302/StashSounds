#!/usr/bin/env node
/**
 * pnpm visual: screenshot comparison in the pinned Playwright container, so a laptop and CI render
 * fonts identically (baselines in e2e/visual/__screenshots__ come from this container).
 *
 *   pnpm visual                     compare against the baselines
 *   pnpm visual:update              rewrite the baselines (commit them with the change that moved them)
 *
 * Inside the container (CI runs the browser job in it) this runs Playwright directly. Elsewhere it
 * builds and starts the web app on the host unless STASH_BASE_URL is set, then runs Playwright in
 * the container on the host network. Needs Docker outside the container.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.63.0-noble";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = ["test", "--project=visual", ...process.argv.slice(2)];
const inContainer = process.env.STASH_PLAYWRIGHT_CONTAINER === "1";
const cli = "node_modules/@playwright/test/cli.js";

function waitFor(url, ms) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () =>
      fetch(url)
        .then((r) => (r.ok ? resolve() : retry()))
        .catch(retry);
    const retry = () => (Date.now() > until ? reject(new Error(`${url} did not come up`)) : setTimeout(tick, 1000));
    tick();
  });
}

if (inContainer) {
  const r = spawnSync("node", [cli, ...args], { cwd: root, stdio: "inherit" });
  process.exit(r.status ?? 1);
}

let server;
let baseUrl = process.env.STASH_BASE_URL;
if (!baseUrl) {
  const port = process.env.STASH_E2E_PORT ?? "3100";
  baseUrl = `http://localhost:${port}`;
  if (!existsSync(join(root, "apps/web/.next/BUILD_ID")) || process.env.STASH_REBUILD !== "0") {
    const b = spawnSync("pnpm", ["--filter", "@stash/web", "build"], { cwd: root, stdio: "inherit" });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
  server = spawn("pnpm", ["--filter", "@stash/web", "exec", "next", "start", "--port", port], { cwd: root, stdio: "ignore", detached: true });
  await waitFor(`${baseUrl}/api/health`, 60_000);
}

const docker = spawnSync(
  "docker",
  [
    "run", "--rm", "--network", "host", "--ipc", "host",
    "-v", `${root}:/work`, "-w", "/work",
    "-e", `STASH_BASE_URL=${baseUrl}`, "-e", "STASH_PLAYWRIGHT_CONTAINER=1", "-e", `CI=${process.env.CI ?? ""}`,
    "--user", `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`, "-e", "HOME=/tmp",
    PLAYWRIGHT_IMAGE, "node", cli, ...args,
  ],
  { cwd: root, stdio: "inherit" },
);
if (server) process.kill(-server.pid, "SIGTERM");
process.exit(docker.status ?? 1);
