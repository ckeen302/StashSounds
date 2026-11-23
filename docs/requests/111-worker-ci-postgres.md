# Request 111 Postgres for the worker CI job
From lane: pipeline
For: lead (.github/workflows/ci.yml)
Blocking ticket: none (111 is done; its database tests skip in CI until this lands)

## What I need changed
In the `worker` job of .github/workflows/ci.yml, add a Postgres service and make the database tests
mandatory:

```yaml
  worker:
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: postgres }
        ports: ["5432:5432"]
        options: --health-cmd pg_isready --health-interval 2s --health-retries 30
    env:
      DATABASE_ADMIN_URL: postgres://postgres:postgres@localhost:5432/postgres
      STASH_REQUIRE_DB: "1"
```

## Why
apps/worker/tests/test_runner_db.py and the process test in test_main.py run the runner against the
real claim_job, worker_complete, worker_fail and requeue_stale_jobs in a database built from
supabase/tests/shim.sql plus the migrations. Without a Postgres they skip, so CI would not prove the
ticket's retry, backoff, final-failure, single-claim and stale-requeue criteria. `STASH_REQUIRE_DB=1`
turns that skip into a failure.

## Workaround in the meantime
The tests run wherever a Postgres is reachable (they passed locally on Postgres 16); in CI they skip.
