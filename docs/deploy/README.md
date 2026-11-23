# Deploy notes

- R2 originals bucket: CORS from r2-originals-cors.json (PUT from the site), lifecycle from r2-lifecycle.json.
- R2 previews bucket: CORS from r2-previews-cors.json (GET for playback).
- Web host: keep the maximum function duration at or below 600 s. Upload completion claims lapse after
  `limits.urls.uploadTtlSeconds` (900 s), and a request must never outlive its claim (decision 0016).
