/**
 * Ticket 103: what the item reads and lifecycle actions rely on in the database, run as the same
 * roles the server uses (anon, or the signed-in user; never the service role). The queries mirror
 * apps/web/src/server/items: getItemPage and loadRows, getOwnItem, updateItem, publishItem,
 * unpublishItem and deleteItem.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, anon, rejection, user, type Who } from "./db.ts";

let db: TestDb;
let ana: string; // owner
let ben: string; // someone else
let admin: string;

const DENIED = /permission denied|row-level security/;

beforeAll(async () => {
  db = await TestDb.create();
  ana = await db.makeUser("ana_items");
  ben = await db.makeUser("ben_items");
  admin = await db.makeUser("admin_items", { role: "admin" });
});

afterAll(async () => {
  await db?.drop();
});

/** A processed item with an original, a preview and a peaks file; a kit gets two samples. */
async function item(status: string, type = "loop") {
  const id = await db.makeItem(ana, { status, type, title: `Item ${status}` });
  const pid = (await db.q(`select public_id from public.items where id = $1`, [id])).rows[0]!.public_id as string;
  await db.q(
    `insert into public.item_files (item_id, role, bucket, path, bytes, mime, sha256, meta) values
       ($1, 'original', 'originals', $2, 10, 'audio/wav', repeat('a', 64), '{}'),
       ($1, 'preview',  'previews',  $3, 5, 'audio/mpeg', null, '{}'),
       ($1, 'peaks',    'previews',  $4, 800, 'application/octet-stream', null, '{"peaks":"x"}')`,
    [id, `${ana}/${id}/original.wav`, `${id}/preview.mp3`, `${id}/peaks.bin`],
  );
  if (type === "kit") {
    await db.q(
      `insert into public.kit_samples (item_id, position, name, category, duration_ms, original_path, preview_path) values
         ($1, 0, 'Kick', 'kick', 300, $2, $3),
         ($1, 1, 'Snare', 'snare', 300, $4, $5)`,
      [id, `${ana}/${id}/kick.wav`, `${id}/kick.mp3`, `${ana}/${id}/snare.wav`, `${id}/snare.mp3`],
    );
  }
  await db.q(`insert into public.processing_jobs (item_id, kind, status, attempts, error) values ($1, $2, 'done', 1, null)`, [id, `process_${type}`]);
  return { id, pid };
}

const pageItem = (who: Who, pid: string) =>
  db.as(who, `select id, status from public.items where public_id = $1 and status = 'published'`, [pid]);
const files = (who: Who, id: string, onlyPreviews = false) =>
  db.as(who, `select role, bucket from public.item_files where item_id = $1 ${onlyPreviews ? "and bucket = 'previews'" : ""} order by role`, [id]);

describe("item page and rows (anon and other users)", () => {
  it("a published item, its previews, samples, tags and owner are readable by anyone", async () => {
    const kit = await item("published", "kit");
    await db.as(user(ana), `select public.set_item_tags($1, array['dark'], array['metro boomin'])`, [kit.id]);
    for (const who of [anon, user(ben)]) {
      expect((await pageItem(who, kit.pid)).rows).toEqual([{ id: kit.id, status: "published" }]);
      expect((await files(who, kit.id, true)).rows.map((r) => r.role)).toEqual(["peaks", "preview"]);
      const s = await db.as(who, `select id, item_id, position, name, category, duration_ms, root_note, preview_path from public.kit_samples where item_id = $1 and position < 16 order by position`, [kit.id]);
      expect(s.rows.map((r) => r.name)).toEqual(["Kick", "Snare"]);
      const names = (await db.as(who, `select tag_names from public.items where id = $1`, [kit.id])).rows[0]!.tag_names as string[];
      const t = await db.as(who, `select name, kind from public.tags where name = any ($1) order by name`, [names]);
      expect(t.rows).toEqual([
        { name: "dark", kind: "tag" },
        { name: "metro boomin", kind: "reference" },
      ]);
      const p = await db.as(who, `select handle, followers_count from public.profiles where id = $1`, [ana]);
      expect(p.rows[0]!.handle).toBe("ana_items");
    }
  });

  it("originals (paths and hashes) are never readable by anon or another user, even without the bucket filter", async () => {
    const it1 = await item("published");
    for (const who of [anon, user(ben)]) expect((await files(who, it1.id)).rows.every((r) => r.bucket === "previews")).toBe(true);
    expect((await files(user(ana), it1.id)).rows.map((r) => r.bucket)).toContain("originals");
  });

  it("a kit sample's original path cannot be selected at all", async () => {
    const kit = await item("published", "kit");
    for (const who of [anon, user(ben), user(ana)]) {
      expect(await rejection(db.as(who, `select original_path from public.kit_samples where item_id = $1`, [kit.id]))).toMatch(DENIED);
    }
  });

  it("draft, ready, flagged and removed items have no page, and their files and samples are hidden from others", async () => {
    for (const status of ["draft", "ready", "flagged", "removed"]) {
      const it1 = await item(status, "kit");
      for (const who of [anon, user(ben)]) {
        expect((await pageItem(who, it1.pid)).rows, status).toEqual([]);
        expect((await db.as(who, `select 1 from public.items where id = $1`, [it1.id])).rows, status).toEqual([]);
        expect((await files(who, it1.id)).rows, status).toEqual([]);
        expect((await db.as(who, `select id from public.kit_samples where item_id = $1`, [it1.id])).rows, status).toEqual([]);
      }
    }
  });

  it("more from the owner: only their published items", async () => {
    const pub = await item("published");
    const draft = await item("draft");
    const r = await db.as(anon, `select id from public.items where owner_id = $1 and status = 'published' and id <> $2`, [ana, pub.id]);
    expect(r.rows.map((x) => x.id)).not.toContain(draft.id);
    expect(r.rows.map((x) => x.id)).not.toContain(pub.id);
  });

  it("the viewer's like and follow are readable; jobs are not, to anon or to another user", async () => {
    const it1 = await item("published");
    await db.as(user(ben), `insert into public.likes (user_id, item_id) values ($1, $2)`, [ben, it1.id]);
    await db.as(user(ben), `insert into public.follows (follower_id, followee_id) values ($1, $2)`, [ben, ana]);
    expect((await db.as(user(ben), `select item_id from public.likes where user_id = $1 and item_id = any ($2)`, [ben, [it1.id]])).rows).toEqual([{ item_id: it1.id }]);
    expect((await db.as(user(ben), `select 1 from public.follows where follower_id = $1 and followee_id = $2`, [ben, ana])).rowCount).toBe(1);
    expect(await rejection(db.as(anon, `select status from public.processing_jobs where item_id = $1`, [it1.id]))).toMatch(DENIED);
    expect((await db.as(user(ben), `select status from public.processing_jobs where item_id = $1`, [it1.id])).rows).toEqual([]);
  });
});

