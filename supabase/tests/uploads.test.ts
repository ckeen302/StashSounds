/**
 * Ticket 102: what createUploadSlot and completeUpload rely on in the database, beyond the
 * upload-function tests in policies.test.ts: add_demo_file's rules, the reads completeUpload makes
 * as the caller, the upload id it stores with the service role, and preset ordering.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, rejection, service, user } from "./db.ts";

let db: TestDb;
let ana: string; // uploader
let ben: string; // someone else

const DENIED = /permission denied|row-level security|violates row-level/;

beforeAll(async () => {
  db = await TestDb.create();
  ana = await db.makeUser("ana");
  ben = await db.makeUser("ben");
});

afterAll(async () => {
  await db?.drop();
});

async function draft(owner: string, type = "loop", ext = "wav", bytes = 100) {
  const r = await db.as(user(owner), `select * from public.create_upload_draft($1, 'Upload', $2, $3, 'Upload.' || $3)`, [type, bytes, ext]);
  return r.rows[0]! as { item_id: string; file_id: string; path: string };
}

const storageBytes = async (id: string) => Number((await db.q(`select storage_bytes from public.accounts where id = $1`, [id])).rows[0]!.storage_bytes);
const enqueue = (owner: string, item: string, file: string, bytes: number) =>
  db.as(service, `select public.enqueue_processing($1, $2, $3, $4) as id`, [owner, item, file, bytes]);

describe("add_demo_file", () => {
  it("attaches a demo to the caller's own preset draft, under the owner's folder, typed by extension", async () => {
    const p = await draft(ana, "preset", "vital");
    const r = await db.as(user(ana), `select * from public.add_demo_file($1, 200, 'MP3', 'Pad demo.mp3')`, [p.item_id]);
    expect(r.rows[0]!.path).toBe(`${ana}/${p.item_id}/demo`);
    const f = await db.q(`select role, bucket, mime, bytes, meta from public.item_files where id = $1`, [r.rows[0]!.file_id]);
    expect(f.rows[0]).toEqual({ role: "demo", bucket: "originals", mime: "audio/mpeg", bytes: "200", meta: { fileName: "Pad demo.mp3" } });
  });

  it("another user's item is not_found; a non-preset is invalid; an unsupported demo type is invalid", async () => {
    const p = await draft(ana, "preset", "vital");
    const loop = await draft(ana);
    expect(await rejection(db.as(user(ben), `select * from public.add_demo_file($1, 10, 'wav')`, [p.item_id]))).toMatch(/^not_found:/);
    expect(await rejection(db.as(user(ana), `select * from public.add_demo_file($1, 10, 'wav')`, [loop.item_id]))).toMatch(/^invalid: Only presets/);
    expect(await rejection(db.as(user(ana), `select * from public.add_demo_file($1, 10, 'exe')`, [p.item_id]))).toMatch(/^invalid:/);
    expect(await rejection(db.as(user(ana), `select * from public.add_demo_file($1, 0, 'wav')`, [p.item_id]))).toMatch(/^invalid:/);
  });

  it("a second demo replaces the first, and storage counts only the current one", async () => {
    const p = await draft(ana, "preset", "vital", 10);
    const before = await storageBytes(ana);
    await db.as(user(ana), `select * from public.add_demo_file($1, 300, 'wav')`, [p.item_id]);
    await db.as(user(ana), `select * from public.add_demo_file($1, 500, 'flac')`, [p.item_id]);
    const demos = await db.q(`select path, bytes from public.item_files where item_id = $1 and role = 'demo'`, [p.item_id]);
    expect(demos.rows).toEqual([{ path: `${ana}/${p.item_id}/demo`, bytes: "500" }]);
    expect(await storageBytes(ana)).toBe(before + 500);
  });

  it("refuses once the item is processing", async () => {
    const p = await draft(ana, "preset", "vital", 10);
    const d = await db.as(user(ana), `select * from public.add_demo_file($1, 10, 'wav')`, [p.item_id]);
    await enqueue(ana, p.item_id, p.file_id, 10);
    await enqueue(ana, p.item_id, d.rows[0]!.file_id, 10);
    expect(await rejection(db.as(user(ana), `select * from public.add_demo_file($1, 10, 'wav')`, [p.item_id]))).toMatch(/^conflict:/);
  });
});

describe("completeUpload's reads as the caller", () => {
  it("the owner reads their draft and its original file row, including meta", async () => {
    const d = await draft(ana);
    const item = await db.as(user(ana), `select id, type from public.items where id = $1 and owner_id = $2`, [d.item_id, ana]);
    expect(item.rows).toEqual([{ id: d.item_id, type: "loop" }]);
    const file = await db.as(
      user(ana),
      `select id, role, path, bytes, meta, uploaded_at from public.item_files where id = $1 and item_id = $2 and bucket = 'originals'`,
      [d.file_id, d.item_id],
    );
    expect(file.rows[0]).toMatchObject({ id: d.file_id, role: "original", path: d.path, bytes: "100", uploaded_at: null });
  });

  it("someone else sees neither the draft nor its file row", async () => {
    const d = await draft(ana);
    expect((await db.as(user(ben), `select id from public.items where id = $1`, [d.item_id])).rows).toEqual([]);
    expect((await db.as(user(ben), `select id from public.item_files where id = $1`, [d.file_id])).rows).toEqual([]);
  });
});

describe("the multipart upload id on the file row", () => {
  it("the service role can store it; the owner can read it but not write it", async () => {
    const d = await draft(ana, "kit", "zip");
    await db.as(service, `update public.item_files set meta = meta || '{"uploadId":"up-1"}' where id = $1`, [d.file_id]);
    const r = await db.as(user(ana), `select meta from public.item_files where id = $1`, [d.file_id]);
    expect(r.rows[0]!.meta).toEqual({ fileName: "Upload.zip", uploadId: "up-1" });
    expect(await rejection(db.as(user(ana), `update public.item_files set meta = '{}' where id = $1`, [d.file_id]))).toMatch(DENIED);
  });
});

describe("enqueue_processing", () => {
  it("is not callable by a signed-in user, even for their own item", async () => {
    const d = await draft(ana);
    expect(await rejection(db.as(user(ana), `select public.enqueue_processing($1, $2, $3, 100)`, [ana, d.item_id, d.file_id]))).toMatch(DENIED);
  });

  it("a file from another item is not_found, and nothing is queued", async () => {
    const a = await draft(ana);
    const b = await draft(ana);
    expect(await rejection(enqueue(ana, a.item_id, b.file_id, 100))).toMatch(/^not_found:/);
    expect((await db.q(`select count(*)::int as n from public.processing_jobs where item_id = $1`, [a.item_id])).rows[0]!.n).toBe(0);
  });

  it("a size mismatch leaves the item in draft with nothing queued", async () => {
    const d = await draft(ana);
    expect(await rejection(enqueue(ana, d.item_id, d.file_id, 101))).toMatch(/^invalid:/);
    const s = await db.q(
      `select i.status, f.uploaded_at, (select count(*)::int from public.processing_jobs j where j.item_id = i.id) as jobs
         from public.items i join public.item_files f on f.item_id = i.id where i.id = $1`,
      [d.item_id],
    );
    expect(s.rows[0]).toEqual({ status: "draft", uploaded_at: null, jobs: 0 });
  });

  it("a preset demo confirmed first waits for the original, then one job is queued", async () => {
    const p = await draft(ana, "preset", "vital", 10);
    const demo = await db.as(user(ana), `select * from public.add_demo_file($1, 20, 'wav')`, [p.item_id]);
    expect((await enqueue(ana, p.item_id, demo.rows[0]!.file_id, 20)).rows[0]!.id).toBeNull();
    expect((await db.q(`select status from public.items where id = $1`, [p.item_id])).rows[0]!.status).toBe("draft");
    expect((await enqueue(ana, p.item_id, p.file_id, 10)).rows[0]!.id).toBeTruthy();
    const jobs = await db.q(`select kind from public.processing_jobs where item_id = $1`, [p.item_id]);
    expect(jobs.rows).toEqual([{ kind: "process_preset" }]);
  });

  it("each type queues its own job kind", async () => {
    for (const [type, ext] of [["oneshot", "wav"], ["kit", "zip"], ["midi", "mid"]] as const) {
      const d = await draft(ana, type, ext);
      await enqueue(ana, d.item_id, d.file_id, 100);
      expect((await db.q(`select kind from public.processing_jobs where item_id = $1`, [d.item_id])).rows[0]!.kind).toBe(`process_${type}`);
    }
  });
});
