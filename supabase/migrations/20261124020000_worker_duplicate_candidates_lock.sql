-- Decision 0018: two uploads of the same file whose lookups overlap must still see each other.
-- A transaction-scoped advisory lock on the hash serialises lookups of equal hashes, so the
-- second waits for the first to commit its recorded SHA-256 and then finds it.
create or replace function public.worker_duplicate_candidates(
  p_job_id uuid, p_attempt int, p_file_id uuid, p_sha256 text,
  p_min_duration_ms int, p_max_duration_ms int)
returns table (match text, item_id uuid, owner_id uuid, duration_ms int, chromaprint int[])
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare v_job public.processing_jobs;
begin
  v_job := public.worker_run(p_job_id, p_attempt);
  if p_sha256 !~ '^[0-9a-f]{64}$' then perform public.fail('invalid', 'Not a SHA-256.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('stash.sha256:' || p_sha256, 0));
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
