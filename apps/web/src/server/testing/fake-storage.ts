/** In-memory OriginalsStorage for action tests. Storage itself is tested in storage/*.test.ts. */
import { vi } from "vitest";
import type { MultipartStart, OriginalsStorage } from "../storage/originals.ts";

export function fakeStorage(objects: Record<string, number> = {}) {
  const sizes = new Map(Object.entries(objects));
  const types = new Map<string, string>();
  /** Multipart completions storage refuses, by upload id. */
  const refuseParts = new Set<string>();
  const uploads = new Map<string, { key: string; bytes: number }>();
  let next = 1;
  const storage = {
    presignPut: vi.fn(async (key: string, bytes: number) => ({ url: `https://storage.test/originals/${key}?len=${bytes}`, headers: {} })),
    startMultipart: vi.fn(async (key: string, bytes: number, partBytes = 16 * 1024 * 1024): Promise<MultipartStart> => {
      const uploadId = `up-${next++}`;
      uploads.set(uploadId, { key, bytes });
      const count = Math.ceil(bytes / partBytes);
      const partLengths = Array.from({ length: count }, (_, i) => (i < count - 1 ? partBytes : bytes - partBytes * (count - 1)));
      return {
        uploadId,
        partBytes,
        partLengths,
        parts: partLengths.map((_, i) => ({ partNumber: i + 1, url: `https://storage.test/originals/${key}?uploadId=${uploadId}&partNumber=${i + 1}` })),
      };
    }),
    completeMultipart: vi.fn(async (key: string, uploadId: string) => {
      const up = uploads.get(uploadId);
      if (!up || up.key !== key) return "gone" as const;
      if (refuseParts.has(uploadId)) return "invalid_parts" as const;
      uploads.delete(uploadId);
      sizes.set(key, up.bytes);
      return "completed" as const;
    }),
    abortMultipart: vi.fn(async (_key: string, uploadId: string) => {
      uploads.delete(uploadId);
    }),
    head: vi.fn(async (key: string) => (sizes.has(key) ? { bytes: sizes.get(key)!, contentType: types.get(key) ?? null } : null)),
    copy: vi.fn(async (fromKey: string, toKey: string, contentType: string) => {
      if (!sizes.has(fromKey)) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      sizes.set(toKey, sizes.get(fromKey)!);
      types.set(toKey, contentType);
    }),
    remove: vi.fn(async (key: string) => {
      sizes.delete(key);
      types.delete(key);
    }),
  } satisfies OriginalsStorage;
  return { storage, sizes, types, uploads, refuseParts };
}
