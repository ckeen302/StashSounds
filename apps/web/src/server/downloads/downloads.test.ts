import { beforeEach, describe, expect, it, vi } from "vitest";
import { limits, requestDownloadOutput } from "@stash/contracts";
import type { ActionDeps } from "../action.ts";
import { IDS, TEST_ENV, fakeSupabase, member, pgError, type FakeOptions } from "../testing/fake-supabase.ts";
import { fakeStorage } from "../testing/fake-storage.ts";
import { contentDisposition, downloadFileName } from "./file-name.ts";
import { requestDownload } from "./request-download.ts";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
});

const ITEM = "a0000000-0000-4000-8000-000000000001";
const KIT = "a0000000-0000-4000-8000-000000000003";
const SAMPLE = "b0000000-0000-4000-8000-000000000001";
const DOWNLOAD = "d0000000-0000-4000-8000-000000000001";
const ORIGINAL = `${IDS.bob}/${ITEM}/original.wav`;
const KIT_ZIP = `${IDS.bob}/${KIT}/original.zip`;
const SAMPLE_PATH = `${IDS.bob}/${KIT}/samples/kick-01.aiff`;

type Rpc = NonNullable<FakeOptions["rpc"]>;

const record = (extra: Record<string, unknown> = {}) => ({
  id: DOWNLOAD,
  user_id: IDS.alice,
  item_id: ITEM,
  kit_sample_id: null,
  item_title: "Dark Keys",
  owner_handle: "bob",
  license: "split_on_placement",
  license_version: "1.0",
  split_percent: 25,
  created_at: "2026-11-23T23:00:00+00:00",
  ...extra,
});
const recordOk: Rpc = (fn, args) =>
  fn === "record_download"
    ? { data: record({ item_id: args.p_item_id, kit_sample_id: args.p_kit_sample_id, ...(args.p_item_id === KIT && { item_title: "Basement Kit", license: "royalty_free", split_percent: null }) }), error: null }
    : { data: null, error: pgError("42883", fn) };

function setup(opts: { rpc?: Rpc; user?: FakeOptions } = {}) {
  const base = opts.user ?? member();
  const fake = fakeSupabase({ ...base, rpc: opts.rpc ?? recordOk });
  const service = fakeSupabase({
    tables: {
      item_files: [
        { item_id: ITEM, role: "original", bucket: "originals", path: ORIGINAL, mime: "audio/wav", uploaded_at: "2026-11-23T20:00:00Z" },
        { item_id: ITEM, role: "preview", bucket: "previews", path: `${ITEM}/preview.mp3`, mime: "audio/mpeg", uploaded_at: null },
        { item_id: KIT, role: "original", bucket: "originals", path: KIT_ZIP, mime: "application/zip", uploaded_at: "2026-11-23T20:00:00Z" },
      ],
      kit_samples: [{ id: SAMPLE, item_id: KIT, name: "Kick 01", original_path: SAMPLE_PATH }],
    },
    rpc: (fn, args) => (fn === "mime_for_ext" ? { data: args.p_ext === "aiff" ? "audio/aiff" : "application/octet-stream", error: null } : { data: null, error: pgError("42883", fn) }),
  });
  const store = fakeStorage();
  const deps: ActionDeps = { supabase: async () => fake.client, service: () => service.client, storage: () => store.storage };
  return { fake, service, store, deps };
}

