import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compatibleKeys,
  workerFileSchema,
  completeUploadOutput,
  createUploadSlotInput,
  decodePeaks,
  encodePeaks,
  err,
  formatKey,
  handleSchema,
  itemHref,
  itemRowSchema,
  itemSchema,
  limits,
  limitsSchema,
  listItemsQuery,
  ok,
  parseItemParam,
  parseKey,
  peaksSchema,
  playableSchema,
  presetDetailsSchema,
  publishItemInput,
  resultSchema,
  slugify,
  updateItemInput,
  toggleLikeOutput,
} from "../src/index.ts";
import { renderJsonSchemas } from "../src/json-schema.ts";
import raw from "../limits.json" with { type: "json" };

const now = "2026-11-23T12:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const loopDetails = {
  sampleRate: 44100,
  channels: 2,
  loudnessLufs: -14.2,
  truePeakDb: -1.1,
  loopSamples: 352800,
  bars: 4,
  detection: { bpmSource: "filename", bpmAgreed: true, bpmCandidates: [120], keySource: "chroma", keyConfidence: 0.42 },
};

const baseItem = {
  id: uuid(1),
  publicId: "k3j9x0a2bq",
  ownerId: uuid(2),
  type: "loop",
  status: "ready",
  title: "Dark keys",
  slug: "dark-keys",
  description: null,
  license: "royalty_free",
  splitPercent: null,
  genre: "trap",
  bpm: 140,
  key: { root: 9, mode: "minor" },
  durationMs: 6857,
  tags: [{ name: "keys", kind: "instrument" }],
  likesCount: 0,
  downloadsCount: 0,
  flaggedReason: null,
  publishedAt: null,
  createdAt: now,
  updatedAt: now,
  details: loopDetails,
};

describe("limits", () => {
  it("limits.json matches its schema", () => {
    expect(() => limitsSchema.parse(raw)).not.toThrow();
  });
  it("keeps the build spec values", () => {
    expect(limits.loop.maxBytes).toBe(50 * 1024 * 1024);
    expect(limits.kit.maxFiles).toBe(300);
    expect(limits.urls.downloadTtlSeconds).toBe(300);
    expect(limits.worker.backoffSeconds).toEqual([30, 120, 600]);
    expect(limits.worker.backoffSeconds).toHaveLength(limits.worker.maxAttempts);
  });
});

describe("musical keys", () => {
  it.each([
    ["F#m", { root: 6, mode: "minor" }],
    ["F# minor", { root: 6, mode: "minor" }],
    ["Fsharpmin", { root: 6, mode: "minor" }],
    ["Cmin", { root: 0, mode: "minor" }],
    ["Ebmaj", { root: 3, mode: "major" }],
    ["a min", { root: 9, mode: "minor" }],
    ["G", { root: 7, mode: "major" }],
    ["Bb", { root: 10, mode: "major" }],
  ])("parses %s", (input, expected) => {
    expect(parseKey(input)).toEqual(expected);
  });
  it.each(["H", "", "C##", "minor", "Cmaj7"])("rejects %s", (input) => {
    expect(parseKey(input)).toBeNull();
  });
  it("round-trips every key", () => {
    for (let root = 0; root < 12; root++)
      for (const mode of ["major", "minor"] as const) expect(parseKey(formatKey({ root, mode }))).toEqual({ root, mode });
  });
  it("lists relative and neighbouring keys as compatible", () => {
    const am = compatibleKeys({ root: 9, mode: "minor" }).map(formatKey);
    expect(am).toEqual(["Am", "C", "Em", "Dm"]);
  });
});

describe("peaks", () => {
  it("round-trips 800 bytes through base64", () => {
    const values = Array.from({ length: 800 }, (_, i) => (i * 7) % 256);
    const decoded = decodePeaks(encodePeaks(values));
    expect(Array.from(decoded)).toEqual(values);
  });
  it("clamps out-of-range values", () => {
    expect(Array.from(decodePeaks(encodePeaks([-5, 300, 12.6])))).toEqual([0, 255, 13]);
  });
  it("accepts exactly limits.waveform.peakPoints bytes", () => {
    expect(peaksSchema.safeParse(encodePeaks(new Array(limits.waveform.peakPoints).fill(1))).success).toBe(true);
    expect(peaksSchema.safeParse(encodePeaks(new Array(799).fill(1))).success).toBe(false);
    expect(peaksSchema.safeParse(encodePeaks(new Array(801).fill(1))).success).toBe(false);
  });
});

