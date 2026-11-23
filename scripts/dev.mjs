#!/usr/bin/env node
/**
 * pnpm dev: the whole local stack with one command (ticket 007).
 *   1. Supabase (Postgres, auth, realtime, local inbox) via the Supabase CLI; migrations and seed apply on first start
 *   2. MinIO with the originals and previews buckets via docker compose
 *   3. .env.local written from `supabase status`
 *   4. the worker (uv) and the web app (next dev), with prefixed logs; Ctrl+C stops both
 * Needs Docker, Node 22, pnpm and uv. `pnpm dev -- --no-infra` skips steps 1 and 2.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const noInfra = process.argv.includes("--no-infra");

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
  console.log("• Storage (MinIO)");
  run("docker", ["compose", "up", "-d", "--wait", "minio"]);
  run("docker", ["compose", "run", "--rm", "minio-init"]);

  const status = run("npx", ["supabase", "status", "-o", "env"], { capture: true });
  const env = Object.fromEntries(
    status.split("\n").map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]),
  );
  const example = readFileSync(join(root, ".env.example"), "utf8");
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: env.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
    DATABASE_URL: env.DB_URL,
  };
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

console.log("\n  web       http://localhost:3000\n  gallery   http://localhost:3000/dev/gallery\n  studio    http://127.0.0.1:54323\n  inbox     http://127.0.0.1:54324\n  storage   http://127.0.0.1:9001\n");
const stop = () => {
  for (const p of procs) p.kill("SIGINT");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