describe("requestDownload", () => {
  it("records the license as the caller, then signs the original for downloadTtlSeconds as an attachment of the row's type", async () => {
    const { fake, store, deps } = setup();
    const before = Date.now();
    const r = await requestDownload.run({ itemId: ITEM }, deps);
    if (!r.ok) throw new Error(r.message);
    expect(requestDownloadOutput.parse(r.data)).toEqual(r.data);
    expect(r.data).toMatchObject({ downloadId: DOWNLOAD, fileName: "Dark Keys.wav", license: "split_on_placement", licenseVersion: "1.0" });
    expect(fake.rpcCalls).toEqual([{ fn: "record_download", args: { p_item_id: ITEM, p_kit_sample_id: null } }]);
    expect(store.storage.presignGet).toHaveBeenCalledWith(ORIGINAL, { contentDisposition: contentDisposition("Dark Keys.wav"), contentType: "audio/wav" });
    // The record comes first: nothing is signed before the database has said yes.
    expect(fake.rpc.mock.invocationCallOrder[0]!).toBeLessThan(store.storage.presignGet.mock.invocationCallOrder[0]!);
    const expires = Date.parse(r.data.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + limits.urls.downloadTtlSeconds * 1000 - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + limits.urls.downloadTtlSeconds * 1000);
  });

  it("the original's path is looked up only for the item the database approved, in the originals bucket", async () => {
    const { service, deps } = setup();
    await requestDownload.run({ itemId: ITEM }, deps);
    const q = service.queries.find((x) => x.table === "item_files")!;
    expect(q.filters).toEqual([
      ["item_id", ITEM],
      ["role", "original"],
      ["bucket", "originals"],
    ]);
  });

  it("kit: the whole ZIP", async () => {
    const { store, deps } = setup();
    const r = await requestDownload.run({ itemId: KIT }, deps);
    expect(r).toMatchObject({ ok: true, data: { fileName: "Basement Kit.zip", license: "royalty_free" } });
    expect(store.storage.presignGet).toHaveBeenCalledWith(KIT_ZIP, { contentDisposition: contentDisposition("Basement Kit.zip"), contentType: "application/zip" });
  });

  it("kit: one sample by sampleId, typed by the database's own extension table", async () => {
    const { fake, service, store, deps } = setup();
    const r = await requestDownload.run({ itemId: KIT, sampleId: SAMPLE }, deps);
    expect(r).toMatchObject({ ok: true, data: { fileName: "Basement Kit - Kick 01.aiff" } });
    expect(fake.rpcCalls[0]).toEqual({ fn: "record_download", args: { p_item_id: KIT, p_kit_sample_id: SAMPLE } });
    expect(service.rpcCalls).toEqual([{ fn: "mime_for_ext", args: { p_ext: "aiff" } }]);
    expect(store.storage.presignGet).toHaveBeenCalledWith(SAMPLE_PATH, { contentDisposition: contentDisposition("Basement Kit - Kick 01.aiff"), contentType: "audio/aiff" });
    expect(service.queries.find((q) => q.table === "kit_samples")!.filters).toEqual([
      ["id", SAMPLE],
      ["item_id", KIT],
    ]);
  });

  it("a sample of another kit, or of a non-kit: not_found from the database, nothing signed", async () => {
    const { store, service, deps } = setup({ rpc: () => ({ data: null, error: pgError("P0001", "not_found: Sample not found.") }) });
    expect(await requestDownload.run({ itemId: ITEM, sampleId: SAMPLE }, deps)).toEqual({ ok: false, code: "not_found", message: "Sample not found." });
    expect(store.storage.presignGet).not.toHaveBeenCalled();
    expect(service.queries).toEqual([]);
  });

  it("anon: unauthorized, nothing recorded or signed", async () => {
    const { fake, store, deps } = setup({ user: {} });
    expect(await requestDownload.run({ itemId: ITEM }, deps)).toMatchObject({ ok: false, code: "unauthorized" });
    expect(fake.rpcCalls).toEqual([]);
    expect(store.storage.presignGet).not.toHaveBeenCalled();
  });

  it("another user's draft: not_found, nothing signed and no path looked up", async () => {
    const { store, service, deps } = setup({ rpc: () => ({ data: null, error: pgError("P0001", "not_found: Item not found.") }) });
    expect(await requestDownload.run({ itemId: ITEM }, deps)).toEqual({ ok: false, code: "not_found", message: "Item not found." });
    expect(store.storage.presignGet).not.toHaveBeenCalled();
    expect(service.queries).toEqual([]);
  });

  it("over limits.rateLimits.downloadsPerDay: rate_limited from record_download", async () => {
    const { store, deps } = setup({ rpc: () => ({ data: null, error: pgError("P0001", "rate_limited: Too many requests. Try again shortly.") }) });
    expect(await requestDownload.run({ itemId: ITEM }, deps)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(store.storage.presignGet).not.toHaveBeenCalled();
  });

  it("suspended: forbidden before the database", async () => {
    const { fake, deps } = setup({ user: member(IDS.alice, "alice", { account: { suspended_at: "2026-11-23T00:00:00Z" } }) });
    expect(await requestDownload.run({ itemId: ITEM }, deps)).toMatchObject({ ok: false, code: "forbidden" });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("an original that has not finished uploading (the owner's own draft): not_found, nothing signed", async () => {
    const { service, store, deps } = setup();
    service.tables.item_files![0]!.uploaded_at = null;
    expect(await requestDownload.run({ itemId: ITEM }, deps)).toMatchObject({ ok: false, code: "not_found" });
    expect(store.storage.presignGet).not.toHaveBeenCalled();
  });

  it("a bad id or sample id is invalid", async () => {
    const { fake, deps } = setup();
    expect(await requestDownload.run({ itemId: "x" }, deps)).toMatchObject({ code: "invalid" });
    expect(await requestDownload.run({ itemId: ITEM, sampleId: "../etc" }, deps)).toMatchObject({ code: "invalid" });
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("file names", () => {
  it("built from the title and the original's extension, never from a path", () => {
    expect(downloadFileName("Dark Keys", "a/b/original.wav")).toBe("Dark Keys.wav");
    expect(downloadFileName("Kit", "a/b/original.zip", "Snare 3")).toBe("Kit - Snare 3.zip");
    expect(downloadFileName("Pad", "a/b/original")).toBe("Pad");
    expect(downloadFileName('  ../../"evil"; name\r\n\t ', "x/original.wav")).toBe("evil name.wav");
    expect(downloadFileName("a/b\\c", "x/original.WAV")).toBe("a b c.wav");
    expect(downloadFileName("", "x/original.wav")).toBe("download.wav");
    expect(downloadFileName("x".repeat(300), "x/original.wav")).toHaveLength(100 + 4);
  });

  it("Content-Disposition is an attachment with an ASCII fallback and the UTF-8 name", () => {
    expect(contentDisposition("Dark Keys.wav")).toBe(`attachment; filename="Dark Keys.wav"; filename*=UTF-8''Dark%20Keys.wav`);
    expect(contentDisposition("Café ñ 808's.wav")).toBe(`attachment; filename="Cafe n 808_s.wav"; filename*=UTF-8''Caf%C3%A9%20%C3%B1%20808%27s.wav`);
  });
});