describe("getOwnItem (the owner's own view)", () => {
  it("the owner reads their draft, its originals and its latest job", async () => {
    const d = await item("processing");
    expect((await db.as(user(ana), `select status from public.items where id = $1 and owner_id = $2`, [d.id, ana])).rows).toEqual([{ status: "processing" }]);
    const job = await db.as(user(ana), `select status, attempts, error from public.processing_jobs where item_id = $1 order by created_at desc limit 1`, [d.id]);
    expect(job.rows).toEqual([{ status: "done", attempts: 1, error: null }]);
  });

  it("another user sees nothing of it; the owner filter keeps an admin's own call to their own items", async () => {
    const d = await item("draft");
    expect((await db.as(user(ben), `select 1 from public.items where id = $1`, [d.id])).rows).toEqual([]);
    // An admin can read any item by policy, so getOwnItem filters by owner_id as well.
    expect((await db.as(user(admin), `select 1 from public.items where id = $1`, [d.id])).rowCount).toBe(1);
    expect((await db.as(user(admin), `select 1 from public.items where id = $1 and owner_id = $2`, [d.id, admin])).rows).toEqual([]);
  });
});

describe("updateItem", () => {
  const update = (who: Who, id: string, set: string, params: unknown[] = []) =>
    db.as(who, `update public.items set ${set} where id = $1 and owner_id = $2 returning id`, [id, who.role === "authenticated" ? who.id : null, ...params]);

  it("the owner edits the granted columns in any live status", async () => {
    for (const status of ["draft", "ready", "published", "flagged"]) {
      const it1 = await item(status);
      const r = await update(user(ana), it1.id, `title = $3, description = $4, genre = $5, bpm = $6, key_root = 2, key_mode = 'major'`, ["New", "Desc", "trap", 141]);
      expect(r.rowCount, status).toBe(1);
    }
  });

  it("another user's item and a removed item match no row", async () => {
    const pub = await item("published");
    const gone = await item("removed");
    expect((await update(user(ben), pub.id, `title = 'Mine'`)).rowCount).toBe(0);
    expect((await db.as(user(ben), `update public.items set title = 'Mine' where id = $1 returning id`, [pub.id])).rowCount).toBe(0);
    expect((await update(user(ana), gone.id, `title = 'Back'`)).rowCount).toBe(0);
  });

  it("columns outside the grant are refused: status, slug, details, owner, counts, timestamps", async () => {
    const it1 = await item("ready");
    for (const set of [`status = 'published'`, `slug = 'x'`, `details = '{}'`, `owner_id = owner_id`, `likes_count = 99`, `published_at = now()`, `tag_names = '{}'`]) {
      expect(await rejection(update(user(ana), it1.id, set)), set).toMatch(DENIED);
    }
  });

  it("license and split must agree (the action checks first; the database enforces it)", async () => {
    const it1 = await item("ready");
    expect(await rejection(update(user(ana), it1.id, `license = 'split_on_placement'`))).toMatch(/check constraint/);
    expect((await update(user(ana), it1.id, `license = 'split_on_placement', split_percent = 25`)).rowCount).toBe(1);
    expect((await update(user(ana), it1.id, `license = 'royalty_free', split_percent = null`)).rowCount).toBe(1);
  });

  it("set_item_tags replaces both sets and records reference kinds, which the reads return", async () => {
    const it1 = await item("ready");
    const r = await db.as(user(ana), `select public.set_item_tags($1, array['dark', '808'], array['drake']) as t`, [it1.id]);
    expect(r.rows[0]!.t).toEqual(["808", "dark", "drake"]);
    const kinds = await db.as(user(ana), `select name, kind from public.tags where name = any ($1) order by name`, [r.rows[0]!.t]);
    expect(kinds.rows.find((k) => k.name === "drake")!.kind).toBe("reference");
    // Sending the references back unchanged with new tags keeps them.
    const again = await db.as(user(ana), `select public.set_item_tags($1, array['keys'], array['drake']) as t`, [it1.id]);
    expect(again.rows[0]!.t).toEqual(["drake", "keys"]);
    expect(await rejection(db.as(user(ben), `select public.set_item_tags($1, array['spam'])`, [it1.id]))).toMatch(/^not_found:/);
    const gone = await item("removed");
    expect(await rejection(db.as(user(ana), `select public.set_item_tags($1, array['back'])`, [gone.id]))).toMatch(/^not_found:/);
  });
});

