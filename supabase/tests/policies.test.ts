/**
 * One test per cell of the access table in docs/spec/build-spec.md (Access policies), plus the
 * state-change functions. Run with pnpm db:test. The Platform lane owns and extends this file.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { profileLinkKindSchema, slugify } from "@stash/contracts";
import { TestDb, anon, rejection, service, superuser, user } from "./db.ts";

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
    `insert into public.kit_samples (item_id, position, name, category, duration_ms, original_path, preview_path) values
       ($1, 0, 'Kick', 'kick', 300, 'a/p/samples/kick.wav', 'p/kick.mp3'),
       ($2, 0, 'Snare', 'snare', 300, 'a/d/samples/snare.wav', 'd/snare.mp3')`,
    [published, draft],
  );
  await db.q(`insert into public.tags (name) values ('seeded')`);
  await db.q(`insert into public.item_tags (item_id, tag_id) select unnest(array[$1, $2]::uuid[]), id from public.tags where name = 'seeded'`, [published, draft]);
  await db.q(
    `insert into public.item_files (item_id, role, bucket, path, bytes, mime) values
       ($1, 'original', 'originals', 'a/p/original.wav', 100, 'audio/wav'),
       ($1, 'preview', 'previews', 'a/p/preview.mp3', 10, 'audio/mpeg'),
       ($2, 'original', 'originals', 'a/d/original.wav', 100, 'audio/wav'),
       ($2, 'preview', 'previews', 'a/d/preview.mp3', 10, 'audio/mpeg')`,
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
  it("a suspended user cannot edit their profile", async () => {
    const sus = await db.makeUser("suspended_editor");
    await db.q(`update public.accounts set suspended_at = now() where id = $1`, [sus]);
    const r = await db.as(user(sus), `update public.profiles set bio = 'still here' where id = $1`, [sus]);
    expect(r.rowCount).toBe(0);
  });
  it("rejects profile values the contracts reject (unknown link kind, blank display name)", async () => {
    const bad = [
      [`update public.profiles set links = '[{"kind":"myspace","url":"https://a.b"}]' where id = $1`],
      [`update public.profiles set display_name = '   ' where id = $1`],
    ];
    for (const [sql] of bad) expect(await rejection(db.as(user(alice), sql!, [alice]))).toMatch(/check constraint/);
    for (const kind of profileLinkKindSchema.options) {
      const links = JSON.stringify([{ kind, url: "https://example.com/x" }]);
      const r = await db.q<{ ok: boolean }>(`select public.valid_profile_links($1::jsonb) as ok`, [links]);
      expect(r.rows[0]!.ok, kind).toBe(true);
    }
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
  it("the slug follows a title change", async () => {
    const id = await db.makeItem(alice, { status: "draft", title: "Old name" });
    await db.as(user(alice), `update public.items set title = 'Dark Keys Über' where id = $1`, [id]);
    const r = await db.q(`select slug from public.items where id = $1`, [id]);
    expect(r.rows[0]!.slug).toBe("dark-keys-uber");
  });
  it("the owner's BPM or key correction marks detection as the uploader's", async () => {
    const id = await db.makeItem(alice, { status: "draft", title: "Detected" });
    const detection = { bpmSource: "onset", bpmAgreed: false, bpmCandidates: [140], keySource: "chroma", keyConfidence: 0.05 };
    await db.q(`update public.items set details = $2::jsonb where id = $1`, [id, JSON.stringify({ detection })]);
    await db.as(user(alice), `update public.items set title = 'Detected again' where id = $1`, [id]);
    expect((await db.q(`select details -> 'detection' as d from public.items where id = $1`, [id])).rows[0]!.d).toEqual(detection);
    await db.as(user(alice), `update public.items set bpm = 141 where id = $1`, [id]);
    let d = (await db.q(`select details -> 'detection' as d from public.items where id = $1`, [id])).rows[0]!.d;
    expect(d).toMatchObject({ bpmSource: "uploader", bpmAgreed: true, keySource: "chroma", keyConfidence: 0.05 });
    await db.as(user(alice), `update public.items set key_root = 2, key_mode = 'minor' where id = $1`, [id]);
    d = (await db.q(`select details -> 'detection' as d from public.items where id = $1`, [id])).rows[0]!.d;
    expect(d).toMatchObject({ keySource: "uploader", keyConfidence: null });
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
  it("previews are readable when the parent item is; originals only by the owner and admins", async () => {
    const r = await db.as(anon, `select path from public.item_files order by path`);
    expect(r.rows.map((x) => x.path)).toEqual(["a/p/preview.mp3"]);
    expect((await db.as(user(bob), `select path from public.item_files order by path`)).rows.map((x) => x.path)).toEqual(["a/p/preview.mp3"]);
    const own = await db.as(user(alice), `select path from public.item_files order by path`);
    expect(own.rows.map((x) => x.path)).toEqual(["a/d/original.wav", "a/d/preview.mp3", "a/p/original.wav", "a/p/preview.mp3"]);
    expect((await db.as(user(admin), `select 1 from public.item_files where bucket = 'originals'`)).rowCount).toBe(2);
  });
  it("kit samples are readable when the parent item is, without their original paths", async () => {
    expect((await db.as(anon, `select name from public.kit_samples`)).rows).toEqual([{ name: "Kick" }]);
    expect((await db.as(user(bob), `select 1 from public.kit_samples where item_id = $1`, [draft])).rowCount).toBe(0);
    expect((await db.as(user(alice), `select name from public.kit_samples where item_id = $1`, [draft])).rows).toEqual([{ name: "Snare" }]);
    for (const who of [anon, user(alice), user(admin)]) {
      expect(await rejection(db.as(who, `select original_path from public.kit_samples`))).toMatch(DENIED);
      expect(await rejection(db.as(who, `select * from public.kit_samples`))).toMatch(DENIED);
    }
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
  it("item_tags are readable when the parent item is", async () => {
    const tagged = `select it.item_id from public.item_tags it join public.tags t on t.id = it.tag_id where t.name = 'seeded'`;
    expect((await db.as(anon, tagged)).rows.map((x) => x.item_id)).toEqual([published]);
    expect((await db.as(user(bob), tagged)).rows.map((x) => x.item_id)).toEqual([published]);
    expect((await db.as(user(alice), tagged)).rowCount).toBe(2);
  });
  it("everyone reads; writes go only through set_item_tags by the owner", async () => {
    expect(await rejection(db.as(user(alice), `insert into public.tags (name) values ('hack')`))).toMatch(DENIED);
    const r = await db.as(user(alice), `select public.set_item_tags($1, array['Dark','keys'], array['metro boomin']) as t`, [published]);
    expect(r.rows[0]!.t).toEqual(["dark", "keys", "metro boomin"]);
    const tags = await db.as(anon, `select name, kind, items_count from public.tags order by name`);
    expect(tags.rows).toEqual([
      { name: "dark", kind: "tag", items_count: 1 },
      { name: "keys", kind: "tag", items_count: 1 },
      { name: "metro boomin", kind: "reference", items_count: 1 },
      { name: "seeded", kind: "tag", items_count: 1 },
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
  it("lowercases and merges duplicate tags, and checks length", async () => {
    const r = await db.as(user(alice), `select public.set_item_tags($1, array['Keys', ' keys ', 'KEYS', 'Dark']) as t`, [published]);
    expect(r.rows[0]!.t).toEqual(["dark", "keys"]);
    expect(await rejection(db.as(user(alice), `select public.set_item_tags($1, array['x'])`, [published]))).toMatch(/^invalid: Tags are 2 to 40/);
    expect(await rejection(db.as(user(alice), `select public.set_item_tags($1, array[repeat('a', 41)])`, [published]))).toMatch(/^invalid:/);
    await db.as(user(alice), `select public.set_item_tags($1, array['keys'])`, [published]);
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
  it("suspended users cannot like or follow", async () => {
    const sus = await db.makeUser("suspended_liker");
    await db.q(`update public.accounts set suspended_at = now() where id = $1`, [sus]);
    expect(await rejection(db.as(user(sus), `insert into public.likes (user_id, item_id) values ($1, $2)`, [sus, published]))).toMatch(DENIED);
    expect(await rejection(db.as(user(sus), `insert into public.follows (follower_id, followee_id) values ($1, $2)`, [sus, alice]))).toMatch(DENIED);
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
  it("following again does not stack follow notifications", async () => {
    const erin = await db.makeUser("erin");
    for (let i = 0; i < 3; i++) {
      await db.as(user(bob), `insert into public.follows (follower_id, followee_id) values ($1, $2)`, [bob, erin]);
      await db.as(user(bob), `delete from public.follows where follower_id = $1 and followee_id = $2`, [bob, erin]);
    }
    expect((await db.as(user(erin), `select 1 from public.notifications where kind = 'follow'`)).rowCount).toBe(1);
  });
  it("only the owner reads, and may only set read_at", async () => {
    expect((await db.as(user(bob), `select 1 from public.notifications where user_id <> $1`, [bob])).rowCount).toBe(0);
    const others = await db.as(user(bob), `update public.notifications set read_at = now() where user_id <> $1`, [bob]);
    expect(others.rowCount).toBe(0);
    expect((await db.q(`select count(*)::int as n from public.notifications where user_id <> $1 and read_at is not null`, [bob])).rows[0]!.n).toBe(0);
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
  it("nobody but the owner or an admin removes or unpublishes an item", async () => {
    expect(await rejection(db.as(user(bob), `select public.remove_item($1)`, [published]))).toMatch(/^not_found:/);
    expect(await rejection(db.as(user(bob), `select public.unpublish_item($1)`, [published]))).toMatch(/^not_found:/);
    expect((await db.q(`select status from public.items where id = $1`, [published])).rows[0]!.status).toBe("published");
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
  it("one report per person per item", async () => {
    expect(await rejection(db.as(user(bob), `insert into public.reports (item_id, reason) values ($1, 'spam')`, [published]))).toMatch(/duplicate key|unique/);
  });
  it("three open reports from different people put an item in the review queue without hiding it", async () => {
    expect((await db.as(user(admin), `select 1 from public.admin_review_queue where item_id = $1`, [published])).rowCount).toBe(0);
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
    await db.as(service, `insert into public.fingerprints (item_file_id, item_id, duration_ms, chromaprint)
      select id, item_id, 1000, '{1,2}' from public.item_files where path = 'a/p/original.wav'`);
    expect((await db.as(user(admin), `select 1 from public.fingerprints`)).rowCount).toBe(1);
    expect((await db.as(user(alice), `select 1 from public.fingerprints`)).rowCount).toBe(0);
    expect(await rejection(db.as(anon, `select 1 from public.fingerprints`))).toMatch(DENIED);
    expect(await rejection(db.as(user(admin), `insert into public.fingerprints (item_file_id, item_id, duration_ms, chromaprint) values (gen_random_uuid(), $1, 1, '{1}')`, [published]))).toMatch(DENIED);
    await db.as(service, `delete from public.fingerprints`);
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
      `select public.worker_complete(gen_random_uuid(), 1, '{}')`,
      `select public.worker_fail(gen_random_uuid(), 1, 'x', true)`,
      `select public.requeue_stale_jobs('1 hour')`,
      `select public.enqueue_processing(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1)`,
      `select public.hit_rate_limit('x', 1000, '1 hour')`,
      `select public.rate_limit_user('like')`,
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
    expect(await rejection(db.as(user(unverified), `select * from public.create_upload_draft('loop', 'x', 100, 'wav')`))).toMatch(/^forbidden: Verify/);
    expect(await rejection(db.as(user(bob), `select * from public.create_upload_draft('loop', 'x', 100, 'exe')`))).toMatch(/^invalid:/);
    expect(await rejection(db.as(user(bob), `select * from public.create_upload_draft('oneshot', 'x', 11 * 1024 * 1024, 'wav')`))).toMatch(/^invalid:/);
    const r = await db.as(user(bob), `select * from public.create_upload_draft('loop', 'Night Drive 140', 1000, 'WAV')`);
    expect(r.rows[0]!.path).toMatch(new RegExp(`^${bob}/[0-9a-f-]{36}/original\\.wav$`));
    const item = await db.q(`select status, slug, title from public.items where id = $1`, [r.rows[0]!.item_id]);
    expect(item.rows[0]).toEqual({ status: "draft", slug: "night-drive-140", title: "Night Drive 140" });
    expect((await db.q(`select storage_bytes from public.accounts where id = $1`, [bob])).rows[0]!.storage_bytes).toBe("1000");
  });
  it("create_upload_draft enforces the storage quota", async () => {
    await db.q(`update public.accounts set storage_bytes = 2147483000 where id = $1`, [bob]);
    expect(await rejection(db.as(user(bob), `select * from public.create_upload_draft('loop', 'x', 1000, 'wav')`))).toMatch(/^quota_exceeded:/);
    await db.q(`update public.accounts set storage_bytes = 1000 where id = $1`, [bob]);
  });
  it("suspended users cannot upload or publish", async () => {
    const sus = await db.makeUser("suspended1");
    await db.q(`update public.accounts set suspended_at = now() where id = $1`, [sus]);
    expect(await rejection(db.as(user(sus), `select * from public.create_upload_draft('loop', 'x', 10, 'wav')`))).toMatch(/^forbidden:/);
  });
  it("stores the file type from the extension, not from the browser", async () => {
    const r = await db.as(user(bob), `select * from public.create_upload_draft('loop', 'Typed', 10, 'mp3')`);
    expect((await db.q(`select mime from public.item_files where id = $1`, [r.rows[0]!.file_id])).rows[0]!.mime).toBe("audio/mpeg");
  });
  it("enqueue_processing (service role, after measuring the object) moves the owner's draft to processing", async () => {
    const r = await db.as(user(bob), `select * from public.create_upload_draft('loop', 'Queue me', 10, 'wav')`);
    const { item_id, file_id } = r.rows[0]!;
    const enqueue = `select public.enqueue_processing($1, $2, $3, $4) as id`;
    expect(await rejection(db.as(user(bob), enqueue, [bob, item_id, file_id, 10]))).toMatch(DENIED);
    expect(await rejection(db.as(service, enqueue, [alice, item_id, file_id, 10]))).toMatch(/^not_found:/);
    expect(await rejection(db.as(service, enqueue, [bob, item_id, file_id, 11]))).toMatch(/^invalid: The uploaded file is not the size/);
    const job = await db.as(service, enqueue, [bob, item_id, file_id, 10]);
    expect(job.rows[0]!.id).toBeTruthy();
    const s = await db.q(`select i.status, j.kind from public.items i join public.processing_jobs j on j.item_id = i.id where i.id = $1`, [item_id]);
    expect(s.rows[0]).toEqual({ status: "processing", kind: "process_loop" });
    expect(await rejection(db.as(service, enqueue, [bob, item_id, file_id, 10]))).toMatch(/^conflict:/);
  });
  it("a preset waits for its demo before processing", async () => {
    const r = await db.as(user(bob), `select * from public.create_upload_draft('preset', 'Glass pad', 10, 'vital')`);
    const { item_id, file_id } = r.rows[0]!;
    const first = await db.as(service, `select public.enqueue_processing($1, $2, $3, 10) as id`, [bob, item_id, file_id]);
    expect(first.rows[0]!.id).toBeNull();
    const demo = await db.as(user(bob), `select * from public.add_demo_file($1, 10, 'wav')`, [item_id]);
    const second = await db.as(service, `select public.enqueue_processing($1, $2, $3, 10) as id`, [bob, item_id, demo.rows[0]!.file_id]);
    expect(second.rows[0]!.id).toBeTruthy();
  });
  it("a replaced demo keeps one storage key whatever its extension", async () => {
    const r = await db.as(user(bob), `select * from public.create_upload_draft('preset', 'Swap pad', 10, 'vital')`);
    const { item_id } = r.rows[0]!;
    const wav = await db.as(user(bob), `select * from public.add_demo_file($1, 10, 'wav')`, [item_id]);
    const mp3 = await db.as(user(bob), `select * from public.add_demo_file($1, 10, 'mp3')`, [item_id]);
    expect(mp3.rows[0]!.path).toBe(wav.rows[0]!.path);
    expect(mp3.rows[0]!.path).toMatch(/\/demo$/);
    const rows = await db.q(`select mime from public.item_files where item_id = $1 and role = 'demo'`, [item_id]);
    expect(rows.rows).toEqual([{ mime: "audio/mpeg" }]);
  });
  it("a file can be claimed for completion once, never after it is confirmed or the item has moved on", async () => {
    const r = await db.as(user(bob), `select * from public.create_upload_draft('loop', 'Claimed loop', 10, 'wav')`);
    const { item_id, file_id } = r.rows[0]!;
    const claim = `select public.claim_file_completion($1, $2, $3, gen_random_uuid()) as ok`;
    expect(await rejection(db.as(user(bob), claim, [bob, item_id, file_id]))).toMatch(/permission denied for function/);
    expect((await db.as(service, claim, [bob, item_id, file_id])).rows[0]!.ok).toBe(true);
    expect((await db.as(service, claim, [bob, item_id, file_id])).rows[0]!.ok).toBe(false);
    expect(await rejection(db.as(service, claim, [alice, item_id, file_id]))).toMatch(/^not_found:/);
    const token = (await db.q(`select meta ->> 'completing' as t from public.item_files where id = $1`, [file_id])).rows[0]!.t;
    await db.as(service, `select public.release_file_completion($1, $2)`, [file_id, token]);
    expect((await db.as(service, claim, [bob, item_id, file_id])).rows[0]!.ok).toBe(true);
    await db.as(service, `select public.enqueue_processing($1, $2, $3, 10)`, [bob, item_id, file_id]);
    const meta = (await db.q(`select meta from public.item_files where id = $1`, [file_id])).rows[0]!.meta;
    expect(meta).not.toHaveProperty("completing");
    expect(await rejection(db.as(service, claim, [bob, item_id, file_id]))).toMatch(/^conflict:/);
  });
  it("a preset's confirmed original cannot be claimed again while it waits for its demo", async () => {
    const r = await db.as(user(bob), `select * from public.create_upload_draft('preset', 'Claimed pad', 10, 'vital')`);
    const { item_id, file_id } = r.rows[0]!;
    await db.as(service, `select public.enqueue_processing($1, $2, $3, 10)`, [bob, item_id, file_id]);
    const again = await db.as(service, `select public.claim_file_completion($1, $2, $3, gen_random_uuid()) as ok`, [bob, item_id, file_id]);
    expect(again.rows[0]!.ok).toBe(false);
  });
  it("enqueue_processing answers conflict before anything that would make the caller clean up", async () => {
    const sus = await db.makeUser("suspended_late");
    const r = await db.as(user(sus), `select * from public.create_upload_draft('loop', 'Late loop', 10, 'wav')`);
    const { item_id, file_id } = r.rows[0]!;
    await db.as(service, `select public.enqueue_processing($1, $2, $3, 10)`, [sus, item_id, file_id]);
    await db.q(`update public.accounts set suspended_at = now() where id = $1`, [sus]);
    expect(await rejection(db.as(service, `select public.enqueue_processing($1, $2, $3, 99)`, [sus, item_id, file_id]))).toMatch(/^conflict:/);
  });
  it("a suspended account cannot attach a demo or have its upload queued", async () => {
    const sus = await db.makeUser("suspended_uploader");
    const r = await db.as(user(sus), `select * from public.create_upload_draft('preset', 'Late pad', 10, 'vital')`);
    const { item_id, file_id } = r.rows[0]!;
    await db.q(`update public.accounts set suspended_at = now() where id = $1`, [sus]);
    expect(await rejection(db.as(user(sus), `select * from public.add_demo_file($1, 10, 'wav')`, [item_id]))).toMatch(/^forbidden:/);
    expect(await rejection(db.as(service, `select public.enqueue_processing($1, $2, $3, 10)`, [sus, item_id, file_id]))).toMatch(/^forbidden:/);
    const s = await db.q(`select status from public.items where id = $1`, [item_id]);
    expect(s.rows[0]!.status).toBe("draft");
  });
});

describe("worker functions", () => {
  async function queuedItem(title: string, type = "loop", ext = "wav") {
    const r = await db.as(user(bob), `select * from public.create_upload_draft($1, $2, 10, $3)`, [type, title, ext]);
    const { item_id, file_id } = r.rows[0]!;
    if (type === "preset") await db.as(user(bob), `select * from public.add_demo_file($1, 10, 'wav')`, [item_id]);
    await db.as(service, `update public.item_files set uploaded_at = now() where item_id = $1`, [item_id]);
    await db.as(service, `select public.enqueue_processing($1, $2, $3, 10)`, [bob, item_id, file_id]);
    return r.rows[0]! as { item_id: string; path: string };
  }
  const loopResult = (itemId: string, extra: Record<string, unknown> = {}) => ({
    type: "loop",
    bpm: 140,
    key: { root: 9, mode: "minor" },
    durationMs: 6857,
    details: { sampleRate: 44100, channels: 2, loudnessLufs: -14, truePeakDb: -1, loopSamples: 302400, bars: 4,
      detection: { bpmSource: "onset", bpmAgreed: true, bpmCandidates: [140], keySource: "chroma", keyConfidence: 0.3 } },
    files: [
      { role: "preview", bucket: "previews", path: `${itemId}/abc.mp3`, bytes: 120000, mime: "audio/mpeg", sha256: null, meta: {} },
      { role: "peaks", bucket: "previews", path: `${itemId}/abc.peaks`, bytes: 800, mime: "application/octet-stream", sha256: null, meta: {} },
    ],
    fingerprints: [],
    flag: null,
    ...extra,
  });

  it("claim_job gives each job to one worker", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    await queuedItem("Claim a");
    await queuedItem("Claim b");
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => db.as(service, `select * from public.claim_job()`)));
    const ids = [a!, b!, c!].flatMap((r) => r.rows.map((x) => x.id));
    expect(new Set(ids).size).toBe(2);
    expect(ids).toHaveLength(2);
  });

  it("worker_complete applies a result in one go, once", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const it1 = await queuedItem("Complete me");
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    const result = loopResult(it1.item_id, { fingerprints: [{ filePath: it1.path, durationMs: 6857, chromaprint: [1, 2, 3] }] });
    await db.as(service, `select public.worker_complete($1, $3, $2)`, [job.id, JSON.stringify(result), job.attempts]);
    // A second delivery of the same result finds the job done and changes nothing.
    expect(await rejection(db.as(service, `select public.worker_complete($1, $3, $2)`, [job.id, JSON.stringify(result), job.attempts]))).toMatch(/^conflict:/);
    const item = await db.q(`select status, bpm, key_root, details->>'bars' as bars from public.items where id = $1`, [it1.item_id]);
    expect(item.rows[0]).toEqual({ status: "ready", bpm: "140.00", key_root: 9, bars: "4" });
    expect((await db.q(`select count(*)::int as n from public.item_files where item_id = $1`, [it1.item_id])).rows[0]!.n).toBe(3);
    expect((await db.q(`select count(*)::int as n from public.fingerprints where item_id = $1`, [it1.item_id])).rows[0]!.n).toBe(1);
    expect((await db.q(`select status from public.processing_jobs where id = $1`, [job.id])).rows[0]!.status).toBe("done");

    expect((await db.q(`select details is not null as has from public.items where id = $1`, [it1.item_id])).rows[0]!.has).toBe(true);
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

  it("worker_complete refuses a job that is not running, a result of another type and paths outside the item", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const it4 = await queuedItem("Guarded");
    const queued = (await db.q(`select id from public.processing_jobs where item_id = $1`, [it4.item_id])).rows[0]!;
    expect(await rejection(db.as(service, `select public.worker_complete($1, $3, $2)`, [queued.id, JSON.stringify(loopResult(it4.item_id)), 0]))).toMatch(/^conflict: This job is not running/);
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    const complete = (r: unknown) => rejection(db.as(service, `select public.worker_complete($1, $3, $2)`, [job.id, JSON.stringify(r), job.attempts]));
    expect(await complete({ ...loopResult(it4.item_id), type: "oneshot" })).toMatch(/^invalid: The result is for a different item type/);
    const badPaths = [
      { role: "preview", bucket: "previews", path: `${published}/x.mp3` },
      { role: "preview", bucket: "previews", path: `${it4.item_id}/../${published}/x.mp3` },
      { role: "preview", bucket: "previews", path: `${it4.item_id}//x.mp3` },
      { role: "original", bucket: "originals", path: `${alice}/${it4.item_id}/x.wav` },
      { role: "preview", bucket: "originals", path: `${bob}/${it4.item_id}/x.mp3` },
    ];
    for (const f of badPaths) {
      const file = { bytes: 1, mime: "audio/mpeg", sha256: null, meta: {}, ...f };
      expect(await complete(loopResult(it4.item_id, { files: [file] })), f.path).toMatch(/^invalid: A file path is outside/);
    }
    expect((await db.q(`select status from public.items where id = $1`, [it4.item_id])).rows[0]!.status).toBe("processing");
  });

  it("worker_complete refuses a result for an item that is no longer processing", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const it5 = await queuedItem("Removed mid-run");
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    await db.as(user(bob), `select public.remove_item($1)`, [it5.item_id]);
    expect(await rejection(db.as(service, `select public.worker_complete($1, $3, $2)`, [job.id, JSON.stringify(loopResult(it5.item_id)), job.attempts]))).toMatch(/^conflict: This item is not processing/);
  });

  it("a preset publishes only with the wavetable confirmation", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const pr = await queuedItem("Glass keys", "preset", "vital");
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    const preset = {
      type: "preset", bpm: null, key: null, durationMs: 8000, files: [], fingerprints: [], flag: null,
      details: { synth: "vital", synthName: "Vital", synthVersion: null, category: "keys", rendered: false, sampledNoteCount: 0, demoDurationMs: 8000 },
    };
    await db.as(service, `select public.worker_complete($1, $3, $2)`, [job.id, JSON.stringify(preset), job.attempts]);
    expect(await rejection(db.as(user(bob), `select public.publish_item($1, true)`, [pr.item_id]))).toMatch(/^invalid: Confirm any wavetables/);
    await db.as(user(bob), `select public.publish_item($1, true, true)`, [pr.item_id]);
    const r = await db.q(`select status, wavetables_confirmed_at is not null as confirmed from public.items where id = $1`, [pr.item_id]);
    expect(r.rows[0]).toEqual({ status: "published", confirmed: true });
  });

  it("a flag in the result makes the item flagged and tells the owner", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const it2 = await queuedItem("Stolen");
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    await db.as(service, `select public.worker_complete($1, $3, $2)`, [
      job.id,
      JSON.stringify({ ...loopResult(it2.item_id), files: [], flag: { reason: "duplicate_exact" } }),
      job.attempts,
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
      const r = await db.as(service, `select (j).status, extract(epoch from (j).run_after - now())::int as wait from (select public.worker_fail($1, $2, 'timeout', true) j) s`, [job.id, job.attempts]);
      if (attempt < 3) backoffs.push(r.rows[0]!.wait);
      else expect(r.rows[0]!.status).toBe("failed");
    }
    expect(backoffs).toEqual([30, 120]);
    expect((await db.q(`select status, flagged_reason from public.items where id = $1`, [it3.item_id])).rows[0]).toEqual({ status: "draft", flagged_reason: "timeout" });
  });

  it("worker_job_input gives the running attempt its item and uploaded files", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const r = await db.as(user(bob), `select * from public.create_upload_draft('loop', 'Named', 10, 'wav', ' Dark Keys 140bpm Am.wav ')`);
    const { item_id, file_id } = r.rows[0]!;
    await db.as(service, `select public.enqueue_processing($1, $2, $3, 10)`, [bob, item_id, file_id]);
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    const input = (await db.as(service, `select public.worker_job_input($1, $2) as i`, [job.id, job.attempts])).rows[0]!.i;
    expect(input).toMatchObject({ jobId: job.id, attempt: 1, itemId: item_id, ownerId: bob, type: "loop", title: "Named" });
    expect(input.files).toEqual([
      { id: file_id, role: "original", bucket: "originals", path: r.rows[0]!.path, bytes: 10, mime: "audio/wav", fileName: "Dark Keys 140bpm Am.wav" },
    ]);
    expect(await rejection(db.as(service, `select public.worker_job_input($1, 2)`, [job.id]))).toMatch(/^conflict:/);
    expect(await rejection(db.as(user(bob), `select public.worker_job_input($1, 1)`, [job.id]))).toMatch(DENIED);
  });

  it("a stalled worker cannot finish or fail a run another worker has taken over", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    const it6 = await queuedItem("Stalled");
    const first = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    await db.q(`update public.processing_jobs set locked_at = now() - interval '1 hour' where id = $1`, [first.id]);
    await db.as(service, `select public.requeue_stale_jobs('10 minutes')`);
    const second = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    expect(second.attempts).toBe(first.attempts + 1);
    expect(await rejection(db.as(service, `select public.worker_fail($1, $2, 'timeout', true)`, [first.id, first.attempts]))).toMatch(/^conflict:/);
    expect(await rejection(db.as(service, `select public.worker_complete($1, $2, $3)`, [first.id, first.attempts, JSON.stringify(loopResult(it6.item_id))]))).toMatch(/^conflict:/);
    await db.as(service, `select public.worker_complete($1, $2, $3)`, [second.id, second.attempts, JSON.stringify(loopResult(it6.item_id))]);
    expect((await db.q(`select status from public.items where id = $1`, [it6.item_id])).rows[0]!.status).toBe("ready");
  });

  it("a corrupt file fails once with no retry", async () => {
    await db.as(service, `delete from public.processing_jobs`);
    await queuedItem("Corrupt");
    const job = (await db.as(service, `select * from public.claim_job()`)).rows[0]!;
    const r = await db.as(service, `select (public.worker_fail($1, $2, 'corrupt_file', false)).status`, [job.id, job.attempts]);
    expect(r.rows[0]!.status).toBe("failed");
  });
});

describe("rate limits", () => {
  it("hit_rate_limit (service role) fails past the limit within a window", async () => {
    for (let i = 0; i < 3; i++) await db.as(service, `select public.hit_rate_limit('test:addr', 3, '1 hour')`);
    expect(await rejection(db.as(service, `select public.hit_rate_limit('test:addr', 3, '1 hour')`))).toMatch(/^rate_limited:/);
  });

  /** Fills the caller's current window for one action up to its limit, as if they had used it all. */
  async function exhaust(action: string, uid: string, limitKey: string, window: string) {
    await db.q(
      `insert into public.rate_limit_hits (bucket, window_start, hits)
       values ($1 || ':' || $2,
               to_timestamp(floor(extract(epoch from now()) / extract(epoch from $4::interval)) * extract(epoch from $4::interval)),
               (public.app_limits() -> 'rateLimits' ->> $3)::int)
       on conflict (bucket, window_start) do update set hits = excluded.hits`,
      [action, uid, limitKey, window],
    );
  }

  it("direct likes, follows and reports are limited in the database", async () => {
    const fay = await db.makeUser("fay");
    const target = await db.makeItem(alice, { title: "Limit me" });
    await exhaust("like", fay, "likesPerHour", "1 hour");
    await exhaust("follow", fay, "followsPerHour", "1 hour");
    await exhaust("report", fay, "reportsPerDay", "1 day");
    expect(await rejection(db.as(user(fay), `insert into public.likes (user_id, item_id) values ($1, $2)`, [fay, target]))).toMatch(/^rate_limited:/);
    expect(await rejection(db.as(user(fay), `insert into public.follows (follower_id, followee_id) values ($1, $2)`, [fay, alice]))).toMatch(/^rate_limited:/);
    expect(await rejection(db.as(user(fay), `insert into public.reports (item_id, reason) values ($1, 'spam')`, [target]))).toMatch(/^rate_limited:/);
    // Another user is unaffected, and the service role is never limited.
    await db.as(user(bob), `insert into public.likes (user_id, item_id) values ($1, $2)`, [bob, target]);
    await db.as(service, `insert into public.likes (user_id, item_id) values ($1, $2)`, [fay, target]);
  });

  it("downloads are limited per day", async () => {
    const gus = await db.makeUser("gus");
    await db.as(user(gus), `select * from public.record_download($1)`, [published]);
    await exhaust("download", gus, "downloadsPerDay", "1 day");
    expect(await rejection(db.as(user(gus), `select * from public.record_download($1)`, [published]))).toMatch(/^rate_limited:/);
  });

  it("signed-in users cannot reset their own counters", async () => {
    expect(await rejection(db.as(user(bob), `delete from public.rate_limit_hits`))).toMatch(DENIED);
  });
});

