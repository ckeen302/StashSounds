import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { limits } from "@stash/contracts";
import { storageEnv } from "./env.ts";

/**
 * The private originals bucket. Browsers upload straight to it with presigned URLs; only the
 * server (HEAD, delete) and the worker (download) touch it otherwise. Every URL names one object
 * and signs its Content-Length, so it accepts exactly the declared bytes for that key and nothing
 * else, until limits.urls.uploadTtlSeconds pass.
 */
export type PresignedPut = { url: string; headers: Record<string, string> };
export type MultipartStart = {
  uploadId: string;
  partBytes: number;
  /** Length of each part, in order; every part but the last is partBytes. */
  partLengths: number[];
  parts: Array<{ partNumber: number; url: string }>;
};

export interface OriginalsStorage {
  presignPut(key: string, bytes: number): Promise<PresignedPut>;
  startMultipart(key: string, bytes: number, partBytes?: number): Promise<MultipartStart>;
  /** "gone" when the upload id is unknown (already completed, aborted or expired). */
  completeMultipart(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<"completed" | "gone">;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  head(key: string): Promise<{ bytes: number } | null>;
  remove(key: string): Promise<void>;
}

export function s3Originals(opts: { client: S3Client; bucket: string; ttlSeconds?: number; partBytes?: number }): OriginalsStorage {
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
        if ((e as { name?: string }).name === "NoSuchUpload") return "gone";
        throw e;
      }
    },

    async abortMultipart(key, uploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    },

    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { bytes: Number(r.ContentLength ?? 0) };
      } catch (e) {
        const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** The originals bucket from the STASH_S3_* settings. Path-style works for SeaweedFS and R2. */
export function originalsFromEnv(): OriginalsStorage {
  const env = storageEnv();
  const client = new S3Client({
    endpoint: env.endpoint,
    region: env.region,
    forcePathStyle: true,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
    // The default adds a CRC32 of an empty body to presigned PUTs, which a browser upload then fails.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return s3Originals({ client, bucket: env.bucket });
}
