# Architecture

> Source: Stash MVP Build Documentation (23 Nov 2026), Tab 1. Where this file and the code disagree, raise it with the lead; do not silently pick one.

## System architecture

The web app never touches audio bytes. Browsers upload straight to storage, a worker turns each original into small playable files, and listeners only ever stream those small files from a CDN.

*Diagram: system architecture · 6 components, 7 flows*

Uploads go from the browser straight to the private bucket. The worker is the only thing that reads originals, and it is the only writer of previews and metadata.

### The upload pipeline, step by step

1. Request a slot. The browser sends file name, size and type to the API. The API checks the session, the user's quota and the size limit, creates a draft item row, and returns a presigned upload URL.
2. Upload direct. The browser sends the file to the private originals bucket in R2. Large files use multipart upload so a dropped connection resumes.
3. Confirm. The browser tells the API the upload finished. The API puts a `process_item` job on the queue.
4. Process. The worker downloads the original and checks the real file type from its bytes, not its extension. Then, by type:
   - Audio: decode with ffmpeg, write a loudness-matched MP3 preview, compute waveform peaks, detect BPM and key, compute a Chromaprint fingerprint.
   - Drum kit: unzip with hard limits (file count, total size, no nested archives, no paths outside the folder), then run the audio steps on each sample and label each one from its name and folder.
   - MIDI: parse tempo, key, bars and notes, and write a compact notes file for the piano roll.
   - Preset: identify the synth from the file, process the uploader's demo audio, and for Vital presets render a demo phrase and a set of sampled notes.
5. Screen. Compare fingerprints against the catalog and, once enabled, against a commercial database. A match sets the item to `flagged` instead of `ready`.
6. Publish. The worker writes preview files to the public previews bucket and updates the item row. The uploader's screen updates over realtime, they confirm tags and license, and publish.
7. Download. The API checks the session, writes a license record, and returns a signed URL to the original that expires in a few minutes.

### Rules that keep it fast and cheap

- Two buckets. `originals` is private and only reachable through signed URLs. `previews` is public, behind a custom domain, with file names that include a content hash so they can be cached forever.
- Previews are small. A 10-second loop as an MP3 preview is a few hundred kilobytes. Listening never pulls the WAV.
- The worker is idempotent. Running the same job twice gives the same result, so a crashed job is simply retried.
- Every job has a row. A `processing_jobs` table records status, attempts and error text, so a failure is visible to you and to the uploader.

### Repository layout

```
apps/web              Next.js app: pages, API routes, server actions
apps/worker           Python worker: one module per content type
packages/contracts    Zod schemas and shared TypeScript types
packages/audio        Browser audio engine: player, MIDI, pads, stretch
packages/ui           Design tokens and shared components
supabase/             SQL migrations, access policies, seed data
docs/                 This document, split into one file per section
```

## Real-time playback

All sound goes through one audio engine that lives for the whole browser session, so navigating between pages never stops playback. This engine is `packages/audio`, and it is the part of the product that has to feel better than anything else out there.

### One engine, four players

| Content | How it plays | Controls | Hard part |
| --- | --- | --- | --- |
| Loop | MP3 preview decoded into a buffer and looped through Signalsmith Stretch | Play, loop, tempo, key in semitones, scrub on the waveform | Seamless loop points: MP3 encoding adds padding, so the worker stores the exact loop length and the player loops on that. |
| One-shot | Buffer triggered on click or key press | Tap to play, pitch across a keyboard | Zero perceived latency: decode on hover. |
| Drum kit | Each sample is a buffer on a 16-pad grid | Pads on mouse and keyboard, demo pattern at a chosen BPM, per-pad download | Loading 50+ samples: fetch the first 16 immediately, the rest on demand. |
| MIDI | Notes file drawn as a piano roll; played by SpessaSynth through a SoundFont | Play, tempo, transpose, sound picker (keys, pluck, pad, bass, 808) | SoundFont size: ship a small custom one with 8 to 10 good sounds, not a full General MIDI set. |
| Preset | Uploader's demo audio; for Vital, sampled notes rendered on the worker | Play demo; for Vital, a playable keyboard | See below. |

### Presets: what is and is not possible

A commercial synth cannot run in a browser, and running one on your server for the public is a licensing problem even where it is technically possible. So presets work in two tiers.

- Every preset: a required demo. The uploader records 5 to 15 seconds of the patch. The site will not publish a preset without one. This alone beats a blind ZIP download.
- Vital presets: rendered automatically. Vital is open source, and the vita Python package loads a .vital preset and renders notes to audio with no screen attached. The worker renders a standard phrase, plus single notes every three semitones across four octaves. The browser loads those notes into a sampler, so a visitor can play the preset on their own keyboard. I did not find another free community site that offers this, though that needs checking.
- Later: a standard demo phrase for everything. Let uploaders pick from a few built-in MIDI phrases to record their demo against, so presets can be compared like for like.

Start with Vital and Serum as the two supported preset formats. Vital gives you the playable tier; Serum is what most hip-hop producers own.

### Performance targets

| Target | How |
| --- | --- |
| Sound within 300 ms of pressing play | Previews under 500 KB on a CDN; start fetching on hover or when a row scrolls into view. |
| No gap when moving between results | Preload the next item's preview while the current one plays. |
| Waveform visible before audio arrives | Peaks ship inside the page data, not as a second request. |
| Playback survives navigation | The engine and the bottom player bar sit in the root layout, outside page content. |
| Works on phones | Create the audio context on the first tap, as mobile browsers require. |

### Keyboard map

Space plays and pauses. Up and down move through a list. Left and right scrub. [ and ] shift key by a semitone. - and = change tempo. L likes, D downloads. On a kit page the letter rows trigger pads.
