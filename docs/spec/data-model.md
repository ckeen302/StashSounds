# Data model

> Source: Stash MVP Build Documentation (23 Nov 2026), Tab 1 ("Data model") and Build spec ("Database schema", "Access policies", "Triggers and functions"). Where this file and the code disagree, raise it with the lead; do not silently pick one.

## Data model

One items table holds every content type, with type-specific details in a JSON column. This keeps search, feeds, likes and follows as single queries instead of five parallel ones.

| Table | Key columns | Purpose |
| --- | --- | --- |
| `profiles` | id (matches auth user), handle, display_name, bio, avatar_url, links, role | Public identity. Handle is unique and lowercase. |
| `items` | id, owner_id, type, title, slug, status, license, bpm, musical_key, duration_ms, genre, details (JSON), search_vector, counts, published_at | Every loop, one-shot, kit, MIDI file and preset. |
| `item_files` | id, item_id, role (original, preview, peaks, notes, demo), bucket, path, bytes, mime, sha256 | Every stored file, original or derived. |
| `kit_samples` | id, item_id, name, category, position, preview_path, duration_ms | One row per sample inside a drum kit. |
| `tags`, `item_tags` | tag id, name, kind (instrument, mood, genre, reference) | Free tags plus "in the style of" reference tags. |
| `fingerprints` | item_file_id, chromaprint, duration_ms | Duplicate and stolen-upload screening. |
| `follows` | follower_id, followee_id, created_at | The social graph. |
| `likes` | user_id, item_id, created_at | Saves, and a ranking signal. |
| `downloads` | id, user_id, item_id, license, license_version, created_at | The license record for every download. |
| `notifications` | id, user_id, kind, actor_id, item_id, read_at | New follower, like, new upload from someone you follow. |
| `reports` | id, reporter_id, item_id, reason, detail, status | User flags for stolen or abusive content. |
| `dmca_notices` | id, item_id, claimant, statement, status, counter_notice, dates | Formal takedown trail. |
| `processing_jobs` | id, item_id, kind, status, attempts, error, timestamps | Worker visibility and retries. |
| `conversations`, `messages` | participants, body, created_at, read_at | Phase 4 only. Create the tables now, expose nothing. |

### Rules for this schema

- Item status is a small state machine: `draft` → `processing` → `ready` → `published`, with `flagged` and `removed` as side exits. Only published items are visible to anyone but the owner.
- Counts are stored, not computed. `likes_count`, `downloads_count` and `followers_count` are columns kept current by database triggers, so feeds never count rows on read.
- Access rules live in the database. Every table has row-level security on. Anyone can read published items and public profiles. Users can write only rows they own. Only the worker's service key can change status, metadata and file rows.
- The details JSON has a schema per type in `packages/contracts` (for example, a preset's synth name and version, or a MIDI file's note range). The database stores it; Zod validates it.
- Search runs on a trigger-maintained `search_vector` column built from title, tags, genre and owner handle, with indexes on type, bpm, musical_key and published_at for filters.
- The following feed is a query, not a stored timeline: published items whose owner is in the viewer's follows, newest first, paged by a cursor. This holds to tens of thousands of users before it needs rework.

## Database schema

This is the first migration, close to final. It was run against a clean Postgres 16 database and creates all 15 tables without error. It refines the overview in three places: the musical key is stored as a root note and a mode so compatible-key filters are a simple query, account state is split from the public profile, and the jobs table doubles as the queue.

