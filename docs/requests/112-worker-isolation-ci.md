# Request 112 Run the worker's isolation tests in CI, and drop capabilities in compose
From lane: pipeline
For: lead (.github/, docker-compose.yml)
Blocking ticket: 112 (the isolation criterion is proven locally as root, but CI skips it)

## What I need changed
1. `.github/workflows/ci.yml`, job `worker`: run the tests as root with isolation required, so a
   regression fails CI instead of skipping. The runner has passwordless sudo:
   ```yaml
   - name: pnpm worker:test
     run: pnpm worker:test
   - name: Worker isolation tests (as root, the job user is nobody)
     working-directory: apps/worker
     run: sudo --preserve-env=DATABASE_ADMIN_URL,STASH_REQUIRE_DB env STASH_REQUIRE_ISOLATION=1 .venv/bin/python -m pytest -q -p no:cacheprovider
   ```
   `.venv/bin/python` exists because `uv sync` already ran in the first step. If
   the lead would rather keep one step, running the whole suite under sudo also works. Every test passes
   as root and as uid 65534 (see handoff 112).
2. `docker-compose.yml`, service `worker`: the parent now runs as root inside the image so it can start
   each job as `stash-job`. Keep the root user to what that needs:
   ```yaml
   cap_drop: [ALL]
   cap_add: [SETUID, SETGID, CHOWN, FOWNER, DAC_OVERRIDE, KILL]
   security_opt: ["no-new-privileges:true"]
   ```
   SETUID and SETGID let it start the child as another uid. CHOWN and FOWNER let it hand the job
   folders to that uid. DAC_OVERRIDE lets it read the child's `report/outcome.json` and remove the job
   folder afterwards. KILL lets it kill a timed-out child's process group.

## Why
Ticket 112 says "a test proves the child cannot read a worker-only file". That test needs root, so
today it only runs on a developer's machine. Without step 1 a change could break isolation and CI
would stay green.

## Workaround in the meantime
`tests/test_isolation.py` skips unless the suite runs as root, and fails rather than skipping when
`STASH_REQUIRE_ISOLATION=1`. Run it locally with `sudo` or in the worker image.
