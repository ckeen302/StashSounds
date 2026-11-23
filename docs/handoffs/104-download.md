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

## What changed

**Storage**
- `storage/originals.ts` has a new method, `presignGet(key, { contentDisposition, contentType })`.
  - It signs a GetObject with ResponseContentDisposition and ResponseContentType.
  - It refuses to sign unless the disposition starts with `attachment` and a content type is given.
  - Expiry is `limits.urls.downloadTtlSeconds`, read when the URL is signed. `s3Originals({ downloadTtlSeconds })` can override it, which the tests use.
- `testing/s3-stub.ts` now serves GET, and applies the `response-content-*` overrides the way S3 does. A body can be a Buffer.
- `testing/fake-storage.ts` has `presignGet`.

**The action** (`downloads/request-download.ts`, member mode)
1. `record_download` runs as the caller. Its row is parsed with Zod (id, item_id, item_title, license, license_version, created_at).
2. The service role reads the original's path, only for the approved ids:
   - for an item, `item_files` filtered to that item, role `original` and the originals bucket;
   - for a sample, `kit_samples` filtered by id and item.
   - If the original has no `uploaded_at` (only possible for the owner's own unfinished draft), the result is `not_found` and nothing is signed.
3. The content type comes from the database:
   - for an item, the row's `mime`;
   - for a kit sample, `public.mime_for_ext` of the stored extension, called with the service role. This reuses the database's table rather than copying it into TypeScript.
4. The output is `{ downloadId, url, expiresAt, fileName, license, licenseVersion }`.
   - downloadId, license and licenseVersion come from the downloads row.
   - expiresAt is now plus downloadTtlSeconds.

**File names** (`downloads/file-name.ts`)
- `downloadFileName(title, originalPath, sampleName?)` works like this:
  - It strips control characters (including CR and LF) and `/ \ " ; : * ? < > |`, collapses whitespace, and drops leading and trailing dots.
  - The base name is capped at 100 characters. An empty base becomes "download".
  - The extension is the stored original's, lowercased, and is never taken from the request.
  - A kit sample's name is "Title - Sample.ext".
- `contentDisposition(name)` returns `attachment; filename="<ASCII>"; filename*=UTF-8''<percent-encoded>`, following RFC 6266 and RFC 5987.

**Wiring**
- `downloads/actions.ts` is a "use server" wrapper.
- `requestDownload` is exported from `server/index.ts`.

**Service role use**
This is the only place the Platform lane reads with the service role. It runs after record_download has approved the request, and it is scoped to the approved item and sample ids. Neither the original's path nor a sample's original_path can be read by a user at all.

## Proof
Merged lane/platform-103 (bdfbb04) at df2ef16. `pnpm check && pnpm test && pnpm db:test`, exit 0:
```
 Test Files  15 passed | 1 skipped (16)
      Tests  315 passed | 9 skipped (324)
 Test Files  5 passed (5)
      Tests  144 passed (144)
```

**New tests**
- `storage/originals.test.ts`, over HTTP to the stub (4 tests):
  - The signed GET returns the bytes with `Content-Disposition: attachment` and the row's type, overriding the stored `text/html`.
  - The URL expires at downloadTtlSeconds.
  - It refuses to sign without an attachment disposition and a type.
  - A configured lifetime is the one signed.
- `storage/seaweedfs.test.ts`, 2 tests (skipped here, no storage):
  - The GET downloads as an attachment with the given type, and the same URL for another key is 403.
  - An expired download URL is refused.
- `downloads/downloads.test.ts` (13 tests):
  - The record is written as the caller before the URL is signed, and expiresAt matches downloadTtlSeconds.
  - The path lookup is scoped to the approved item.
  - Kit as a whole ZIP, and kit as one sample (with its type from mime_for_ext).
  - Another kit's sample is `not_found`, with nothing signed and no path read.
  - Anon is `unauthorized`.
  - Another user's draft is `not_found`.
  - Over the limit is `rate_limited`.
  - Suspended is `forbidden`.
  - An unfinished original is `not_found`.
  - Bad ids are `invalid`.
  - File names and the Content-Disposition header.
- `supabase/tests/downloads.test.ts` (8 tests):
  - The record holds the license, its current version and the split, and survives the item being removed.
  - A kit sample must belong to the kit.
  - Another user's draft, ready or flagged item is `not_found`, while the owner can download their own.
  - Anon is denied, and suspended is `forbidden`.
  - Over downloadsPerDay is `rate_limited`, and no record is written.
  - The original's path is hidden from the downloader but readable by the service role, for an item and for a kit sample.
  - mime_for_ext is service role only.

## Not done
The library screen (ticket 333).

## Surprises and decisions
- **Record before URL.** The record is written before the URL is signed, as the ticket says. If the path read or the signing then fails (an outage, or a published item missing its original), a record exists without a URL. The record is the license grant, so I kept it.
- **Owner downloads count.** record_download lets the owner download their own unpublished item, and the downloads trigger counts it in `downloads_count`. So an owner's own downloads are counted too. That is the lead's function, so I am noting it only and filed no request.
- **Kit sample types.** kit_samples has no `mime` column, so a sample's type comes from `mime_for_ext` of its stored extension, which is the same table the uploads use.
- **Signed out.** The wrapper answers `unauthorized` before the database is reached. record_download would refuse anon anyway, because execute is not granted to anon.

## Requests filed
None.
