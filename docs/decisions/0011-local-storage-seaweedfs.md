# 0011 Local S3 storage is SeaweedFS, not MinIO
- Context: The new local-stack CI job failed: `minio/minio` no longer exists on Docker Hub (MinIO stopped publishing community images in 2025). `pnpm dev` needs an S3-compatible server standing in for Cloudflare R2.
- Options: SeaweedFS (Apache-2.0, S3 API with presigned URLs, multipart and per-bucket anonymous read); Supabase Storage's S3 endpoint (one fewer container, but presigned-URL behavior differs from R2); Garage (AGPL); an unmaintained MinIO fork.
- Choice: SeaweedFS `chrislusf/seaweedfs:4.53` in docker-compose.yml, S3 API on host port 9000 so .env.example is unchanged. Credentials and the public-read rule for previews live in docker/seaweedfs-s3.json; `storage-init` creates both buckets.
- Reason: Closest behavior to R2 for the things the upload pipeline uses (presigned PUT, multipart, public GET), permissive license, maintained image.
- Consequence: Ticket 102's tests run against SeaweedFS. If browser uploads need CORS rules locally, the Platform lane files a request and the lead adds them to the storage config.
