# Build spec

> Source: Stash MVP Build Documentation (23 Nov 2026), Build spec. Where this file and the code disagree, raise it with the lead; do not silently pick one.

This is the MVP at the level an agent can build from: the limits, every screen, every endpoint, the schema, each worker job, the audio interface, and the ordered ticket list. Working name: Stash.

## Limits and constants

Every number an agent would otherwise invent is fixed here and lives in one file, `packages/contracts/limits.json`, which the web app and the worker both read. These are starting values; change them in that one place.

| Area | Constant | Value |
| --- | --- | --- |
| Loop | Formats; max size; max length | WAV, AIFF, FLAC, MP3; 50 MB; 60 s |
| One-shot | Formats; max size; max length | WAV, AIFF, FLAC; 10 MB; 15 s |
| Drum kit | ZIP size; unpacked size; file count; folder depth | 500 MB; 1 GB; 300; 4. No nested archives. |
| MIDI | Max size; max notes; max length | 1 MB; 20,000; 5 minutes |
| Preset | Preset file size; demo length; demo size | 20 MB; 5 to 30 s; 20 MB |
| Text | Title; description; bio; handle | 80; 500; 280 characters; handle 3 to 24 of a-z, 0-9, underscore |
| Tags | Per item; length | 8; 2 to 40 characters |
| Quota | Storage per user; uploads per day | 2 GB, 10 GB for trusted uploaders; 50 |
| Preview | Loop bitrate; one-shot and kit sample bitrate | MP3 192 kbps up to 20 s, 128 kbps beyond; 192 kbps |
| Loudness | Loop and demo previews; one-shots | −14 LUFS with a −1 dB true-peak ceiling; peak-normalized to −1 dB |
| Waveform | Stored peak points per file | 800, downsampled in the browser for small rows |
| URLs | Upload URL lifetime; download URL lifetime | 15 minutes; 5 minutes |
| Rate limits | Likes; follows; reports; downloads; search | 120 per hour; 60 per hour; 10 per day; 500 per day; 60 per minute per address |
| Worker | Timeouts for audio, kit, MIDI, preset render | 120 s; 600 s; 60 s; 180 s |
| Worker | Attempts and backoff | 3 attempts; retry after 30 s, 2 min, 10 min |
| Lists | Page size; trending window | 30 items; 7 days |
| Moderation | Upheld takedowns before suspension | 3 |
| Performance | Time to first sound | 300 ms on a fast connection, 800 ms on a throttled one |
| Performance | Item page: largest paint; layout shift; script before audio loads | 2.0 s; 0.05; 200 KB compressed |

Originals are kept exactly as uploaded. Every limit is checked twice: in the browser for a fast error, and on the server or worker because the browser check can be bypassed.

## Routes and screens

The MVP has 19 routes. Public pages are rendered on the server so search engines and link previews see real content; the player bar and audio engine sit in the root layout and survive every navigation.

| Route | Screen | Done when |
| --- | --- | --- |
| `/` | Home | Signed out: trending rows, first sound one click away. Signed in: following feed first, then trending. Infinite scroll by cursor. |
| `/browse/[type]` | Browse | Tabs for the five types. Filters for BPM range, key, genre, tags and sort, all stored in the URL. Arrow keys move the selection and playback follows. |
| `/search` | Search | Query in the URL. Results grouped by type with counts. Typos still find close titles. Empty state suggests tags. |
| `/[type]/[slug]-[id]` | Item page | The type's large player, title, uploader card with follow, license badge, key, BPM, tags, like, download, share, more from this uploader, similar items. Correct preview card when the link is shared. |
| `/u/[handle]` | Profile | Avatar, bio, links, follower and download totals, follow button, tabs per type, most popular first or newest first. |
| `/style/[tag]` | Reference page | Everything tagged in the style of one artist or song, grouped by type, playable in place. |
| `/tag/[tag]` | Tag page | All published items with a tag. |
| `/upload` | Upload | Drop one or many files. Each shows live status from upload through processing. Detected fields are pre-filled and editable. License picker. Publish one or all. Refresh does not lose drafts. |
| `/library` | Library | Tabs for likes, downloads with license records, and your own uploads including drafts and flagged items. |
| `/notifications` | Notifications | Batched list, unread first, marks read on view. |
| `/settings` | Settings | Profile fields, handle, avatar, links, email preferences, delete account. |
| `/login` | Sign in | Email link, Google, Discord. New users choose a handle before anything else. |
| `/embed/[id]` | Embed | A minimal player for one item, small enough to load inside another site, with a link back. |
| `/licenses` | Licenses | The three licenses in plain language, with version numbers. |
| `/dmca` | Takedown | Agent contact details and the notice form. |
| `/terms`, `/privacy` | Legal | Lawyer-supplied text. |
| `/admin` | Admin | Review queue for flagged items, reports, takedown notices, user lookup, suspend and restore. Admin role only. |
| `/dev/gallery` | Component gallery | Every component in every state. Not linked, not indexed. |
| `/dev/player` | Player test page | Real rows played through the engine, for end-to-end tests. Answers 404 unless the server runs with `STASH_DEV_PAGES=1` (never set in production). |

