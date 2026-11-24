# Request 102 CORS on the originals bucket for browser uploads
From lane: platform
For: lead
Blocking ticket: 134 (the upload screen), not 102

## What I need changed
Browsers PUT straight to presigned URLs on another origin: the app is on localhost:3000 (or 3100
in e2e), and storage is on 127.0.0.1:9000 locally and R2 in production. The `originals` bucket
needs a CORS rule in the local storage setup (decision 0011 says this comes to the lead) and on R2:

- AllowedOrigins: the site origin (`NEXT_PUBLIC_SITE_URL`; locally http://localhost:3000 and http://localhost:3100)
- AllowedMethods: PUT
- AllowedHeaders: content-type
- ExposeHeaders: ETag (multipart completion needs each part's ETag)
- MaxAgeSeconds: 3600

## Why
Without it, the browser's preflight fails and no upload starts. Without `ETag` exposed, the page
cannot read part ETags and completeUpload cannot finish a multipart upload.

## Workaround in the meantime
Server-side tests and the SeaweedFS suite use Node's fetch, which does not enforce CORS.
