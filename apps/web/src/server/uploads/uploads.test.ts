import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createUploadSlotOutput, limits } from "@stash/contracts";
import { createUploadSlot } from "./create-upload-slot.ts";
import { completeUpload } from "./complete-upload.ts";
import type { ActionDeps } from "../action.ts";
import { IDS, TEST_ENV, fakeSupabase, member, pgError, type FakeOptions } from "../testing/fake-supabase.ts";
import { fakeStorage } from "../testing/fake-storage.ts";
import { S3Stub } from "../testing/s3-stub.ts";
import { S3Client } from "@aws-sdk/client-s3";
import { s3Originals } from "../storage/originals.ts";

const ITEM = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const DEMO = "55555555-5555-4555-8555-555555555555";
const PATH = `${IDS.alice}/${ITEM}/original.wav`;
/** Where the browser uploads; completeUpload copies it to the row's path. */
const STAGE = `staging/${IDS.alice}/${ITEM}/${FILE}`;
const DEMO_STAGE = `staging/${IDS.alice}/${ITEM}/${DEMO}`;

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
});

type Rpc = NonNullable<FakeOptions["rpc"]>;

/**
 * The service client as the migration answers it: claim_file_completion and
 * release_file_completion (decision 0016) keep their claims in `claims`, refusing a confirmed file
 * or a live claim; a successful enqueue_processing confirms the file (uploaded_at, as the caller
 * then reads it) and clears the claim. `serviceRpc` answers everything else, enqueue included.
 */
function serviceFake(user: ReturnType<typeof fakeSupabase>, serviceRpc?: Rpc, opts: { claim?: (fileId: string) => boolean } = {}) {
  const claims = new Map<string, string>();
  const userFiles = () => (user.tables.item_files ?? []) as Array<Record<string, unknown>>;
  const service = fakeSupabase({
    tables: { item_files: structuredClone(userFiles()) },
    rpc: async (fn, args) => {
      const fileId = args.p_file_id as string;
      if (fn === "claim_file_completion") {
        if (opts.claim) return { data: opts.claim(fileId), error: null };
        const row = userFiles().find((f) => f.id === fileId);
        if (row?.uploaded_at || claims.has(fileId)) return { data: false, error: null };
        claims.set(fileId, args.p_token as string);
        return { data: true, error: null };
      }
      if (fn === "release_file_completion") {
        if (claims.get(fileId) === args.p_token) claims.delete(fileId);
        return { data: null, error: null };
      }
      const held = claims.get(fileId) === args.p_token && !userFiles().find((f) => f.id === fileId)?.uploaded_at;
      if (fn === "file_claim_held") return { data: held, error: null };
      if (fn === "mark_file_copied") {
        const row = (service.tables.item_files ?? []).find((f) => f.id === fileId);
        if (held && row) row.meta = { ...((row.meta as object) ?? {}), copiedAt: "2026-11-23T23:58:00Z" };
        return { data: held, error: null };
      }
      if (fn === "enqueue_processing" && !held) return { data: null, error: pgError("P0001", "conflict: This file is being completed by another request.") };
      const r = serviceRpc ? await serviceRpc(fn, args) : { data: null, error: pgError("42883", fn) };
      if (fn === "enqueue_processing" && !r.error) {
        claims.delete(fileId);
        const row = userFiles().find((f) => f.id === fileId);
        if (row) row.uploaded_at = "2026-11-23T23:59:00Z";
      }
      return r;
    },
  });
  return { service, claims };
}

function setup(opts: { user?: FakeOptions; rpc?: Rpc; serviceRpc?: Rpc; tables?: FakeOptions["tables"]; objects?: Record<string, number> } = {}) {
  const base = opts.user ?? member();
  const fake = fakeSupabase({ ...base, rpc: opts.rpc, tables: { ...base.tables, ...opts.tables } });
  const { service, claims } = serviceFake(fake, opts.serviceRpc);
  const store = fakeStorage(opts.objects);
  const deps: ActionDeps = { supabase: async () => fake.client, service: () => service.client, storage: () => store.storage };
  return { fake, service, claims, store, deps };
}

/** The enqueue_processing calls a service client received. */
const enqueues = (service: ReturnType<typeof fakeSupabase>) => service.rpcCalls.filter((c) => c.fn === "enqueue_processing");

/** create_upload_draft as the migration answers it, for a verified member under quota. */
const draftRpc: Rpc = (fn, args) => {
  if (fn !== "create_upload_draft") return { data: null, error: pgError("42883", fn) };
  return { data: [{ item_id: ITEM, file_id: FILE, path: `${IDS.alice}/${ITEM}/original.${args.p_ext}` }], error: null };
};

const slot = (extra: Record<string, unknown> = {}) => ({ type: "loop", fileName: "Dark Keys 140 Am.wav", bytes: 2_000_000, mime: "audio/wav", ...extra });