### Behavior every screen shares

- Keyboard: space plays and pauses; up and down move through any list; left and right scrub; [ and ] shift key; - and = change tempo; L likes; D downloads; / focuses search. On kit and preset pages the letter keys play sounds, so like and download become Shift+L and Shift+D.
- Signed-out actions: like, follow and download open the sign-in dialog and complete the action after sign-in.
- States: every list has a skeleton while loading, an empty state with a next step, and an error state with retry.
- Phone: every screen works at 380 pixels wide with touch targets of at least 40 pixels.

## API surface

Mutations are server actions; anything that needs its own URL is a route handler. Every one passes through a single wrapper that checks the session, validates input against a contracts schema, applies the rate limit and returns a typed result or a typed error.

| Name | Kind | Who | Does |
| --- | --- | --- | --- |
| `createUploadSlot` | Action | Signed in, verified email | Checks type, size and quota. Creates a draft item and file row. Returns a presigned upload URL, or part URLs for large files. |
| `completeUpload` | Action | Owner | Confirms the object exists in storage with the declared size. Sets status to processing and queues a job. |
| `updateItem` | Action | Owner | Edits title, description, tags, genre, license, and corrections to detected BPM and key. |
| `publishItem` | Action | Owner | Allowed only from ready. Requires the rights confirmation. Sets published time and notifies followers. |
| `unpublishItem`, `deleteItem` | Action | Owner | Unpublish returns to ready. Delete marks removed and schedules file cleanup; download records are kept. |
| `requestDownload` | Action | Signed in | Writes the download record with the license and its version. Returns a signed URL valid for 5 minutes. For a kit, accepts one sample or the whole ZIP. |
| `toggleLike` | Action | Signed in | Adds or removes a like. Counts update by trigger. |
| `toggleFollow` | Action | Signed in | Adds or removes a follow. Notifies on new follow. |
| `updateProfile`, `claimHandle` | Action | Signed in | Profile fields; handle is checked for format, reserved words and uniqueness. |
| `reportItem` | Action | Signed in | Creates a report. Three open reports on one item move it to the review queue. |
| `submitTakedown` | Action | Anyone | Stores a takedown notice and alerts admins. Protected by a challenge and a strict rate limit. |
| `markNotificationsRead` | Action | Signed in | Marks all or some read. |
| `adminReview` | Action | Admin | Approve, remove, restore; uphold or dismiss a report; suspend or restore a user; records who and why. |
| `GET /api/items` | Route | Anyone | Browse and search: type, query, BPM range, key, genre, tags, sort, cursor. Returns rows with preview URL and peaks. |
| `GET /api/feed` | Route | Anyone | Following feed when signed in, trending otherwise. Cursor paged. |
| `GET /api/items/[id]/similar` | Route | Anyone | Same type, near BPM, compatible key, shared tags. |
| `GET /embed/[id]` | Route | Anyone | Embed page. Sets headers that allow framing on other sites. |
| `GET /og/[id]` | Route | Anyone | Share image drawn from the item's waveform and metadata. |

