import "server-only";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { limits } from "@stash/contracts";
import { storageEnv } from "./env.ts";

/**
 * The private originals bucket. Browsers upload straight to it with presigned URLs, but only to a
 * staging key (stagingKey below) that nothing else ever reads. completeUpload then copies the
 * staged object to the file row's own path, server side, and deletes the staged one. A presigned
 * URL stays usable until limits.urls.uploadTtlSeconds pass, so a late PUT after completeUpload can
 * only rewrite staging, never the object the worker checks and downloads serve (rule 10). Every
 * URL names one object and signs its Content-Length.
 */
export type PresignedPut = { url: string; headers: Record<string, string> };
/**
 * Response headers a download URL forces. Both are required: storage must never serve an original
 * with the uploader's type or inline (PR #6 security note).
 */
export type DownloadHeaders = { contentDisposition: string; contentType: string };
export type MultipartStart = {
  uploadId: string;
  partBytes: number;
  /** Length of each part, in order; every part but the last is partBytes. */
  partLengths: number[];
  parts: Array<{ partNumber: number; url: string }>;
};

/** Multipart completion refused for a reason the uploader can fix by uploading again. */
const INVALID_PARTS = new Set(["InvalidPart", "InvalidPartOrder", "EntityTooSmall"]);

/**
 * Where the browser uploads a file before completeUpload confirms it. Derived on the server from
 * ids only; it never equals a final path (those start with the owner's id, never "staging").
 */
export function stagingKey(ownerId: string, itemId: string, fileId: string): string {
  return `staging/${ownerId}/${itemId}/${fileId}`;
}

export interface OriginalsStorage {
  presignPut(key: string, bytes: number): Promise<PresignedPut>;
  startMultipart(key: string, bytes: number, partBytes?: number): Promise<MultipartStart>;
  /**
   * "gone" when the upload id is unknown (already completed, aborted or expired); "invalid_parts"
   * when storage refuses the listed parts (a wrong ETag or order, or a part below the minimum size).
   */
  completeMultipart(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<"completed" | "gone" | "invalid_parts">;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  head(key: string): Promise<{ bytes: number; contentType: string | null } | null>;
  /**
   * Server-side copy in one request (S3 allows up to 5 GB per CopyObject; our largest original is
   * 500 MB). The copy's Content-Type is the one given here, never the uploader's.
   */
  copy(fromKey: string, toKey: string, contentType: string): Promise<void>;
  /** A signed GET for one object, valid for limits.urls.downloadTtlSeconds, that always downloads with the given type. */
  presignGet(key: string, headers: DownloadHeaders): Promise<string>;
  remove(key: string): Promise<void>;
}

export function s3Originals(opts: {
  client: S3Client;
  bucket: string;
  ttlSeconds?: number;
  partBytes?: number;
  /** Download URL lifetime; limits.urls.downloadTtlSeconds when not set. */
  downloadTtlSeconds?: number;
}): OriginalsStorage {
  const { client, bucket } = opts;
  const expiresIn = opts.ttlSeconds ?? limits.urls.uploadTtlSeconds;
  const defaultPartBytes = opts.partBytes ?? limits.multipart.partBytes;

  return {
    async presignPut(key, bytes) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentLength: bytes }), { expiresIn });
      // The browser sets Content-Length itself; no other header is needed or signed.
      return { url, headers: {} };
    },

    async startMultipart(key, bytes, partBytes = defaultPartBytes) {
      const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }));
      const uploadId = created.UploadId;
      if (!uploadId) throw new Error("storage returned no multipart upload id");
      const count = Math.ceil(bytes / partBytes);
      const partLengths = Array.from({ length: count }, (_, i) => (i < count - 1 ? partBytes : bytes - partBytes * (count - 1)));
      const parts = await Promise.all(
        partLengths.map(async (length, i) => ({
          partNumber: i + 1,
          url: await getSignedUrl(
            client,
            new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: i + 1, ContentLength: length }),
            { expiresIn },
          ),
        })),
      );
      return { uploadId, partBytes, partLengths, parts };
    },

    async completeMultipart(key, uploadId, parts) {
      const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      try {
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: sorted.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
          }),
        );
        return "completed";
      } catch (e) {
        const name = (e as { name?: string }).name ?? "";
        if (name === "NoSuchUpload") return "gone";
        if (INVALID_PARTS.has(name)) return "invalid_parts";
        throw e;
      }
    },

    async abortMultipart(key, uploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    },

    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { bytes: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? null };
      } catch (e) {
        const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },

    async copy(fromKey, toKey, contentType) {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: toKey,
          CopySource: `${bucket}/${fromKey.split("/").map(encodeURIComponent).join("/")}`,
          MetadataDirective: "REPLACE",
          ContentType: contentType,
        }),
      );
    },

    async presignGet(key, headers) {
      if (!headers.contentDisposition.startsWith("attachment") || !headers.contentType) {
        throw new Error("a download URL needs an attachment disposition and a content type");
      }
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: headers.contentDisposition,
          ResponseContentType: headers.contentType,
        }),
        { expiresIn: opts.downloadTtlSeconds ?? limits.urls.downloadTtlSeconds },
      );
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** The originals bucket from the STASH_S3_* settings. Path-style works for SeaweedFS and R2. */
export function originalsFromEnv(): OriginalsStorage {
  return s3Originals({ client: s3ClientFromEnv(), bucket: storageEnv().bucket });
}

/** The S3 client for the STASH_S3_* settings. Exported for its config test. */
export function s3ClientFromEnv(): S3Client {
  const env = storageEnv();
  return new S3Client({
    endpoint: env.endpoint,
    region: env.region,
    forcePathStyle: true,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
    // The default adds a CRC32 of an empty body to presigned PUTs, which a browser upload then fails.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
