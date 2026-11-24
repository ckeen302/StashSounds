# Overview

> Source: Stash MVP Build Documentation (23 Nov 2026), Tab 1. Where this file and the code disagree, raise it with the lead; do not silently pick one.

## Producer Network MVP: Build Documentation

Nov 23, 2026 · @Caden Keen

Working name: Stash. This tab is the overview. The detail agents build from is in three more tabs: Agent playbook for how the agents work together, Build spec for the schema, endpoints, worker jobs and all 68 tickets, and Design spec for the visual rulebook. Where a tab and this overview differ, the tab is newer and wins.

## Decisions at a glance

Build a web app where every upload (loop, MIDI, preset, drum kit, one-shot) gets a page that plays within a fraction of a second, with profiles and follows on top. Messaging ships last. The whole thing is one Next.js app, one Postgres database, one file bucket and one Python worker.

| Decision | Choice | Why |
| --- | --- | --- |
| Web app | Next.js 16 (current Active LTS), TypeScript, React | Server-rendered item pages rank on Google, which is how Looperman gets found. Largest pool of examples for AI agents to draw on. |
| Database, auth, realtime | Supabase (Postgres) | Auth, row-level security and realtime in one service. Postgres handles search and the social graph at MVP scale. |
| File storage | Cloudflare R2 | Downloads cost nothing in bandwidth. For a site that exists to serve audio files, this is the single most important cost decision. |
| Processing | One Python worker reading a job queue | Audio analysis, MIDI parsing, kit unpacking, fingerprinting and preset rendering all have mature Python tooling. |
| Loop playback | Compressed preview + precomputed waveform + Signalsmith Stretch | Instant start, with live tempo and key change. |
| MIDI playback | SpessaSynth in the browser | Plays MIDI through real instrument sounds with no server round trip. |
| Preset playback | Uploader demo required; Vital presets auto-rendered | You cannot run commercial synths in a browser or legally on your server. Vital is the exception. |
| Stolen-upload screening | Chromaprint in-house from day one; ACRCloud once there is traffic | Open upload sites fill with ripped packs. Screening must exist before the first public upload. |
| Build method | One lead session sets contracts, then 4 parallel agents in separate worktrees | Agents collide when they share files. Disjoint ownership is what makes parallel work safe. |

In the MVP: accounts, uploads of all five content types, instant playback, search and filters, profiles, follows, a following feed, likes, downloads with a license record, reporting and takedowns.

Not in the MVP: direct messaging, comments, payments, a DAW plugin, AI search, mobile apps. Each has a slot in the build phases.

## Product scope

The product is one promise: find a sound, hear it instantly, grab it, and follow the person who made it. Everything in the MVP serves that loop.

### Content types

"Sound design" is split into two concrete types (one-shots and presets) so each can have its own player and metadata.

| Type | What gets uploaded | Auto-detected | Uploader adds | Player |
| --- | --- | --- | --- | --- |
| Loop | WAV, AIFF, FLAC or MP3, up to about 60 seconds | BPM, key, length in bars, loudness | Genre, instruments, mood tags | Waveform with tempo and key controls |
| One-shot | Single audio hit: 808, kick, FX, texture, vocal chop | Root note, loudness, length | Category, tags | Tap to trigger, playable across a keyboard |
| Drum kit | ZIP of samples in folders | Sample count, category of each sample from its name and folder | Kit name, genre, cover image | Pad grid plus a demo pattern |
| MIDI | .mid file | Tempo, key, bar count, note range, chord or melody | Genre, what it is (chords, melody, drums, bass) | Piano roll with a sound picker |
| Preset | Synth preset file plus a short audio demo | Synth and version, from the file | Category (bass, lead, pad, pluck, keys), tags | Audio demo; playable keyboard for Vital presets |

### Core user stories