### Conventions

- Errors are data. Every action returns either `{ ok: true, data }` or `{ ok: false, code, message }`, with codes from one list in contracts: `unauthorized`, `forbidden`, `not_found`, `invalid`, `rate_limited`, `quota_exceeded`, `conflict`.
- List responses carry everything a row needs to play: preview URL, peaks, duration, BPM, key, type, title, owner handle and avatar. A result row never triggers a second request before sound.
- Cursors, not page numbers. Lists page by an opaque cursor built from the sort value and the id.
- The browser never talks to storage or the database directly except to upload to a presigned URL and to stream public previews.
- Reads of public data are cacheable. Item pages and public lists are cached and refreshed when the item changes.

## Database schema

The schema, access policies, and triggers and functions are in [data-model.md](data-model.md).

## Worker jobs

One job kind per content type, each a pure function of the original file: the same input always produces the same outputs, so a failed job is simply run again. Every job starts with the same three checks and ends with the same write.

### Common steps

1. Fetch the original from the private bucket into a temporary folder that is deleted when the job ends.
2. Verify the real type from the file's leading bytes, the size against the limit, and the SHA-256 against existing originals. An exact match by another user flags the item as a duplicate.
3. Process by type, in a subprocess with a time limit and a memory limit, so a hostile file cannot stall the worker.
4. Write derived files to the public bucket under content-hashed names, then update the item, its files and its job row in one database transaction. Status becomes `ready`, or `flagged` with a reason.

### Loop

| Step | Detail |
| --- | --- |
| Decode | ffmpeg to 44.1 kHz stereo floating-point audio. Reject silence and files over 60 s. |
| Duration and loop length | Record the exact sample count. The player loops on this number, not on the preview file's length. |
| BPM | Three sources, in order of trust. A number in the file name between 60 and 200. Then duration: assume a whole number of bars (1, 2, 4, 8, 16) in 4/4 and list the tempos that fit. Then onset-based tempo (numpy STFT onset envelope) to choose among those candidates. Store the value, the source and whether the sources agreed. |
| Key | A key in the file name, such as `Cmin` or `F#m`. Otherwise compare the loop's averaged chroma against the 24 major and minor key profiles and take the best match, storing the margin over the runner-up as confidence. Chroma is computed with numpy (decision 0017: librosa's soxr and soundfile dependencies are LGPL), and the profile comparison is about thirty lines the Pipeline builder writes and tests. |
| Preview | Loudness-match to −14 LUFS, encode MP3 at the bitrate in the limits table. |
| Peaks | 800 values of peak amplitude from the mono mix, stored as bytes. |
| Fingerprint | Chromaprint via `fpcalc`. Compare against stored fingerprints of similar duration; similarity over the threshold flags the item. Start the threshold at 0.90 and tune it on the fixtures. |

Low confidence is not a failure. The upload form shows detected BPM and key as editable fields, marked "check this" when sources disagreed.

### One-shot

Same as a loop without BPM. Root note comes from the file name or from pitch tracking on the first 500 ms. The preview is peak-normalized instead of loudness-matched, because loudness measures are unreliable on very short sounds.

### Drum kit

| Step | Detail |
| --- | --- |
| Unpack safely | Read the ZIP's listing before extracting anything. Refuse if file count, total unpacked size, folder depth or compression ratio exceeds the limits, if any path leaves the target folder, or if it contains another archive. |
| Select | Keep audio files. Ignore everything else, including system files and documents. |
| Per sample | Run the one-shot steps. Write one `kit_samples` row each. |
| Categorize | Match the file and folder name against patterns: kick, snare, clap, hat, open hat, 808 or bass, perc, tom, cymbal, FX, vocal. Anything else is `other`. |
| Order | Position samples so the first sixteen make a playable grid: kicks, snares, claps, hats, open hats, 808s, percussion, then the rest. |
| Screen | Fingerprint every sample. If more than a set share of the kit matches existing originals from other users, flag the whole kit. |

### MIDI

