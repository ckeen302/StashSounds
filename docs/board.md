# Board

One line per ticket: number, lane, status, blocker. The lead keeps this current.
Statuses: todo, planning, building, review, merged.

## Phase 0: foundations (lead)
| # | Ticket | Status | Blocker |
|---|---|---|---|
| 001 | Scaffold monorepo and commands | review | |
| 002 | CLAUDE.md, docs/spec, reviewers, templates | review | |
| 003 | Contracts and limits | review | Owner reads and agrees with every contract |
| 004 | Migration, policies, functions, seed, policy tests | review | |
| 005 | Tokens, lint rule, gallery route | review | |
| 006 | Fixtures | review | Owner's own files in fixtures/own/ |
| 007 | One-command local stack | review | |
| 008 | CI for every gate | review | |

## Phase 1: loops end to end
| # | Lane | Ticket | Status | Blocker |
|---|---|---|---|---|
| 101 | platform | Sign-in, profile and account rows, handle claim | review: PR #4 | Phase 0 merge |
| 102 | platform | createUploadSlot, completeUpload | review: PR #6 | 101 |
| 103 | platform | Item reads and lifecycle actions | review: PR #9 | 102 |
| 104 | platform | requestDownload | review: PR #11 | 103 |
| 111 | pipeline | Job runner | review: PR #3 | Phase 0 merge |
| 112 | pipeline | Decode, preview, peaks, loop length | review: PR #8 | 111 |
| 113 | pipeline | BPM and key | todo | 112 |
| 114 | pipeline | Duplicate check | todo | 112 |
| 121 | audio | Engine core | review: PR #2 | Phase 0 merge |
| 122 | audio | Loop player with stretch | review: PR #7 | 121 |
| 123 | audio | Preload, queue, first-sound test | review: PR #10 | 122 |
| 131 | interface | Core components in the gallery | review: PR #5 | Design refs (decision 0006) |
| 132 | interface | App shell and player bar | review: PR #12 | 131, 121 |
| 133 | interface | Sign-in screens | building | 131, 101 |
| 134 | interface | Upload flow for one loop | todo | 132, 102 |
| 135 | interface | Loop item page | todo | 132, 103, 122 |
| 136 | interface | Polish pass 1 | todo | 135 |
| 137 | interface | Browser-only demo build | todo | 132, 135 |
| 190 | lead | Phase 1 gate end-to-end test | todo | all above |

## Follow-ups from reviews (lead to schedule)
- Avatar upload: build `avatarUrl` only from the previews origin and add a CSP `img-src` limited to it (PR #5 security review).
- Run worker handlers under a separate uid or container (now in ticket 112).
- Production database: a dedicated login role granted only `service_role`, not `postgres` (PR #3).
- Rate limits for sign-in, handle claim and profile edits (ticket 203).
- Clean up abandoned drafts and unfinished multipart uploads, which count toward quota; consider longer part-URL lifetime for 500 MB kits (ticket 102).
- A job child can escape the timeout kill with setsid(); use a cgroup or container per job (ticket 215, decision 0014).
- Worker records the SHA-256 of the original it downloaded; publishing compares it, closing the last upload swap race (decision 0015).
- `cleanup_item` job: remove_item queues it; the worker deletes the item's files and releases storage bytes (decision 0015).