describe("publishItem", () => {
  it("owner, ready, rights confirmed: published, with the fields the output needs", async () => {
    const it1 = await item("ready");
    const r = await db.as(user(ana), `select id, type, slug, public_id, published_at, status from public.publish_item($1, true, false)`, [it1.id]);
    expect(r.rows[0]).toMatchObject({ id: it1.id, type: "loop", public_id: it1.pid, status: "published" });
    expect(r.rows[0]!.published_at).toBeInstanceOf(Date);
    expect((await pageItem(anon, it1.pid)).rowCount).toBe(1);
  });

  it("wrong status: flagged, draft, processing, published and removed are conflicts", async () => {
    for (const status of ["flagged", "draft", "processing", "published", "removed"]) {
      const it1 = await item(status);
      expect(await rejection(db.as(user(ana), `select public.publish_item($1, true)`, [it1.id])), status).toMatch(/^conflict:/);
    }
  });

  it("no rights confirmation: invalid; another user: not_found; anon cannot call it", async () => {
    const it1 = await item("ready");
    expect(await rejection(db.as(user(ana), `select public.publish_item($1, false)`, [it1.id]))).toMatch(/^invalid:/);
    expect(await rejection(db.as(user(ben), `select public.publish_item($1, true)`, [it1.id]))).toMatch(/^not_found:/);
    expect(await rejection(db.as(anon, `select public.publish_item($1, true)`, [it1.id]))).toMatch(DENIED);
    expect((await db.q(`select status from public.items where id = $1`, [it1.id])).rows[0]!.status).toBe("ready");
  });
});

describe("unpublishItem", () => {
  it("owner, published: back to ready, and the page is gone", async () => {
    const it1 = await item("published");
    const r = await db.as(user(ana), `select status from public.unpublish_item($1)`, [it1.id]);
    expect(r.rows[0]!.status).toBe("ready");
    expect((await pageItem(anon, it1.pid)).rows).toEqual([]);
  });

  it("wrong status or another user: not_found", async () => {
    const ready = await item("ready");
    const pub = await item("published");
    expect(await rejection(db.as(user(ana), `select public.unpublish_item($1)`, [ready.id]))).toMatch(/^not_found:/);
    expect(await rejection(db.as(user(ben), `select public.unpublish_item($1)`, [pub.id]))).toMatch(/^not_found:/);
  });
});

describe("deleteItem", () => {
  it("owner: removed; it disappears for everyone else, files included, and can no longer be edited", async () => {
    const it1 = await item("published", "kit");
    const r = await db.as(user(ana), `select status from public.remove_item($1)`, [it1.id]);
    expect(r.rows[0]!.status).toBe("removed");
    expect((await pageItem(anon, it1.pid)).rows).toEqual([]);
    expect((await files(anon, it1.id)).rows).toEqual([]);
    expect((await db.as(anon, `select id from public.kit_samples where item_id = $1`, [it1.id])).rows).toEqual([]);
    expect((await db.as(user(ana), `update public.items set title = 'x' where id = $1 returning id`, [it1.id])).rowCount).toBe(0);
  });

  it("another user: not_found; the owner pre-check is what keeps an admin's deleteItem off other people's items", async () => {
    const it1 = await item("published");
    expect(await rejection(db.as(user(ben), `select public.remove_item($1)`, [it1.id]))).toMatch(/^not_found:/);
    // remove_item itself lets an admin remove anything (moderation); deleteItem reads with owner_id first.
    expect((await db.as(user(admin), `select 1 from public.items where id = $1 and owner_id = $2`, [it1.id, admin])).rows).toEqual([]);
  });
});
