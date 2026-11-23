/**
 * One test per cell of the access table in docs/spec/build-spec.md (Access policies), plus the
 * state-change functions. Run with pnpm db:test. The Platform lane owns and extends this file.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestDb, anon, rejection, service, user } from "./db.ts";

let db: TestDb;
let alice: string; // uploader
let bob: string; // another user
let admin: string;
let published: string; // alice's published loop
let draft: string; // alice's draft loop

const DENIED = /permission denied|row-level security|violates row-level/;

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.makeUser("alice");
  bob = await db.makeUser("bob");
  admin = await db.makeUser("mod", { role: "admin" });
  published = await db.makeItem(alice, { status: "published", title: "Public loop" });
  draft = await db.makeItem(alice, { status: "draft", title: "Secret draft" });
  await db.q(
    `insert into public.item_files (item_id, role, bucket, path, bytes, mime) values
       ($1, 'original', 'originals', 'a/p/original.wav', 100, 'audio/wav'),
       ($1, 'preview', 'previews', 'a/p/preview.mp3', 10, 'audio/mpeg'),
       ($2, 'original', 'originals', 'a/d/original.wav', 100, 'audio/wav')`,
    [published, draft],
  );
});

afterAll(async () => {
  await db?.drop();
});

describe("profiles", () => {
  it("everyone can read", async () => {
    const r = await db.as(anon, `select handle from public.profiles order by handle`);
    expect(r.rows.map((x) => x.handle)).toEqual(["alice", "bob", "mod"]);
  });
  it("the owner can edit display name, bio, avatar and links", async () => {
    await db.as(user(alice), `update public.profiles set display_name = 'Alice A', bio = 'hi' where id = $1`, [alice]);
    const r = await db.q(`select display_name, bio from public.profiles where id = $1`, [alice]);
    expect(r.rows[0]).toEqual({ display_name: "Alice A", bio: "hi" });
  });
  it("nobody can edit someone else's profile", async () => {
    const r = await db.as(user(bob), `update public.profiles set bio = 'pwned' where id = $1`, [alice]);
    expect(r.rowCount).toBe(0);
  });
  it("the handle and counts cannot be written directly", async () => {
    expect(await rejection(db.as(user(alice), `update public.profiles set handle = 'x_x_x' where id = $1`, [alice]))).toMatch(DENIED);
    expect(await rejection(db.as(user(alice), `update public.profiles set followers_count = 999 where id = $1`, [alice]))).toMatch(DENIED);
  });
  it("anon cannot write", async () => {
    expect(await rejection(db.as(anon, `update public.profiles set bio = 'x'`))).toMatch(DENIED);
  });
});

describe("claim_handle", () => {
  it("rejects bad formats, reserved words and taken handles", async () => {
    const u = (await db.q<{ id: string }>(`insert into auth.users (email, email_confirmed_at) values ('new@x.test', now()) returning id`)).rows[0]!.id;
    expect(await rejection(db.as(user(u), `select public.claim_handle('No Caps')`))).toMatch(/^invalid:/);
    expect(await rejection(db.as(user(u), `select public.claim_handle('admin')`))).toMatch(/^conflict:/);
    expect(await rejection(db.as(user(u), `select public.claim_handle('alice')`))).toMatch(/^conflict:/);
    await db.as(user(u), `select public.claim_handle('newbie', 'New Bie')`);
    const r = await db.q(`select p.handle, p.display_name, a.role from public.profiles p join public.accounts a using (id) where p.id = $1`, [u]);
    expect(r.rows[0]).toEqual({ handle: "newbie", display_name: "New Bie", role: "user" });
  });
  it("anon cannot claim", async () => {
    expect(await rejection(db.as(anon, `select public.claim_handle('ghost')`))).toMatch(DENIED);
  });
});

describe("accounts", () => {
  it("the owner reads their own row only", async () => {
    const r = await db.as(user(bob), `select id from public.accounts`);
    expect(r.rows.map((x) => x.id)).toEqual([bob]);
  });
  it("admins read every row", async () => {
    const r = await db.as(user(admin), `select count(*)::int as n from public.accounts`);
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(3);
  });
  it("nobody but the service role writes", async () => {
    expect(await rejection(db.as(user(bob), `update public.accounts set role = 'admin' where id = $1`, [bob]))).toMatch(DENIED);
    expect(await rejection(db.as(anon, `select * from public.accounts`))).toMatch(DENIED);
    await db.as(service, `update public.accounts set strikes = 1 where id = $1`, [bob]);
    await db.as(service, `update public.accounts set strikes = 0 where id = $1`, [bob]);
  });
});

describe("items", () => {
  it("published rows are readable by everyone", async () => {
    const r = await db.as(anon, `select title from public.items`);
    expect(r.rows.map((x) => x.title)).toEqual(["Public loop"]);
  });
  it("any status is readable by the owner and admins, not by others", async () => {
    expect((await db.as(user(alice), `select id from public.items where id = $1`, [draft])).rowCount).toBe(1);
    expect((await db.as(user(admin), `select id from public.items where id = $1`, [draft])).rowCount).toBe(1);
    expect((await db.as(user(bob), `select id from public.items where id = $1`, [draft])).rowCount).toBe(0);
  });
  it("the owner edits title, description, genre, license, split, BPM and key", async () => {
    await db.as(
      user(alice),
      `update public.items set title = 'Renamed', genre = 'trap', bpm = 140, key_root = 9, key_mode = 'minor',
              license = 'split_on_placement', split_percent = 10 where id = $1`,
      [draft],
    );
    const r = await db.q(`select title, bpm, license, split_percent from public.items where id = $1`, [draft]);
    expect(r.rows[0]).toMatchObject({ title: "Renamed", bpm: "140.00", license: "split_on_placement", split_percent: 10 });
  });
  it("status, counts and details cannot be written directly", async () => {
    for (const set of ["status = 'published'", "likes_count = 9", "details = '{}'", "owner_id = owner_id", "published_at = now()"]) {
      expect(await rejection(db.as(user(alice), `update public.items set ${set} where id = $1`, [draft])), set).toMatch(DENIED);
    }
  });
  it("nobody edits someone else's item", async () => {
    const r = await db.as(user(bob), `update public.items set title = 'mine now' where id = $1`, [published]);
    expect(r.rowCount).toBe(0);
  });
  it("items cannot be inserted or deleted directly", async () => {
    expect(await rejection(db.as(user(alice), `insert into public.items (owner_id, type, title, slug) values ($1, 'loop', 'x', 'x')`, [alice]))).toMatch(DENIED);
    expect(await rejection(db.as(user(alice), `delete from public.items where id = $1`, [draft]))).toMatch(DENIED);
  });
});

describe("item_files and kit_samples", () => {
  it("are readable when the parent item is", async () => {
    const r = await db.as(anon, `select path from public.item_files order by path`);
    expect(r.rows.map((x) => x.path)).toEqual(["a/p/original.wav", "a/p/preview.mp3"]);
    expect((await db.as(user(alice), `select 1 from public.item_files where item_id = $1`, [draft])).rowCount).toBe(1);
    expect((await db.as(user(bob), `select 1 from public.item_files where item_id = $1`, [draft])).rowCount).toBe(0);
  });
  it("only the service role writes", async () => {
    expect(
      await rejection(db.as(user(alice), `insert into public.item_files (item_id, role, bucket, path, bytes, mime) values ($1, 'preview', 'previews', 'x', 1, 'a')`, [draft])),
    ).toMatch(DENIED);
    expect(
      await rejection(db.as(user(alice), `insert into public.kit_samples (item_id, position, name, category, duration_ms, original_path, preview_path) values ($1, 0, 'k', 'kick', 1, 'a', 'b')`, [draft])),
    ).toMatch(DENIED);
  });
});

describe("tags", () => {
  it("everyone reads; writes go only through set_item_tags by the owner", async () => {
    expect(await rejection(db.as(user(alice), `insert into public.tags (name) values ('hack')`))).toMatch(DENIED);
    const r = await db.as(user(alice), `select public.set_item_tags($1, array['Dark','keys'], array['metro boomin']) as t`, [published]);
    expect(r.rows[0]!.t).toEqual(["dark", "keys", "metro boomin"]);
    const tags = await db.as(anon, `select name, kind, items_count from public.tags order by name`);
    expect(tags.rows).toEqual([
      { name: "dark", kind: "tag", items_count: 1 },
      { name: "keys", kind: "tag", items_count: 1 },
      { name: "metro boomin", kind: "reference", items_count: 1 },
    ]);
    expect(await rejection(db.as(user(bob), `select public.set_item_tags($1, array['spam'])`, [published]))).toMatch(/^not_found:/);
  });
  it("tag changes refresh tag_names, counts and search", async () => {
    await db.as(user(alice), `select public.set_item_tags($1, array['keys'])`, [published]);
    const r = await db.q(`select tag_names, search_vector @@ to_tsquery('simple', 'keys') as hit from public.items where id = $1`, [published]);
    expect(r.rows[0]).toEqual({ tag_names: ["keys"], hit: true });
    expect((await db.q(`select items_count from public.tags where name = 'dark'`)).rows[0]!.items_count).toBe(0);
  });
  it("caps tags at eight", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `tag${i}`);
    expect(await rejection(db.as(user(alice), `select public.set_item_tags($1, $2)`, [published, nine]))).toMatch(/^invalid:/);
  });
});

describe("follows and likes", () => {
  it("users write their own rows and counts follow", async () => {
    await db.as(user(bob), `insert into public.follows (follower_id, followee_id) values ($1, $2)`, [bob, alice]);
    await db.as(user(bob), `insert into public.likes (user_id, item_id) values ($1, $2)`, [bob, published]);
    expect((await db.q(`select followers_count from public.profiles where id = $1`, [alice])).rows[0]!.followers_count).toBe(1);
    expect((await db.q(`select following_count from public.profiles where id = $1`, [bob])).rows[0]!.following_count).toBe(1);
    expect((await db.q(`select likes_count from public.items where id = $1`, [published])).rows[0]!.likes_count).toBe(1);
  });
  it("everyone reads", async () => {
    expect((await db.as(anon, `select 1 from public.follows`)).rowCount).toBe(1);
    expect((await db.as(anon, `select 1 from public.likes`)).rowCount).toBe(1);
  });
  it("nobody writes rows for someone else", async () => {
    expect(await rejection(db.as(user(bob), `insert into public.follows (follower_id, followee_id) values ($1, $2)`, [admin, alice]))).toMatch(DENIED);
    expect(await rejection(db.as(user(bob), `insert into public.likes (user_id, item_id) values ($1, $2)`, [admin, published]))).toMatch(DENIED);
    expect((await db.as(user(alice), `delete from public.follows where follower_id = $1`, [bob])).rowCount).toBe(0);
    expect(await rejection(db.as(anon, `insert into public.likes (user_id, item_id) values ($1, $2)`, [bob, published]))).toMatch(DENIED);
  });
  it("nobody can like an item they cannot see", async () => {
    expect(await rejection(db.as(user(bob), `insert into public.likes (user_id, item_id) values ($1, $2)`, [bob, draft]))).toMatch(DENIED);
  });
  it("unlike and unfollow bring counts back down", async () => {
    await db.as(user(bob), `delete from public.likes where user_id = $1 and item_id = $2`, [bob, published]);
    await db.as(user(bob), `delete from public.follows where follower_id = $1`, [bob]);
    expect((await db.q(`select likes_count from public.items where id = $1`, [published])).rows[0]!.likes_count).toBe(0);
    expect((await db.q(`select followers_count from public.profiles where id = $1`, [alice])).rows[0]!.followers_count).toBe(0);
  });
});

describe("notifications", () => {
  it("batches repeated likes within an hour into one notification", async () => {
    const carol = await db.makeUser("carol");
    const dave = await db.makeUser("dave");
    const item = await db.makeItem(carol);
    for (const u of [dave, bob, admin]) await db.as(user(u), `insert into public.likes (user_id, item_id) values ($1, $2)`, [u, item]);
    const r = await db.as(user(carol), `select kind, count from public.notifications where kind = 'like'`);
    expect(r.rows).toEqual([{ kind: "like", count: 3 }]);
  });
  it("only the owner reads, and may only set read_at", async () => {
    expect((await db.as(user(bob), `select 1 from public.notifications where user_id <> $1`, [bob])).rowCount).toBe(0);
    await db.as(user(alice), `update public.notifications set read_at = now() where user_id = $1`, [alice]);
    expect(await rejection(db.as(user(alice), `update public.notifications set kind = 'flag'`))).toMatch(DENIED);
    expect(await rejection(db.as(user(alice), `insert into public.notifications (user_id, kind) values ($1, 'flag')`, [alice]))).toMatch(DENIED);
  });
});

describe("downloads", () => {
  it("record_download writes the license record and counts it", async () => {
    const r = await db.as(user(bob), `select * from public.record_download($1)`, [published]);
    expect(r.rows[0]).toMatchObject({ user_id: bob, item_id: published, owner_handle: "alice", license: "royalty_free", license_version: "1.0" });
    expect((await db.q(`select downloads_count from public.items where id = $1`, [published])).rows[0]!.downloads_count).toBe(1);
  });
  it("the downloader reads only their own rows", async () => {
    expect((await db.as(user(bob), `select 1 from public.downloads`)).rowCount).toBe(1);
    expect((await db.as(user(alice), `select 1 from public.downloads`)).rowCount).toBe(0);
    expect(await rejection(db.as(anon, `select 1 from public.downloads`))).toMatch(DENIED);
  });
  it("cannot be written directly", async () => {
    expect(
      await rejection(db.as(user(bob), `insert into public.downloads (user_id, item_title, owner_handle, license, license_version) values ($1, 'x', 'y', 'royalty_free', '1')`, [bob])),
    ).toMatch(DENIED);
  });
  it("needs a signed-in user and a visible item", async () => {
    expect(await rejection(db.as(anon, `select public.record_download($1)`, [published]))).toMatch(DENIED);
    expect(await rejection(db.as(user(bob), `select public.record_download($1)`, [draft]))).toMatch(/^not_found:/);
  });
  it("survives removal of the item", async () => {
    await db.as(user(alice), `select public.remove_item($1)`, [published]);
    const r = await db.as(user(bob), `select item_title, license from public.downloads`);
    expect(r.rows[0]).toEqual({ item_title: "Public loop", license: "royalty_free" });
    await db.q(`update public.items set status = 'published' where id = $1`, [published]);
  });
});

describe("reports", () => {
  it("any signed-in user may report a visible item as themselves", async () => {
    await db.as(user(bob), `insert into public.reports (item_id, reason, detail) values ($1, 'stolen', 'from a paid pack')`, [published]);
    const r = await db.q(`select reporter_id from public.reports`);
    expect(r.rows[0]!.reporter_id).toBe(bob);
  });
  it("nobody can report on someone else's behalf", async () => {
    expect(await rejection(db.as(user(bob), `insert into public.reports (reporter_id, item_id, reason) values ($1, $2, 'spam')`, [admin, published]))).toMatch(DENIED);
  });
  it("only admins read", async () => {
    expect((await db.as(user(bob), `select 1 from public.reports`)).rowCount).toBe(0);
    expect((await db.as(user(admin), `select 1 from public.reports`)).rowCount).toBe(1);
    expect(await rejection(db.as(anon, `insert into public.reports (item_id, reason) values ($1, 'spam')`, [published]))).toMatch(DENIED);
  });
  it("three open reports put an item in the review queue without hiding it", async () => {
    for (const u of [alice, admin]) await db.as(user(u), `insert into public.reports (item_id, reason) values ($1, 'spam')`, [published]);
    const q = await db.as(user(admin), `select open_reports from public.admin_review_queue where item_id = $1`, [published]);
    expect(q.rows[0]!.open_reports).toBe(3);
    expect((await db.as(anon, `select 1 from public.items where id = $1`, [published])).rowCount).toBe(1);
    expect((await db.as(user(bob), `select 1 from public.admin_review_queue`)).rowCount).toBe(0);
  });
});

describe("dmca_notices and fingerprints", () => {
  it("admins read notices; nobody but the service role writes either", async () => {
    await db.as(
      service,
      `insert into public.dmca_notices (item_id, claimant_name, claimant_email, work_description, statement, signature)
       values ($1, 'Label', 'legal@label.test', 'Our track', 'I swear', 'Label')`,
      [published],
    );
    expect((await db.as(user(admin), `select 1 from public.dmca_notices`)).rowCount).toBe(1);
    expect((await db.as(user(bob), `select 1 from public.dmca_notices`)).rowCount).toBe(0);
    expect(await rejection(db.as(anon, `select 1 from public.dmca_notices`))).toMatch(DENIED);
    expect(
      await rejection(db.as(user(bob), `insert into public.dmca_notices (claimant_name, claimant_email, work_description, statement, signature) values ('a','b','c','d','e')`)),
    ).toMatch(DENIED);
    expect(await rejection(db.as(user(admin), `select 1 from public.fingerprints`))).toMatch(DENIED);
  });
});

describe("processing_jobs", () => {
  it("the item's owner and admins read; nobody else; only the service role writes", async () => {
    await db.as(service, `insert into public.processing_jobs (item_id, kind) values ($1, 'process_loop')`, [draft]);
    expect((await db.as(user(alice), `select 1 from public.processing_jobs`)).rowCount).toBe(1);
    expect((await db.as(user(admin), `select 1 from public.processing_jobs`)).rowCount).toBe(1);
    expect((await db.as(user(bob), `select 1 from public.processing_jobs`)).rowCount).toBe(0);
    expect(await rejection(db.as(user(alice), `insert into public.processing_jobs (item_id, kind) values ($1, 'process_loop')`, [draft]))).toMatch(DENIED);
    expect(await rejection(db.as(user(alice), `update public.processing_jobs set status = 'done'`))).toMatch(DENIED);
    await db.as(service, `delete from public.processing_jobs`);
  });
  it("worker functions are not callable by signed-in users", async () => {
    for (const sql of [
      `select public.claim_job()`,
      `select public.worker_complete(gen_random_uuid(), '{}')`,
      `select public.worker_fail(gen_random_uuid(), 'x', true)`,
      `select public.requeue_stale_jobs('1 hour')`,
    ]) {
      expect(await rejection(db.as(user(admin), sql)), sql).toMatch(DENIED);
    }
  });
});

describe("phase 4 and internal tables", () => {
  it("expose nothing to anon or signed-in users", async () => {
    for (const t of ["conversations", "conversation_participants", "messages", "rate_limit_hits", "reserved_handles", "admin_actions"]) {
      if (t === "admin_actions") {
        expect((await db.as(user(bob), `select 1 from public.${t}`)).rowCount, t).toBe(0);
        continue;
      }
      expect(await rejection(db.as(user(bob), `select 1 from public.${t}`)), t).toMatch(DENIED);
      expect(await rejection(db.as(anon, `select 1 from public.${t}`)), t).toMatch(DENIED);
    }
  });
});

describe("upload pipeline functions", () => {
  it("create_upload_draft checks email verification, type and size", async () => {
    const unverified = await db.makeUser("unverified", { verified: false });
    expect(await rejection(db.as(user(unverified), `select * from public.create_upload_draft('loop', 'x', 100, 'audio/wav', 'wav')`))).toMatch(/^forbidden: Verify/);
    expect(await rejection(db.as(user(bob), `select * from public.create_upload_draft('loop', 'x', 100, 'audio/wav', 'exe')`))).toMatch(/^invalid:/);
    expect(await rejection(db.as(user(bob), `select * from public.create_upload_draft('oneshot', 'x', 11 * 1024 * 1024, 'audio/wav', 'wav')`))).toMatch(/^invalid:/);
    const r = await db.as(user(bob), `select * from public.create_upload_draft('loop', 'Night Drive 140', 1000, 'audio/wav', 'WAV')`);
    expect(r.rows[0]!.path).toMatch(new RegExp(`^${bob}/[0-9a-f-]{36}/original\\.wav$`));
    const item = await db.q(`select status, slug, title from public.items where id = $1`, [r.rows[0]!.item_id]);
    expect(item.rows[0]).toEqual({ status: "draft", slug: "night-drive-140", title: "Night Drive 140" });
    expect((await db.q(`select storage_bytes from public.accounts where id = $1`, [bob])).rows[0]!.storage_bytes).toBe("1000");
  });
  it("create_upload_draft enforces the storage quota", async () => {
    await db.q(`update public.accounts set storage_bytes = 2147483000 where id = $1`, [bob]);
    expect(await rejection(db.as(user(bob), `select * from public.create_upload_draft('loop', 'x', 1000, 'audio/wav', 'wav')`))).toMatch(/^quota_exceeded:/);
    await db.q(`update public.accounts set storage_bytes = 1000 where id = $1`, [bob]);
  });
  it("suspended users cannot upload or publish", async () => {
    const sus = await db.makeUser("suspended1");
    await db.q(`update public.accounts set suspended_at = now() where id = $1`, [sus]);
    expect(await rejection(db.as(user(sus), `select * from public.create_upload_draft('loop', 'x', 10, 'audio/wav', 'wav')`))).toMatch(/^forbidden:/);
  });
  it("enqueue_processing moves the owner's draft to processing and queues one job", async () => {
    const r = await db.as(user(bob), `select * from public.create_upload_draft('loop', 'Queue me', 10, 'audio/wav', 'wav')`);
    const { item_id, file_id } = r.rows[0]!;
    expect(await rejection(db.as(user(alice), `select public.enqueue_processing($1, $2)`, [item_id, file_id]))).toMatch(/^not_found:/);
    const job = await db.as(user(bob), `select public.enqueue_processing($1, $2) as id`, [item_id, file_id]);
    expect(job.rows[0]!.id).toBeTruthy();
    const s = await db.q(`select i.status, j.kind from public.items i join public.processing_jobs j on j.item_id = i.id where i.id = $1`, [item_id]);
    expect(s.rows[0]).toEqual({ status: "processing", kind: "process_loop" });
    expect(await rejection(db.as(user(bob), `select public.enqueue_processing($1, $2)`, [item_id, file_id]))).toMatch(/^conflict:/);
  });
  it("a preset waits for its demo before processing", async () => {
    const r = await db.as(user(bob), `select * from public.create_upload_draft('preset', 'Glass pad', 10, 'application/octet-stream', 'vital')`);
    const { item_id, file_id } = r.rows[0]!;
    const first = await db.as(user(bob), `select public.enqueue_processing($1, $2) as id`, [item_id, file_id]);
    expect(first.rows[0]!.id).toBeNull();
    const demo = await db.as(user(bob), `select * from public.add_demo_file($1, 10, 'audio/wav', 'wav')`, [item_id]);
    const second = await db.as(user(bob), `select public.enqueue_processing($1, $2) as id`, [item_id, demo.rows[0]!.file_id]);
    expect(second.rows[0]!.id).toBeTruthy();
  });
});

describe("worker functions", () => {
  async function queuedItem(title: string) {
    const r = await db.as(user(bob), `select * from public.create_upload_draft('loop', $1, 10, 'audio/wav', 'wav')`, [title]);
    await db.as(user(bob), `select public.enqueue_processing($1, $2)`, [r.rows[0]!.item_id, r.rows[0]!.file_id]);
    return r.rows[0]! as { item_id: string; path: string };
  }

  it("claim_job gives each job to one worker", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    await queuedItem("Claim a");
    await queuedItem("Claim b");
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => db.as(service, `select * from public.claim_job()`)));
    const ids = [a!, b!, c!].flatMap((r) => r.rows.map((x) => x.id));
    expect(new Set(ids).size).toBe(2);
    expect(ids).toHaveLength(2);
  });

  it("worker_complete applies a result in one go and is idempotent", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const it1 = await queuedItem("Complete me");
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    const result = {
      type: "loop",
      bpm: 140,
      key: { root: 9, mode: "minor" },
      durationMs: 6857,
      details: { sampleRate: 44100, channels: 2, loudnessLufs: -14, truePeakDb: -1, loopSamples: 302400, bars: 4,
        detection: { bpmSource: "onset", bpmAgreed: true, bpmCandidates: [140], keySource: "chroma", keyConfidence: 0.3 } },
      files: [
        { role: "preview", bucket: "previews", path: "p/abc.mp3", bytes: 120000, mime: "audio/mpeg", sha256: null, meta: {} },
        { role: "peaks", bucket: "previews", path: "p/abc.peaks", bytes: 800, mime: "application/octet-stream", sha256: null, meta: {} },
      ],
      fingerprints: [{ filePath: it1.path, durationMs: 6857, chromaprint: [1, 2, 3] }],
      flag: null,
    };
    for (let i = 0; i < 2; i++) await db.as(service, `select public.worker_complete($1, $2)`, [job.id, JSON.stringify(result)]);
    const item = await db.q(`select status, bpm, key_root, details->>'bars' as bars from public.items where id = $1`, [it1.item_id]);
    expect(item.rows[0]).toEqual({ status: "ready", bpm: "140.00", key_root: 9, bars: "4" });
    expect((await db.q(`select count(*)::int as n from public.item_files where item_id = $1`, [it1.item_id])).rows[0]!.n).toBe(3);
    expect((await db.q(`select count(*)::int as n from public.fingerprints where item_id = $1`, [it1.item_id])).rows[0]!.n).toBe(1);
    expect((await db.q(`select status from public.processing_jobs where id = $1`, [job.id])).rows[0]!.status).toBe("done");

    // publish needs ready and the rights confirmation, and notifies followers once
    await db.as(user(alice), `insert into public.follows (follower_id, followee_id) values ($1, $2)`, [alice, bob]);
    expect(await rejection(db.as(user(bob), `select public.publish_item($1, false)`, [it1.item_id]))).toMatch(/^invalid:/);
    expect(await rejection(db.as(user(alice), `select public.publish_item($1, true)`, [it1.item_id]))).toMatch(/^not_found:/);
    await db.as(user(bob), `select public.publish_item($1, true)`, [it1.item_id]);
    expect((await db.as(user(alice), `select 1 from public.notifications where kind = 'upload' and item_id = $1`, [it1.item_id])).rowCount).toBe(1);
    expect(await rejection(db.as(user(bob), `select public.publish_item($1, true)`, [it1.item_id]))).toMatch(/^conflict:/);
    await db.as(user(bob), `select public.unpublish_item($1)`, [it1.item_id]);
    expect((await db.q(`select status from public.items where id = $1`, [it1.item_id])).rows[0]!.status).toBe("ready");
  });

  it("a flag in the result makes the item flagged and tells the owner", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const it2 = await queuedItem("Stolen");
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    await db.as(service, `select public.worker_complete($1, $2)`, [
      job.id,
      JSON.stringify({ type: "loop", bpm: null, key: null, durationMs: 1000, details: {}, files: [], fingerprints: [], flag: { reason: "duplicate_exact" } }),
    ]);
    const item = await db.q(`select status, flagged_reason from public.items where id = $1`, [it2.item_id]);
    expect(item.rows[0]).toEqual({ status: "flagged", flagged_reason: "duplicate_exact" });
    expect((await db.as(anon, `select 1 from public.items where id = $1`, [it2.item_id])).rowCount).toBe(0);
    expect(await rejection(db.as(user(bob), `select public.publish_item($1, true)`, [it2.item_id]))).toMatch(/^conflict:/);
  });

  it("worker_fail retries with backoff, then fails and returns the item to draft", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const it3 = await queuedItem("Flaky");
    const backoffs: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      await db.q(`update public.processing_jobs set run_after = now() where status = 'queued'`);
      const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
      expect(job.attempts).toBe(attempt);
      const r = await db.as(service, `select (j).status, extract(epoch from (j).run_after - now())::int as wait from (select public.worker_fail($1, 'timeout', true) j) s`, [job.id]);
      if (attempt < 3) backoffs.push(r.rows[0]!.wait);
      else expect(r.rows[0]!.status).toBe("failed");
    }
    expect(backoffs).toEqual([30, 120]);
    expect((await db.q(`select status, flagged_reason from public.items where id = $1`, [it3.item_id])).rows[0]).toEqual({ status: "draft", flagged_reason: "timeout" });
  });

  it("a corrupt file fails once with no retry", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    await queuedItem("Corrupt");
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    const r = await db.as(service, `select (public.worker_fail($1, 'corrupt_file', false)).status`, [job.id]);
    expect(r.rows[0]!.status).toBe("failed");
  });
});

describe("rate limits", () => {
  it("hit_rate_limit fails past the limit within a window", async () => {
    for (let i = 0; i < 3; i++) await db.as(user(bob), `select public.hit_rate_limit('test:' || $1, 3, '1 hour')`, [bob]);
    expect(await rejection(db.as(user(bob), `select public.hit_rate_limit('test:' || $1, 3, '1 hour')`, [bob]))).toMatch(/^rate_limited:/);
  });
});

describe("limits", () => {
  it("the database enforces the same limits as packages/contracts/limits.json", async () => {
    const json = JSON.parse(readFileSync(join(import.meta.dirname, "../../packages/contracts/limits.json"), "utf8"));
    delete json.$comment;
    const r = await db.q(`select public.app_limits() as l`);
    expect(r.rows[0]!.l).toEqual(json);
  });
});
