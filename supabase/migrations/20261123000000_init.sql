-- Stash: first migration. Schema, functions, triggers and access policies.
-- Source: docs/spec/build-spec.md (Database schema, Access policies, Triggers and functions).
-- Lead-owned. Builders request changes through docs/requests/.
--
-- Supabase provides the roles anon, authenticated and service_role, the auth schema and
-- auth.uid(). supabase/tests/shim.sql recreates those for plain Postgres in tests.

create extension if not exists pg_trgm;

-- ===========================================================================
-- Types

create type item_type    as enum ('loop','oneshot','kit','midi','preset');
create type item_status  as enum ('draft','processing','ready','published','flagged','removed');
create type license_kind as enum ('royalty_free','credit_required','split_on_placement');
create type key_mode     as enum ('major','minor');
create type job_status   as enum ('queued','running','done','failed');

-- ===========================================================================
-- Helpers

-- Short id for URLs: 10 characters of 0-9a-z.
create function public.gen_public_id() returns text
language sql volatile
set search_path = ''
as $$
  select string_agg(substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + floor(random() * 36)::int, 1), '')
  from generate_series(1, 10);
$$;

-- Mirrors slugify() in packages/contracts/src/paths.ts.
create function public.slugify(title text) returns text
language sql immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from left(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), 60)),
      ''),
    'untitled');
$$;

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- Tables

-- Public identity. Created by claim_handle, because new users choose a handle before anything else.
create table public.profiles (
  id              uuid primary key references auth.users on delete cascade,
  handle          text unique not null check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name    text not null check (char_length(display_name) between 1 and 40),
  bio             text check (char_length(bio) <= 280),
  avatar_path     text,
  links           jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),
  followers_count int not null default 0,
  following_count int not null default 0,
  created_at      timestamptz not null default now()
);

-- Private account state, never exposed to other users.
create table public.accounts (
  id            uuid primary key references public.profiles on delete cascade,
  role          text not null default 'user' check (role in ('user','trusted','admin')),
  storage_bytes bigint not null default 0,
  strikes       int not null default 0,
  suspended_at  timestamptz
);

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  public_id       text unique not null default public.gen_public_id(),
  owner_id        uuid not null references public.profiles on delete cascade,
  type            item_type not null,
  status          item_status not null default 'draft',
  title           text not null check (char_length(title) between 1 and 80),
  slug            text not null,
  description     text check (char_length(description) <= 500),
  license         license_kind not null default 'royalty_free',
  split_percent   smallint check (split_percent between 1 and 50),
  genre           text check (char_length(genre) <= 40),
  bpm             numeric(5,2) check (bpm between 40 and 300),
  key_root        smallint check (key_root between 0 and 11),     -- 0 = C
  key_mode        key_mode,
  duration_ms     int,
  details         jsonb not null default '{}',                    -- per-type shape, validated by contracts
  tag_names       text[] not null default '{}',                   -- kept in sync from item_tags
  search_vector   tsvector,                                       -- kept in sync by trigger
  likes_count     int not null default 0,
  downloads_count int not null default 0,
  flagged_reason  text,
  rights_confirmed_at timestamptz,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((license = 'split_on_placement') = (split_percent is not null)),
  check ((key_root is null) = (key_mode is null))
);
create index items_owner_idx  on public.items (owner_id, published_at desc) where status = 'published';
create index items_browse_idx on public.items (type, published_at desc)     where status = 'published';
create index items_bpm_idx    on public.items (type, bpm)                   where status = 'published';
create index items_key_idx    on public.items (type, key_root, key_mode)    where status = 'published';
create index items_trending_idx on public.items (published_at desc)         where status = 'published';
create index items_owner_all_idx on public.items (owner_id, created_at desc);
create index items_search_idx on public.items using gin (search_vector);
create index items_tags_idx   on public.items using gin (tag_names);
create index items_title_trgm on public.items using gin (title gin_trgm_ops);

create trigger items_updated_at before update on public.items
  for each row execute function public.set_updated_at();

create table public.item_files (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items on delete cascade,
  role       text not null check (role in ('original','preview','peaks','notes','demo','sampled_note','cover')),
  bucket     text not null check (bucket in ('originals','previews')),
  path       text not null,
  bytes      bigint not null check (bytes >= 0),
  mime       text not null,
  sha256     text check (sha256 ~ '^[0-9a-f]{64}$'),
  meta       jsonb not null default '{}',
  uploaded_at timestamptz,          -- set by completeUpload once the object is confirmed in storage
  created_at timestamptz not null default now(),
  unique (bucket, path)
);
create index item_files_item_idx on public.item_files (item_id, role);
create index item_files_sha_idx  on public.item_files (sha256) where role = 'original';

