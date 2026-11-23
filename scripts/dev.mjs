#!/usr/bin/env node
/**
 * pnpm dev: the whole local stack with one command (ticket 007).
 *   1. Supabase (Postgres, auth, realtime, local inbox) via the Supabase CLI; migrations and seed apply on first start
 *   2. S3-compatible storage (SeaweedFS) with the originals and previews buckets via docker compose
 *   3. .env.local written from `supabase status`
 *   4. the worker (uv) and the web app (next dev), with prefixed logs; Ctrl+C stops both
 * Needs Docker, Node 22, pnpm and uv. `pnpm dev -- --no-infra` skips steps 1 and 2.
 * `pnpm dev -- --check` starts everything, checks each service answers (CI's local-stack job), and exits.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const noInfra = process.argv.includes("--no-infra");
const checkOnly = process.argv.includes("--check");
let supabaseEnv = {};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8" });
  if (r.status !== 0) {
    if (opts.capture) process.stderr.write(r.stderr ?? "");
    console.error(`\n✗ ${cmd} ${args.join(" ")} failed.${opts.hint ? ` ${opts.hint}` : ""}`);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

if (!noInfra) {
  run("docker", ["info"], { capture: true, hint: "Start Docker and try again." });
  console.log("• Supabase");
  run("npx", ["supabase", "start"]);
  console.log("• Storage (SeaweedFS, S3 API on :9000)");
  run("docker", ["compose", "up", "-d", "--wait", "storage"]);
  run("docker", ["compose", "run", "--rm", "storage-init"]);

  const status = run("npx", ["supabase", "status", "-o", "env"], { capture: true });
  const env = Object.fromEntries(
    status.split("\n").map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]),
  );
  const example = readFileSync(join(root, ".env.example"), "utf8");
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: env.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY ?? env.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY ?? env.SECRET_KEY,
    DATABASE_URL: env.DB_URL,
  };
  supabaseEnv = env;
  const local = example.replace(/^([A-Z_]+)=(.*)$/gm, (line, k) => (values[k] ? `${k}=${values[k]}` : line));
  writeFileSync(join(root, ".env.local"), local);
  if (!existsSync(join(root, "apps/web/.env.local"))) writeFileSync(join(root, "apps/web/.env.local"), local);
  console.log("• wrote .env.local");
}

const procs = [
  ["worker", "uv", ["run", "python", "-m", "stash_worker"], join(root, "apps/worker")],
  ["web", "pnpm", ["--filter", "@stash/web", "dev"], root],
].map(([name, cmd, args, cwd]) => {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `[${name}]`.padEnd(9);
  for (const s of [p.stdout, p.stderr]) s.on("data", (d) => process.stdout.write(d.toString().replace(/^(?=.)/gm, tag)));
  p.on("exit", (code) => console.log(`${tag}exited with ${code}`));
  return p;
});

if (checkOnly) {
  const until = Date.now() + 180_000;
  const probe = async (name, url, init, ok) => {
    for (;;) {
      try {
        const r = await fetch(url, init);
        if (await ok(r)) return console.log(`✓ ${name}`);
      } catch {}
      if (Date.now() > until) {
        console.error(`✗ ${name} did not answer at ${url}`);
        for (const p of procs) p.kill("SIGINT");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  await probe("web", "http://localhost:3000/api/health", {}, (r) => r.ok);
  await probe("storage", "http://127.0.0.1:9000/healthz", {}, (r) => r.ok);
  // A missing key in a public bucket is 404; a private or missing bucket answers 403 or NoSuchBucket.
  await probe("previews bucket is publicly readable", "http://127.0.0.1:9000/previews/probe-missing-object", {}, async (r) =>
    r.status === 404 && !(await r.text()).includes("NoSuchBucket"),
  );
  if (!noInfra) {
    const key = supabaseEnv.ANON_KEY ?? supabaseEnv.PUBLISHABLE_KEY;
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    await probe("database seed is readable through the API", `${supabaseEnv.API_URL}/rest/v1/items?select=public_id&status=eq.published`, { headers }, async (r) =>
      r.ok && (await r.json()).length === 4,
    );
  }
  for (const p of procs) p.kill("SIGINT");
  process.exit(0);
}

console.log("\n  web       http://localhost:3000\n  gallery   http://localhost:3000/dev/gallery\n  studio    http://127.0.0.1:54323\n  inbox     http://127.0.0.1:54324\n  storage   http://127.0.0.1:9000 (S3)\n");
const stop = () => {
  for (const p of procs) p.kill("SIGINT");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
