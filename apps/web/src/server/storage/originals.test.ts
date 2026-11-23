import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { limits } from "@stash/contracts";
import { s3Originals, type OriginalsStorage } from "./originals.ts";
import { storageEnv } from "./env.ts";
import { S3Stub } from "../testing/s3-stub.ts";

const KEY = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/original.wav";

let stub: S3Stub;
let storage: OriginalsStorage;

beforeAll(async () => {
  stub = await new S3Stub().start();
  const client = new S3Client({
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

  it("a browser PUT to the URL stores exactly that object", async () => {
    const { url } = await storage.presignPut(KEY, 5);
    expect((await put(url, "hello")).status).toBe(200);
    expect(stub.objects.get(`originals/${KEY}`)?.toString()).toBe("hello");
    expect([...stub.objects.keys()]).toEqual([`originals/${KEY}`]);
    expect(await storage.head(KEY)).toEqual({ bytes: 5 });
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
    expect(await storage.head(KEY)).toEqual({ bytes: 20 });
  });

  it("completing an upload that no longer exists reports gone instead of throwing", async () => {
    expect(await storage.completeMultipart(KEY, "upload-missing", [{ partNumber: 1, etag: '"x"' }])).toBe("gone");
  });

  it("a wrong ETag is an error from storage", async () => {
    const m = await storage.startMultipart(KEY, 4);
    await put(m.parts[0]!.url, "abcd");
    await expect(storage.completeMultipart(KEY, m.uploadId, [{ partNumber: 1, etag: '"forged"' }])).rejects.toThrow();
  });

  it("abort drops the upload", async () => {
    const m = await storage.startMultipart(KEY, 4);
    await storage.abortMultipart(KEY, m.uploadId);
    expect(stub.uploads.size).toBe(0);
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