describe("createUploadSlot", () => {
  it("single upload: a draft from the database and one presigned URL for its path", async () => {
    const { fake, store, deps } = setup({ rpc: draftRpc });
    const before = Date.now();
    const r = await createUploadSlot.run(slot(), deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(createUploadSlotOutput.parse(r.data)).toEqual(r.data);
    expect(r.data).toMatchObject({ itemId: ITEM, fileId: FILE, upload: { kind: "single", url: `https://storage.test/originals/${STAGE}?len=2000000`, headers: {} } });
    expect(fake.rpcCalls).toEqual([
      { fn: "create_upload_draft", args: { p_type: "loop", p_title: "Dark Keys 140 Am", p_bytes: 2_000_000, p_ext: "wav", p_file_name: "Dark Keys 140 Am.wav" } },
    ]);
    // Signed for the staging key, never the row's path (the object the worker and downloads read).
    expect(store.storage.presignPut).toHaveBeenCalledWith(STAGE, 2_000_000);
    const expires = Date.parse(r.data.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + limits.urls.uploadTtlSeconds * 1000 - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + limits.urls.uploadTtlSeconds * 1000);
  });

  it("never passes the browser's MIME type on: the type comes from the extension", async () => {
    const { fake, deps } = setup({ rpc: draftRpc });
    await createUploadSlot.run(slot({ mime: "application/x-msdownload", fileName: "beat.WAV" }), deps);
    expect(fake.rpcCalls[0]!.args).toEqual({ p_type: "loop", p_title: "beat", p_bytes: 2_000_000, p_ext: "wav", p_file_name: "beat.WAV" });
    expect(JSON.stringify(fake.rpcCalls)).not.toMatch(/msdownload|audio\/wav/);
  });

  it("uses only the base name of a path-like file name for the title", async () => {
    const { fake, deps } = setup({ rpc: draftRpc });
    await createUploadSlot.run(slot({ fileName: "C:\\loops\\..\\Night Drive.flac" }), deps);
    expect(fake.rpcCalls[0]!.args).toMatchObject({ p_title: "Night Drive", p_ext: "flac" });
  });

  it("a file name with no extension is invalid before the database", async () => {
    const { fake, deps } = setup({ rpc: draftRpc });
    expect(await createUploadSlot.run(slot({ fileName: "README" }), deps)).toMatchObject({ ok: false, code: "invalid", fields: { fileName: expect.any(String) } });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("multipart past the threshold: part URLs, and the upload id kept on the file row", async () => {
    const bytes = limits.multipart.thresholdBytes + 1;
    const { store, service, deps } = setup({
      rpc: draftRpc,
      tables: { item_files: [{ id: FILE, item_id: ITEM, meta: { fileName: "Kit.zip" } }] },
    });
    const r = await createUploadSlot.run(slot({ type: "kit", fileName: "Kit.zip", bytes }), deps);
    expect(r.ok).toBe(true);
    if (!r.ok || r.data.upload.kind !== "multipart") throw new Error("expected multipart");
    expect(createUploadSlotOutput.parse(r.data)).toEqual(r.data);
    expect(store.storage.startMultipart).toHaveBeenCalledWith(STAGE, bytes);
    expect(store.storage.presignPut).not.toHaveBeenCalled();
    expect(r.data.upload.partBytes).toBe(limits.multipart.partBytes);
    expect(r.data.upload.parts).toHaveLength(Math.ceil(bytes / limits.multipart.partBytes));
    const update = service.queries.find((q) => q.op === "update")!;
    expect(update).toMatchObject({ table: "item_files", filters: [["id", FILE]], values: { meta: { fileName: "Kit.zip", uploadId: r.data.upload.uploadId } } });
  });

  it("multipart: if the upload id cannot be kept, the storage upload is aborted", async () => {
    const bytes = limits.multipart.thresholdBytes + 1;
    const base = member();
    const fake = fakeSupabase({ ...base, rpc: draftRpc });
    const service = fakeSupabase({ tables: { item_files: [{ id: FILE, item_id: ITEM, meta: {} }] }, failures: { "item_files.update": pgError("XX000", "disk full") } });
    const store = fakeStorage();
    const deps: ActionDeps = { supabase: async () => fake.client, service: () => service.client, storage: () => store.storage };
    await expect(createUploadSlot.run(slot({ type: "kit", fileName: "Kit.zip", bytes }), deps)).rejects.toMatchObject({ code: "XX000" });
    const uploadId = (await store.storage.startMultipart.mock.results[0]!.value).uploadId;
    expect(store.storage.abortMultipart).toHaveBeenCalledWith(STAGE, uploadId);
    expect(store.uploads.size).toBe(0);
  });

  it("a malformed row from the upload function is a bug: nothing is signed", async () => {
    const { store, deps } = setup({ rpc: () => ({ data: [{ item_id: ITEM, path: PATH }], error: null }) });
    await expect(createUploadSlot.run(slot(), deps)).rejects.toThrow(/create_upload_draft/);
    expect(store.storage.presignPut).not.toHaveBeenCalled();
  });

  it("at the threshold exactly it is still a single upload", async () => {
    const { store, deps } = setup({ rpc: draftRpc });
    await createUploadSlot.run(slot({ type: "kit", fileName: "Kit.zip", bytes: limits.multipart.thresholdBytes }), deps);
    expect(store.storage.presignPut).toHaveBeenCalled();
    expect(store.storage.startMultipart).not.toHaveBeenCalled();
  });

  it("quota exceeded: the database's answer, and no URL is signed", async () => {
    const { store, deps } = setup({ rpc: () => ({ data: null, error: pgError("P0001", "quota_exceeded: This upload would go over your storage quota.") }) });
    expect(await createUploadSlot.run(slot(), deps)).toEqual({ ok: false, code: "quota_exceeded", message: "This upload would go over your storage quota." });
    expect(store.storage.presignPut).not.toHaveBeenCalled();
  });

  it("unverified email: forbidden from the database", async () => {
    const { store, deps } = setup({
      user: member(IDS.alice, "alice"),
      rpc: () => ({ data: null, error: pgError("P0001", "forbidden: Verify your email before uploading.") }),
    });
    expect(await createUploadSlot.run(slot(), deps)).toEqual({ ok: false, code: "forbidden", message: "Verify your email before uploading." });
    expect(store.storage.presignPut).not.toHaveBeenCalled();
  });

  it("unauthenticated or without a handle: refused before the database", async () => {
    const signedOut = setup({ user: {}, rpc: draftRpc });
    expect(await createUploadSlot.run(slot(), signedOut.deps)).toMatchObject({ code: "unauthorized" });
    const noHandle = setup({ user: { user: { id: IDS.bob } }, rpc: draftRpc });
    expect(await createUploadSlot.run(slot(), noHandle.deps)).toMatchObject({ code: "forbidden" });
    expect(signedOut.fake.rpcCalls).toEqual([]);
    expect(noHandle.fake.rpcCalls).toEqual([]);
  });

  it("over the type's size limit: invalid from the contract or the database", async () => {
    const { deps } = setup({ rpc: () => ({ data: null, error: pgError("P0001", "invalid: This file is larger than the limit for its type.") }) });
    expect(await createUploadSlot.run(slot({ bytes: limits.loop.maxBytes + 1 }), deps)).toMatchObject({ code: "invalid" });
    expect(await createUploadSlot.run(slot({ bytes: 0 }), deps)).toMatchObject({ code: "invalid", fields: { bytes: expect.any(String) } });
  });

  describe("preset demo (role demo)", () => {
    const demoRpc: Rpc = (fn, args) =>
      fn === "add_demo_file"
        ? { data: [{ file_id: DEMO, path: `${IDS.alice}/${args.p_item_id}/demo` }], error: null }
        : { data: null, error: pgError("42883", fn) };

    it("attaches a demo to the caller's preset draft", async () => {
      const { fake, store, deps } = setup({ rpc: demoRpc });
      const r = await createUploadSlot.run({ type: "preset", role: "demo", itemId: ITEM, fileName: "Glass pad demo.mp3", bytes: 500_000, mime: "audio/mpeg" }, deps);
      expect(r).toMatchObject({ ok: true, data: { itemId: ITEM, fileId: DEMO, upload: { kind: "single" } } });
      expect(fake.rpcCalls).toEqual([{ fn: "add_demo_file", args: { p_item_id: ITEM, p_bytes: 500_000, p_ext: "mp3", p_file_name: "Glass pad demo.mp3" } }]);
      expect(store.storage.presignPut).toHaveBeenCalledWith(DEMO_STAGE, 500_000);
    });

    it("needs an item id and the preset type", async () => {
      const { fake, deps } = setup({ rpc: demoRpc });
      expect(await createUploadSlot.run({ type: "preset", role: "demo", fileName: "d.mp3", bytes: 10, mime: "" }, deps)).toMatchObject({
        code: "invalid",
        fields: { itemId: expect.any(String) },
      });
      expect(await createUploadSlot.run({ type: "loop", role: "demo", itemId: ITEM, fileName: "d.mp3", bytes: 10, mime: "" }, deps)).toMatchObject({
        code: "invalid",
        fields: { type: expect.any(String) },
      });
      expect(fake.rpcCalls).toEqual([]);
    });

    it("a suspension the database sees (e.g. suspended after the session was read): forbidden, no URL signed", async () => {
      const { store, deps } = setup({ rpc: () => ({ data: null, error: pgError("P0001", "forbidden: This account is suspended.") }) });
      expect(await createUploadSlot.run({ type: "preset", role: "demo", itemId: ITEM, fileName: "d.mp3", bytes: 10, mime: "" }, deps)).toEqual({
        ok: false,
        code: "forbidden",
        message: "This account is suspended.",
      });
      expect(store.storage.presignPut).not.toHaveBeenCalled();
      expect(store.storage.startMultipart).not.toHaveBeenCalled();
    });

    it("another user's item: not_found from the database", async () => {
      const { deps } = setup({ rpc: () => ({ data: null, error: pgError("P0001", "not_found: Item not found.") }) });
      expect(await createUploadSlot.run({ type: "preset", role: "demo", itemId: ITEM, fileName: "d.mp3", bytes: 10, mime: "" }, deps)).toEqual({
        ok: false,
        code: "not_found",
        message: "Item not found.",
      });
    });

    it("an item id on an original upload is invalid (originals always start a new draft)", async () => {
      const { fake, deps } = setup({ rpc: draftRpc });
      expect(await createUploadSlot.run(slot({ itemId: ITEM }), deps)).toMatchObject({ code: "invalid", fields: { itemId: expect.any(String) } });
      expect(fake.rpcCalls).toEqual([]);
    });
  });
});

describe("completeUpload", () => {
  const itemRow = (extra: Record<string, unknown> = {}) => ({ id: ITEM, owner_id: IDS.alice, type: "loop", status: "draft", ...extra });
  const fileRow = (extra: Record<string, unknown> = {}) => ({
    id: FILE,
    item_id: ITEM,
    bucket: "originals",
    role: "original",
    path: PATH,
    bytes: 1000,
    mime: "audio/wav",
    meta: {},
    uploaded_at: null,
    ...extra,
  });
  const JOB = "66666666-6666-4666-8666-666666666666";
  const enqueueOk: Rpc = (fn) => (fn === "enqueue_processing" ? { data: JOB, error: null } : { data: null, error: pgError("42883", fn) });
  const waiting: Rpc = (fn) => (fn === "enqueue_processing" ? { data: null, error: null } : { data: null, error: pgError("42883", fn) });

  it("single upload: copies staging to the row's path with the row's type, deletes staging, enqueues the measured size", async () => {
    const { fake, service, store, deps } = setup({ tables: { items: [itemRow()], item_files: [fileRow()] }, objects: { [STAGE]: 1000 }, serviceRpc: enqueueOk });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toEqual({ ok: true, data: { itemId: ITEM, status: "processing", jobId: JOB } });
    expect(store.storage.copy).toHaveBeenCalledWith(STAGE, PATH, "audio/wav");
    expect(store.types.get(PATH)).toBe("audio/wav");
    expect(store.sizes.has(STAGE)).toBe(false);
    expect(store.sizes.get(PATH)).toBe(1000);
    // The measured size is the final object's, read after the copy.
    expect(store.storage.head).toHaveBeenLastCalledWith(PATH);
    expect(enqueues(service)).toEqual([
      { fn: "enqueue_processing", args: { p_user_id: IDS.alice, p_item_id: ITEM, p_file_id: FILE, p_measured_bytes: 1000, p_token: service.rpcCalls[0]!.args.p_token } },
    ]);
    // The claim is checked immediately before the copy, and the copy recorded under it.
    const fns = service.rpcCalls.map((c) => c.fn);
    expect(fns).toEqual(["claim_file_completion", "file_claim_held", "mark_file_copied", "enqueue_processing"]);
    expect(service.rpc.mock.invocationCallOrder[1]!).toBeLessThan(store.storage.copy.mock.invocationCallOrder[0]!);
    expect(store.storage.copy.mock.invocationCallOrder[0]!).toBeLessThan(service.rpc.mock.invocationCallOrder[2]!);
    // The file was claimed before any storage call, and the copy is recorded on the row.
    expect(service.rpcCalls[0]).toMatchObject({ fn: "claim_file_completion", args: { p_user_id: IDS.alice, p_item_id: ITEM, p_file_id: FILE, p_token: expect.any(String) } });
    expect(service.rpc.mock.invocationCallOrder[0]!).toBeLessThan(store.storage.head.mock.invocationCallOrder[0]!);
    expect(service.tables.item_files![0]!.meta).toMatchObject({ copiedAt: expect.any(String) });
    // Never through the user's own client: the function is service role only.
    expect(fake.rpcCalls).toEqual([]);
  });

  it("over HTTP: a PUT to the slot's URL after completeUpload never changes the confirmed object", async () => {
    const stub = await new S3Stub().start();
    try {
      const client = new S3Client({
        endpoint: stub.endpoint,
        region: "auto",
        forcePathStyle: true,
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
        requestChecksumCalculation: "WHEN_REQUIRED",
      });
      const storage = s3Originals({ client, bucket: "originals" });
      const fake = fakeSupabase({ ...member(), rpc: draftRpc, tables: { ...member().tables, items: [itemRow()], item_files: [fileRow({ bytes: 4 })] } });
      const { service } = serviceFake(fake, enqueueOk);
      const deps: ActionDeps = { supabase: async () => fake.client, service: () => service.client, storage: () => storage };

      const slotResult = await createUploadSlot.run(slot({ bytes: 4 }), deps);
      if (!slotResult.ok || slotResult.data.upload.kind !== "single") throw new Error("expected a single upload");
      const { url } = slotResult.data.upload;
      // The uploader's own Content-Type is not what gets stored.
      expect((await fetch(url, { method: "PUT", body: "good", headers: { "Content-Type": "text/html" } })).status).toBe(200);
      expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ ok: true, data: { status: "processing" } });

      expect(stub.objects.get(`originals/${PATH}`)?.toString()).toBe("good");
      expect(stub.contentTypes.get(`originals/${PATH}`)).toBe("audio/wav");
      expect(stub.objects.has(`originals/${STAGE}`)).toBe(false);

      // The URL is still within its lifetime: the late PUT lands in staging only.
      expect((await fetch(url, { method: "PUT", body: "evil" })).status).toBe(200);
      expect(stub.objects.get(`originals/${PATH}`)?.toString()).toBe("good");
    } finally {
      await stub.stop();
    }
  });

  it("size mismatch: the database refuses it, and both the staged and the copied object are deleted", async () => {
    const { store, service, deps } = setup({
      tables: { items: [itemRow()], item_files: [fileRow()] },
      objects: { [STAGE]: 5000 },
      serviceRpc: () => ({ data: null, error: pgError("P0001", "invalid: The uploaded file is not the size that was declared.") }),
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toEqual({
      ok: false,
      code: "invalid",
      message: "The uploaded file is not the size that was declared.",
    });
    expect(enqueues(service)[0]!.args).toMatchObject({ p_measured_bytes: 5000 });
    expect(store.storage.remove).toHaveBeenCalledWith(PATH);
    expect(store.storage.remove).toHaveBeenCalledWith(STAGE);
    expect(store.sizes.size).toBe(0);
  });

  it("if deleting a refused object fails, the database's answer is still what comes back", async () => {
    const { store, deps } = setup({
      tables: { items: [itemRow()], item_files: [fileRow()] },
      objects: { [STAGE]: 5000 },
      serviceRpc: () => ({ data: null, error: pgError("P0001", "invalid: The uploaded file is not the size that was declared.") }),
    });
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    store.storage.remove.mockRejectedValue(new Error("storage down"));
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ ok: false, code: "invalid" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("another user's item: not_found, without touching storage or the queue", async () => {
    const { store, service, fake, deps } = setup({
      tables: { items: [itemRow({ owner_id: IDS.bob })], item_files: [fileRow()] },
      objects: { [STAGE]: 1000 },
      serviceRpc: enqueueOk,
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ ok: false, code: "not_found" });
    expect(store.storage.head).not.toHaveBeenCalled();
    expect(store.storage.copy).not.toHaveBeenCalled();
    expect(service.rpcCalls).toEqual([]);
    expect(fake.queries.find((q) => q.table === "items")!.filters).toEqual([
      ["id", ITEM],
      ["owner_id", IDS.alice],
    ]);
  });

  it("an item that is no longer a draft: conflict before storage is touched, so the worker's object stays as checked", async () => {
    const { store, service, deps } = setup({
      tables: { items: [itemRow({ status: "processing" })], item_files: [fileRow()] },
      objects: { [STAGE]: 1000, [PATH]: 1000 },
      serviceRpc: enqueueOk,
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toEqual({ ok: false, code: "conflict", message: "This item is already processing." });
    expect(store.storage.copy).not.toHaveBeenCalled();
    expect(store.storage.remove).not.toHaveBeenCalled();
    expect(service.rpcCalls).toEqual([]);
  });

  it("a file that is not the item's original or demo: not_found", async () => {
    for (const row of [fileRow({ item_id: "77777777-7777-4777-8777-777777777777" }), fileRow({ bucket: "previews" })]) {
      const { service, deps } = setup({ tables: { items: [itemRow()], item_files: [row] }, objects: { [STAGE]: 1000 }, serviceRpc: enqueueOk });
      expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ code: "not_found" });
      expect(service.rpcCalls).toEqual([]);
    }
  });

  it("nothing uploaded yet: invalid, nothing queued, and the claim is released", async () => {
    const { service, claims, deps } = setup({ tables: { items: [itemRow()], item_files: [fileRow()] }, serviceRpc: enqueueOk });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ ok: false, code: "invalid", message: expect.stringMatching(/upload/i) });
    expect(enqueues(service)).toEqual([]);
    expect(service.rpcCalls.map((c) => c.fn)).toEqual(["claim_file_completion", "release_file_completion"]);
    expect(claims.size).toBe(0);
  });

  it("no staged object and no copy recorded on the row: an object at the final key is not trusted (invalid)", async () => {
    const { store, service, deps } = setup({ tables: { items: [itemRow()], item_files: [fileRow()] }, objects: { [PATH]: 1000 }, serviceRpc: enqueueOk });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ ok: false, code: "invalid" });
    expect(enqueues(service)).toEqual([]);
    expect(store.storage.copy).not.toHaveBeenCalled();
  });

  it("a repeat after an earlier call copied (meta.copiedAt) but did not enqueue: uses that copy, no new copy", async () => {
    const { store, service, deps } = setup({
      tables: { items: [itemRow()], item_files: [fileRow({ meta: { copiedAt: "2026-11-23T23:00:00Z" } })] },
      objects: { [PATH]: 1000 },
      serviceRpc: enqueueOk,
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ ok: true, data: { status: "processing" } });
    expect(store.storage.copy).not.toHaveBeenCalled();
    expect(enqueues(service)[0]!.args).toMatchObject({ p_measured_bytes: 1000 });
  });

  it("multipart: completes the staged upload with the parts, then copies, HEADs and enqueues", async () => {
    const kitPath = `${IDS.alice}/${ITEM}/original.zip`;
    const { store, service, deps } = setup({
      tables: { items: [itemRow({ type: "kit" })], item_files: [fileRow({ path: kitPath, bytes: 40, mime: "application/zip", meta: { uploadId: "up-kit" } })] },
      serviceRpc: enqueueOk,
    });
    store.uploads.set("up-kit", { key: STAGE, bytes: 40 });
    const parts = [1, 2, 3].map((n) => ({ partNumber: n, etag: `"e${n}"` }));
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE, parts }, deps)).toMatchObject({ ok: true, data: { status: "processing" } });
    expect(store.storage.completeMultipart).toHaveBeenCalledWith(STAGE, "up-kit", parts);
    expect(store.storage.copy).toHaveBeenCalledWith(STAGE, kitPath, "application/zip");
    expect(store.sizes.has(STAGE)).toBe(false);
    expect(enqueues(service)[0]!.args).toMatchObject({ p_measured_bytes: 40 });
  });

  it("multipart parts storage refuses (wrong ETag, order, too small): invalid, upload it again", async () => {
    const { store, service, deps } = setup({ tables: { items: [itemRow()], item_files: [fileRow({ meta: { uploadId: "up-bad" } })] }, serviceRpc: enqueueOk });
    store.uploads.set("up-bad", { key: STAGE, bytes: 1000 });
    store.refuseParts.add("up-bad");
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE, parts: [{ partNumber: 1, etag: '"forged"' }] }, deps)).toEqual({
      ok: false,
      code: "invalid",
      message: "Some parts did not upload. Upload it again.",
      fields: { parts: "Some parts did not upload. Upload it again." },
    });
    expect(store.storage.copy).not.toHaveBeenCalled();
    expect(enqueues(service)).toEqual([]);
  });

  it("duplicate part numbers are invalid input, not a storage error", async () => {
    const { store, service, deps } = setup({ tables: { items: [itemRow()], item_files: [fileRow({ meta: { uploadId: "up-dup" } })] }, serviceRpc: enqueueOk });
    const parts = [
      { partNumber: 1, etag: '"a"' },
      { partNumber: 1, etag: '"b"' },
    ];
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE, parts }, deps)).toMatchObject({ ok: false, code: "invalid", fields: { parts: expect.any(String) } });
    expect(store.storage.completeMultipart).not.toHaveBeenCalled();
    expect(service.rpcCalls).toEqual([]);
  });

  it("a stale call whose claim was taken over (and the file confirmed) by a second call neither copies nor deletes", async () => {
    const base = member();
    const fake = fakeSupabase({ ...base, tables: { ...base.tables, items: [itemRow()], item_files: [fileRow()] } });
    const { service, claims } = serviceFake(fake, enqueueOk);
    const store = fakeStorage({ [STAGE]: 1000, [PATH]: 1000 });
    // The stale call claimed, then stalled; meanwhile its claim lapsed and another call confirmed.
    store.storage.head.mockImplementationOnce(async (key: string) => {
      claims.set(FILE, "the-second-call");
      (fake.tables.item_files![0] as Record<string, unknown>).uploaded_at = "2026-11-23T23:59:30Z";
      return { bytes: 1000, contentType: null, key } as never;
    });
    const deps: ActionDeps = { supabase: async () => fake.client, service: () => service.client, storage: () => store.storage };
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ ok: false, code: "conflict" });
    expect(store.storage.copy).not.toHaveBeenCalled();
    expect(store.storage.remove).not.toHaveBeenCalled();
    expect(enqueues(service)).toEqual([]);
    // Its release does not touch the second call's claim.
    expect(claims.get(FILE)).toBe("the-second-call");
  });

  it("a claim taken over between the copy and the confirmation: conflict from enqueue_processing, nothing deleted", async () => {
    const { store, claims, service, deps } = setup({ tables: { items: [itemRow()], item_files: [fileRow()] }, objects: { [STAGE]: 1000 }, serviceRpc: enqueueOk });
    store.storage.copy.mockImplementationOnce(async (from: string, to: string) => {
      store.sizes.set(to, store.sizes.get(from)!);
      claims.set(FILE, "the-second-call");
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ ok: false, code: "conflict" });
    expect(store.storage.remove).not.toHaveBeenCalledWith(PATH);
    expect(store.sizes.has(PATH)).toBe(true);
    expect(enqueues(service)).toEqual([]);
  });

  it("storage setup failing after the claim still releases it", async () => {
    const { fake, service, claims } = (() => {
      const base = member();
      const f = fakeSupabase({ ...base, tables: { ...base.tables, items: [itemRow()], item_files: [fileRow()] } });
      return { fake: f, ...serviceFake(f, enqueueOk) };
    })();
    const deps: ActionDeps = {
      supabase: async () => fake.client,
      service: () => service.client,
      storage: () => {
        throw new Error("Missing or invalid environment variables: STASH_S3_ENDPOINT");
      },
    };
    await expect(completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).rejects.toThrow(/STASH_S3_ENDPOINT/);
    expect(service.rpcCalls.map((c) => c.fn)).toEqual(["claim_file_completion", "release_file_completion"]);
    expect(claims.size).toBe(0);
  });

  it("an error after the claim releases it, so the owner can retry at once", async () => {
    const { store, claims, service, deps } = setup({ tables: { items: [itemRow()], item_files: [fileRow()] }, objects: { [STAGE]: 1000 }, serviceRpc: enqueueOk });
    store.storage.copy.mockRejectedValueOnce(new Error("storage down"));
    await expect(completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).rejects.toThrow(/storage down/);
    expect(service.rpcCalls.map((c) => c.fn)).toEqual(["claim_file_completion", "file_claim_held", "release_file_completion"]);
    expect(claims.size).toBe(0);
    // The retry goes through.
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ ok: true, data: { status: "processing" } });
  });

  it("two concurrent completions of one file: exactly one copies; the other is a conflict", async () => {
    const { store, service, deps } = setup({ tables: { items: [itemRow()], item_files: [fileRow()] }, objects: { [STAGE]: 1000 }, serviceRpc: enqueueOk });
    const [a, b] = await Promise.all([completeUpload.run({ itemId: ITEM, fileId: FILE }, deps), completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "conflict" });
    expect(store.storage.copy).toHaveBeenCalledTimes(1);
    expect(enqueues(service)).toHaveLength(1);
  });

  it("a preset's confirmed original is never overwritten by a re-PUT staged object, whichever file is completed next", async () => {
    const origPath = `${IDS.alice}/${ITEM}/original.vital`;
    const demoPath = `${IDS.alice}/${ITEM}/demo`;
    const { store, service, deps } = setup({
      tables: {
        items: [itemRow({ type: "preset" })],
        item_files: [
          fileRow({ path: origPath, mime: "application/octet-stream", uploaded_at: "2026-11-23T22:00:00Z", meta: { copiedAt: "2026-11-23T22:00:00Z" } }),
          fileRow({ id: DEMO, role: "demo", path: demoPath, mime: "audio/mpeg" }),
        ],
      },
      // The confirmed original, a late re-PUT of it in staging (same length), and the demo's upload.
      objects: { [origPath]: 1000, [STAGE]: 1000, [DEMO_STAGE]: 1000 },
      serviceRpc: enqueueOk,
    });
    // Completing the original again: confirmed, so nothing is claimed or copied.
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toEqual({ ok: true, data: { itemId: ITEM, status: "draft", jobId: null, waitingFor: "demo" } });
    expect(store.storage.copy).not.toHaveBeenCalled();
    expect(service.rpcCalls).toEqual([]);
    // Completing the demo copies the demo only.
    expect(await completeUpload.run({ itemId: ITEM, fileId: DEMO }, deps)).toMatchObject({ ok: true, data: { status: "processing" } });
    expect(store.storage.copy.mock.calls).toEqual([[DEMO_STAGE, demoPath, "audio/mpeg"]]);
    expect(service.rpcCalls.find((c) => c.fn === "claim_file_completion")!.args).toMatchObject({ p_file_id: DEMO });
  });

  it("a claim refused for a file confirmed meanwhile returns where the item stands, without copying", async () => {
    const base = member();
    const fake = fakeSupabase({ ...base, tables: { ...base.tables, items: [itemRow({ type: "preset" })], item_files: [fileRow()] } });
    const { service } = serviceFake(fake, enqueueOk, {
      claim: () => {
        (fake.tables.item_files![0] as Record<string, unknown>).uploaded_at = "2026-11-23T23:00:00Z";
        return false;
      },
    });
    const store = fakeStorage({ [STAGE]: 1000 });
    const deps: ActionDeps = { supabase: async () => fake.client, service: () => service.client, storage: () => store.storage };
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toEqual({ ok: true, data: { itemId: ITEM, status: "draft", jobId: null, waitingFor: "demo" } });
    expect(store.storage.copy).not.toHaveBeenCalled();
    expect(store.storage.head).not.toHaveBeenCalled();
  });

  it("multipart without parts is invalid", async () => {
    const { store, deps } = setup({ tables: { items: [itemRow()], item_files: [fileRow({ meta: { uploadId: "up-9" } })] }, serviceRpc: enqueueOk });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ code: "invalid", fields: { parts: expect.any(String) } });
    expect(store.storage.completeMultipart).not.toHaveBeenCalled();
  });

  it("a repeated call after a completed multipart upload still finds the object", async () => {
    const { store, deps } = setup({
      tables: { items: [itemRow()], item_files: [fileRow({ meta: { uploadId: "up-already-done" } })] },
      objects: { [STAGE]: 1000 },
      serviceRpc: enqueueOk,
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE, parts: [{ partNumber: 1, etag: '"x"' }] }, deps)).toMatchObject({ ok: true });
    expect(store.storage.completeMultipart).toHaveBeenCalled();
  });

  it("a preset whose demo has not arrived waits in draft", async () => {
    const { deps } = setup({
      tables: { items: [itemRow({ type: "preset" })], item_files: [fileRow({ path: `${IDS.alice}/${ITEM}/original.vital` })] },
      objects: { [STAGE]: 1000 },
      serviceRpc: waiting,
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toEqual({ ok: true, data: { itemId: ITEM, status: "draft", jobId: null, waitingFor: "demo" } });
  });

  it("a demo confirmed before its preset original waits for the original", async () => {
    const demoPath = `${IDS.alice}/${ITEM}/demo`;
    const { store, deps } = setup({
      tables: {
        items: [itemRow({ type: "preset" })],
        item_files: [fileRow({ id: DEMO, role: "demo", path: demoPath, mime: "audio/mpeg" }), fileRow({ path: `${IDS.alice}/${ITEM}/original.vital` })],
      },
      objects: { [DEMO_STAGE]: 1000 },
      serviceRpc: waiting,
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: DEMO }, deps)).toEqual({ ok: true, data: { itemId: ITEM, status: "draft", jobId: null, waitingFor: "original" } });
    expect(store.storage.copy).toHaveBeenCalledWith(DEMO_STAGE, demoPath, "audio/mpeg");
  });

  it("a suspension enqueue_processing sees: forbidden, nothing queued, and the objects are deleted", async () => {
    const { store, service, deps } = setup({
      tables: { items: [itemRow()], item_files: [fileRow()] },
      objects: { [STAGE]: 1000 },
      serviceRpc: () => ({ data: null, error: pgError("P0001", "forbidden: This account is suspended.") }),
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toEqual({ ok: false, code: "forbidden", message: "This account is suspended." });
    expect(enqueues(service)).toHaveLength(1);
    // Refused, so the worker will never see it: it must not stay in storage (rule 10).
    expect(store.storage.remove).toHaveBeenCalledWith(PATH);
    expect(store.sizes.size).toBe(0);
  });

  it("a conflict from the database (a concurrent call queued it first) keeps the object: the worker is using it", async () => {
    const { store, deps } = setup({
      tables: { items: [itemRow()], item_files: [fileRow()] },
      objects: { [STAGE]: 1000 },
      serviceRpc: () => ({ data: null, error: pgError("P0001", "conflict: This item is already processing.") }),
    });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toEqual({ ok: false, code: "conflict", message: "This item is already processing." });
    expect(store.sizes.has(PATH)).toBe(true);
    expect(store.storage.remove).not.toHaveBeenCalledWith(PATH);
  });

  it("unauthenticated: unauthorized", async () => {
    const { store, deps } = setup({ user: {}, tables: { items: [itemRow()], item_files: [fileRow()] }, objects: { [STAGE]: 1000 } });
    expect(await completeUpload.run({ itemId: ITEM, fileId: FILE }, deps)).toMatchObject({ code: "unauthorized" });
    expect(store.storage.head).not.toHaveBeenCalled();
  });
});