1. Listen without an account. A visitor lands on an item page from Google, presses space, and hears it in under 300 ms.
2. Audition fast. In search results, arrow keys move between items and playback follows. No page loads between sounds.
3. Upload in under a minute. Drag a file in. Key, BPM and type fill in automatically. Fix tags, pick a license, publish.
4. Follow and return. Follow a creator and see their new uploads at the top of the home feed.
5. Download with proof. Every download writes a license record: who, what, when, under which license.
6. Find sounds by reference. Uploaders can tag an item "in the style of" an artist or song, and those tags get their own browsable pages. This is the replacement for the slow YouTube hunt, and it is the feature to market.

### What waits

| Feature | Why it waits | Phase |
| --- | --- | --- |
| Direct messages | Needs spam and abuse controls to be safe; people can use profile links until then | 4 |
| Comments | Same moderation burden, lower value than follows | 4 |
| Paid packs, tips | Needs payments, payouts and tax handling | 5 |
| Similarity and text-to-sound search | Needs a catalog worth searching first | 5 |
| DAW plugin | Large separate build; the web app must prove demand | 6 |

## Tech stack

Every choice below favors boring, well-documented tools, because AI agents write better code against tools with a lot of public examples. Versions and prices were checked on 23 Nov 2026.

| Layer | Choice | Reason | Rejected alternative |
| --- | --- | --- | --- |
| Framework | Next.js 16, App Router, TypeScript strict | 16.x is the Active LTS line. Server-rendered item pages for search engines; client-side navigation keeps the player alive. | Plain React SPA: no search-engine pages. |
| Styling | Tailwind CSS with shadcn/ui components | Agents produce consistent UI when tokens and components are fixed up front. | Hand-written CSS: drifts across agents. |
| Database | Supabase Postgres | Row-level security puts access rules in the database, where one agent can own and test them. | Firebase: weak for relational social data and search. |
| Auth | Supabase Auth (email, Google, Discord) | Included; 50,000 monthly users on Free, 100,000 on Pro. | Rolling your own: never worth it. |
| File storage | Cloudflare R2 | $0.015 per GB-month stored, egress free. | Supabase Storage: $0.09 per GB of egress past the included 250 GB on Pro. |
| Uploads | Browser uploads straight to R2 with presigned URLs | Files never pass through your web server, so large kits do not time out. | Uploading through an API route: slow and size-capped. |
| Job queue | A jobs table in Postgres, claimed with row locks | No extra service; jobs sit next to the data they change. | Supabase Queues or Redis: a second mechanism beside the jobs table you need anyway. |
| Worker | Python 3.12 container: ffmpeg, numpy, mido, Chromaprint, vita | Best audio tooling lives in Python. | Doing analysis in Node: thinner libraries. |
| Waveforms | wavesurfer.js 7 fed precomputed peaks | Its docs recommend pre-decoded peaks for large files; with peaks the waveform draws before audio loads. | Decoding in the browser: slow on long files. |
| Tempo and key shift | Signalsmith Stretch (MIT, official Web Audio build) | High quality, runs in an AudioWorklet, permissive license. | Rubber Band: GPL or paid license. |
| MIDI playback | SpessaSynth (Apache-2.0) with a small SoundFont | Full MIDI synth in the browser, real-time and offline. | Tone.js samplers: more assembly for the same result. |
| Client state | Zustand for the player; server components and server actions for data | The player is the only truly global client state. | Redux: unneeded weight. |
| Validation | Zod schemas shared by web and API | One source of truth for shapes that every agent imports. | Ad hoc types: agents drift apart. |
| Search | Postgres full-text plus trigram indexes | Good to roughly hundreds of thousands of items. | A search service on day one: premature. |
| Tests | Vitest for units, Playwright for end-to-end | Agents need a command that proves their work. | No tests: parallel agents break each other unnoticed. |
| Hosting | Vercel for the web app; any container host for the worker | Least setup for Next.js. Moving to Cloudflare later is possible. | Self-managed servers: time sink. |