create table public.kit_samples (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.items on delete cascade,
  position      int not null,
  name          text not null,
  category      text not null check (category in
                  ('kick','snare','clap','hat','open_hat','808','perc','tom','cymbal','fx','vocal','other')),
  duration_ms   int not null,
  root_note     smallint check (root_note between 0 and 127),
  original_path text not null,
  preview_path  text not null,
  unique (item_id, position)
);

create table public.tags (
  id          bigint generated always as identity primary key,
  name        text unique not null check (name = lower(name) and char_length(name) between 2 and 40),
  kind        text not null default 'tag' check (kind in ('tag','instrument','mood','reference')),
  items_count int not null default 0
);
create index tags_name_trgm on public.tags using gin (name gin_trgm_ops);

create table public.item_tags (
  item_id uuid   not null references public.items on delete cascade,
  tag_id  bigint not null references public.tags  on delete cascade,
  primary key (item_id, tag_id)
);
create index item_tags_tag_idx on public.item_tags (tag_id);

create table public.fingerprints (
  item_file_id uuid primary key references public.item_files on delete cascade,
  item_id      uuid not null references public.items on delete cascade,
  duration_ms  int not null,
  chromaprint  int[] not null
);
create index fingerprints_duration_idx on public.fingerprints (duration_ms);

create table public.follows (
  follower_id uuid not null references public.profiles on delete cascade,
  followee_id uuid not null references public.profiles on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);

create table public.likes (
  user_id    uuid not null references public.profiles on delete cascade,
  item_id    uuid not null references public.items on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index likes_item_idx on public.likes (item_id, created_at desc);

-- The license record. Survives deletion of the item or the user.
create table public.downloads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles on delete set null,
  item_id         uuid references public.items on delete set null,
  kit_sample_id   uuid references public.kit_samples on delete set null,
  item_title      text not null,
  owner_handle    text not null,
  license         license_kind not null,
  license_version text not null,
  split_percent   smallint,
  created_at      timestamptz not null default now()
);
create index downloads_user_idx on public.downloads (user_id, created_at desc);
create index downloads_item_idx on public.downloads (item_id, created_at desc);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  kind       text not null check (kind in ('follow','like','upload','flag','takedown')),
  actor_id   uuid references public.profiles on delete cascade,
  item_id    uuid references public.items on delete cascade,
  count      int not null default 1,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles on delete set null default auth.uid(),
  item_id     uuid not null references public.items on delete cascade,
  reason      text not null check (reason in ('stolen','copyright','spam','abuse','other')),
  detail      text check (char_length(detail) <= 1000),
  status      text not null default 'open' check (status in ('open','upheld','dismissed')),
  created_at  timestamptz not null default now()
);
create index reports_item_idx on public.reports (item_id) where status = 'open';

create table public.dmca_notices (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid references public.items on delete set null,
  claimant_name    text not null,
  claimant_email   text not null,
  work_description text not null,
  statement        text not null,
  signature        text not null,
  status           text not null default 'received'
                     check (status in ('received','removed','countered','restored','rejected')),
  counter_notice   jsonb,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);

-- Job record and queue in one table.
create table public.processing_jobs (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items on delete cascade,
  kind        text not null check (kind in
                ('process_loop','process_oneshot','process_kit','process_midi','process_preset','render_vital')),
  status      job_status not null default 'queued',
  attempts    int not null default 0,
  run_after   timestamptz not null default now(),
  locked_at   timestamptz,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_claim_idx on public.processing_jobs (run_after) where status = 'queued';
create index jobs_item_idx  on public.processing_jobs (item_id, created_at desc);

-- Additions beyond the build spec's fifteen tables (see docs/decisions/0002-schema-additions.md).

-- Who did what in the admin screen, and why.
create table public.admin_actions (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid references public.profiles on delete set null,
  action     text not null,
  target_id  uuid not null,
  reason     text not null,
  created_at timestamptz not null default now()
);

-- Fixed-window counters for rate limits on every action that writes or sends.
create table public.rate_limit_hits (
  bucket       text not null,          -- e.g. 'like:<user id>' or 'search:<address hash>'
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (bucket, window_start)
);

-- Phase 4 only. Created now so the schema is stable; nothing is exposed (no grants, no policies).
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table public.conversation_participants (
  conversation_id uuid not null references public.conversations on delete cascade,
  user_id         uuid not null references public.profiles on delete cascade,
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations on delete cascade,
  sender_id       uuid references public.profiles on delete set null,
  body            text not null check (char_length(body) between 1 and 2000),
  item_id         uuid references public.items on delete set null,   -- attachments are item links, never raw files
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);

-- ===========================================================================
-- Limits. The real body is generated from packages/contracts/limits.json by scripts/sync-limits.mjs
-- into the next migration, so the database enforces the same numbers as the app.

create function public.app_limits() returns jsonb
language sql immutable
set search_path = ''
as $$ select '{}'::jsonb $$;

-- ===========================================================================
-- Caller helpers (security definer so policies can use them without recursion)

create function public.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.accounts a where a.id = auth.uid() and a.role = 'admin');
$$;