| Step | Detail |
| --- | --- |
| Parse | Read with mido. Reject files that fail to parse, exceed the note limit, or contain no notes. |
| Tempo | Use the file's tempo event. If there is none, assume 120 and mark it as assumed. |
| Notes file | A compact list of start in beats, length in beats, pitch and velocity, sorted by start, plus bar count and pitch range. This is what the piano roll draws and the player schedules. |
| Key | Weight each pitch class by total note length and compare against the same key profiles used for audio. |
| Kind | Drums if the notes sit on the percussion channel. Chords if three or more notes often sound together. Bass if single notes sit low. Otherwise melody. |

### Preset

| Step | Detail |
| --- | --- |
| Identify | Extension and file header decide the synth: `.vital` is JSON; Serum uses `.fxp` and `.SerumPreset`. Keep the known signatures in one table in code. Unknown formats are accepted with the synth named by the uploader. |
| Demo audio | Run the loop steps on the uploader's demo, without BPM. |
| Vital only: render | In a separate process, load the preset with the vita package and render single notes every three semitones from C1 to C5. vita renders one note per call, so the worker builds the demo phrase by layering those renders into a short chord and melody. Store each note as a `sampled_note` file with its pitch in `meta`. |
| Guard | A render that is silent, clips, or exceeds the time limit falls back to the uploader's demo alone. |

## Failure handling

| Case | Result |
| --- | --- |
| Corrupt or unsupported file | Job fails once, no retry. Item returns to draft with a plain-language reason. |
| Timeout or crash | Retry with backoff up to the attempt limit, then fail with the error stored. |
| Storage or database error | Retry. Derived files have content-hashed names, so a rerun overwrites nothing wrong. |
| Suspected stolen content | Item is `flagged`, visible only to its owner and admins, with the reason shown and an appeal link. |

## Audio engine interface

The Interface lane talks to sound through this one interface and nothing else. The Audio lane may change everything behind it without touching a single component.

```ts
// packages/audio: the whole public surface

export type SoundId = 'keys' | 'pluck' | 'pad' | 'bass' | '808' | 'bell' | 'strings' | 'drums';

export type Playable =
  | { kind: 'loop';    id: string; previewUrl: string; loopSamples: number; sampleRate: number;
      bpm?: number; keyRoot?: number }
  | { kind: 'oneshot'; id: string; previewUrl: string; rootNote?: number }
  | { kind: 'kit';     id: string;
      pads: { index: number; name: string; category: string; previewUrl: string }[] }
  | { kind: 'midi';    id: string; notesUrl: string; bpm: number; sound: SoundId }
  | { kind: 'preset';  id: string; demoUrl: string;
      sampledNotes?: { pitch: number; url: string }[] };

export interface EngineState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  current: Playable | null;
  durationMs: number;
  tempoRatio: number;   // 1 = original speed
  transpose: number;    // semitones
  volume: number;       // 0 to 1
  loop: boolean;        // default true; false: a loop plays its current pass to the end, then pauses at 0
  queue: Playable[];
  queueIndex: number;
}

export interface Engine {
  unlock(): Promise<void>;                   // call on the first tap or key press
  preload(item: Playable): void;             // fetch and decode before play is pressed
  play(item?: Playable): Promise<void>;      // no argument resumes
  pause(): void;
  seek(positionMs: number): void;
  setTempo(bpm: number): void;               // loops and MIDI
  setTranspose(semitones: number): void;     // loops, MIDI, one-shots
  setVolume(volume: number): void;
  setLoop(on: boolean): void;                // loops; the end is placed on the audio clock
  setSound(sound: SoundId): void;            // MIDI
  triggerPad(index: number, velocity?: number): void;   // kits
  noteOn(pitch: number, velocity?: number): void;       // one-shots and Vital presets
  noteOff(pitch: number): void;
  setQueue(items: Playable[], startIndex?: number): void;
  next(): void;
  previous(): void;
  getState(): EngineState;
  getPositionMs(): number;                   // read every frame by the waveform
  subscribe(listener: (state: EngineState) => void): () => void;
}

export function getEngine(): Engine;                                        // one instance for the browser session
export function usePlayerState<T>(select: (state: EngineState) => T): T;    // React binding
```

### Rules behind the interface

