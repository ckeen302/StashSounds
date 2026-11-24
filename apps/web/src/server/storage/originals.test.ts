import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { limits } from "@stash/contracts";
import { s3ClientFromEnv, s3Originals, stagingKey, type OriginalsStorage } from "./originals.ts";

vi.mock("server-only", () => ({}));
import { storageEnv } from "./env.ts";
import { S3Stub } from "../testing/s3-stub.ts";

const KEY = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/original.wav";

let stub: S3Stub;
let storage: OriginalsStorage;
let client: S3Client;

beforeAll(async () => {
  stub = await new S3Stub().start();
  client = new S3Client({
    endpoint: stub.endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  storage = s3Originals({ client, bucket: "originals", partBytes: 8 });
});

afterAll(async () => {
  await stub.stop();
});

beforeEach(() => {
  stub.objects.clear();
  stub.contentTypes.clear();
  stub.uploads.clear();
  stub.requests.length = 0;
});

const put = (url: string, body: Buffer | string) => fetch(url, { method: "PUT", body: typeof body === "string" ? body : new Uint8Array(body) });

describe("presignPut", () => {
  it("signs one object, its length, and expires after limits.urls.uploadTtlSeconds", async () => {
    const { url, headers } = await storage.presignPut(KEY, 1234);
    const u = new URL(url);
    expect(decodeURIComponent(u.pathname)).toBe(`/originals/${KEY}`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe(String(limits.urls.uploadTtlSeconds));
    expect(u.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(["content-length", "host"]);
    // No checksum of an empty body (the SDK default), which would break a browser upload.
    expect([...u.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
    expect(headers).toEqual({});
  });

  it("signs the configured lifetime (ttlSeconds)", async () => {
    const short = s3Originals({ client, bucket: "originals", ttlSeconds: 60 });
    const { url } = await short.presignPut(KEY, 5);
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("60");
  });

  it("a browser PUT to the URL stores exactly that object", async () => {
    const { url } = await storage.presignPut(KEY, 5);
    expect((await put(url, "hello")).status).toBe(200);
    expect(stub.objects.get(`originals/${KEY}`)?.toString()).toBe("hello");
    expect([...stub.objects.keys()]).toEqual([`originals/${KEY}`]);
    expect(await storage.head(KEY)).toEqual({ bytes: 5, contentType: "text/plain;charset=UTF-8" });
  });

  it("an expired URL is refused", async () => {
    vi.useFakeTimers({ now: Date.now() - (limits.urls.uploadTtlSeconds + 60) * 1000, toFake: ["Date"] });
    const { url } = await storage.presignPut(KEY, 5);
    vi.useRealTimers();
    expect((await put(url, "hello")).status).toBe(403);
    expect(stub.objects.size).toBe(0);
  });
});

describe("multipart", () => {
  it("creates the upload and signs one URL per part, each for its exact length", async () => {
    const m = await storage.startMultipart(KEY, 20);
    expect(m.uploadId).toMatch(/^upload-/);
    expect(m.partBytes).toBe(8);
    expect(m.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    for (const p of m.parts) {
      const u = new URL(p.url);
      expect(decodeURIComponent(u.pathname)).toBe(`/originals/${KEY}`);
      expect(u.searchParams.get("uploadId")).toBe(m.uploadId);
      expect(u.searchParams.get("partNumber")).toBe(String(p.partNumber));
      expect(u.searchParams.get("X-Amz-Expires")).toBe(String(limits.urls.uploadTtlSeconds));
      expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host");
    }
    expect(m.partLengths).toEqual([8, 8, 4]);
  });

  it("parts uploaded and completed become one object", async () => {
    const data = Buffer.from("0123456789abcdefghij");
    const m = await storage.startMultipart(KEY, data.length);
    const etags = [];
    for (const [i, p] of m.parts.entries()) {
      const res = await put(p.url, data.subarray(i * m.partBytes, (i + 1) * m.partBytes));
      etags.push({ partNumber: p.partNumber, etag: res.headers.get("etag")! });
    }
    // Out of order on purpose: completion sorts by part number.
    expect(await storage.completeMultipart(KEY, m.uploadId, [...etags].reverse())).toBe("completed");
    expect(stub.objects.get(`originals/${KEY}`)?.toString()).toBe(data.toString());
    expect(await storage.head(KEY)).toEqual({ bytes: 20, contentType: "binary/octet-stream" });
  });

  it("completing an upload that no longer exists reports gone instead of throwing", async () => {
    expect(await storage.completeMultipart(KEY, "upload-missing", [{ partNumber: 1, etag: '"x"' }])).toBe("gone");
  });

  it("parts storage refuses (a wrong ETag here) are reported as invalid_parts, not thrown", async () => {
    const m = await storage.startMultipart(KEY, 4);
    await put(m.parts[0]!.url, "abcd");
    expect(await storage.completeMultipart(KEY, m.uploadId, [{ partNumber: 1, etag: '"forged"' }])).toBe("invalid_parts");
    expect(stub.objects.size).toBe(0);
  });

  it("abort drops the upload", async () => {
    const m = await storage.startMultipart(KEY, 4);
    await storage.abortMultipart(KEY, m.uploadId);
    expect(stub.uploads.size).toBe(0);
  });
});

describe("copy", () => {
  it("copies server side to the final key with the given Content-Type, replacing the uploader's", async () => {
    const staged = stagingKey("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333");
    const { url } = await storage.presignPut(staged, 4);
    await fetch(url, { method: "PUT", body: "data", headers: { "Content-Type": "text/html" } });
    await storage.copy(staged, KEY, "audio/wav");
    expect(stub.objects.get(`originals/${KEY}`)?.toString()).toBe("data");
    expect(await storage.head(KEY)).toEqual({ bytes: 4, contentType: "audio/wav" });
    const copyReq = stub.requests.find((r) => r.method === "PUT" && r.headers["x-amz-copy-source"])!;
    expect(copyReq.headers["x-amz-metadata-directive"]).toBe("REPLACE");
    expect(decodeURIComponent(String(copyReq.headers["x-amz-copy-source"]))).toBe(`originals/${staged}`);
  });

  it("the staging key is derived from ids and never collides with a final path", () => {
    const k = stagingKey("o", "i", "f");
    expect(k).toBe("staging/o/i/f");
    expect(k.startsWith("staging/")).toBe(true);
  });
});

describe("presignGet (downloads)", () => {
  const DISPOSITION = `attachment; filename="Dark Keys.wav"; filename*=UTF-8''Dark%20Keys.wav`;

  it("signs a GET for one object that always downloads, with the row's type, for downloadTtlSeconds", async () => {
    stub.objects.set(`originals/${KEY}`, Buffer.from("RIFFdata"));
    stub.contentTypes.set(`originals/${KEY}`, "text/html");
    const before = Date.now();
    const { url, expiresAt } = await storage.presignGet(KEY, { contentDisposition: DISPOSITION, contentType: "audio/wav" });
    const u = new URL(url);
    // The expiry is the signing date plus the one lifetime that was signed.
    const signedAt = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(u.searchParams.get("X-Amz-Date")!)!;
    const signedMs = Date.UTC(+signedAt[1]!, +signedAt[2]! - 1, +signedAt[3]!, +signedAt[4]!, +signedAt[5]!, +signedAt[6]!);
    expect(Math.floor(Date.parse(expiresAt) / 1000) * 1000).toBe(signedMs + limits.urls.downloadTtlSeconds * 1000);
    expect(Date.parse(expiresAt)).toBeGreaterThanOrEqual(before + limits.urls.downloadTtlSeconds * 1000);
    expect(decodeURIComponent(u.pathname)).toBe(`/originals/${KEY}`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe(String(limits.urls.downloadTtlSeconds));
    expect(u.searchParams.get("response-content-disposition")).toBe(DISPOSITION);
    expect(u.searchParams.get("response-content-type")).toBe("audio/wav");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("RIFFdata");
    expect(res.headers.get("content-disposition")).toBe(DISPOSITION);
    expect(res.headers.get("content-type")).toBe("audio/wav");
  });

  it("the download URL expires", async () => {
    stub.objects.set(`originals/${KEY}`, Buffer.from("x"));
    vi.useFakeTimers({ now: Date.now() - (limits.urls.downloadTtlSeconds + 5) * 1000, toFake: ["Date"] });
    const { url } = await storage.presignGet(KEY, { contentDisposition: DISPOSITION, contentType: "audio/wav" });
    vi.useRealTimers();
    expect((await fetch(url)).status).toBe(403);
  });

  it("refuses to sign without an attachment disposition and a type", async () => {
    await expect(storage.presignGet(KEY, { contentDisposition: "inline", contentType: "audio/wav" })).rejects.toThrow(/attachment/);
    await expect(storage.presignGet(KEY, { contentDisposition: DISPOSITION, contentType: "" })).rejects.toThrow(/content type/);
  });

  it("a configured lifetime is the one signed", async () => {
    const short = s3Originals({ client, bucket: "originals", downloadTtlSeconds: 30 });
    const before = Date.now();
    const { url, expiresAt } = await short.presignGet(KEY, { contentDisposition: DISPOSITION, contentType: "audio/wav" });
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("30");
    expect(Date.parse(expiresAt) - before).toBeGreaterThanOrEqual(30_000);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(30_000);
  });
});

describe("head and remove", () => {
  it("head is null for a missing object; remove deletes", async () => {
    expect(await storage.head(KEY)).toBeNull();
    stub.objects.set(`originals/${KEY}`, Buffer.from("x"));
    await storage.remove(KEY);
    expect(stub.objects.size).toBe(0);
  });
});

describe("s3ClientFromEnv", () => {
  it("is path-style and adds no checksum unless storage requires one (a browser upload would fail)", async () => {
    vi.stubEnv("STASH_S3_ENDPOINT", "http://127.0.0.1:9000");
    vi.stubEnv("STASH_S3_REGION", "auto");
    vi.stubEnv("STASH_S3_ACCESS_KEY_ID", "stash");
    vi.stubEnv("STASH_S3_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("STASH_BUCKET_ORIGINALS", "originals");
    const c = s3ClientFromEnv();
    expect(c.config.forcePathStyle).toBe(true);
    expect(await c.config.requestChecksumCalculation()).toBe("WHEN_REQUIRED");
    expect(await c.config.responseChecksumValidation()).toBe("WHEN_REQUIRED");
    expect(await c.config.region()).toBe("auto");
    vi.unstubAllEnvs();
  });
});

describe("storageEnv", () => {
  it("validates the storage settings and never prints secrets", () => {
    vi.stubEnv("STASH_S3_ENDPOINT", "http://127.0.0.1:9000");
    vi.stubEnv("STASH_S3_REGION", "auto");
    vi.stubEnv("STASH_S3_ACCESS_KEY_ID", "stash");
    vi.stubEnv("STASH_S3_SECRET_ACCESS_KEY", "very-secret-value");
    vi.stubEnv("STASH_BUCKET_ORIGINALS", "originals");
    expect(storageEnv()).toEqual({
      endpoint: "http://127.0.0.1:9000",
      region: "auto",
      accessKeyId: "stash",
      secretAccessKey: "very-secret-value",
      bucket: "originals",
    });
    vi.stubEnv("STASH_S3_ENDPOINT", "nope");
    vi.stubEnv("STASH_S3_SECRET_ACCESS_KEY", "");
    expect(() => storageEnv()).toThrow(/STASH_S3_ENDPOINT, STASH_S3_SECRET_ACCESS_KEY/);
    try {
      storageEnv();
    } catch (e) {
      expect((e as Error).message).not.toMatch(/very-secret|nope/);
    }
    vi.unstubAllEnvs();
  });
});
