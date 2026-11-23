import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemRowSchema, limits } from "@stash/contracts";
import { buildPlayable, checkFields, itemLength, peaksFor, toItem, toItemRow } from "./rows.ts";
import { TEST_ENV } from "../testing/fake-supabase.ts";
import { DETAILS, ITEM_IDS, PEAKS, fileDbRow, filesFor, itemDbRow, samplesFor, type TestType } from "../testing/items.ts";

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
});

const BASE = TEST_ENV.NEXT_PUBLIC_PREVIEWS_BASE_URL;
const owner = { handle: "alice", displayName: "Alice", avatarUrl: null };

describe("toItem", () => {
  it("maps the row to itemSchema: numeric bpm, key from root and mode, tags with kinds", () => {
    const item = toItem(itemDbRow("loop", { bpm: "140.00" }), [{ name: "dark", kind: "tag" }]);
    expect(item).toMatchObject({ id: ITEM_IDS.loop, publicId: "k3j9x0a2bq", bpm: 140, key: { root: 9, mode: "minor" }, tags: [{ name: "dark", kind: "tag" }] });
  });

  it("a draft has no details yet; a processed item without details is a contract error", () => {
    expect(toItem(itemDbRow("loop", { status: "draft", details: null, published_at: null }), []).details).toBeNull();
    expect(() => toItem(itemDbRow("loop", { status: "ready", details: null }), [])).toThrow();
  });
});

describe("buildPlayable", () => {
  const playable = (type: TestType, files = filesFor(type), samples = samplesFor(ITEM_IDS.kit, 20)) =>
    buildPlayable(toItem(itemDbRow(type), []), files, samples);

  it("loop: public preview URL, exact loop length in samples, bpm and key root", () => {
    expect(playable("loop")).toEqual({
      kind: "loop",
      id: ITEM_IDS.loop,
      previewUrl: `${BASE}/${ITEM_IDS.loop}/preview.mp3`,
      loopSamples: 302400,
      sampleRate: 44100,
      bpm: 140,
      keyRoot: 9,
    });
  });

  it("loop without a detected bpm or key leaves them out", () => {
    const p = buildPlayable(toItem(itemDbRow("loop", { bpm: null, key_root: null, key_mode: null }), []), filesFor("loop"), []);
    expect(p).not.toHaveProperty("bpm");
    expect(p).not.toHaveProperty("keyRoot");
  });

  it("oneshot: preview and root note", () => {
    expect(playable("oneshot")).toEqual({ kind: "oneshot", id: ITEM_IDS.oneshot, previewUrl: `${BASE}/${ITEM_IDS.oneshot}/preview.mp3`, rootNote: 36 });
  });

  it("kit: the first sixteen samples by position become pads", () => {
    const p = playable("kit", filesFor("kit"), samplesFor(ITEM_IDS.kit, 20).reverse());
    if (p?.kind !== "kit") throw new Error("expected a kit");
    expect(p.pads).toHaveLength(16);
    expect(p.pads[0]).toEqual({ index: 0, name: "Kick 1", category: "kick", previewUrl: `${BASE}/${ITEM_IDS.kit}/s0.mp3` });
    expect(p.pads[15]!.name).toBe("Kick 16");
  });

  it("midi: notes file, bpm, and the default sound for its kind", () => {
    expect(playable("midi")).toEqual({ kind: "midi", id: ITEM_IDS.midi, notesUrl: `${BASE}/${ITEM_IDS.midi}/notes.json`, bpm: 140, sound: "keys" });
    const drums = buildPlayable(toItem(itemDbRow("midi", { details: { ...DETAILS.midi, kind: "drums" } }), []), filesFor("midi"), []);
    expect(drums).toMatchObject({ sound: "drums" });
  });

  it("preset: the public demo preview and sampled notes by pitch", () => {
    expect(playable("preset")).toEqual({
      kind: "preset",
      id: ITEM_IDS.preset,
      demoUrl: `${BASE}/${ITEM_IDS.preset}/demo.mp3`,
      sampledNotes: [
        { pitch: 48, url: `${BASE}/${ITEM_IDS.preset}/n48.mp3` },
        { pitch: 72, url: `${BASE}/${ITEM_IDS.preset}/n72.mp3` },
      ],
    });
  });

  it("never plays an original: a preview-role file in the originals bucket is ignored", () => {
    const files = [fileDbRow(ITEM_IDS.loop, "preview", { bucket: "originals", path: "secret/original.wav" })];
    expect(buildPlayable(toItem(itemDbRow("loop"), []), files, [])).toBeNull();
  });

  it("null when a derived file is missing or the item is not processed", () => {
    expect(playable("loop", [])).toBeNull();
    expect(playable("kit", [], [])).toBeNull();
    expect(buildPlayable(toItem(itemDbRow("loop", { status: "processing", details: null, published_at: null }), []), filesFor("loop"), [])).toBeNull();
  });
});

