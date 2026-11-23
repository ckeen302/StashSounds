# Handoff 104 requestDownload with license record and signed URL
Lane: platform
Branch: lane/platform-104 (from lane/platform-103, with origin/phase-0/foundations merged in)

## Plan

`requestDownload({ itemId, sampleId? })` is a member action that runs in four steps.

1. **The license record, as the caller.** `record_download(p_item_id, p_kit_sample_id)` runs with the user's own client. It is the only authority on who may download:
   - Signed out is `unauthorized`. The wrapper catches this first; the database refuses it as well.
   - A suspended account is `forbidden`.
   - Another user's draft, or a missing item or sample, is `not_found`.
   - A user over limits.rateLimits.downloadsPerDay is `rate_limited`, through `rate_limit_user('download')`.
   - It writes the downloads row with the license and its version (the record is kept even if the item is removed later).
   - Nothing is signed unless it succeeds.
2. **Where the original is, with the service role.** Policies hide an original's path from everyone but the owner, and kit_samples.original_path is never selectable through the API ("originals are signed by the server", migration grants). The server reads only the one path that record_download has just authorized:
   - For an item, the `original` row in the originals bucket of that item.
   - For a kit sample, the `original_path` of that sample, filtered by item.
   - This is the only service-role read in the lane, and it is scoped to ids the database has just approved.
3. **The signed GET.** A new storage method `presignGet(key, { fileName, contentType, ttlSeconds })`:
   - Always sets ResponseContentDisposition `attachment` (an ASCII `filename=` plus an RFC 5987 `filename*=`).
   - Always sets ResponseContentType from the row (PR #6 security note): the item_files row's `mime`, or for a kit sample `public.mime_for_ext` of its stored extension, called with the service role so the database's table is not retyped.
   - Expires after `limits.urls.downloadTtlSeconds`, read when the URL is signed.
4. **The output** is built from the downloads row: `{ downloadId, url, expiresAt, fileName, license, licenseVersion }`.
   - The file name is built from the title: control characters and `/ \ " ;` are stripped, it is capped at 100 characters, and the original's extension is added.
   - A kit sample's file name is "Title - Sample name.ext".

Files:
- `apps/web/src/server/storage/originals.ts`: add `presignGet` and a download lifetime option.
- `apps/web/src/server/testing/s3-stub.ts`: add GET with the response-header overrides.
- `apps/web/src/server/testing/fake-storage.ts`: add `presignGet`.
- `apps/web/src/server/downloads/request-download.ts`.
- `apps/web/src/server/downloads/file-name.ts`.
- `apps/web/src/server/downloads/actions.ts` ("use server"), plus the barrel export.

Tests first:
- `storage/originals.test.ts`, over HTTP against the stub:
  - the signed GET returns the bytes with `attachment` and the row's type;
  - the URL expires at downloadTtlSeconds;
  - the URL names only its own key.
- `storage/seaweedfs.test.ts` (skips without storage): the same three checks against real storage, plus that an unsigned GET of the object is refused.
- `downloads/downloads.test.ts`:
  - the record comes before the URL, and nothing is signed when it is refused;
  - anon is `unauthorized`;
  - another user's draft is `not_found`;
  - a user over the limit is `rate_limited`;
  - suspended is `forbidden`;
  - a kit downloads the whole ZIP or one sample, and another kit's sample is `not_found`;
  - the license version comes from the record;
  - file names are safe;
  - the type comes from the row, never the request.
- `supabase/tests/downloads.test.ts`:
  - record_download writes the license and version;
  - the downloader reads only their own records;
  - a kit sample must belong to the item;
  - the rate limit;
  - original paths stay hidden from the downloader while the service role reads them;
  - mime_for_ext is service role only.