Two license traps to avoid. Essentia is the best-known key and BPM library, but it is released under the Affero GPL, which can oblige you to publish your own source. Write onset tempo and chroma on numpy (BSD-3-Clause) instead. librosa itself is ISC, but it pulls in soxr and soundfile, which are LGPL (decision 0017). Vital's source is GPLv3, so keep the Vital renderer as its own isolated worker process and have a lawyer confirm that arrangement.

## Social layer

The MVP social layer is profiles, follows, likes and a feed. That is enough to give uploaders an audience, which is the reason they will post here instead of on YouTube.

| Piece | MVP behavior | Notes |
| --- | --- | --- |
| Profile | Handle URL, avatar, bio, outbound links, tabs per content type, follower and download totals | Link out to Instagram, YouTube and BeatStars. Early on these replace messaging. |
| Follow | One click, no approval | Stored in `follows`; triggers keep counts current. |
| Home feed | Signed in: newest from people you follow, then trending. Signed out: trending. | Trending is likes plus downloads over the past 7 days, with a decay by age. |
| Likes | Heart on any item; a Likes tab on your own profile | Doubles as a personal library. |
| Notifications | In-app bell: new follower, like on your item, new upload from a followed creator | Batch them. Ten likes become one notification. |
| Reference pages | A page per "in the style of" tag listing every item tagged with it | The answer to the YouTube hunt, and the pages most likely to rank in search. |
| Share | Every item page has a preview card for link sharing and an embeddable player | Lets YouTubers put your player in their descriptions. |

### Messaging, when it ships in phase 4

- Transport: Supabase Realtime on the messages table, one channel per conversation. Supabase Pro includes 500 concurrent realtime connections, so open the connection only while the inbox is on screen.
- Abuse controls first: new accounts cannot start conversations for 24 hours, a cap on new conversations per day, block and report on every thread, and message requests from people you do not follow land in a separate tab.
- Attachments are item links, not raw files. Sending a loop means sending its page, which keeps every file inside the screening pipeline.

Build the conversations and messages tables now so the schema is stable, and ship nothing on top of them until phase 4.

## Trust, safety and legal

An open upload site for kits, loops and presets will receive stolen material in its first week. The screening, license and takedown pieces below are launch requirements, not polish. I am not a lawyer; a music or internet lawyer needs to review this section before public launch.

### Screening uploads

| Layer | Tool | Catches | When |
| --- | --- | --- | --- |
| Exact duplicates | SHA-256 of every file | The same file uploaded twice | Phase 1 |
| Near duplicates in your catalog | Chromaprint fingerprints stored per file | Re-encoded or trimmed copies of something already on the site. Built for duplicate detection, so it is weaker on pitched or time-stretched copies. | Phase 1 |
| Released music and commercial packs | ACRCloud copyright compliance | Loops lifted from released tracks | Before public launch. Pricing sits behind a login and there is a 14-day trial, so get a quote. |
| Known pack names | A blocklist of file-name patterns from popular paid kits | Lazy re-uploads of paid drum kits | Phase 2 |
| People | Report button, trusted-uploader status, a review queue | Everything the machines miss | Phase 2 |

A clean scan is not proof of ownership. Word it on the site as "screened", never "guaranteed clean".

### Licenses

Offer three licenses at upload and show the choice as a badge on every item.

1. Free, royalty-free. Use in your own music, including commercial releases. No redistribution of the raw file.
2. Free, credit required. Same, with a credit line the downloader agrees to.
3. Free, split on placement. Free to use; a stated publishing share is owed if the track is commercially released. The MVP records the terms and both parties. Collecting the money is a later phase.

Every download writes a row with user, item, license and license version. That row is the downloader's proof and the uploader's record.

### Takedowns

- Register a DMCA agent with the US Copyright Office before launch. The fee is $6 and the designation must be renewed every three years. This is a condition of safe-harbor protection for sites hosting user uploads.
- Publish a takedown page with the agent's contact details and a form that writes to `dmca_notices`.
- Act and log. On a valid notice: remove the item, notify the uploader, offer a counter-notice. Three upheld notices ends the account. Keep the trail.
- Uploader warranty. At upload the user confirms they made the content or hold the rights, and that it contains no samples from paid packs or released records.

