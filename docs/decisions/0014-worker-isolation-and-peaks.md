# 0014 Requests from ticket 112: isolation in CI, worker capabilities, peaks meta
Date: 2026-11-23. Decided by: lead.

## Isolation tests in CI
Accepted. The Worker job runs the suite a second time as root with `STASH_REQUIRE_ISOLATION=1`, so
the test that the job child cannot read a worker-only file fails CI instead of skipping. The
local-stack job also builds the production worker image (`docker compose --profile worker build`),
which could not be built here because Docker Hub rate-limits this environment.

## Worker container capabilities
Accepted as proposed: `cap_drop: [ALL]`, then only SETUID, SETGID, CHOWN, FOWNER, DAC_OVERRIDE and
KILL, with `no-new-privileges`. The parent is root only to start each job as `stash-job`.

## Peaks on the worker result
Accepted. `workerFileSchema` is a union: a `peaks` file must carry
`meta: { points: limits.waveform.peakPoints, peaks: <base64> }` (`peaksFileMetaSchema`); other
roles keep free-form meta. `item.peaks` is read from the peaks row's meta.

## Still open
A job child that calls `setsid()` leaves the process group the timeout kill reaches. A cgroup or a
container per job closes it; scheduled with the Vital renderer (ticket 215).
