# Handoff 102 createUploadSlot and completeUpload: presigned URLs, multipart, quota, job enqueue

## Plan
Branch `lane/platform-102` from `origin/lane/platform-101`, with `origin/phase-0/foundations` merged in.

Files (apps/web/src/server/ unless noted):
- `storage/env.ts`: Zod schema for `STASH_S3_*` and `STASH_BUCKET_ORIGINALS` (server only, already in .env.example).
- `storage/originals.ts`: an `OriginalsStorage` built on `@aws-sdk/client-s3`. It presigns one PUT for
  one key with `Content-Length` signed, so the URL accepts only that object at the declared size,
  for `limits.urls.uploadTtlSeconds`. For multipart it creates the upload, presigns one URL per part
  with that part's exact length, then completes or aborts the upload. It can also HEAD and delete an
  object. The client uses `requestChecksumCalculation: "WHEN_REQUIRED"`. The SDK's default adds a
  CRC32 of an empty body to presigned PUTs, which breaks browser uploads (checked against the
  installed 3.1165.0).
- `supabase/service.ts`: service-role client from `SUPABASE_SERVICE_ROLE_KEY`, server only. It is
  used only for `enqueue_processing` and for storing the multipart upload id in `item_files.meta`.
- `uploads/create-upload-slot.ts`, `uploads/complete-upload.ts`: the actions (auth `member`).
  - createUploadSlot takes the extension and title from `fileName` and ignores the client's `mime`.
    For `original` it calls `create_upload_draft`; for `demo` it needs `itemId` and type `preset`
    and calls `add_demo_file`. Both run as the user, so the database checks quota, verified email
    and suspension. Above `limits.multipart.thresholdBytes` it returns part URLs.
  - completeUpload reads the item and file as the caller (only the owner's rows), completes the
    multipart upload when there is one, HEADs the object, then calls `enqueue_processing` with
    the service role and the measured size. On a size mismatch it deletes the object, so nothing
    is stored that the worker will not process, and returns `invalid`.
- `ActionDeps` gains optional `service` and `storage` factories, so tests inject fakes.
- Tests: action unit tests with fake storage and a fake Supabase client covering single, multipart,
  size mismatch, another user's item, quota exceeded, unverified email, demo slot, the MIME being
  ignored, and the object missing. There are also storage unit tests against an in-process S3 stub
  (presigned URL expiry, key, signed length, part sizes; the create, complete, HEAD and delete wire
  calls), plus a SeaweedFS suite that runs when `STASH_S3_ENDPOINT` answers.
  `supabase/tests/uploads.test.ts` covers the database gaps: add_demo_file rules, demo replacement
  and quota, enqueue for another user's item, a repeat enqueue, and a preset waiting for its demo.

Ticket problems found while planning:
- `completeUploadOutput` requires `status: "processing"` and a `jobId`. `enqueue_processing`
  returns null while a preset still waits for its demo (or the demo for its original). Filed
  docs/requests/102-complete-upload-waiting.md, and widened the output locally from contracts pieces.
- "Tests against local storage": SeaweedFS cannot run here (Docker Hub is rate-limited, and running
  a downloaded binary was refused), so the SeaweedFS suite is written but did not run in this
  environment. CI's unit job has no storage service; filed docs/requests/102-storage-in-ci.md.

## What changed
All under apps/web/src/server/ unless noted.
- `storage/env.ts`: `storageEnv()` validates the `STASH_S3_*` settings and `STASH_BUCKET_ORIGINALS`
  with Zod (all already in .env.example). The error names the bad variables and never prints their
  values.
- `storage/originals.ts`: `OriginalsStorage` and `s3Originals()` / `originalsFromEnv()`, using a
  path-style S3 client that works for SeaweedFS and R2.
  - `presignPut(key, bytes)` signs a PUT for that one key with `Content-Length` in the signed
    headers. It expires after `limits.urls.uploadTtlSeconds` (900 s) and needs no extra headers.
  - `startMultipart(key, bytes)` creates the upload and signs one URL per part, each for that part's
    exact length. Parts are `limits.multipart.partBytes` long, except the last.
  - `completeMultipart` sorts the parts and returns `"gone"` for an unknown upload id (a repeat call).
  - `abortMultipart`, `head` (null when missing) and `remove`.
  - `requestChecksumCalculation: "WHEN_REQUIRED"`: the SDK default puts
    `x-amz-checksum-crc32=AAAAAA==` (the CRC of an empty body) into every presigned PUT, which a
    real upload then fails. I checked this against the installed 3.1165.0.
- `supabase/service.ts`: `serviceSupabase()`, the service-role client from `SUPABASE_SERVICE_ROLE_KEY`.
  It is used only for `enqueue_processing` and for storing a multipart upload id.
- `action.ts`: `ActionDeps` and `ActionContext` gain `service` and `storage` factories. An action
  that has none configured throws.
- `uploads/create-upload-slot.ts` (auth `member`):
  - The title and extension come from the file's base name, and the client's `mime` is ignored.
  - For `role: "original"` it calls `create_upload_draft` as the user; an `itemId` is invalid there.
    For `role: "demo"` it needs `itemId` and type `preset` and calls `add_demo_file` as the user.
    The database checks verified email, suspension, type, size, uploads per day and quota.
  - Up to the threshold it returns one presigned PUT. Above it, it returns the multipart upload and
    stores `uploadId` in `item_files.meta` with the service role; if that write fails, the upload
    is aborted.
- `uploads/complete-upload.ts` (auth `member`):
  - It reads the item filtered to `owner_id = caller` and the file filtered to that item and the
    originals bucket, both with the user's client. Otherwise it returns not_found, before storage
    or the queue is touched.
  - When the row has `meta.uploadId` it needs `parts` and completes the multipart upload.
  - It HEADs the object (missing: not_found, "upload it again"), then calls `enqueue_processing`
    with the service role and the measured size.
  - When the database refuses the size, the object is deleted and `invalid` is returned, so no
    stored file escapes the worker.
  - A null job (a preset still missing a file) returns `{ status: "draft", jobId: null, waitingFor }`.
- `uploads/schemas.ts`: that waiting shape, built from contracts pieces until request 102 lands. (Deleted after the lead's 9885686; see the follow-up section.)
- `uploads/actions.ts` (`"use server"`): `createUploadSlot` and `completeUpload` for ticket 134,
  with the flow described at the top of the file. They are also exported from `@/server`.
- `request-deps.ts` now wires in the service client and the storage.
- Tests:
  - `testing/s3-stub.ts`: an in-process S3 endpoint over real HTTP.
  - `testing/fake-storage.ts`: in-memory storage for the action tests.
  - `storage/originals.test.ts`: 10 tests against the stub.
  - `storage/seaweedfs.test.ts`: 5 tests against real local storage (see Not done).
  - `uploads/uploads.test.ts`: 26 action tests.
  - `supabase/tests/uploads.test.ts`: 13 database tests.

New dependencies (apps/web/package.json):
- `@aws-sdk/client-s3` 3.1165.0, Apache-2.0. The S3 API for R2 and SeaweedFS.
- `@aws-sdk/s3-request-presigner` 3.1165.0, Apache-2.0. Presigned PUT and UploadPart URLs.

Both are pinned to the newest release that is at least 14 days old. `pnpm run licenses` reports
"All dependency licenses are on the allowed list."

## Proof
`pnpm check && pnpm test && pnpm db:test`, exit 0:
```
> stash@ check /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
> pnpm -r --parallel typecheck && tsc -p tsconfig.json && eslint . --max-warnings 0
Scope: 4 of 5 workspace projects
apps/web typecheck$ next typegen && tsc -p tsconfig.json
packages/audio typecheck$ tsc -p tsconfig.json
packages/contracts typecheck$ tsc -p tsconfig.json
packages/ui typecheck$ tsc -p tsconfig.json
apps/web typecheck: Generating route types...
apps/web typecheck: ✓ Types generated successfully
packages/ui typecheck: Done
packages/audio typecheck: Done
packages/contracts typecheck: Done
apps/web typecheck: Done
> stash@ test /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
> vitest run
 Test Files  12 passed | 1 skipped (13)
      Tests  222 passed | 5 skipped (227)
> stash@ db:test /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
> vitest run --config supabase/tests/vitest.config.ts
 Test Files  3 passed (3)
      Tests  104 passed (104)
```
- The web project has 125 tests (120 passed, 5 skipped): action 16, profile actions 22, sign-in 19,
  env 5, errors 6, session 16, storage stub 10, SeaweedFS 5 (skipped), uploads 26.
- `pnpm db:test` has 104 tests: the 91 from before plus 13 in uploads.test.ts.
- `pnpm --filter @stash/web build` compiles.

Acceptance criteria:
- S3 client in server/storage/: `originals.ts`, `env.ts`, with tests in originals.test.ts and seaweedfs.test.ts.
- URLs expire after uploadTtlSeconds and cover one object: originals.test.ts checks the
  `X-Amz-Expires`, the path and the signed headers, that a PUT lands only at that key, and that an
  expired URL is refused. seaweedfs.test.ts checks that another key and another size are refused.
- Multipart past the threshold, completed by completeUpload: uploads.test.ts (threshold boundary,
  part URLs, upload id stored, completion before HEAD) and originals.test.ts (part sizes, completion
  over the wire, out-of-order parts, wrong ETag).
- completeUpload checks ownership, HEADs, and enqueues as the service role; the database refuses a
  size mismatch with invalid: uploads.test.ts. The user client is never used for the RPC.
  supabase/tests covers that enqueue is denied to users and that a mismatch leaves a draft with no job.
- No MIME from the client: uploads.test.ts (the RPC arguments carry only the extension) and the
  existing policies.test.ts test for `mime_for_ext`.
- Preset demo via role 'demo': uploads.test.ts (slot, missing itemId, wrong type, another user's
  item, waiting in both orders) and supabase/tests (add_demo_file rules, replacement and quota,
  demo-first ordering).
- Single, multipart, size mismatch, another user's item, quota exceeded, unverified email: all in
  uploads.test.ts. Single and multipart also run against the stub over HTTP, and against SeaweedFS
  when it is up.

## Not done
- **The SeaweedFS suite did not run here.** Docker Hub is rate-limited, so `pnpm dev`'s storage
  container cannot start, and running a downloaded SeaweedFS binary was refused in this
  environment. The suite skips with a warning when nothing answers at `STASH_S3_ENDPOINT`. With
  `STASH_REQUIRE_STORAGE=1` it fails instead, the same pattern as the worker's `STASH_REQUIRE_DB`.
  CI's `pnpm test` job has no storage yet; see request 102-storage-in-ci. Until that lands, the
  checks the stub cannot make (signatures, signed length, key scope, real 5 MB parts, private
  originals) are unproven. **Please run `pnpm dev` and then `pnpm test` once before merging.**
- No cleanup of abandoned drafts or incomplete multipart uploads. A slot whose upload never
  completes keeps its draft row and counts toward the quota. That needs a scheduled job (a later
  ticket, or the R2 lifecycle rule for incomplete multipart uploads).
- No browser CORS rule for the originals bucket (request 102-storage-cors). Ticket 134 needs it.
- Part URLs expire after the same 900 s as single uploads. A slow connection uploading a 500 MB
  kit could outlive them. A part-URL refresh can come with ticket 134 if it shows up.

## Surprises and decisions
- `completeUploadOutput` cannot express a preset waiting for its other file, which is
  `enqueue_processing`'s normal null. I filed a request and widened the output locally.
- The multipart upload id lives in `item_files.meta.uploadId`, written by the service role (users
  cannot write item_files). The owner can read it, and it is no secret from them. That avoids
  listing multipart uploads on every completion. The worker should ignore the key.
- On a size mismatch the object is deleted, not kept, so storage holds nothing the worker will not
  process. The draft and its file row remain, so the user can request a new slot.
- `completeUpload` reads the item with an explicit `owner_id = caller` filter. Row-level security
  alone would also show another user's published item, and the action must refuse that.
- `add_demo_file` and `enqueue_processing` do not check suspension (request
  102-suspended-upload-completion). The action wrapper's `member` mode refuses suspended accounts
  in the app.

## Requests filed
- docs/requests/102-complete-upload-waiting.md: the preset waiting shape in `completeUploadOutput`.
- docs/requests/102-storage-in-ci.md: SeaweedFS in CI's unit job, with `STASH_REQUIRE_STORAGE=1`.
- docs/requests/102-storage-cors.md: CORS on the originals bucket (PUT, exposing ETag).
- docs/requests/102-suspended-upload-completion.md: suspension checks in `add_demo_file` and `enqueue_processing`.

## Follow-up: requests answered (phase-0/foundations 9885686, decision 0013)
Where this section conflicts with the sections above, this section is current.

- Merged `origin/phase-0/foundations`, with no conflicts and no force-push.
- `completeUploadOutput` in contracts is now the processing/draft union with `waitingFor`.
  `uploads/schemas.ts` is deleted, and `completeUpload` and its server action use the contract.
- `add_demo_file` and `enqueue_processing` now refuse suspended accounts with `forbidden`; the lead
  added the policy test. Action-level tests in uploads.test.ts:
  - createUploadSlot (demo): a `forbidden` from `add_demo_file` maps through, and no URL is signed.
  - completeUpload: a `forbidden` from `enqueue_processing` maps through and nothing is queued.
  - The object is now deleted on `forbidden` as well as on `invalid`. A refused upload will never
    reach the worker, so it must not stay in storage (rule 10).
  - A new test checks that a `conflict` (already processing) keeps the object, because the worker
    is using it.
- CORS for local SeaweedFS (ports 3000 and 3100, all headers exposed including ETag) and
  `docs/deploy/r2-cors.json` for R2 are the lead's. Nothing changed in this lane.
- **CI is the first real run of the SeaweedFS suite.** CI's unit-test job now starts SeaweedFS and
  runs `pnpm test` with `STASH_REQUIRE_STORAGE=1`. That will be the first run of
  `apps/web/src/server/storage/seaweedfs.test.ts` against real storage: signatures, the signed
  Content-Length, key scope, 5 MB multipart parts and private originals. Here it was still skipped
  (no storage), so a failure in CI would be new information, not a regression.

`pnpm check && pnpm test && pnpm db:test`, exit 0:
```
> stash@ check /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
> pnpm -r --parallel typecheck && tsc -p tsconfig.json && eslint . --max-warnings 0
Scope: 4 of 5 workspace projects
packages/audio typecheck$ tsc -p tsconfig.json
apps/web typecheck$ next typegen && tsc -p tsconfig.json
packages/contracts typecheck$ tsc -p tsconfig.json
packages/ui typecheck$ tsc -p tsconfig.json
apps/web typecheck: Generating route types...
apps/web typecheck: ✓ Types generated successfully
packages/ui typecheck: Done
packages/contracts typecheck: Done
packages/audio typecheck: Done
apps/web typecheck: Done
> stash@ test /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
> vitest run
 Test Files  12 passed | 1 skipped (13)
      Tests  226 passed | 5 skipped (231)
> stash@ db:test /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
> vitest run --config supabase/tests/vitest.config.ts
 Test Files  3 passed (3)
      Tests  105 passed (105)
```
- Unit tests: 226 passed and 5 skipped (the SeaweedFS suite). uploads.test.ts now has 29 tests.
- Database tests: 105, one more from the lead's policy test.


## Review round (PR #6)

### What changed

**Merged origin/phase-0/foundations (a1e7e80).**
- add_demo_file now uses one key per item, `<owner>/<item>/demo`.
- completeUploadInput.parts is capped.
- supabase/tests/uploads.test.ts now expects the new demo path.

**B1, blocking: uploads go to a staging key.** A presigned PUT stays valid for 900 s, so after this change it can never name the object the worker checks.
- createUploadSlot signs the single PUT, or the multipart upload, only for `stagingKey(owner, item, file)`, which is `staging/<owner>/<item>/<fileId>` in the originals bucket.
  - The key is built on the server from ids only.
  - It never matches a final path, because final paths start with the owner's uuid.
  - Nothing else reads `staging/`.
- completeUpload, in order:
  1. Refuses an item that is not a draft with `conflict`, before it touches storage.
  2. Completes the multipart upload on the staging key.
  3. Copies the staged object to the row's path with CopyObject, MetadataDirective REPLACE and ContentType set to the row's `mime`. This also fixes security A2: the uploader's Content-Type is never stored.
  4. Deletes the staged object.
  5. HEADs the copy and sends its measured size to enqueue_processing.
  - On `invalid` or `forbidden` it deletes both the copy and the staged object.
  - When there is no staged object but the row's path exists (an earlier call copied the file and stopped before the queue), it uses that object. Only the server ever writes that path.
- Copy limit: S3 CopyObject handles up to 5 GB in a single request. Our largest original is 500 MB (kit.maxBytes 524288000), so no multipart copy is needed.
- Residual race:
  - Two concurrent completeUpload calls for the same draft could interleave like this:
    1. Call A copies and enqueues.
    2. The uploader PUTs new staged bytes.
    3. Call B, which saw the item as a draft before A enqueued, copies after A's enqueue.
  - It needs two requests in flight plus a third PUT, all inside a window of a few milliseconds, and the bytes must be the same length.
  - Closing it fully needs the worker to record the original's sha256 when it downloads the file (it already hashes it, build spec step 2), so a changed object would be detectable. I have noted this for Pipeline (ticket 114).
- Leftover staging objects (an upload never completed, a late PUT): docs/requests/102-staging-expiry.md asks for a lifecycle rule on `staging/`.

**Advisory items.**
- Contract A1 / security A6: storage's InvalidPart, InvalidPartOrder and EntityTooSmall come back from `completeMultipart` as `"invalid_parts"`. completeUpload turns this into `invalid`, "Some parts did not upload. Upload it again.", with a `parts` field, instead of a 500.
- Contract A2: storage failures during refusal cleanup are logged with `console.error` and swallowed, so the database's contract error is what the caller gets.
- Contract A3: the rows from create_upload_draft and add_demo_file are parsed with a small Zod schema (uuid ids, a non-empty path) before anything is signed. A malformed row throws, naming the function.
- Security A5: `import "server-only"` is now at the top of supabase/service.ts, storage/env.ts and storage/originals.ts.
  - Dependency added: `server-only@0.0.1` (MIT). It is the marker package Next aliases for server bundles; apps/web needs it as a direct dependency so the import resolves for tsc and vitest.
  - `pnpm run licenses` passes.
  - Tests that import those modules use `vi.mock("server-only", () => ({}))`: uploads, originals, seaweedfs and sign-in (which goes through the barrel).
- Security A3: the rateLimit hook for createUploadSlot is not filled. Upload limits already apply: create_upload_draft enforces quota.uploadsPerDay, and add_demo_file replaces the single demo row. A per-call slot limit needs a new `rate_limit_user` action and a limit in limits.json, which are lead-owned, so this is left for ticket 203.

**Tests.**
- uploads.test.ts:
  - The staging key is what gets signed, for an original, a multipart upload and a demo.
  - The multipart upload is aborted when the upload id cannot be stored (test A3).
  - A malformed RPC row means nothing is signed.
  - The copy uses the row's type.
  - The staging object is gone after complete.
  - The measured size is read from the copy.
  - A non-draft item is a conflict before storage.
  - On a refusal, both keys are deleted.
  - A cleanup failure does not hide the database's error.
  - Invalid parts give `invalid`.
  - The repeat-after-copy path works.
  - Over real HTTP against the S3 stub: a slot is created, its URL is PUT with `text/html`, completeUpload runs, and a late PUT of different bytes follows. The final object keeps the confirmed bytes and has `audio/wav`.
- originals.test.ts:
  - ttlSeconds 60 signs 60 (test A2).
  - copy sends REPLACE and the new Content-Type.
  - A wrong ETag gives `invalid_parts`.
  - The production client config from `s3ClientFromEnv()`: path-style, request and response checksums WHEN_REQUIRED (test A1).
- seaweedfs.test.ts, which skips without storage:
  - An expired URL is refused, with ttl 1 s and a 2.1 s wait (test A4).
  - Privacy: the PUT returns 200, then an unsigned GET returns 403 (test A5).
  - Another key returns 403, and `head(otherKey)` is null (test A6).
  - Staging, copy and a late PUT keep the final object's bytes and type.

### Proof
`pnpm check && pnpm test && pnpm db:test`, exit 0:
```
apps/web typecheck: Done
 Test Files  12 passed | 1 skipped (13)
      Tests  236 passed | 7 skipped (243)
 Test Files  3 passed (3)
      Tests  106 passed (106)
```
- The 7 skipped tests are the SeaweedFS suite: no storage is reachable here, and running the binary is not permitted in this sandbox. CI (STASH_REQUIRE_STORAGE=1) is still the first real run, now with 3 more tests.
- `pnpm run licenses`: "All dependency licenses are on the allowed list."

### Follow-up (decision 0015)
Request 102-staging-expiry is answered: staging/ expires after a day on R2 (docs/deploy/r2-lifecycle.json), so the request file is removed. The lead added the concurrent-completion race to the board for the pipeline lane (the worker records the SHA-256 it downloaded). Lane check after merging phase-0/foundations bdc2eb9, exit 0: unit tests 238 passed and 7 skipped (SeaweedFS); database tests 108 passed.

## Security re-review (PR #6, decision 0016)

Merged origin/phase-0/foundations at 94849c9: into lane/platform-101 first (95fdaf8), then 101 into 102 (20d5188).

**S1 (blocking): a file is claimed before it is completed.**
- completeUpload calls `claim_file_completion(p_user_id, p_item_id, p_file_id, p_token)` with a fresh `randomUUID()` token, using the service client.
  - The claim happens after the caller-scoped reads of the item and file, and before any storage call.
  - A row whose `uploaded_at` is already set is never claimed or copied. completeUpload returns the item's current state (a preset that is still waiting: `draft`/`waitingFor`).
- **When the claim returns false**, nothing is copied:
  - If the file has been confirmed in the meantime, completeUpload returns the current state.
  - Otherwise another call is completing it right now, and the answer is `conflict` ("This file is already being completed").
- **Release.** Every exit after the claim that does not end in confirmation calls `release_file_completion(p_file_id, p_token)`, from a `finally` block. Those exits are an early return, an error, or a refusal from enqueue_processing. enqueue_processing clears the claim when it confirms the file.
- New tests in uploads.test.ts:
  - A preset's confirmed original is never overwritten by a staged re-PUT. Completing the original again claims and copies nothing; completing the demo copies only the demo.
  - Two concurrent completions of one file: exactly one copies and enqueues, and the other is a conflict.
  - An error after the claim releases it, and a retry then succeeds.
  - A claim refused for a file confirmed in the meantime returns the current state without touching storage.
  - The claim is called before the first storage call.
- New test in supabase/tests/uploads.test.ts: the service-role sequence. A wrong token releases nothing. The `copiedAt` write keeps the claim. enqueue clears the claim and keeps `copiedAt`.

**S3: no cleanup after a conflict.**
- enqueue_processing now checks the status first.
- completeUpload deletes objects only on `invalid` or `forbidden`. Under a held claim, those can only refer to this call's own fresh copy.
- A `conflict` deletes nothing. The existing test checks that the final object stays.

**S4: the fallback needs `meta.copiedAt`.**
- After copying, completeUpload records `meta.copiedAt` on the row with the service role. It reads the current meta first, so the claim and the uploadId are kept.
- With no staged object, the final object is used only when the row has `copiedAt`. Otherwise the answer is `invalid` ("Upload it again"), also when nothing was uploaded at all; this used to be `not_found`.
- Tests: no staged object and no `copiedAt` gives invalid; a repeat after an earlier copy uses that copy.

**S5: duplicate part numbers.**
- Duplicate part numbers are now `invalid` with a `parts` field. The contract refuses them, so the action never claims and never calls storage.

`pnpm check && pnpm test && pnpm db:test`, exit 0:
```
 Test Files  12 passed | 1 skipped (13)
      Tests  244 passed | 7 skipped (251)
 Test Files  3 passed (3)
      Tests  112 passed (112)
```
The 7 skipped tests are the SeaweedFS suite, which needs storage that is not available here.

## Second security re-review (PR #6, fenced claims)

Merged phase-0/foundations 76b8476 (through 101). `enqueue_processing` now takes the claim token as a fifth argument, and `file_claim_held` / `mark_file_copied` are new service-only functions (decision 0016, "Claims are fenced").

- **A1.** completeUpload passes its token to `enqueue_processing`. Just before CopyObject it calls `file_claim_held`; if that is false (the call stalled past the claim's lifetime and another call took over), it copies nothing and returns conflict. A conflict from `enqueue_processing` deletes nothing, because another call or the worker may be using the file. New tests:
  - a stale call whose claim was taken over, with the file confirmed by the second call, neither copies nor deletes, and the second claim stays intact;
  - a takeover between the copy and the confirmation gives conflict, and the copy stays.
  The DB tests now call `enqueue_processing` with five arguments under a real claim. They also check that a wrong token gives conflict and that the token holds nothing once the file is confirmed.
- **A2.** `ctx.storage()` (and the multipart and copy work) now sits inside the `try`, so `finally` always releases the claim. New test: storage setup throws an env error, and the claim is released.
- **A3.** The read-then-write `markCopied` is now the single-statement `mark_file_copied(p_file_id, p_token)` RPC, which writes only under the claim.

### Proof

```
$ pnpm check && pnpm test && pnpm db:test
packages/ui typecheck: Done
packages/contracts typecheck: Done
packages/audio typecheck: Done
apps/web typecheck: Done
 Test Files  12 passed | 1 skipped (13)
      Tests  247 passed | 7 skipped (254)
 Test Files  3 passed (3)
      Tests  114 passed (114)
```
The 7 skipped tests are the SeaweedFS suite, which needs storage that is not available here.