### Three content-specific risks

- MIDI of real songs. A melody is part of a song's composition. Allow chord progressions and original melodies; reject uploads titled as a specific song's melody. Reference tags say "in the style of", never "from".
- Preset recreations. A patch that sounds like a famous record is generally lower risk than a sample of it, but presets that embed wavetables or samples from paid products are not. Ask uploaders to confirm wavetables are their own or factory content.
- Artist and song names. Using names to describe a style is common practice across the industry, but it can still draw complaints. Keep names in tags, not in ads or page titles that imply endorsement.

### Abuse basics

Rate-limit uploads, follows and reports per account. Require a verified email to upload. Cap file sizes per type. Scan ZIPs defensively as described in the pipeline. Give yourself an admin page from day one: review queue, remove item, suspend user.

## Build phases

Phases 0 to 3 are the MVP. Each phase ends with something you can use yourself, and nothing in a later phase should start until the gate for the current one passes.

| Phase | Ships | Gate to move on |
| --- | --- | --- |
| 0. Foundations | Repo, contracts, schema, tokens, fixtures, CI. Lead session only. | All checks run green on an empty app. You have read and agreed with every contract. |
| 1. Loops end to end | Sign-up, upload a loop, worker processing, item page with waveform, tempo and key controls, download with license record, duplicate check | You upload 20 of your own loops and each plays within 300 ms on its page. A re-upload of the same loop is caught. |
| 2. All content types | One-shots, drum kits with pads, MIDI with piano roll and sound picker, presets with demos, Vital rendering and playable keyboard, browse and search with filters, player bar and keyboard map | Every fixture type uploads and plays. You can audition 30 mixed results with the keyboard alone. |
| 3. Social and safety | Profiles, follows, likes, home feed, notifications, reference pages, share cards and embeds, reports, takedown flow, admin page, commercial fingerprint screening | Ten invited producers upload, follow each other and use the feed for a week. A test takedown runs start to finish. Lawyer review done. DMCA agent registered. |
| 4. Conversation | Direct messages with abuse controls, comments | Invited users report no spam after two weeks open. |
| 5. Money and discovery | Tips and paid packs, similarity search, split-license tracking | Decide from what users ask for in phases 3 and 4. |
| 6. Reach | DAW plugin or desktop app, mobile app | Only once the web app retains users week over week. |

### Launch sequence inside phase 3

1. Seed. Upload your own catalog and recruit 20 to 50 producers you know. Aim for at least 1,000 published items before anyone outside sees the site.
2. Private beta. Invite-only sign-up. Watch what people search for and do not find.
3. Reference pages first. Fill the 50 most-searched hip-hop references with real content before opening. These are the pages that answer the YouTube hunt.
4. Open. Remove the invite gate, keep upload behind a verified email.

## Costs and scaling

Development can run at $0 a month on free tiers, and a public launch costs roughly the price of Supabase Pro plus a small worker. Storage and bandwidth, the costs that normally sink a file-sharing site, stay small because of R2.

| Item | Development | At launch | Source |
| --- | --- | --- | --- |
| Supabase | Free: 500 MB database, 50,000 monthly users, projects pause after a week idle | Pro: from $25 a month, 8 GB database, 100,000 monthly users, never pauses | Supabase pricing |
| Cloudflare R2 | Free: 10 GB stored | $0.015 per GB-month past 10 GB; downloads free | R2 pricing |
| Web hosting | Free tier | A paid plan once the site is commercial; check current pricing | Not verified here |
| Worker container | Runs on your own machine | One small always-on container; check your host's pricing | Not verified here |
| Commercial fingerprinting | Not needed | Quote required | ACRCloud |
| DMCA agent | Not needed | $6, renewed every three years | US Copyright Office |
| Lawyer review | Not needed | One-time; get a quote | |

