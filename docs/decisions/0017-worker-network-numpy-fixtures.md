# 0017 Worker child network, numpy analysis, preview cap, fixture chords
Date: 2026-11-24. Decided by: lead. Source: pipeline requests 112-child-network,
112-preview-max-bytes and 113-librosa-licence; PR #8 review.

## Each job child gets an empty network namespace (112-child-network)
The compose worker gains `SYS_ADMIN` so the root parent can unshare a network namespace for each
child. Only the parent holds it; the child runs as `stash-job` with no capabilities and only `lo`.
`no-new-privileges`, `read_only`, the pids and memory limits stay. `STASH_CHILD_NETWORK=shared` is a
development escape hatch that logs a warning; it is never set in compose or CI. Production should
still move to a container per job (decision 0014), which makes this capability unnecessary.

## numpy, not librosa (113-librosa-licence)
librosa is ISC but imports soxr (LGPL-2.1+) and soundfile (bundles LGPL libsndfile) at startup,
and pulls certifi (MPL). Rather than grant three exceptions to the licenses gate, the worker
computes the onset envelope and chroma on numpy (BSD-3-Clause). The spec now says so.
The child sets `OPENBLAS_NUM_THREADS=1` so numpy stays inside the per-job process cap.

## Loop preview byte cap (112-preview-max-bytes)
`limits.preview.loopMaxBytes` = 1,024,384: 60 s at 128 kbps plus 5% and 16 KiB for frame padding
and headers, the larger of the two preview regimes. The worker refuses to publish a bigger
preview. Migration 20261124000039_limits.sql.

## Fixture chords are diatonic
`chord_loop` gave every major-key chord a major third, so the E♭ major loop played C major (E
natural) on its vi chord, and minor keys played a minor VI. Major keys now use a minor vi and
minor keys a major VI. Zip entries now carry a fixed date, so regenerating fixtures is
byte-identical. All chord loops and their duplicates were regenerated.

## The child installs its own seccomp filter (PR #8 second re-review, N1)
Docker derives its default seccomp profile from the container's capabilities, so adding SYS_ADMIN
also lets the unprivileged child call unshare, setns, mount, bpf and similar, which opens the
user-namespace route to kernel exploits. Rather than maintain a forked Docker profile, the worker
child, after dropping to the job uid, sets `PR_SET_NO_NEW_PRIVS` and installs a seccomp filter
built in-process (classic BPF through prctl, no new dependency; libseccomp is LGPL). The filter:
- returns EPERM for unshare, setns, mount, umount2, pivot_root, bpf, perf_event_open, keyctl,
  add_key, request_key, fanotify_init, open_by_handle_at, name_to_handle_at, ptrace,
  process_vm_readv/writev and userfaultfd;
- returns EPERM for clone with any CLONE_NEW* flag and ENOSYS for clone3 (so libc falls back to
  clone);
- kills the process on a foreign architecture (x86_64 and aarch64 are supported; others refuse to
  start when a job user is set).
The worker refuses to start with a job user when the filter cannot be installed. The isolation
tests prove `unshare(CLONE_NEWUSER)` fails in the child. no_new_privs no longer depends on compose.
