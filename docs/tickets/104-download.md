# 104 requestDownload with license record and signed URL
Lane: platform
Depends on: 103

## Goal
A signed-in user downloads an original; a license record is written first and a 5-minute signed URL is returned.

## Owned paths
apps/web/src/server/, supabase/tests/

## Spec and contracts that apply
- architecture.md: step 7 Download
- build-spec.md: API surface (requestDownload), Limits (download URL lifetime)
- data-model.md: downloads, record_download
- contracts: requestDownloadInput/Output, downloadRecordSchema, LICENSES

## Acceptance criteria
- [ ] Calls record_download, then signs a GET for the original with limits.urls.downloadTtlSeconds and a Content-Disposition file name built from the title
- [ ] Kit: whole ZIP, or one sample by sampleId
- [ ] Rate limited at limits.rateLimits.downloadsPerDay
- [ ] Tests: record written with license version, URL expires, anon gets `unauthorized`, draft of another user gets `not_found`

## Out of scope
- Library screen (333)