### What storage actually costs

At R2's rate, 100 GB of originals costs about $1.35 a month and 1 TB costs about $14.85. Bandwidth for downloads adds nothing. The same terabyte of monthly downloads from Supabase Storage on Pro would add about $67.50 in egress, which is why originals do not live there.

Drum kits will dominate storage. As a planning assumption, 10,000 loops at 4 MB is 40 GB, while 500 kits at 150 MB is 75 GB. Set per-file limits (for example 50 MB for a loop, 500 MB for a kit) and a per-user quota from the start.

### What changes as it grows

| When | Change |
| --- | --- |
| Processing queue backs up | Run more worker containers. Jobs are idempotent, so this is safe. |
| Search slows or needs typo tolerance | Move search to a dedicated engine, fed from Postgres. |
| Feed query slows | Precompute feeds for active users. |
| You want "sounds like this" | Add audio embeddings and vector search in Postgres. |
| Realtime connections pass the plan limit | Supabase Pro includes 500; more are billed per 1,000. |
| Storage of rarely downloaded originals grows | Move old originals to R2's infrequent-access class. |

## Risks and open questions

The technology here is well understood. The risks that can actually stop the project are an empty catalog at launch, stolen uploads, and legal exposure around references to real songs.

| Risk | Why it matters | What to do |
| --- | --- | --- |
| Empty site at launch | A social product with nothing on it loses every first visitor | Seed 1,000 items and 20 to 50 creators before opening. Stay hip-hop only. |
| Stolen kits and loops | Legal exposure, and serious producers stop trusting the catalog | Screening from phase 1, commercial fingerprinting and a report flow before public launch. |
| References to real songs and artists | Melodies are copyrighted; names can draw complaints | "In the style of" tags only, no song-melody MIDI, lawyer review of the wording. |
| Open-source license obligations | GPL and AGPL code can force you to publish your own | Avoid Essentia. Isolate the Vital renderer. Record every dependency's license. |
| Agents drifting apart | Four agents produce four styles and mismatched APIs | Contracts first, folder ownership, reviewers on every pull request. |
| Scope creep | Messaging, payments and a plugin each double the build | Hold the phase gates. |
| Creators stay on YouTube | They are paid there in views and email sign-ups | Embeddable player, follower counts, profile links, and later tips. |

## Decisions only you can make

- Name and domain. Working name is Stash; trademark and domain checks are still open.
- Hip-hop only at launch, or wider.
- Which two preset formats to support first. This document assumes Vital and Serum.
- Whether downloads require an account. This document assumes yes, for the license record.
- File size limits and per-user storage quota.
- Whether the split-on-placement license is offered at launch or added later.

## Things to verify before building on them

- Key-detection accuracy on your fixture loops. The worker's numpy chroma ships no finished key detector, so the profile match is our own code. If accuracy is poor, test alternatives before committing.
- That the vita package renders your own Vital presets faithfully, including ones with custom wavetables.
- The duplicate-fingerprint threshold against your fixtures, including a trimmed copy and a re-encoded copy of the same loop.
- ACRCloud pricing for your expected upload volume.
- Whether any free community site already offers playable presets in the browser. I did not find one, but I did not search for it exhaustively.
- Loop previews loop without a click or gap after MP3 encoding. If not, switch previews to a gapless format.

## Sources

Sources for the facts above, checked 23 Nov 2026.

- Next.js support policy
- Supabase pricing
- Cloudflare R2 pricing
- Claude Code: agent teams
- SpessaSynth library
- Signalsmith Stretch for Web Audio
- wavesurfer.js
- Vita: Python bindings for Vital
- Vital source and license
- Essentia licensing
- Chromaprint
- ACRCloud copyright compliance
- US Copyright Office DMCA agent directory
- Claude Code: worktrees
- librosa on PyPI
- Supabase Queues

The Next.js, library and DMCA entries come from search results for those pages rather than a full read of each; the Supabase, R2 and Claude Code pages were read directly.
