# Request 112 Give the worker container CAP_SYS_ADMIN so job children have no network
From lane: pipeline
For: lead (docker-compose.yml)
Blocking ticket: 112 (PR #8 security advisory A1). The compose worker will not start without it.

## What I need changed
In `docker-compose.yml`, service `worker`, add `SYS_ADMIN` to `cap_add`:
```yaml
cap_add: [SETUID, SETGID, CHOWN, FOWNER, DAC_OVERRIDE, KILL, SYS_ADMIN]
```

## Why
Each job's child now gets its own network namespace with no interfaces (only `lo`, down), so a hostile
file that takes over ffmpeg cannot reach anything over the network:
- SeaweedFS's master, filer and volume ports, which have no auth in compose.
- Postgres.
- A cloud metadata endpoint in production.

The parent creates the namespace with `unshare(CLONE_NEWNET)` in the forked child, while it is still
root and before it switches to `stash-job` (`sandbox._child_setup`). Creating a network namespace
needs CAP_SYS_ADMIN. Docker's default seccomp profile also allows `unshare` only with that capability.

- The capability stays with the root parent and is never handed to a job. The child drops to an
  unprivileged uid with no capabilities before exec, and `no-new-privileges` stays on.
- **Fail-closed:** a worker with a job user refuses to start when it cannot create the namespace. It
  names this request and `STASH_CHILD_NETWORK=shared`, the explicit opt-out (logged as a warning).
- **Tests** (as root, in CI's isolation step):
  - `test_the_child_has_no_network`: a connect to a listener on the parent's 127.0.0.1 fails, and the
    only interface is `lo`.
  - `test_the_network_probe_connects_when_isolation_is_off`: the same probe connects with isolation
    off.

Alternatives I considered:
- An unprivileged user namespace (`CLONE_NEWUSER | CLONE_NEWNET`, no new capability). Docker's
  seccomp blocks it, Ubuntu 24.04's AppArmor restricts it, and it hands the job a full capability set
  inside its namespace.
- An iptables owner rule for the `stash-job` uid. It needs NET_ADMIN and an entrypoint script, and
  it blocks only what the rules list.

## Workaround in the meantime
Set `STASH_CHILD_NETWORK: shared` on the compose worker until the capability is added. `pnpm dev`
runs the worker as the developer's uid (`STASH_WORKER_ALLOW_SAME_UID=1`) and is not affected.