describe("profile constraints", () => {
  it("links must be https and at most eight", async () => {
    const set = (links: unknown) => db.as(user(bob), `update public.profiles set links = $2 where id = $1`, [bob, JSON.stringify(links)]);
    await set([{ kind: "instagram", url: "https://instagram.com/bob" }]);
    for (const bad of [
      [{ kind: "website", url: "javascript:alert(1)" }],
      [{ kind: "website", url: "http://example.com" }],
      [{ kind: "website", url: "https:// spaced.example" }],
      ["https://not-an-object.example"],
      Array.from({ length: 9 }, () => ({ kind: "website", url: "https://x.example" })),
    ]) {
      expect(await rejection(set(bad)), JSON.stringify(bad)).toMatch(/check constraint/);
    }
  });
  it("avatars live under the owner's own folder", async () => {
    await db.as(user(bob), `update public.profiles set avatar_path = $2 where id = $1`, [bob, `${bob}/avatar.webp`]);
    for (const bad of [`${alice}/avatar.webp`, `${bob}/../${alice}/avatar.webp`, "avatar.webp"]) {
      expect(await rejection(db.as(user(bob), `update public.profiles set avatar_path = $2 where id = $1`, [bob, bad])), bad).toMatch(/check constraint/);
    }
  });
  it("claiming a handle twice changes it and keeps one account", async () => {
    const hal = await db.makeUser("hal_one");
    await db.as(user(hal), `select public.claim_handle('hal_two')`);
    const r = await db.q(`select p.handle, (select count(*)::int from public.accounts a where a.id = p.id) as accounts from public.profiles p where p.id = $1`, [hal]);
    expect(r.rows[0]).toEqual({ handle: "hal_two", accounts: 1 });
  });
});