describe("itemLength and peaks", () => {
  it("bars for loops and MIDI, seconds for one-shots, samples for kits, null for presets", () => {
    expect(itemLength(toItem(itemDbRow("loop"), []))).toEqual({ unit: "bars", value: 4 });
    expect(itemLength(toItem(itemDbRow("midi"), []))).toEqual({ unit: "bars", value: 8 });
    expect(itemLength(toItem(itemDbRow("oneshot"), []))).toEqual({ unit: "seconds", value: 6.857 });
    expect(itemLength(toItem(itemDbRow("kit"), []))).toEqual({ unit: "samples", value: 20 });
    expect(itemLength(toItem(itemDbRow("preset"), []))).toBeNull();
  });

  it("peaks come from the peaks file's meta and must be exactly 800 bytes", () => {
    expect(peaksFor(filesFor("loop"))).toBe(PEAKS);
    expect(peaksFor([fileDbRow(ITEM_IDS.loop, "peaks", { meta: { peaks: "AAAA" } })])).toBeNull();
    expect(peaksFor([fileDbRow(ITEM_IDS.loop, "peaks", { meta: null })])).toBeNull();
    expect(peaksFor([])).toBeNull();
  });
});

describe("checkFields", () => {
  const withDetection = (d: Record<string, unknown>) =>
    toItem(itemDbRow("loop", { details: { ...DETAILS.loop, detection: { ...(DETAILS.loop.detection as object), ...d } } }), []);

  it("bpm when the sources disagreed; key when chroma confidence is low", () => {
    expect(checkFields(withDetection({}))).toEqual([]);
    expect(checkFields(withDetection({ bpmAgreed: false }))).toEqual(["bpm"]);
    expect(checkFields(withDetection({ bpmAgreed: false, bpmSource: "filename" }))).toEqual([]);
    expect(checkFields(withDetection({ keyConfidence: 0.05 }))).toEqual(["key"]);
    expect(checkFields(withDetection({ keyConfidence: null }))).toEqual(["key"]);
    expect(checkFields(withDetection({ keySource: "filename", keyConfidence: null }))).toEqual([]);
  });

  it("rootNote when it came from pitch tracking; nothing before processing", () => {
    const tracked = toItem(itemDbRow("oneshot", { details: { ...DETAILS.oneshot, rootNoteSource: "pitch_tracking" } }), []);
    expect(checkFields(tracked)).toEqual(["rootNote"]);
    expect(checkFields(toItem(itemDbRow("oneshot"), []))).toEqual([]);
    expect(checkFields(toItem(itemDbRow("loop", { status: "draft", details: null, published_at: null }), []))).toEqual([]);
  });
});

describe("toItemRow", () => {
  it("builds a row that carries everything to play, for every type", () => {
    for (const type of ["loop", "oneshot", "kit", "midi", "preset"] as const) {
      const row = toItemRow({ row: itemDbRow(type), owner, files: filesFor(type), samples: samplesFor(ITEM_IDS[type], 4) });
      expect(row, type).not.toBeNull();
      expect(itemRowSchema.parse(row)).toEqual(row);
      expect(row!.href).toBe(`/${type}/dark-keys-${itemDbRow(type).public_id}`);
      expect(row!.peaks).toBe(type === "midi" ? null : PEAKS);
    }
  });

  it("carries the viewer's like only when there is a viewer", () => {
    expect(toItemRow({ row: itemDbRow(), owner, files: filesFor("loop"), samples: [] })).not.toHaveProperty("viewer");
    expect(toItemRow({ row: itemDbRow(), owner, files: filesFor("loop"), samples: [], viewerLiked: true })!.viewer).toEqual({ liked: true });
  });

  it("an unpublished or unplayable item is no row", () => {
    expect(toItemRow({ row: itemDbRow("loop", { status: "ready", published_at: null }), owner, files: filesFor("loop"), samples: [] })).toBeNull();
    expect(toItemRow({ row: itemDbRow("loop"), owner, files: [], samples: [] })).toBeNull();
  });

  it("tags are capped at the per-item limit", () => {
    const many = Array.from({ length: limits.tags.perItem + 2 }, (_, i) => `tag${i}`);
    expect(toItemRow({ row: itemDbRow("loop", { tag_names: many }), owner, files: filesFor("loop"), samples: [] })!.tags).toHaveLength(limits.tags.perItem);
  });
});