```sql
create extension if not exists pg_trgm;

create type item_type    as enum ('loop','oneshot','kit','midi','preset');
create type item_status  as enum ('draft','processing','ready','published','flagged','removed');
create type license_kind as enum ('royalty_free','credit_required','split_on_placement');
create type key_mode     as enum ('major','minor');
create type job_status   as enum ('queued','running','done','failed');

-- Public identity
create table profiles (
  id              uuid primary key references auth.users on delete cascade,
  handle          text unique not null check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name    text not null check (char_length(display_name) between 1 and 40),
  bio             text check (char_length(bio) <= 280),
  avatar_path     text,
  links           jsonb not null default '[]',
  followers_count int not null default 0,
  following_count int not null default 0,
  created_at      timestamptz not null default now()
);

-- Private account state, never exposed to other users
create table accounts (
  id            uuid primary key references profiles on delete cascade,
  role          text not null default 'user' check (role in ('user','trusted','admin')),
  storage_bytes bigint not null default 0,
  strikes       int not null default 0,
  suspended_at  timestamptz
);

create table items (
  id              uuid primary key default gen_random_uuid(),
  public_id       text unique not null,           -- short id used in URLs
  owner_id        uuid not null references profiles on delete cascade,
  type            item_type not null,
  status          item_status not null default 'draft',
  title           text not null check (char_length(title) between 1 and 80),
  slug            text not null,
  description     text check (char_length(description) <= 500),
  license         license_kind not null default 'royalty_free',
  split_percent   smallint check (split_percent between 1 and 50),
  genre           text,
  bpm             numeric(5,2) check (bpm between 40 and 300),
  key_root        smallint check (key_root between 0 and 11),     -- 0 = C
  key_mode        key_mode,
  duration_ms     int,
  details         jsonb not null default '{}',    -- per-type shape, validated by contracts
  tag_names       text[] not null default '{}',   -- kept in sync from item_tags
  search_vector   tsvector,                       -- kept in sync by trigger
  likes_count     int not null default 0,
  downloads_count int not null default 0,
  flagged_reason  text,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((license = 'split_on_placement') = (split_percent is not null))
);
create index items_owner_idx  on items (owner_id, published_at desc) where status = 'published';
create index items_browse_idx on items (type, published_at desc)     where status = 'published';
create index items_bpm_idx    on items (type, bpm)                   where status = 'published';
create index items_key_idx    on items (type, key_root, key_mode)    where status = 'published';
create index items_search_idx on items using gin (search_vector);
create index items_tags_idx   on items using gin (tag_names);
create index items_title_trgm on items using gin (title gin_trgm_ops);

create table item_files (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references items on delete cascade,
  role       text not null check (role in ('original','preview','peaks','notes','demo','sampled_note','cover')),
  bucket     text not null check (bucket in ('originals','previews')),
  path       text not null,
  bytes      bigint not null,
  mime       text not null,
  sha256     text,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (bucket, path)
);
create index item_files_item_idx on item_files (item_id, role);
create index item_files_sha_idx on item_files (sha256) where role = 'original';

create table kit_samples (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references items on delete cascade,
  position      int not null,
  name          text not null,
  category      text not null,    -- kick, snare, clap, hat, open_hat, 808, perc, tom, cymbal, fx, vocal, other
  duration_ms   int not null,
  root_note     smallint,
  original_path text not null,
  preview_path  text not null,
  unique (item_id, position)
);

create table tags (
  id          bigint generated always as identity primary key,
  name        text unique not null check (name = lower(name) and char_length(name) between 2 and 40),
  kind        text not null default 'tag' check (kind in ('tag','instrument','mood','reference')),
  items_count int not null default 0
);
create table item_tags (
  item_id uuid   not null references items on delete cascade,
  tag_id  bigint not null references tags  on delete cascade,
  primary key (item_id, tag_id)
);
create index item_tags_tag_idx on item_tags (tag_id);

create table fingerprints (
  item_file_id uuid primary key references item_files on delete cascade,
  item_id      uuid not null references items on delete cascade,
  duration_ms  int not null,
  chromaprint  int[] not null
);

create table follows (
  follower_id uuid not null references profiles on delete cascade,
  followee_id uuid not null references profiles on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on follows (followee_id);

create table likes (
  user_id    uuid not null references profiles on delete cascade,
  item_id    uuid not null references items on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index likes_item_idx on likes (item_id, created_at desc);

-- The license record. Survives deletion of the item or the user.
create table downloads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references profiles on delete set null,
  item_id         uuid references items on delete set null,
  item_title      text not null,
  owner_handle    text not null,
  license         license_kind not null,
  license_version text not null,
  split_percent   smallint,
  created_at      timestamptz not null default now()
);
create index downloads_user_idx on downloads (user_id, created_at desc);
create index downloads_item_idx on downloads (item_id, created_at desc);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  kind       text not null check (kind in ('follow','like','upload','flag','takedown')),
  actor_id   uuid references profiles on delete cascade,
  item_id    uuid references items on delete cascade,
  count      int not null default 1,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);

create table reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles on delete set null,
  item_id     uuid not null references items on delete cascade,
  reason      text not null check (reason in ('stolen','copyright','spam','abuse','other')),
  detail      text check (char_length(detail) <= 1000),
  status      text not null default 'open' check (status in ('open','upheld','dismissed')),
  created_at  timestamptz not null default now()
);

create table dmca_notices (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid references items on delete set null,
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

-- Job record and queue in one table
create table processing_jobs (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items on delete cascade,
  kind        text not null,
  status      job_status not null default 'queued',
  attempts    int not null default 0,
  run_after   timestamptz not null default now(),
  locked_at   timestamptz,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_claim_idx on processing_jobs (run_after) where status = 'queued';
```

The worker claims one job at a time with a row lock, so several workers can run without taking the same job:

```sql
update processing_jobs
   set status = 'running', locked_at = now(), attempts = attempts + 1
 where id = (select id from processing_jobs
              where status = 'queued' and run_after <= now()
              order by run_after
              for update skip locked
              limit 1)
returning *;
```

## Access policies

Row-level security is on for every table. Row policies decide which rows; column-level grants decide which columns a signed-in user may change.

| Table | Read | Write |
| --- | --- | --- |
| `profiles` | Everyone | Owner: display name, bio, avatar, links. Handle only through `claim_handle`. |
| `accounts` | Owner and admins | Service role only |
| `items` | Published rows: everyone. Any status: owner and admins. | Owner: title, description, genre, license, split, BPM, key. Status changes only through `publish_item`, `unpublish_item`, `remove_item`. |
| `item_files`, `kit_samples` | When the parent item is readable | Service role only |
| `tags`, `item_tags` | Everyone | Owner of the item, through `set_item_tags` |
| `follows`, `likes` | Everyone | The acting user's own rows |
| `downloads` | The downloader's own rows | Only through `record_download` |
| `notifications` | Owner | Owner may set `read_at` |
| `reports` | Admins | Any signed-in user may insert |
| `dmca_notices`, `fingerprints` | Admins | Service role only |
| `processing_jobs` | Owner of the item, and admins | Service role only |

## Triggers and functions

- Counts: likes, downloads, followers, following, tag usage and per-user storage are maintained by triggers.
- Search: a trigger rebuilds `search_vector` from title, tags, genre and the owner's handle whenever any of them changes.
- Tag sync: changes to `item_tags` refresh `items.tag_names`.
- Notifications: new follow, new like and publish insert notification rows; repeated likes on one item within an hour increase count instead of adding rows.
- State changes: `publish_item`, `unpublish_item`, `remove_item`, `claim_handle`, `set_item_tags` and `record_download` are the only way to make those changes, and each checks the caller.
- Tests: the Platform lane writes a policy test for every cell in the table above, run by `pnpm db:test`.