- One audio context for the session, created on the first user gesture, never recreated on navigation.
- Position is not state. The playhead reads `getPositionMs()` inside an animation frame. Putting position in React state would re-render the page sixty times a second.
- Heavy parts load late. The stretch processor and the MIDI synth are fetched the first time something needs them, not with the page.
- Everything is scheduled on the audio clock, never with timers, so MIDI and the kit demo pattern stay in time under load.
- Loops are seamless by test. A unit test renders two passes of every fixture loop offline and fails if there is a gap or a click at the join. If MP3 previews cannot pass it, loop previews move to a format that can.
- Loop off plays the current pass to its end, fades out over 5 ms and pauses at 0. A seek, a resume or a tempo change moves the end. Switching loop back on before the end carries on with no gap. One-shots and demos end by themselves.
- The stretch processor loads from a static, versioned file the web app serves (`/worklets/signalsmith-stretch-<version>.mjs`, copied at build time), never from bundled code. If it fails to load within 3 s, the loop plays on at tempo 1 and key 0.
- Kits behave like a drum machine. A closed hat cuts off an open hat. A limiter on the output keeps stacked pads from clipping.
- The preset sampler plays the nearest rendered note, repitched by at most one semitone in either direction.
- Failures are quiet and recoverable. A preview that fails to load sets status to error with a retry; it never throws into the UI.

## Ticket backlog

The MVP is 68 tickets across four phases. Within a phase the four lanes run in parallel; a ticket starts when the tickets it depends on have merged. Numbers encode phase and lane: the first digit is the phase, the second is the lane.

### Phase 0: foundations (lead only, in order)

| # | Ticket |
| --- | --- |
| 001 | Scaffold the monorepo, TypeScript strict, the Python worker project, and every command in CLAUDE.md |
| 002 | CLAUDE.md, the spec split into `docs/spec/`, reviewer definitions, ticket and handoff templates |
| 003 | Contracts: schemas for every item type, file, profile, details shape, request, response, error code, and the limits file |
| 004 | First migration, access policies, functions, seed data, and the policy test harness |
| 005 | Design tokens, theme, the lint rule banning raw values, fonts, the empty gallery route |
| 006 | Fixtures: your own loops, one-shots, kits, MIDI files and presets, plus hostile files for the worker tests |
| 007 | One-command local stack: database, S3-compatible storage, worker, web app |
| 008 | CI running every quality gate; visual baseline tooling; performance budget tooling |

### Phase 1: loops end to end

| # | Lane | Ticket | After |
| --- | --- | --- | --- |
| 101 | Platform | Sign-in by email link, Google and Discord; profile and account rows; handle claim | 004 |
| 102 | Platform | `createUploadSlot` and `completeUpload`: presigned URLs, multipart, quota, job enqueue | 101 |
| 103 | Platform | Item reads; `updateItem`, `publishItem`, `unpublishItem`, `deleteItem` | 102 |
| 104 | Platform | `requestDownload` with license record and signed URL | 103 |
| 111 | Pipeline | Job runner: claim, time and memory limits, retries, status updates | 004 |
| 112 | Pipeline | Audio decode, loudness-matched preview, peaks, exact loop length | 111 |
| 113 | Pipeline | BPM and key detection with file-name parsing and confidence | 112 |
| 114 | Pipeline | SHA and Chromaprint duplicate check, flagged status with reason | 112 |
| 121 | Audio | Engine core: context lifecycle, load, play, pause, seek, state, subscribe | 003 |
| 122 | Audio | Loop player with tempo and key shift; the seamless-loop test | 121 |
| 123 | Audio | Preload, queue, next and previous; time-to-first-sound test | 122 |
| 131 | Interface | Core components with all states, shown in the gallery | 005 |
| 132 | Interface | App shell, navigation, the player bar wired to the engine | 131, 121 |
| 133 | Interface | Sign-in screens and handle claim | 131, 101 |
| 134 | Interface | Upload flow for one loop with live processing status | 132, 102 |
| 135 | Interface | Loop item page with waveform, tempo and key controls, download | 132, 103, 122 |
| 136 | Interface | Polish pass: shell, player bar, loop page | 135 |
| 190 | Lead | End-to-end test: every loop fixture uploaded, processed, published, played and downloaded through the real path | all above |

