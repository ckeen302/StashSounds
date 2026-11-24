/** Item rows as the database returns them, for unit tests. */
import { encodePeaks, limits } from "@stash/contracts";
import type { FileDbRow, ItemDbRow, SampleDbRow } from "../items/rows.ts";
import { IDS } from "./fake-supabase.ts";

export const ITEM_IDS = {
  loop: "a0000000-0000-4000-8000-000000000001",
  oneshot: "a0000000-0000-4000-8000-000000000002",
  kit: "a0000000-0000-4000-8000-000000000003",
  midi: "a0000000-0000-4000-8000-000000000004",
  preset: "a0000000-0000-4000-8000-000000000005",
} as const;
export type TestType = keyof typeof ITEM_IDS;

const detection = { bpmSource: "onset", bpmAgreed: true, bpmCandidates: [140], keySource: "chroma", keyConfidence: 0.4 };
export const DETAILS: Record<TestType, Record<string, unknown>> = {
  loop: { sampleRate: 44100, channels: 2, loudnessLufs: -14, truePeakDb: -1, loopSamples: 302400, bars: 4, detection },
  oneshot: { sampleRate: 44100, channels: 1, loudnessLufs: null, truePeakDb: null, category: "808", rootNote: 36, rootNoteSource: "filename" },
  kit: { sampleCount: 20, categoryCounts: { kick: 4 }, ignoredCount: 0, hasCover: false },
  midi: { kind: "chords", bars: 8, noteCount: 64, pitchMin: 48, pitchMax: 72, timeSignature: [4, 4], tempoAssumed: false, detection: { ...detection, bpmSource: "midi_file", keySource: "midi_notes" } },
  preset: { synth: "vital", synthName: "Vital", synthVersion: "1.5", category: "pad", rendered: true, sampledNoteCount: 2, demoDurationMs: 8000 },
};

export const PEAKS = encodePeaks(Array.from({ length: limits.waveform.peakPoints }, (_, i) => i % 256));
const PUBLIC_IDS: Record<TestType, string> = { loop: "k3j9x0a2bq", oneshot: "b0b0b0b0b1", kit: "c0c0c0c0c1", midi: "d0d0d0d0d1", preset: "e0e0e0e0e1" };

export function itemDbRow(type: TestType = "loop", extra: Partial<ItemDbRow> = {}): ItemDbRow {
  return {
    id: ITEM_IDS[type],
    public_id: PUBLIC_IDS[type],
    owner_id: IDS.alice,
    type,
    status: "published",
    title: "Dark Keys",
    slug: "dark-keys",
    description: "Late night keys.",
    license: "royalty_free",
    split_percent: null,
    genre: "trap",
    bpm: type === "loop" || type === "midi" ? 140 : null,
    key_root: type === "loop" || type === "midi" ? 9 : null,
    key_mode: type === "loop" || type === "midi" ? "minor" : null,
    duration_ms: type === "midi" || type === "kit" ? null : 6857,
    details: DETAILS[type],
    tag_names: ["dark", "keys"],
    likes_count: 3,
    downloads_count: 7,
    flagged_reason: null,
    published_at: "2026-11-23T22:18:04.123456+00:00",
    created_at: "2026-11-23T20:00:00+00:00",
    updated_at: "2026-11-23T22:18:04.123456+00:00",
    ...extra,
  };
}

let n = 0;
export function fileDbRow(itemId: string, role: string, extra: Partial<FileDbRow> = {}): FileDbRow {
  n += 1;
  return { id: `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, item_id: itemId, role, bucket: "previews", path: `${itemId}/${role}-${n}.mp3`, meta: {}, ...extra };
}

/** The derived files the worker writes for each type (decision 0015). */
export function filesFor(type: TestType, itemId: string = ITEM_IDS[type]): FileDbRow[] {
  const peaks = fileDbRow(itemId, "peaks", { path: `${itemId}/peaks.bin`, meta: { points: limits.waveform.peakPoints, peaks: PEAKS } });
  switch (type) {
    case "loop":
    case "oneshot":
      return [fileDbRow(itemId, "preview", { path: `${itemId}/preview.mp3` }), peaks];
    case "kit":
      return [peaks];
    case "midi":
      return [fileDbRow(itemId, "notes", { path: `${itemId}/notes.json` })];
    case "preset":
      return [
        fileDbRow(itemId, "preview", { path: `${itemId}/demo.mp3` }),
        peaks,
        fileDbRow(itemId, "sampled_note", { path: `${itemId}/n72.mp3`, meta: { pitch: 72 } }),
        fileDbRow(itemId, "sampled_note", { path: `${itemId}/n48.mp3`, meta: { pitch: 48 } }),
      ];
  }
}

export function samplesFor(itemId: string, count: number): SampleDbRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `b0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    item_id: itemId,
    position: i,
    name: `Kick ${i + 1}`,
    category: "kick",
    duration_ms: 400,
    root_note: null,
    preview_path: `${itemId}/s${i}.mp3`,
  }));
}