describe("slugify", () => {
  it("gives the same slug in the database and in packages/contracts", async () => {
    const titles = [
      "Dark Keys (Am) 140 BPM!!", "Café Noir", "Straße 808", "Ærøskøbing Øresund", "Łódź drill", "Þórr",
      "Œuvre", "naïve façade", "Ñoño", "ＦＵＬＬＷＩＤＴＨ", "ﬁre ﬂute", "emoji 🔥 loop", "東京 lofi", "  --  ",
      "a".repeat(70) + " tail", "İstanbul", "Mötley Crüe", "Đorđe", "---x---", "",
    ];
    const r = await db.q<{ s: string[] }>(`select array(select public.slugify(t) from unnest($1::text[]) with ordinality u(t, n) order by n) as s`, [titles]);
    expect(r.rows[0]!.s).toEqual(titles.map(slugify));
  });
});

describe("access audit", () => {
  it("every table in public has row-level security on", async () => {
    const r = await db.q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
    expect(r.rows).toEqual([]);
  });

  it("anon and authenticated hold only the table privileges the access table allows", async () => {
    const r = await db.as(superuser, `
      select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
        from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')
       group by grantee, table_name order by grantee, table_name`);
    const actual = Object.fromEntries(r.rows.map((x) => [`${x.grantee}.${x.table_name}`, x.privs]));
    const read = ["profiles", "items", "item_files", "tags", "item_tags", "follows", "likes"];
    const expected: Record<string, string> = {};
    for (const role of ["anon", "authenticated"]) for (const t of read) expected[`${role}.${t}`] = "SELECT";
    for (const t of ["accounts", "downloads", "notifications", "dmca_notices", "processing_jobs", "admin_actions", "admin_review_queue", "fingerprints"]) {
      expected[`authenticated.${t}`] = "SELECT";
    }
    expected["authenticated.follows"] = "DELETE,SELECT";
    expected["authenticated.likes"] = "DELETE,SELECT";
    // Column-level grants (profiles, items, notifications updates; reports insert; kit_samples read) are
    // not table-level, so they do not appear here; reports keeps its table-level SELECT for admins.
    expected["authenticated.reports"] = "SELECT";
    expect(actual).toEqual(expected);
  });

  it("column grants are exactly the editable fields", async () => {
    const r = await db.as(superuser, `
      select grantee || '.' || table_name || '.' || privilege_type as k, string_agg(column_name, ',' order by column_name) as cols
        from information_schema.column_privileges
       where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
       group by grantee, table_name, privilege_type order by 1`);
    expect(Object.fromEntries(r.rows.map((x) => [x.k, x.cols]))).toEqual({
      "authenticated.follows.INSERT": "followee_id,follower_id",
      "authenticated.items.UPDATE": "bpm,description,genre,key_mode,key_root,license,split_percent,title",
      "authenticated.likes.INSERT": "item_id,user_id",
      "authenticated.notifications.UPDATE": "read_at",
      "authenticated.profiles.UPDATE": "avatar_path,bio,display_name,links",
      "authenticated.reports.INSERT": "detail,item_id,reason",
    });
  });

  it("anon and authenticated may execute only the functions meant for them", async () => {
    const r = await db.as(superuser, `
      select p.proname, array_remove(array[
               case when has_function_privilege('anon', p.oid, 'execute') then 'anon' end,
               case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated' end], null) as who
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
       order by 1`);
    const both = ["anon", "authenticated"];
    const signedIn = ["authenticated"];
    expect(Object.fromEntries(r.rows.map((x) => [x.proname, x.who]))).toEqual({
      add_demo_file: signedIn,
      app_limits: both,
      can_read_item: both,
      claim_handle: signedIn,
      create_upload_draft: signedIn,
      is_active_user: both,
      is_admin: both,
      publish_item: signedIn,
      record_download: signedIn,
      remove_item: signedIn,
      safe_path: both,
      set_item_tags: signedIn,
      slugify: both,
      unpublish_item: signedIn,
      valid_profile_links: both,
    });
  });
});

describe("seed", () => {
  it("supabase/seed.sql applies cleanly on top of the migrations", async () => {
    const seeded = await TestDb.create();
    try {
      await seeded.q(readFileSync(join(import.meta.dirname, "../seed.sql"), "utf8"));
      const r = await seeded.as(anon, `select count(*)::int as n from public.items`);
      expect(r.rows[0]!.n).toBe(4);
    } finally {
      await seeded.drop();
    }
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
