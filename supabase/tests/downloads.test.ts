/**
 * Ticket 104: what requestDownload relies on in the database, beyond the record_download tests in
 * policies.test.ts. The record runs as the caller; only after it succeeds does the server read the
 * original's path with the service role, because the caller can never read it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, anon, rejection, service, user } from "./db.ts";

let db: TestDb;
let owner: string;
let fan: string;

const DENIED = /permission denied|row-level security/;

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.makeUser("dl_owner");
  fan = await db.makeUser("dl_fan");
});

afterAll(async () => {
  await db?.drop();
});

async function published(opts: { type?: string; license?: string; split?: number | null; status?: string } = {}) {
  const id = await db.makeItem(owner, { title: "Dark Keys", status: opts.status ?? "published", type: opts.type ?? "loop", license: opts.license, split: opts.split });
  const ext = opts.type === "kit" ? "zip" : "wav";
  await db.q(
    `insert into public.item_files (item_id, role, bucket, path, bytes, mime, uploaded_at) values ($1, 'original', 'originals', $2, 10, $3, now())`,
    [id, `${owner}/${id}/original.${ext}`, ext === "zip" ? "application/zip" : "audio/wav"],
  );
  return id;
}

async function sample(kit: string, position: number, ext = "aiff") {
  const r = await db.q<{ id: string }>(
    `insert into public.kit_samples (item_id, position, name, category, duration_ms, original_path, preview_path)
     values ($1, $2, 'Kick', 'kick', 300, $3, $4) returning id`,
    [kit, position, `${owner}/${kit}/samples/${position}.${ext}`, `${kit}/s${position}.mp3`],
  );
  return r.rows[0]!.id;
}

describe("record_download (as the caller)", () => {
  it("writes the license, its current version and the split, with the title and handle at download time", async () => {
    const id = await published({ license: "split_on_placement", split: 25 });
    const r = await db.as(user(fan), `select * from public.record_download($1)`, [id]);
    const version = (await db.q(`select public.app_limits() -> 'licenses' -> 'split_on_placement' ->> 'version' as v`)).rows[0]!.v;
    expect(r.rows[0]).toMatchObject({ user_id: fan, item_id: id, kit_sample_id: null, item_title: "Dark Keys", owner_handle: "dl_owner", license: "split_on_placement", license_version: version, split_percent: 25 });
    // The record is the license: it survives the item being removed.
    await db.as(user(owner), `select public.remove_item($1)`, [id]);
    expect((await db.as(user(fan), `select license from public.downloads where id = $1`, [r.rows[0]!.id])).rows).toEqual([{ license: "split_on_placement" }]);
  });

  it("a kit sample must belong to the kit; a sample on another item is not_found", async () => {
    const kit = await published({ type: "kit" });
    const other = await published({ type: "kit" });
    const s = await sample(kit, 0);
    const ok = await db.as(user(fan), `select kit_sample_id from public.record_download($1, $2)`, [kit, s]);
    expect(ok.rows[0]!.kit_sample_id).toBe(s);
    expect(await rejection(db.as(user(fan), `select public.record_download($1, $2)`, [other, s]))).toMatch(/^not_found: Sample/);
  });

  it("another user's draft, ready or removed item is not_found; the owner may download their own", async () => {
    for (const status of ["draft", "ready", "flagged"]) {
      const id = await published({ status });
      expect(await rejection(db.as(user(fan), `select public.record_download($1)`, [id])), status).toMatch(/^not_found:/);
      expect((await db.as(user(owner), `select license from public.record_download($1)`, [id])).rowCount, status).toBe(1);
    }
  });

  it("two downloads give two records and count twice; the owner's own downloads are recorded but not counted", async () => {
    const id = await published();
    const first = await db.as(user(fan), `select id from public.record_download($1)`, [id]);
    const second = await db.as(user(fan), `select id from public.record_download($1)`, [id]);
    expect(first.rows[0]!.id).not.toBe(second.rows[0]!.id);
    await db.as(user(owner), `select public.record_download($1)`, [id]);
    const records = await db.q(`select user_id from public.downloads where item_id = $1 order by created_at, user_id`, [id]);
    expect(records.rows.filter((r) => r.user_id === fan)).toHaveLength(2);
    expect(records.rows.filter((r) => r.user_id === owner)).toHaveLength(1);
    expect((await db.q(`select downloads_count::int as n from public.items where id = $1`, [id])).rows[0]!.n).toBe(2);
  });

  it("anon cannot call it; a suspended account is forbidden", async () => {
    const id = await published();
    expect(await rejection(db.as(anon, `select public.record_download($1)`, [id]))).toMatch(DENIED);
    const sus = await db.makeUser("dl_suspended");
    await db.q(`update public.accounts set suspended_at = now() where id = $1`, [sus]);
    expect(await rejection(db.as(user(sus), `select public.record_download($1)`, [id]))).toMatch(/^forbidden:/);
  });

  it("over limits.rateLimits.downloadsPerDay: rate_limited, and no record is written", async () => {
    const id = await published();
    const heavy = await db.makeUser("dl_heavy");
    await db.q(
      `insert into public.rate_limit_hits (bucket, window_start, hits)
       values ('download:' || $1, to_timestamp(floor(extract(epoch from now()) / 86400) * 86400),
               (public.app_limits() -> 'rateLimits' ->> 'downloadsPerDay')::int)`,
      [heavy],
    );
    expect(await rejection(db.as(user(heavy), `select public.record_download($1)`, [id]))).toMatch(/^rate_limited:/);
    expect((await db.q(`select count(*)::int as n from public.downloads where user_id = $1`, [heavy])).rows[0]!.n).toBe(0);
  });
});

describe("the original's path (service role, after the record)", () => {
  it("the downloader cannot read it; the service role reads exactly the approved item's original", async () => {
    const id = await published();
    expect((await db.as(user(fan), `select path from public.item_files where item_id = $1 and bucket = 'originals'`, [id])).rows).toEqual([]);
    const r = await db.as(service, `select path, mime, uploaded_at is not null as uploaded from public.item_files where item_id = $1 and role = 'original' and bucket = 'originals'`, [id]);
    expect(r.rows).toEqual([{ path: `${owner}/${id}/original.wav`, mime: "audio/wav", uploaded: true }]);
  });

  it("a kit sample's original path: never selectable by a user, read by the service role by id and kit", async () => {
    const kit = await published({ type: "kit" });
    const s = await sample(kit, 3);
    expect(await rejection(db.as(user(fan), `select original_path from public.kit_samples where id = $1`, [s]))).toMatch(DENIED);
    const r = await db.as(service, `select name, original_path from public.kit_samples where id = $1 and item_id = $2`, [s, kit]);
    expect(r.rows).toEqual([{ name: "Kick", original_path: `${owner}/${kit}/samples/3.aiff` }]);
  });

  it("mime_for_ext types a sample from its stored extension, and only the service role calls it", async () => {
    const r = await db.as(service, `select public.mime_for_ext('aiff') as a, public.mime_for_ext('WAV') as w, public.mime_for_ext('exe') as e`);
    expect(r.rows[0]).toEqual({ a: "audio/aiff", w: "audio/wav", e: "application/octet-stream" });
    expect(await rejection(db.as(user(fan), `select public.mime_for_ext('wav')`))).toMatch(DENIED);
  });
});