describe("handles and paths", () => {
  it("accepts valid handles and rejects others", () => {
    expect(handleSchema.safeParse("beat_maker99").success).toBe(true);
    for (const bad of ["ab", "UpperCase", "has space", "a".repeat(25), "dash-ed"]) expect(handleSchema.safeParse(bad).success).toBe(false);
  });
  it("builds and parses item paths", () => {
    const href = itemHref({ type: "loop", slug: "dark-keys", publicId: "k3j9x0a2bq" });
    expect(href).toBe("/loop/dark-keys-k3j9x0a2bq");
    expect(parseItemParam("dark-keys-k3j9x0a2bq")).toEqual({ slug: "dark-keys", publicId: "k3j9x0a2bq" });
    expect(parseItemParam("k3j9x0a2bq")).toEqual({ slug: "", publicId: "k3j9x0a2bq" });
    expect(parseItemParam("nope")).toBeNull();
  });
  it("slugifies titles", () => {
    expect(slugify("  Dark Keys (Am) 140 BPM!! ")).toBe("dark-keys-am-140-bpm");
    expect(slugify("Café Noir")).toBe("cafe-noir");
    expect(slugify("!!!")).toBe("untitled");
    // Letters NFKD keeps whole are spelled out the way Postgres unaccent does (parity: supabase/tests).
    expect(slugify("Straße Ærø Łódź")).toBe("strasse-aero-lodz");
  });
});

describe("items", () => {
  it("accepts a processed loop", () => {
    expect(itemSchema.safeParse(baseItem).success).toBe(true);
  });
  it("rejects details of the wrong type", () => {
    const r = itemSchema.safeParse({ ...baseItem, type: "midi" });
    expect(r.success).toBe(false);
  });
  it("allows empty details only before processing", () => {
    expect(itemSchema.safeParse({ ...baseItem, status: "processing", details: null }).success).toBe(true);
    expect(itemSchema.safeParse({ ...baseItem, status: "ready", details: null }).success).toBe(false);
  });
  it("requires a split percent exactly for split-on-placement", () => {
    expect(itemSchema.safeParse({ ...baseItem, license: "split_on_placement" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...baseItem, license: "split_on_placement", splitPercent: 10 }).success).toBe(true);
    expect(itemSchema.safeParse({ ...baseItem, splitPercent: 10 }).success).toBe(false);
  });
  it("a result row carries everything needed to play", () => {
    const row = {
      id: uuid(1),
      publicId: "k3j9x0a2bq",
      type: "loop",
      title: "Dark keys",
      slug: "dark-keys",
      href: "/loop/dark-keys-k3j9x0a2bq",
      owner: { handle: "caden", displayName: "Caden", avatarUrl: null },
      license: "royalty_free",
      bpm: 140,
      key: { root: 9, mode: "minor" },
      durationMs: 6857,
      length: { unit: "bars", value: 4 },
      tags: ["keys"],
      peaks: encodePeaks(new Array(800).fill(10)),
      playable: { kind: "loop", id: uuid(1), previewUrl: "https://previews.example.com/a.mp3", loopSamples: 352800, sampleRate: 44100 },
      likesCount: 0,
      downloadsCount: 0,
      publishedAt: now,
    };
    expect(itemRowSchema.safeParse(row).success).toBe(true);
    expect(itemRowSchema.safeParse({ ...row, playable: { kind: "loop", id: "x" } }).success).toBe(false);
    for (const href of ["//evil.example/x", "/\\evil.example", "https://evil.example/loop/x", "loop/x"]) {
      expect(itemRowSchema.safeParse({ ...row, href }).success, href).toBe(false);
    }
  });
  it("caps kit pads at sixteen", () => {
    const pad = (i: number) => ({ index: i, name: `Kick ${i}`, category: "kick", previewUrl: "https://p.example.com/k.mp3" });
    expect(playableSchema.safeParse({ kind: "kit", id: "k", pads: Array.from({ length: 16 }, (_, i) => pad(i)) }).success).toBe(true);
    expect(playableSchema.safeParse({ kind: "kit", id: "k", pads: Array.from({ length: 17 }, (_, i) => pad(i)) }).success).toBe(false);
  });
});

