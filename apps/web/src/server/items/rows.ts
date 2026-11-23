/**
 * Items as the database stores them, and the pure builders that turn them into the contracts
 * shapes: itemSchema (an owner's view), itemRowSchema (everything one row needs to draw and play)
 * and the pieces of the item page. No I/O here; load-rows.ts and the queries read the rows.
 *
 * Provisional choices (docs/requests/103-row-sources.md, 103-check-fields.md) are each kept in one
 * place below: peaksFor, MIDI_SOUND, the preview roles in buildPlayable, and checkFields.
 */
import {
  itemHref,
  itemRowSchema,
  itemSchema,
  kitSampleSchema,
  limits,
  midiPitchSchema,
  peaksSchema,
  type Item,
  type ItemRow,
  type KitSample,
  type MidiKind,
  type OwnerSummary,
  type Playable,
  type SoundId,
  type Tag,
} from "@stash/contracts";
import { previewUrl } from "../profile.ts";

/** Columns of public.items as PostgREST returns them. A database row, not a contract. */
export type ItemDbRow = {
  id: string;
  public_id: string;
  owner_id: string;
  type: string;
  status: string;
  title: string;
  slug: string;
  description: string | null;
  license: string;
  split_percent: number | null;
  genre: string | null;
  /** numeric(5,2): PostgREST sends a JSON number, but a string is accepted too. */
  bpm: number | string | null;
  key_root: number | null;
  key_mode: string | null;
  duration_ms: number | null;
  details: unknown;
  tag_names: string[];
  likes_count: number;
  downloads_count: number;
  flagged_reason: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
/** Named columns, never `*` (search_vector and the confirmation timestamps are not needed). */
export const ITEM_COLUMNS =
  "id, public_id, owner_id, type, status, title, slug, description, license, split_percent, genre, bpm, key_root, key_mode, " +
  "duration_ms, details, tag_names, likes_count, downloads_count, flagged_reason, published_at, created_at, updated_at";

/** A derived file in the previews bucket. Originals are never read for rows. */
export type FileDbRow = { id: string; item_id: string; role: string; bucket: string; path: string; meta: Record<string, unknown> | null };
export const FILE_COLUMNS = "id, item_id, role, bucket, path, meta";

/** kit_samples without original_path, which the API cannot select. */
export type SampleDbRow = {
  id: string;
  item_id: string;
  position: number;
  name: string;
  category: string;
  duration_ms: number;
  root_note: number | null;
  preview_path: string;
};
export const SAMPLE_COLUMNS = "id, item_id, position, name, category, duration_ms, root_note, preview_path";

/** Pads on a kit row and in its playable. */
export const KIT_PADS = 16;

/** The item in its contracts shape. Throws if the database row breaks the contract (a schema bug). */
export function toItem(row: ItemDbRow, tags: Tag[]): Item {
  return itemSchema.parse({
    id: row.id,
    publicId: row.public_id,
    ownerId: row.owner_id,
    type: row.type,
    status: row.status,
    title: row.title,
    slug: row.slug,
    description: row.description,
    license: row.license,
    splitPercent: row.split_percent,
    genre: row.genre,
    bpm: row.bpm === null ? null : Number(row.bpm),
    key: row.key_root === null || row.key_mode === null ? null : { root: row.key_root, mode: row.key_mode },
    durationMs: row.duration_ms,
    tags,
    likesCount: row.likes_count,
    downloadsCount: row.downloads_count,
    flaggedReason: row.flagged_reason,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    details: row.details ?? null,
  });
}

/** Default MIDI sound from what the worker found (request 103-row-sources). */
export const MIDI_SOUND: Record<MidiKind, SoundId> = { drums: "drums", bass: "bass", chords: "keys", melody: "pluck" };

/** Peaks from the peaks file's meta.peaks (request 103-row-sources); null when missing or not 800 bytes. */
export function peaksFor(files: FileDbRow[]): string | null {
  const raw = files.find((f) => f.role === "peaks" && f.bucket === "previews")?.meta?.peaks;
  const r = peaksSchema.safeParse(raw);
  return r.success ? r.data : null;
}

function publicFile(files: FileDbRow[], role: string): string | null {
  const f = files.find((x) => x.role === role && x.bucket === "previews");
  return f ? previewUrl(f.path) : null;
}

/**
 * Everything the audio engine needs, with no further lookup. Null when the item cannot be played
 * yet (not processed, or a derived file is missing).
 */
export function buildPlayable(item: Item, files: FileDbRow[], samples: SampleDbRow[]): Playable | null {
  const id = item.id;
  switch (item.type) {
    case "loop": {
      const url = publicFile(files, "preview");
      if (!item.details || !url) return null;
      return {
        kind: "loop",
        id,
        previewUrl: url,
        loopSamples: item.details.loopSamples,
        sampleRate: item.details.sampleRate,
        ...(item.bpm !== null && { bpm: item.bpm }),
        ...(item.key && { keyRoot: item.key.root }),
      };
    }
    case "oneshot": {
      const url = publicFile(files, "preview");
      if (!item.details || !url) return null;
      return { kind: "oneshot", id, previewUrl: url, ...(item.details.rootNote !== null && { rootNote: item.details.rootNote }) };
    }
    case "kit": {
      const pads = [...samples]
        .sort((a, b) => a.position - b.position)
        .slice(0, KIT_PADS)
        .map((s, index) => ({ index, name: s.name, category: s.category as KitSample["category"], previewUrl: previewUrl(s.preview_path) }));
      if (!item.details || pads.length === 0) return null;
      return { kind: "kit", id, pads };
    }
    case "midi": {
      const url = publicFile(files, "notes");
      if (!item.details || !url) return null;
      // A file with no tempo event is processed at 120 BPM (details.tempoAssumed).
      return { kind: "midi", id, notesUrl: url, bpm: item.bpm ?? 120, sound: MIDI_SOUND[item.details.kind] };
    }
    case "preset": {
      const url = publicFile(files, "preview");
      if (!item.details || !url) return null;
      const sampledNotes = files
        .filter((f) => f.role === "sampled_note" && f.bucket === "previews")
        .flatMap((f) => {
          const pitch = midiPitchSchema.safeParse(f.meta?.pitch);
          return pitch.success ? [{ pitch: pitch.data, url: previewUrl(f.path) }] : [];
        })
        .sort((a, b) => a.pitch - b.pitch);
      return { kind: "preset", id, demoUrl: url, ...(sampledNotes.length > 0 && { sampledNotes }) };
    }
  }
}

/** Bars for loops and MIDI, seconds for one-shots, sample count for kits, null for presets. */
export function itemLength(item: Item): ItemRow["length"] {
  if (!item.details) return null;
  switch (item.type) {
    case "loop":
      return item.details.bars === null ? null : { unit: "bars", value: item.details.bars };
    case "midi":
      return { unit: "bars", value: item.details.bars };
    case "oneshot":
      return item.durationMs === null ? null : { unit: "seconds", value: item.durationMs / 1000 };
    case "kit":
      return { unit: "samples", value: item.details.sampleCount };
    case "preset":
      return null;
  }
}

/** Below this key confidence a chroma-detected key is marked "check this" (request 103-check-fields). */
export const KEY_CONFIDENCE_MIN = 0.15;

/** Detected fields the uploader should double-check (request 103-check-fields). */
export function checkFields(item: Item): Array<"bpm" | "key" | "rootNote"> {
  const out: Array<"bpm" | "key" | "rootNote"> = [];
  if (!item.details) return out;
  if (item.type === "loop" || item.type === "midi") {
    const d = item.details.detection;
    const trusted = d.bpmSource === "filename" || d.bpmSource === "uploader" || d.bpmSource === "midi_file";
    if (!d.bpmAgreed && !trusted) out.push("bpm");
    if (d.keySource === "chroma" && (d.keyConfidence ?? 0) < KEY_CONFIDENCE_MIN) out.push("key");
  }
  if (item.type === "oneshot" && item.details.rootNoteSource === "pitch_tracking") out.push("rootNote");
  return out;
}

/** A kit sample as the browser sees it (no original path). */
export function toKitSample(s: SampleDbRow): KitSample {
  return kitSampleSchema.parse({
    id: s.id,
    position: s.position,
    name: s.name,
    category: s.category,
    durationMs: s.duration_ms,
    rootNote: s.root_note,
    previewUrl: previewUrl(s.preview_path),
  });
}

/**
 * One result row. Null when the item is not published or cannot be played: a row always plays
 * without a second request (build spec: Conventions), so a broken one is left out by the caller.
 */
export function toItemRow(input: {
  row: ItemDbRow;
  owner: Pick<OwnerSummary, "handle" | "displayName" | "avatarUrl">;
  files: FileDbRow[];
  samples: SampleDbRow[];
  viewerLiked?: boolean;
}): ItemRow | null {
  const { row } = input;
  if (row.status !== "published" || !row.published_at) return null;
  // Row tags are names only; kinds are read for the item page (allTags).
  const item = toItem(row, []);
  const playable = buildPlayable(item, input.files, input.samples);
  if (!playable) return null;
  return itemRowSchema.parse({
    id: item.id,
    publicId: item.publicId,
    type: item.type,
    title: item.title,
    slug: item.slug,
    href: itemHref(item),
    owner: input.owner,
    license: item.license,
    bpm: item.bpm,
    key: item.key,
    durationMs: item.durationMs,
    length: itemLength(item),
    tags: row.tag_names.slice(0, limits.tags.perItem),
    peaks: item.type === "midi" ? null : peaksFor(input.files),
    playable,
    likesCount: item.likesCount,
    downloadsCount: item.downloadsCount,
    publishedAt: row.published_at,
    ...(input.viewerLiked !== undefined && { viewer: { liked: input.viewerLiked } }),
  });
}