-- Signed in, has a profile, not suspended.
create function public.is_active_user() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.accounts a where a.id = auth.uid() and a.suspended_at is null);
$$;

create function public.can_read_item(p_item_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.items i
    where i.id = p_item_id
      and (i.status = 'published' or i.owner_id = auth.uid() or public.is_admin())
  );
$$;

-- Raises a typed error the server maps to a contracts error code: the SQLSTATE class is P0001 and
-- the message starts with the code, e.g. 'forbidden: not your item'.
create function public.fail(code text, message text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: %', code, message using errcode = 'P0001';
end;
$$;

-- ===========================================================================
-- Rate limits

-- Counts one hit in the current window and fails with rate_limited past the limit.
create function public.hit_rate_limit(p_bucket text, p_limit int, p_window interval) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  v_hits int;
begin
  insert into public.rate_limit_hits as r (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  if v_hits > p_limit then
    perform public.fail('rate_limited', 'Too many requests. Try again shortly.');
  end if;
end;
$$;

-- ===========================================================================
-- Counts, kept current by triggers so feeds never count rows on read

create function public.on_like_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_batch uuid;
begin
  if tg_op = 'INSERT' then
    update public.items set likes_count = likes_count + 1 where id = new.item_id returning owner_id into v_owner;
    if v_owner is not null and v_owner <> new.user_id then
      -- Batch: repeated likes on one item within an hour raise the count of one unread notification.
      select id into v_batch from public.notifications
       where user_id = v_owner and kind = 'like' and item_id = new.item_id
         and read_at is null and created_at > now() - interval '1 hour'
       order by created_at desc limit 1;
      if v_batch is not null then
        update public.notifications set count = count + 1, actor_id = new.user_id where id = v_batch;
      else
        insert into public.notifications (user_id, kind, actor_id, item_id) values (v_owner, 'like', new.user_id, new.item_id);
      end if;
    end if;
    return new;
  else
    update public.items set likes_count = greatest(likes_count - 1, 0) where id = old.item_id;
    return old;
  end if;
end;
$$;
create trigger likes_count after insert or delete on public.likes
  for each row execute function public.on_like_change();

create function public.on_follow_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set followers_count = followers_count + 1 where id = new.followee_id;
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    insert into public.notifications (user_id, kind, actor_id) values (new.followee_id, 'follow', new.follower_id);
    return new;
  else
    update public.profiles set followers_count = greatest(followers_count - 1, 0) where id = old.followee_id;
    update public.profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    return old;
  end if;
end;
$$;
create trigger follows_count after insert or delete on public.follows
  for each row execute function public.on_follow_change();

create function public.on_download_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.items set downloads_count = downloads_count + 1 where id = new.item_id;
  return new;
end;
$$;
create trigger downloads_count after insert on public.downloads
  for each row execute function public.on_download_insert();

-- Per-user storage counts the uploader's own files (originals and demos), not derived previews.
create function public.on_item_file_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.item_files;
  v_delta bigint;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if v_row.bucket <> 'originals' then
    return v_row;
  end if;
  v_delta := case when tg_op = 'DELETE' then -old.bytes
                  when tg_op = 'INSERT' then new.bytes
                  else new.bytes - old.bytes end;
  update public.accounts a set storage_bytes = greatest(a.storage_bytes + v_delta, 0)
    from public.items i where i.id = v_row.item_id and a.id = i.owner_id;
  return v_row;
end;
$$;
create trigger item_files_storage after insert or update of bytes or delete on public.item_files
  for each row execute function public.on_item_file_change();

-- ===========================================================================
-- Tags and search

create function public.refresh_item_tags(p_item_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.items i
     set tag_names = coalesce((select array_agg(t.name order by t.name)
                                 from public.item_tags it join public.tags t on t.id = it.tag_id
                                where it.item_id = i.id), '{}')
   where i.id = p_item_id;
$$;

create function public.on_item_tag_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.tags set items_count = items_count + 1 where id = new.tag_id;
    perform public.refresh_item_tags(new.item_id);
    return new;
  else
    update public.tags set items_count = greatest(items_count - 1, 0) where id = old.tag_id;
    perform public.refresh_item_tags(old.item_id);
    return old;
  end if;
end;
$$;
create trigger item_tags_sync after insert or delete on public.item_tags
  for each row execute function public.on_item_tag_change();

-- search_vector from title (A), tags (B), genre (C) and the owner's handle (D).
create function public.items_search_vector() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_handle text;
begin
  select handle into v_handle from public.profiles where id = new.owner_id;
  new.search_vector :=
       setweight(to_tsvector('simple', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple', array_to_string(new.tag_names, ' ')), 'B')
    || setweight(to_tsvector('simple', coalesce(new.genre, '')), 'C')
    || setweight(to_tsvector('simple', coalesce(v_handle, '')), 'D');
  return new;
end;
$$;
create trigger items_search before insert or update of title, tag_names, genre, owner_id on public.items
  for each row execute function public.items_search_vector();

create function public.on_handle_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Touch title to re-run the search trigger for every item of this owner.
  update public.items set title = title where owner_id = new.id;
  return new;
end;
$$;
create trigger profiles_handle_search after update of handle on public.profiles
  for each row when (old.handle is distinct from new.handle)
  execute function public.on_handle_change();

-- ===========================================================================
-- State changes: the only way to make these changes, each checking the caller

create table public.reserved_handles (handle text primary key);
insert into public.reserved_handles (handle) values
  ('admin'),('administrator'),('api'),('browse'),('search'),('upload'),('library'),('notifications'),
  ('settings'),('login'),('logout'),('signup'),('embed'),('licenses'),('dmca'),('terms'),('privacy'),
  ('dev'),('style'),('tag'),('stash'),('support'),('help'),('about'),('root'),('system'),('moderator'),
  ('staff'),('official'),('u'),('og'),('loop'),('oneshot'),('kit'),('midi'),('preset'),('null'),('undefined');

-- Creates the caller's profile and account on first call; changes the handle afterwards.
create function public.claim_handle(p_handle text, p_display_name text default null)
returns public.profiles
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text := lower(trim(p_handle));
  v_profile public.profiles;
begin
  if v_uid is null then perform public.fail('unauthorized', 'Sign in first.'); end if;
  if v_handle !~ '^[a-z0-9_]{3,24}$' then
    perform public.fail('invalid', 'Handles are 3 to 24 characters: a to z, 0 to 9 and underscore.');
  end if;
  if exists (select 1 from public.reserved_handles where handle = v_handle) then
    perform public.fail('conflict', 'That handle is taken.');
  end if;
  if exists (select 1 from public.profiles where handle = v_handle and id <> v_uid) then
    perform public.fail('conflict', 'That handle is taken.');
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then
    insert into public.profiles (id, handle, display_name)
    values (v_uid, v_handle, coalesce(nullif(trim(p_display_name), ''), v_handle))
    returning * into v_profile;
    insert into public.accounts (id) values (v_uid);
  else
    if exists (select 1 from public.accounts where id = v_uid and suspended_at is not null) then
      perform public.fail('forbidden', 'This account is suspended.');
    end if;
    update public.profiles
       set handle = v_handle,
           display_name = coalesce(nullif(trim(p_display_name), ''), display_name)
     where id = v_uid
    returning * into v_profile;
  end if;
  return v_profile;
end;
$$;

-- createUploadSlot: checks verified email, suspension, type, size, daily uploads and quota, then
-- creates a draft item and its original file row. The server signs the upload URL for the path.
create function public.create_upload_draft(
  p_type public.item_type, p_title text, p_bytes bigint, p_mime text, p_ext text
) returns table (item_id uuid, file_id uuid, path text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_account public.accounts;
  v_quota bigint;
  v_item uuid;
  v_file uuid;
  v_path text;
  v_ext text := lower(regexp_replace(p_ext, '[^A-Za-z0-9]', '', 'g'));
  v_limits jsonb := public.app_limits();
  v_type_limits jsonb := v_limits -> p_type::text;
begin
  if v_uid is null then perform public.fail('unauthorized', 'Sign in first.'); end if;
  select * into v_account from public.accounts where id = v_uid;
  if v_account.id is null then perform public.fail('forbidden', 'Choose a handle first.'); end if;
  if v_account.suspended_at is not null then perform public.fail('forbidden', 'This account is suspended.'); end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    perform public.fail('forbidden', 'Verify your email before uploading.');
  end if;
  if not exists (select 1 from jsonb_array_elements_text(v_type_limits -> 'formats') f where lower(f) = v_ext) then
    perform public.fail('invalid', 'This file type is not supported for this kind of upload.');
  end if;
  if p_bytes <= 0 or p_bytes > (v_type_limits ->> 'maxBytes')::bigint then
    perform public.fail('invalid', 'This file is larger than the limit for its type.');
  end if;
  if (select count(*) from public.items i where i.owner_id = v_uid and i.created_at > now() - interval '1 day')
       >= (v_limits -> 'quota' ->> 'uploadsPerDay')::int then
    perform public.fail('rate_limited', 'You have reached today''s upload limit. Try again tomorrow.');
  end if;
  v_quota := case when v_account.role in ('trusted', 'admin')
                  then (v_limits -> 'quota' ->> 'storageBytesTrusted')::bigint
                  else (v_limits -> 'quota' ->> 'storageBytes')::bigint end;
  if v_account.storage_bytes + p_bytes > v_quota then
    perform public.fail('quota_exceeded', 'This upload would go over your storage quota.');
  end if;

  insert into public.items (owner_id, type, title, slug)
  values (v_uid, p_type, left(coalesce(nullif(trim(p_title), ''), 'Untitled'), 80), public.slugify(coalesce(p_title, '')))
  returning id into v_item;

  v_path := v_uid::text || '/' || v_item::text || '/original.' || v_ext;
  insert into public.item_files (item_id, role, bucket, path, bytes, mime)
  values (v_item, 'original', 'originals', v_path, p_bytes, p_mime)
  returning id into v_file;

  return query select v_item, v_file, v_path;
end;
$$;

-- A preset's demo audio, attached to the caller's own draft.
create function public.add_demo_file(p_item_id uuid, p_bytes bigint, p_mime text, p_ext text)
returns table (file_id uuid, path text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item public.items;
  v_file uuid;
  v_path text;
  v_ext text := lower(regexp_replace(p_ext, '[^A-Za-z0-9]', '', 'g'));
  v_demo jsonb := public.app_limits() -> 'preset' -> 'demo';
begin
  select * into v_item from public.items where id = p_item_id;
  if v_item.id is null or v_item.owner_id is distinct from auth.uid() then perform public.fail('not_found', 'Item not found.'); end if;
  if v_item.type <> 'preset' then perform public.fail('invalid', 'Only presets take a demo.'); end if;
  if v_item.status <> 'draft' then perform public.fail('conflict', 'This item is already processing.'); end if;
  if not exists (select 1 from jsonb_array_elements_text(v_demo -> 'formats') f where lower(f) = v_ext) then
    perform public.fail('invalid', 'Demos are WAV, AIFF, FLAC or MP3.');
  end if;
  if p_bytes <= 0 or p_bytes > (v_demo ->> 'maxBytes')::bigint then perform public.fail('invalid', 'This demo is larger than the limit.'); end if;
  delete from public.item_files f where f.item_id = p_item_id and f.role = 'demo';
  v_path := v_item.owner_id::text || '/' || v_item.id::text || '/demo.' || v_ext;
  insert into public.item_files (item_id, role, bucket, path, bytes, mime)
  values (p_item_id, 'demo', 'originals', v_path, p_bytes, p_mime)
  returning id into v_file;
  return query select v_file, v_path;
end;
$$;

-- completeUpload: called after the server confirmed the object exists with the declared size.
-- Moves draft to processing and queues the job. Presets need their demo too.
create function public.enqueue_processing(p_item_id uuid, p_file_id uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item public.items;
  v_job uuid;
begin
  select * into v_item from public.items where id = p_item_id for update;
  if v_item.id is null or v_item.owner_id is distinct from auth.uid() then perform public.fail('not_found', 'Item not found.'); end if;
  update public.item_files set uploaded_at = now() where id = p_file_id and item_id = p_item_id;
  if not found then perform public.fail('not_found', 'File not found.'); end if;

  if v_item.status <> 'draft' then perform public.fail('conflict', 'This item is already processing.'); end if;
  if exists (select 1 from public.item_files where item_id = p_item_id and bucket = 'originals' and uploaded_at is null) then
    -- Another file (a preset's original or demo) has not finished uploading yet.
    return null;
  end if;
  if v_item.type = 'preset' and not exists (select 1 from public.item_files where item_id = p_item_id and role = 'demo') then
    return null;
  end if;

  update public.items set status = 'processing', flagged_reason = null where id = p_item_id;
  insert into public.processing_jobs (item_id, kind)
  values (p_item_id, 'process_' || v_item.type::text)
  returning id into v_job;
  return v_job;
end;
$$;

-- Owner edits: tags and reference tags replace the item's current set.
create function public.set_item_tags(p_item_id uuid, p_tags text[], p_reference_tags text[] default '{}')
returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text;
  v_tag bigint;
  v_kind text;
  v_all text[];
begin
  if not exists (select 1 from public.items where id = p_item_id and owner_id = auth.uid() and status <> 'removed') then
    perform public.fail('not_found', 'Item not found.');
  end if;
  select coalesce(array_agg(distinct lower(trim(t))), '{}') into v_all
    from unnest(coalesce(p_tags, '{}') || coalesce(p_reference_tags, '{}')) t;
  if cardinality(v_all) > 8 then perform public.fail('invalid', 'Up to 8 tags in total.'); end if;

  delete from public.item_tags where item_id = p_item_id;
  foreach v_name in array v_all loop
    if char_length(v_name) not between 2 and 40 then perform public.fail('invalid', 'Tags are 2 to 40 characters.'); end if;
    v_kind := case when v_name = any (select lower(trim(r)) from unnest(coalesce(p_reference_tags, '{}')) r)
                   then 'reference' else 'tag' end;
    insert into public.tags (name, kind) values (v_name, v_kind)
    on conflict (name) do update set kind = case when excluded.kind = 'reference' then 'reference' else public.tags.kind end
    returning id into v_tag;
    insert into public.item_tags (item_id, tag_id) values (p_item_id, v_tag) on conflict do nothing;
  end loop;
  return (select tag_names from public.items where id = p_item_id);
end;
$$;

create function public.publish_item(p_item_id uuid, p_rights_confirmed boolean) returns public.items
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item public.items;
begin
  if not public.is_active_user() then perform public.fail('forbidden', 'This account cannot publish.'); end if;
  select * into v_item from public.items where id = p_item_id for update;
  if v_item.id is null or v_item.owner_id is distinct from auth.uid() then perform public.fail('not_found', 'Item not found.'); end if;
  if v_item.status <> 'ready' then perform public.fail('conflict', 'Only a processed item can be published.'); end if;
  if p_rights_confirmed is not true then
    perform public.fail('invalid', 'Confirm you made this or hold the rights to it.');
  end if;

  update public.items
     set status = 'published',
         rights_confirmed_at = now(),
         published_at = coalesce(published_at, now())
   where id = p_item_id
  returning * into v_item;

  -- Notify followers only on first publish.
  if v_item.published_at >= now() - interval '1 second' then
    insert into public.notifications (user_id, kind, actor_id, item_id)
    select f.follower_id, 'upload', v_item.owner_id, v_item.id from public.follows f where f.followee_id = v_item.owner_id;
  end if;
  return v_item;
end;
$$;

create function public.unpublish_item(p_item_id uuid) returns public.items
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item public.items;
begin
  update public.items set status = 'ready'
   where id = p_item_id and owner_id = auth.uid() and status = 'published'
  returning * into v_item;
  if v_item.id is null then perform public.fail('not_found', 'No published item to unpublish.'); end if;
  return v_item;
end;
$$;

-- Owner or admin. Marks removed; download records are kept. File cleanup is a worker job.
create function public.remove_item(p_item_id uuid, p_reason text default null) returns public.items
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item public.items;
  v_admin boolean := public.is_admin();
begin
  select * into v_item from public.items where id = p_item_id for update;
  if v_item.id is null or (v_item.owner_id is distinct from auth.uid() and not v_admin) then
    perform public.fail('not_found', 'Item not found.');
  end if;
  update public.items set status = 'removed', flagged_reason = coalesce(p_reason, flagged_reason)
   where id = p_item_id returning * into v_item;
  if v_admin and v_item.owner_id is distinct from auth.uid() then
    insert into public.admin_actions (admin_id, action, target_id, reason)
    values (auth.uid(), 'remove_item', p_item_id, coalesce(p_reason, 'removed'));
  end if;
  return v_item;
end;
$$;

-- requestDownload: writes the license record. The server then signs a 5-minute URL to the original.
create function public.record_download(p_item_id uuid, p_kit_sample_id uuid default null)
returns public.downloads
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items;
  v_handle text;
  v_row public.downloads;
begin
  if v_uid is null then perform public.fail('unauthorized', 'Sign in to download.'); end if;
  if not public.is_active_user() then perform public.fail('forbidden', 'This account cannot download.'); end if;
  select * into v_item from public.items where id = p_item_id;
  if v_item.id is null or (v_item.status <> 'published' and v_item.owner_id <> v_uid) then
    perform public.fail('not_found', 'Item not found.');
  end if;
  if p_kit_sample_id is not null and not exists (select 1 from public.kit_samples where id = p_kit_sample_id and item_id = p_item_id) then
    perform public.fail('not_found', 'Sample not found.');
  end if;
  select handle into v_handle from public.profiles where id = v_item.owner_id;
  insert into public.downloads (user_id, item_id, kit_sample_id, item_title, owner_handle, license, license_version, split_percent)
  values (v_uid, v_item.id, p_kit_sample_id, v_item.title, v_handle, v_item.license,
          public.app_limits() -> 'licenses' -> v_item.license::text ->> 'version', v_item.split_percent)
  returning * into v_row;
  return v_row;
end;
$$;

-- ===========================================================================
-- Worker functions (service role only)

-- Claims one job with a row lock, so several workers never take the same job.
create function public.claim_job() returns setof public.processing_jobs
language sql
set search_path = ''
as $$
  update public.processing_jobs
     set status = 'running', locked_at = now(), attempts = attempts + 1
   where id = (select id from public.processing_jobs
                where status = 'queued' and run_after <= now()
                order by run_after
                for update skip locked
                limit 1)
  returning *;
$$;

-- Applies a validated worker result (contracts: workerResultSchema) in one transaction.
-- Idempotent: derived rows for the item are replaced, so a rerun gives the same end state.
create function public.worker_complete(p_job_id uuid, p_result jsonb) returns public.items
language plpgsql
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_item public.items;
  v_flag jsonb := p_result -> 'flag';
  v_status public.item_status;
begin
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if v_job.id is null then perform public.fail('not_found', 'Job not found.'); end if;

  -- Replace derived files and samples; the uploader's originals stay.
  delete from public.item_files where item_id = v_job.item_id and role not in ('original', 'demo');
  delete from public.kit_samples where item_id = v_job.item_id;
  delete from public.fingerprints where item_id = v_job.item_id;

  insert into public.item_files (item_id, role, bucket, path, bytes, mime, sha256, meta)
  select v_job.item_id, f ->> 'role', f ->> 'bucket', f ->> 'path', (f ->> 'bytes')::bigint, f ->> 'mime',
         f ->> 'sha256', coalesce(f -> 'meta', '{}')
    from jsonb_array_elements(coalesce(p_result -> 'files', '[]')) f
  on conflict (bucket, path) do update
     set bytes = excluded.bytes, mime = excluded.mime, sha256 = coalesce(excluded.sha256, public.item_files.sha256),
         meta = excluded.meta;

  insert into public.kit_samples (item_id, position, name, category, duration_ms, root_note, original_path, preview_path)
  select v_job.item_id, (s ->> 'position')::int, s ->> 'name', s ->> 'category', (s ->> 'durationMs')::int,
         (s ->> 'rootNote')::smallint, s ->> 'originalPath', s ->> 'previewPath'
    from jsonb_array_elements(coalesce(p_result -> 'kitSamples', '[]')) s;

  insert into public.fingerprints (item_file_id, item_id, duration_ms, chromaprint)
  select f.id, v_job.item_id, (fp ->> 'durationMs')::int,
         array(select jsonb_array_elements_text(fp -> 'chromaprint')::int)
    from jsonb_array_elements(coalesce(p_result -> 'fingerprints', '[]')) fp
    join public.item_files f on f.item_id = v_job.item_id and f.path = fp ->> 'filePath';

  v_status := case when v_flag is not null and v_flag <> 'null'::jsonb then 'flagged' else 'ready' end;
  update public.items
     set status = v_status,
         flagged_reason = case when v_status = 'flagged' then v_flag ->> 'reason' else null end,
         details = p_result -> 'details',
         bpm = coalesce(bpm, (p_result ->> 'bpm')::numeric),
         key_root = coalesce(key_root, (p_result -> 'key' ->> 'root')::smallint),
         key_mode = coalesce(key_mode, (p_result -> 'key' ->> 'mode')::public.key_mode),
         duration_ms = (p_result ->> 'durationMs')::int
   where id = v_job.item_id
  returning * into v_item;

  if v_status = 'flagged' then
    insert into public.notifications (user_id, kind, item_id) values (v_item.owner_id, 'flag', v_item.id);
  end if;

  update public.processing_jobs set status = 'done', finished_at = now(), error = null where id = p_job_id;
  return v_item;
end;
$$;

-- Records a failure. Retryable failures go back on the queue with backoff until attempts run out;
-- a corrupt or unsupported file fails once and returns the item to draft with the reason.
create function public.worker_fail(p_job_id uuid, p_reason text, p_retryable boolean)
returns public.processing_jobs
language plpgsql
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_worker jsonb := public.app_limits() -> 'worker';
  v_max_attempts int := (v_worker ->> 'maxAttempts')::int;
  v_backoff int;
begin
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if v_job.id is null then perform public.fail('not_found', 'Job not found.'); end if;
  if p_retryable and v_job.attempts < v_max_attempts then
    v_backoff := coalesce((v_worker -> 'backoffSeconds' ->> (v_job.attempts - 1))::int, 600);
    update public.processing_jobs
       set status = 'queued', locked_at = null, error = p_reason,
           run_after = now() + make_interval(secs => v_backoff)
     where id = p_job_id returning * into v_job;
  else
    update public.processing_jobs set status = 'failed', finished_at = now(), error = p_reason
     where id = p_job_id returning * into v_job;
    update public.items set status = 'draft', flagged_reason = p_reason where id = v_job.item_id and status = 'processing';
  end if;
  return v_job;
end;
$$;

-- Returns jobs whose worker died mid-run to the queue.
create function public.requeue_stale_jobs(p_older_than interval) returns int
language sql
set search_path = ''
as $$
  with r as (
    update public.processing_jobs set status = 'queued', locked_at = null
     where status = 'running' and locked_at < now() - p_older_than
    returning 1)
  select count(*)::int from r;
$$;

-- Items in the admin review queue: flagged by the worker, or with enough open reports.
create view public.admin_review_queue with (security_invoker = true) as
  select i.id as item_id, i.status, i.flagged_reason,
         (select count(*) from public.reports r where r.item_id = i.id and r.status = 'open')::int as open_reports
    from public.items i
   where i.status = 'flagged'
      or (select count(*) from public.reports r where r.item_id = i.id and r.status = 'open') >= 3;

-- ===========================================================================
-- Privileges. Supabase grants everything on new tables to anon and authenticated by default;
-- start from nothing and grant exactly what the access table allows.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Reads
grant select on public.profiles, public.items, public.item_files, public.kit_samples,
                public.tags, public.item_tags, public.follows, public.likes to anon, authenticated;
grant select on public.accounts, public.downloads, public.notifications, public.reports,
                public.dmca_notices, public.processing_jobs, public.admin_actions,
                public.admin_review_queue to authenticated;

-- Column-level writes
grant update (display_name, bio, avatar_path, links) on public.profiles to authenticated;
grant update (title, description, genre, license, split_percent, bpm, key_root, key_mode) on public.items to authenticated;
grant insert, delete on public.follows, public.likes to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert (item_id, reason, detail) on public.reports to authenticated;

-- Functions callable by signed-in users (each checks the caller itself)
grant execute on function
  public.is_admin(), public.is_active_user(), public.can_read_item(uuid),
  public.claim_handle(text, text),
  public.create_upload_draft(public.item_type, text, bigint, text, text),
  public.add_demo_file(uuid, bigint, text, text),
  public.enqueue_processing(uuid, uuid),
  public.set_item_tags(uuid, text[], text[]),
  public.publish_item(uuid, boolean),
  public.unpublish_item(uuid),
  public.remove_item(uuid, text),
  public.record_download(uuid, uuid),
  public.hit_rate_limit(text, int, interval)
to authenticated;
grant execute on function public.is_admin(), public.is_active_user(), public.can_read_item(uuid), public.slugify(text) to anon;
grant execute on function public.slugify(text) to authenticated;

-- ===========================================================================
-- Row-level security: on for every table

alter table public.profiles                  enable row level security;
alter table public.accounts                  enable row level security;
alter table public.items                     enable row level security;
alter table public.item_files                enable row level security;
alter table public.kit_samples               enable row level security;
alter table public.tags                      enable row level security;
alter table public.item_tags                 enable row level security;
alter table public.fingerprints              enable row level security;
alter table public.follows                   enable row level security;
alter table public.likes                     enable row level security;
alter table public.downloads                 enable row level security;
alter table public.notifications             enable row level security;
alter table public.reports                   enable row level security;
alter table public.dmca_notices              enable row level security;
alter table public.processing_jobs           enable row level security;
alter table public.admin_actions             enable row level security;
alter table public.rate_limit_hits           enable row level security;
alter table public.reserved_handles          enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;

-- profiles: everyone reads; owner updates the granted columns
create policy profiles_read   on public.profiles for select using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- accounts: owner and admins read; service role writes
create policy accounts_read on public.accounts for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- items: published rows for everyone; any status for owner and admins
create policy items_read on public.items for select
  using (status = 'published' or owner_id = auth.uid() or public.is_admin());
create policy items_update on public.items for update to authenticated
  using (owner_id = auth.uid() and status <> 'removed') with check (owner_id = auth.uid());

-- item_files, kit_samples: readable when the parent item is
create policy item_files_read  on public.item_files  for select using (public.can_read_item(item_id));
create policy kit_samples_read on public.kit_samples for select using (public.can_read_item(item_id));

-- tags, item_tags: everyone reads (writes go through set_item_tags)
create policy tags_read      on public.tags      for select using (true);
create policy item_tags_read on public.item_tags for select using (public.can_read_item(item_id));

-- follows, likes: everyone reads; the acting user writes their own rows
create policy follows_read   on public.follows for select using (true);
create policy follows_insert on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and public.is_active_user());
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid());

create policy likes_read   on public.likes for select using (true);
create policy likes_insert on public.likes for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user() and public.can_read_item(item_id));
create policy likes_delete on public.likes for delete to authenticated using (user_id = auth.uid());

-- downloads: the downloader's own rows (writes through record_download)
create policy downloads_read on public.downloads for select to authenticated using (user_id = auth.uid());

-- notifications: owner reads and may set read_at
create policy notifications_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reports: admins read; any signed-in user may insert a report as themselves
create policy reports_read   on public.reports for select to authenticated using (public.is_admin());
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_active_user() and public.can_read_item(item_id));

-- dmca_notices, fingerprints: admins read dmca; service role writes both
create policy dmca_read on public.dmca_notices for select to authenticated using (public.is_admin());

-- processing_jobs: owner of the item and admins read
create policy jobs_read on public.processing_jobs for select to authenticated
  using (public.is_admin() or exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.uid()));

-- admin_actions: admins read
create policy admin_actions_read on public.admin_actions for select to authenticated using (public.is_admin());

-- rate_limit_hits, reserved_handles, conversations, participants, messages: no policies, so no access
-- for anon or authenticated. The service role bypasses RLS.

-- ===========================================================================
-- Realtime: the upload screen listens to its own items and jobs.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.items, public.processing_jobs;
  end if;
end;
$$;