describe("worker result files", () => {
  const base = { bucket: "previews", path: "i/peaks-abc.peaks", bytes: 800, mime: "application/octet-stream", sha256: null };
  it("a peaks file carries its 800 peaks in meta", () => {
    const peaks = encodePeaks(new Array(800).fill(7));
    expect(workerFileSchema.safeParse({ ...base, role: "peaks", meta: { points: 800, peaks } }).success).toBe(true);
    expect(workerFileSchema.safeParse({ ...base, role: "peaks", meta: {} }).success).toBe(false);
    expect(workerFileSchema.safeParse({ ...base, role: "peaks", meta: { points: 800, peaks: encodePeaks([1, 2]) } }).success).toBe(false);
  });
  it("other files keep free-form meta", () => {
    expect(workerFileSchema.safeParse({ ...base, role: "preview", mime: "audio/mpeg", meta: { bitrateKbps: 192 } }).success).toBe(true);
  });
});

describe("requests", () => {
  it("completeUpload says which file a draft preset is still waiting for", () => {
    const itemId = "00000000-0000-4000-8000-000000000001";
    expect(completeUploadOutput.safeParse({ itemId, status: "processing", jobId: itemId }).success).toBe(true);
    expect(completeUploadOutput.safeParse({ itemId, status: "draft", jobId: null, waitingFor: "demo" }).success).toBe(true);
    expect(completeUploadOutput.safeParse({ itemId, status: "draft", jobId: null }).success).toBe(false);
    expect(completeUploadOutput.safeParse({ itemId, status: "processing", jobId: null }).success).toBe(false);
  });
  it("defaults an upload slot to the original file", () => {
    const v = createUploadSlotInput.parse({ type: "loop", fileName: "a.wav", bytes: 10, mime: "audio/wav" });
    expect(v.role).toBe("original");
  });
  it("refuses to publish without the rights confirmation", () => {
    expect(publishItemInput.safeParse({ itemId: uuid(1), rightsConfirmed: false }).success).toBe(false);
    expect(publishItemInput.safeParse({ itemId: uuid(1), rightsConfirmed: true }).success).toBe(true);
  });
  it("carries the wavetable confirmation on publish, not in preset details", () => {
    expect(publishItemInput.parse({ itemId: uuid(1), rightsConfirmed: true }).wavetablesConfirmed).toBe(false);
    expect(publishItemInput.parse({ itemId: uuid(1), rightsConfirmed: true, wavetablesConfirmed: true }).wavetablesConfirmed).toBe(true);
    expect("wavetablesConfirmed" in presetDetailsSchema.shape).toBe(false);
  });
  it("caps tags across free and reference tags", () => {
    const tags = ["a1", "b2", "c3", "d4", "e5"];
    expect(updateItemInput.safeParse({ itemId: uuid(1), tags, referenceTags: ["f6", "g7", "h8", "i9"] }).success).toBe(false);
    expect(updateItemInput.safeParse({ itemId: uuid(1), tags, referenceTags: ["f6"] }).success).toBe(true);
  });
  it("parses list filters from URL strings", () => {
    const q = listItemsQuery.parse({ type: "loop", bpmMin: "130", bpmMax: "150", tags: "dark,keys", limit: "10" });
    expect(q).toMatchObject({ bpmMin: 130, bpmMax: 150, tags: ["dark", "keys"], limit: 10, sort: "new" });
    expect(listItemsQuery.safeParse({ bpmMin: "150", bpmMax: "130" }).success).toBe(false);
    expect(listItemsQuery.parse({}).limit).toBe(limits.lists.pageSize);
  });
});

describe("results", () => {
  it("wraps data and errors in one shape", () => {
    const schema = resultSchema(toggleLikeOutput);
    expect(schema.safeParse(ok({ liked: true, likesCount: 3 })).success).toBe(true);
    expect(schema.safeParse(err("rate_limited", "Slow down.")).success).toBe(true);
    expect(schema.safeParse({ ok: false, code: "teapot", message: "" }).success).toBe(false);
  });
});

describe("generated JSON Schemas", () => {
  it("are in sync with the Zod contracts (run pnpm --filter @stash/contracts gen)", () => {
    const dir = join(import.meta.dirname, "..", "generated");
    for (const [name, text] of Object.entries(renderJsonSchemas())) {
      expect(readFileSync(join(dir, `${name}.schema.json`), "utf8"), name).toBe(text);
    }
  });
});