### Phase 2: every content type

| # | Lane | Ticket | After |
| --- | --- | --- | --- |
| 201 | Platform | Browse and search query: full-text, filters, sorts, cursor paging | 103 |
| 202 | Platform | Tags and reference tags; `set_item_tags`; tag and style page queries | 201 |
| 203 | Platform | Rate limits and quotas on every action | 104 |
| 204 | Platform | Similar-items query | 201 |
| 211 | Pipeline | One-shot processor with root note | 113 |
| 212 | Pipeline | Kit processor: safe unpack, per-sample processing, categories, pad order | 211 |
| 213 | Pipeline | MIDI processor: notes file, tempo, key, kind | 111 |
| 214 | Pipeline | Preset processor: synth identification and demo audio | 112 |
| 215 | Pipeline | Vital renderer in its own process: sampled notes and demo phrase | 214 |
| 221 | Audio | One-shot and pad players with choke groups and output limiter | 123 |
| 222 | Audio | Kit demo-pattern sequencer on the audio clock | 221 |
| 223 | Audio | MIDI player: synth, custom SoundFont, tempo, transpose, sound switch | 123 |
| 224 | Audio | Sampler for rendered preset notes; computer-keyboard note input | 221 |
| 225 | Audio | Global keyboard map | 221 |
| 231 | Interface | Browse and search screens with URL filters and keyboard audition | 201, 136 |
| 232 | Interface | One-shot page and kit page with the pad grid | 221, 212 |
| 233 | Interface | MIDI page with the piano roll and sound picker | 223, 213 |
| 234 | Interface | Preset page with demo and playable keyboard | 224, 215 |
| 235 | Interface | Multi-file upload and per-type forms | 134, 212, 213, 214 |
| 236 | Interface | Tag and style pages | 202, 231 |
| 237 | Interface | Phone layouts for every screen so far | 231 to 236 |
| 238 | Interface | Polish pass: search rows, kit page, MIDI page, preset page | 237 |
| 290 | Lead | End-to-end test: every fixture of every type through the real path; keyboard-only audition of thirty results | all above |

### Phase 3: social and safety

| # | Lane | Ticket | After |
| --- | --- | --- | --- |
| 301 | Platform | Follows and likes with count triggers | 203 |
| 302 | Platform | Following feed and trending | 301 |
| 303 | Platform | Notifications with batching | 301 |
| 304 | Platform | Reports, takedown notices, strikes, admin actions with an audit trail | 203 |
| 305 | Platform | Embed route and share-image route | 201 |
| 311 | Pipeline | Commercial fingerprint check behind a switch | 114 |
| 312 | Pipeline | Pack-name blocklist and review-queue reasons | 212 |
| 313 | Pipeline | Reprocess command to rerun any job kind over existing items | 215 |
| 321 | Audio | Embed build of the player, small enough for third-party pages | 225 |
| 322 | Audio | Performance pass on low-end phones | 225 |
| 331 | Interface | Profile screen | 301 |
| 332 | Interface | Home feed, signed in and signed out | 302 |
| 333 | Interface | Notifications and library | 303 |
| 334 | Interface | Report dialog, takedown form, licenses and legal pages | 304 |
| 335 | Interface | Admin screen | 304 |
| 336 | Interface | Embed page and share cards | 305, 321 |
| 337 | Interface | Settings and account deletion | 301 |
| 338 | Interface | Final polish and accessibility pass on every screen | 331 to 337 |
| 390 | Lead | Launch checklist: environments, backups, error tracking, analytics, takedown agent registered, lawyer review done | all above |

### Reading the backlog

- Phase 1 has the longest chain: 004 to 101 to 102 to 134. Start those first; the Interface lane works from mock data until 102 and 103 merge.
- Each polish ticket is real work, scheduled like a feature and reviewed with before and after screenshots.
- The lead's 190, 290 and 390 tickets are the phase gates. A phase is done when its gate ticket passes, not when its features exist.
