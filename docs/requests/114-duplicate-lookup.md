# Request 114 A worker function to look up duplicates, and a decision for the fingerprint threshold
From lane: pipeline
For: lead (supabase/migrations, docs/decisions)
Blocking ticket: 114 merges with a test-only stand-in; production needs the migration
Status: answered in decision 0018 and migration 20261124010000 (the function as proposed, with execute also revoked from anon and authenticated; threshold 0.90; flag.detail deferred to the admin queue ticket). The test-only stand-in is deleted.

## What I need changed
1. **A new service-role function** (migration). The worker reads nothing but the worker functions
   (db.py, decision 0012), so it cannot query `item_files` or `fingerprints` itself.
```sql
create function public.worker_duplicate_candidates(
  p_job_id uuid, p_attempt int, p_file_id uuid, p_sha256 text,
  p_min_duration_ms int, p_max_duration_ms int)
returns table (match text, item_id uuid, owner_id uuid, duration_ms int, chromaprint int[])
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare v_job public.processing_jobs;
begin
  v_job := public.worker_run(p_job_id, p_attempt);
  if p_sha256 !~ '^[0-9a-f]{64}$' then perform public.fail('invalid', 'Not a SHA-256.'); end if;
  update public.item_files f set sha256 = p_sha256
   where f.id = p_file_id and f.item_id = v_job.item_id and f.role = 'original';
  if not found then perform public.fail('invalid', 'Not this job''s original.'); end if;
  return query
    select 'exact', i.id, i.owner_id, null::int, null::int[]
      from public.item_files f join public.items i on i.id = f.item_id
     where f.role = 'original' and f.sha256 = p_sha256 and f.item_id <> v_job.item_id
       and i.status <> 'draft'
    union all
    select 'fingerprint', i.id, i.owner_id, fp.duration_ms, fp.chromaprint
      from public.fingerprints fp join public.items i on i.id = fp.item_id
     where p_min_duration_ms is not null
       and fp.duration_ms between p_min_duration_ms and p_max_duration_ms
       and fp.item_id <> v_job.item_id and i.status <> 'draft';
end $$;
revoke all on function public.worker_duplicate_candidates(uuid, int, uuid, text, int, int) from public;
grant execute on function public.worker_duplicate_candidates(uuid, int, uuid, text, int, int) to service_role;
```
   - **The SHA-256 is recorded at lookup time.** `worker_complete` cannot record it: its upsert sets
     `meta = excluded.meta` and would wipe the original's `fileName` and `copiedAt` (decision 0016).
     Recording it here also means two uploads of the same file processed at once see each other.
   - **Drafts are left out.** They never produced a result, or failed. Processing, ready, published,
     flagged and removed items count. A re-upload of a removed item is caught.
   - **No cap.** The window is `[0.75 d, d / 0.75]`. At catalog scale this needs a cap or a coarse
     index, ordered by duration distance. That can come later. It is not needed for phase 1.

   The exact text the worker's tests install meanwhile is
   `apps/worker/tests/sql/worker_duplicate_candidates.sql`. It is applied only when the function is
   missing, so the migration replaces it with no change to the worker.

2. **A decision record for the threshold.** Ticket 114 asks for the tuned threshold to be recorded in a
   decision file, and docs/decisions is the lead's. Proposed: keep `limits.worker.fingerprintThreshold`
   at 0.90. Handoff 114 has the measurements. The three duplicate fixtures score 0.995 to 1.000. The
   copies the tests make (64 kbps MP3, -6 dB, trimmed at either end) score 0.992 to 1.000. The closest
   two different loops score 0.781, and the closest pair inside the duration window scores 0.749. Copies
   pitched up a semitone (0.635) or sped up 5% (0.878) are not caught. The overview expects Chromaprint
   to be weak there.

3. **Optional: keep `flag.detail`.** `worker_complete` drops `flag.detail`, so an admin cannot see what
   an item matched, and the uploader cannot see that it matched their own upload. If you want that, a
   `flagged_detail` column, or a key in `details`, would hold it. Not needed for 114: the reason texts
   already invite review.

## Why
Ticket 114 criteria 1 to 3. The spec says "the SHA-256 against existing originals" and "compare against
stored fingerprints of similar duration". Both read other items' rows, which only a worker function may
do.

## Workaround in the meantime
`apps/worker/tests/conftest.py` installs the function above from `tests/sql/` after the migrations, and
only if `to_regprocedure` does not find it. Delete that file and the lines that apply it once the
migration merges. In production, before the migration, the lookup fails with an undefined function
error. The job is then retried as `internal` and finally fails. No upload goes unscreened to `ready`.
