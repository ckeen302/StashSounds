/**
 * The same storage calls against real local storage: SeaweedFS from `pnpm dev` (S3 API on :9000,
 * decision 0011), configured by the STASH_S3_* values in .env.example. This is what checks the
 * signatures, the signed Content-Length and the bucket privacy that the in-process stub cannot.
 *
 * It runs when the endpoint answers. With STASH_REQUIRE_STORAGE=1 (meant for CI, request
 * 102-storage-in-ci) an unreachable endpoint fails the run instead of skipping it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { originalsFromEnv, type OriginalsStorage } from "./originals.ts";

const ENV = {
  STASH_S3_ENDPOINT: "http://127.0.0.1:9000",
  STASH_S3_REGION: "auto",
  STASH_S3_ACCESS_KEY_ID: "stash",
  STASH_S3_SECRET_ACCESS_KEY: "stash-local-only",
  STASH_BUCKET_ORIGINALS: "originals",
};
for (const [k, v] of Object.entries(ENV)) process.env[k] ??= v;

const endpoint = process.env.STASH_S3_ENDPOINT!;
const required = process.env.STASH_REQUIRE_STORAGE === "1";

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(new URL("/healthz", endpoint), { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

const available = await reachable();
if (!available && required) throw new Error(`STASH_REQUIRE_STORAGE=1 but no storage answers at ${endpoint}`);
if (!available) console.warn(`[seaweedfs.test] no storage at ${endpoint}: skipped (start it with pnpm dev, or set STASH_REQUIRE_STORAGE=1 to fail instead)`);

describe.skipIf(!available)("SeaweedFS (local storage)", () => {
  let storage: OriginalsStorage;
  const created: string[] = [];
  const key = () => {
    const k = `${randomUUID()}/${randomUUID()}/original.wav`;
    created.push(k);
    return k;
  };

  beforeAll(() => {
    storage = originalsFromEnv();
  });

  afterAll(async () => {
    for (const k of created) await storage.remove(k).catch(() => {});
  });

  it("single upload: the presigned PUT stores the object at the declared size", async () => {
    const k = key();
    const body = new Uint8Array(1000).fill(7);
    const { url } = await storage.presignPut(k, body.length);
    expect((await fetch(url, { method: "PUT", body })).status).toBe(200);
    expect(await storage.head(k)).toEqual({ bytes: 1000 });
  });

  it("a body of another size is refused by the signature", async () => {
    const k = key();
    const { url } = await storage.presignPut(k, 1000);
    const r = await fetch(url, { method: "PUT", body: new Uint8Array(2000).fill(7) });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await storage.head(k)).toBeNull();
  });

  it("the URL covers only its own object", async () => {
    const k = key();
    const { url } = await storage.presignPut(k, 10);
    const other = new URL(url);
    other.pathname = other.pathname.replace(/original\.wav$/, "other.wav");
    expect((await fetch(other, { method: "PUT", body: new Uint8Array(10) })).status).toBeGreaterThanOrEqual(400);
  });

  it("multipart upload: parts and completion give one object", async () => {
    const k = key();
    const partBytes = 5 * 1024 * 1024; // S3's minimum part size
    const total = partBytes + 1234;
    const m = await storage.startMultipart(k, total, partBytes);
    const data = new Uint8Array(total).fill(3);
    const parts = [];
    for (const [i, p] of m.parts.entries()) {
      const r = await fetch(p.url, { method: "PUT", body: data.subarray(i * partBytes, (i + 1) * partBytes) });
      expect(r.status).toBe(200);
      parts.push({ partNumber: p.partNumber, etag: r.headers.get("etag")! });
    }
    expect(await storage.completeMultipart(k, m.uploadId, parts)).toBe("completed");
    expect(await storage.head(k)).toEqual({ bytes: total });
  });

  it("originals are not readable without a signature", async () => {
    const k = key();
    const { url } = await storage.presignPut(k, 3);
    await fetch(url, { method: "PUT", body: "abc" });
    const plain = new URL(url);
    plain.search = "";
    expect((await fetch(plain)).status).toBeGreaterThanOrEqual(400);
  });
});
