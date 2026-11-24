# 0003 Limits are enforced in the database from limits.json
- Context: Every limit is checked twice, in the browser and on the server. Upload slots are created by a database function a signed-in user can call directly, so taking limits as arguments would let a caller pass their own.
- Options: Pass limits from the server and run the function as the service role only; keep a copy of the limits in the database.
- Choice: `public.app_limits()` returns limits.json as jsonb. `scripts/sync-limits.mjs` writes it into a migration; `node scripts/sync-limits.mjs --check` runs in CI and a policy test compares it with limits.json.
- Reason: One source of numbers, enforced where it cannot be bypassed.
- Consequence: Changing a limit is a limits.json edit plus a generated migration, both by the lead.
