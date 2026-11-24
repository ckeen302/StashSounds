import "server-only";
import { z } from "zod";

/** Server-only storage settings (.env.example: SeaweedFS locally, Cloudflare R2 in production). */
const storageEnvSchema = z.object({
  STASH_S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  STASH_S3_REGION: z.string().min(1),
  STASH_S3_ACCESS_KEY_ID: z.string().min(1),
  STASH_S3_SECRET_ACCESS_KEY: z.string().min(1),
  STASH_BUCKET_ORIGINALS: z.string().min(3).max(63),
});

export type StorageEnv = { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string; bucket: string };

export function storageEnv(): StorageEnv {
  const r = storageEnvSchema.safeParse({
    STASH_S3_ENDPOINT: process.env.STASH_S3_ENDPOINT,
    STASH_S3_REGION: process.env.STASH_S3_REGION,
    STASH_S3_ACCESS_KEY_ID: process.env.STASH_S3_ACCESS_KEY_ID,
    STASH_S3_SECRET_ACCESS_KEY: process.env.STASH_S3_SECRET_ACCESS_KEY,
    STASH_BUCKET_ORIGINALS: process.env.STASH_BUCKET_ORIGINALS,
  });
  if (!r.success) {
    const names = [...new Set(r.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Missing or invalid environment variables: ${names}. See .env.example.`);
  }
  return {
    endpoint: r.data.STASH_S3_ENDPOINT,
    region: r.data.STASH_S3_REGION,
    accessKeyId: r.data.STASH_S3_ACCESS_KEY_ID,
    secretAccessKey: r.data.STASH_S3_SECRET_ACCESS_KEY,
    bucket: r.data.STASH_BUCKET_ORIGINALS,
  };
}
