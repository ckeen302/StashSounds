#!/usr/bin/env node
// pnpm db:reset: drops the local Supabase database and re-applies migrations and seed.
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["supabase", "db", "reset"], { stdio: "inherit" });
process.exit(r.status ?? 1);
