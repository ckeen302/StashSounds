import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ticket 122: the seamless-loop test. Every fixture loop is rendered offline (OfflineAudioContext in
// Chromium) through the engine's own code: two passes on the plain path, two passes through the
// stretch, and a live tempo then key change. A gap or click at a join fails. The harness is
// packages/audio/test-page/seamless.ts; the join measures are unit tested in packages/audio/test.

const root = join(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "fixtures/manifest.json"), "utf8")) as {
  fixtures: { path: string; type: string; hostile: boolean; expect: { bpm?: number; loopSamples?: number; sampleRate?: number } }[];
};
const loops = manifest.fixtures.filter((f) => f.type === "loop" && !f.hostile && f.path.startsWith("generated/loops/"));
const byPath = (p: string) => manifest.fixtures.find((f) => f.path === p)!;
// The re-encoded MP3 copy of midnight_keys (128 kbps): a second MP3, the format previews use.
const reencoded = { ...byPath("generated/duplicates/midnight_keys_reencoded.mp3"), expect: byPath("generated/loops/midnight_keys_140bpm_Am.wav").expect };
const cases = [...loops, reencoded].map((f) => ({
  name: f.path.split("/").pop()!,
  item: { kind: "loop" as const, id: f.path, previewUrl: "https://previews.invalid/loop", loopSamples: f.expect.loopSamples!, sampleRate: f.expect.sampleRate!, bpm: f.expect.bpm! },
  b64: bytesFor(f.path).toString("base64"),
}));

/** Chromium cannot decode AIFF, so AIFF fixtures are rewritten as WAV with the same samples. */
function bytesFor(path: string): Buffer {
  const raw = readFileSync(join(root, "fixtures", path));
  return path.endsWith(".aiff") ? aiffToWav(raw) : raw;
}

function aiffToWav(aiff: Buffer): Buffer {
  if (aiff.toString("ascii", 0, 4) !== "FORM" || aiff.toString("ascii", 8, 12) !== "AIFF") throw new Error("not AIFF");
  let channels = 0;
  let bits = 0;
  let rate = 0;
  let pcm: Buffer | null = null;
  for (let o = 12; o + 8 <= aiff.length; ) {
    const id = aiff.toString("ascii", o, o + 4);
    const size = aiff.readUInt32BE(o + 4);
    const body = o + 8;
    if (id === "COMM") {
      channels = aiff.readUInt16BE(body);
      bits = aiff.readUInt16BE(body + 6);
      // 80-bit extended float sample rate: exponent, then a 64-bit mantissa.
      const exp = aiff.readUInt16BE(body + 8) - 16383;
      rate = Math.round(aiff.readUInt32BE(body + 10) * 2 ** (exp - 31));
    }
    if (id === "SSND") pcm = aiff.subarray(body + 8 + aiff.readUInt32BE(body), body + size);
    o = body + size + (size % 2);
  }
  if (!pcm || bits !== 16) throw new Error(`unsupported AIFF (${bits} bit)`);
  const le = Buffer.alloc(pcm.length);
  for (let i = 0; i + 1 < pcm.length; i += 2) le.writeInt16LE(pcm.readInt16BE(i), i);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + le.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(le.length, 40);
  return Buffer.concat([header, le]);
}

let server: ChildProcess;
let origin: string;

test.beforeAll(async () => {
  server = spawn(process.execPath, [join(root, "packages/audio/test-page/serve.mjs")], { env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
  origin = await new Promise<string>((resolve, reject) => {
    let out = "";
    server.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+/.exec(out);
      if (m) resolve(m[0]);
    });
    server.on("exit", (code) => reject(new Error(`test page server exited with ${code}: ${out}`)));
    setTimeout(() => reject(new Error(`test page server did not start: ${out}`)), 15_000);
  });
});

test.afterAll(() => {
  server?.kill();
});

// What packages/audio/test-page/seamless.ts returns (it runs in the page, so it is not imported here).
interface JoinResult {
  report: { stepAtJoin: number; maxStepElsewhere: number; minRmsNearJoin: number; minRmsElsewhere: number };
  faults: { gap: boolean; click: boolean };
}
interface PlainResult {
  status: string;
  loopFrames: number;
  maxDiff: number;
  join: JoinResult;
}
interface StretchResult {
  status: string;
  diff: { max: number; atS: number };
  joins: JoinResult[];
}
interface SeekResult {
  status: string;
  joins: JoinResult[];
  fadeOut: number;
  fadeIn: number;
  positionS: number;
  targetS: number;
}
interface Harness {
  renderPlain(b64: string, item: unknown, rate: number): Promise<PlainResult>;
  renderStretch(b64: string, item: unknown, rate: number, ratio: number, semitones: number): Promise<StretchResult>;
  renderLiveChange(b64: string, item: unknown, rate: number, ratio: number, semitones: number): Promise<StretchResult>;
  renderSeekStretched(b64: string, item: unknown, rate: number, ratio: number, semitones: number): Promise<SeekResult>;
}

async function harness(page: Page) {
  await page.goto(`${origin}/`); // the page's import map resolves signalsmith-stretch
  return {
    plain: (b64: string, item: unknown, rate: number) =>
      page.evaluate(async ([b, i, r]) => ((await import("/test-page/seamless.ts" as string)) as Harness).renderPlain(b, i, r), [b64, item, rate] as const),
    stretch: (b64: string, item: unknown, rate: number, ratio: number, semitones: number) =>
      page.evaluate(async ([b, i, r, q, s]) => ((await import("/test-page/seamless.ts" as string)) as Harness).renderStretch(b, i, r, q, s), [b64, item, rate, ratio, semitones] as const),
    live: (b64: string, item: unknown, rate: number, ratio: number, semitones: number) =>
      page.evaluate(async ([b, i, r, q, s]) => ((await import("/test-page/seamless.ts" as string)) as Harness).renderLiveChange(b, i, r, q, s), [b64, item, rate, ratio, semitones] as const),
    seek: (b64: string, item: unknown, rate: number, ratio: number, semitones: number) =>
      page.evaluate(async ([b, i, r, q, s]) => ((await import("/test-page/seamless.ts" as string)) as Harness).renderSeekStretched(b, i, r, q, s), [b64, item, rate, ratio, semitones] as const),
  };
}

const RATES = [44100, 48000];
const fmt = (n: number) => n.toPrecision(3);

test.describe.configure({ timeout: 120_000 });

for (const c of cases) {
  test(`${c.name}: two passes on the plain path are the loop twice, with no gap or click`, async ({ page }) => {
    const h = await harness(page);
    for (const rate of RATES) {
      const r = await h.plain(c.b64, c.item, rate);
      const j = r.join.report;
      console.log(`plain   ${c.name} @${rate}: loopFrames ${r.loopFrames}, maxDiff ${fmt(r.maxDiff)}, join step ${fmt(j.stepAtJoin)} vs ${fmt(j.maxStepElsewhere)}, min rms ${fmt(j.minRmsNearJoin)} vs ${fmt(j.minRmsElsewhere)}`);
      expect(r.status).toBe("playing");
      expect(r.maxDiff, `sample-exact at ${rate} Hz`).toBeLessThan(1e-6);
      expect(r.join.faults, `join at ${rate} Hz`).toEqual({ gap: false, click: false });
    }
  });

  test(`${c.name}: two passes through the stretch match an unlooped render, with no gap or click`, async ({ page }) => {
    const h = await harness(page);
    for (const rate of RATES) {
      const r = await h.stretch(c.b64, c.item, rate, 0.8, 3);
      console.log(`stretch ${c.name} @${rate}: diff ${fmt(r.diff.max)} at ${fmt(r.diff.atS)} s, joins ${r.joins.map((j) => `step ${fmt(j.report.stepAtJoin)} vs ${fmt(j.report.maxStepElsewhere)}`).join("; ")}`);
      expect(r.status).toBe("playing");
      expect(r.diff.max, `difference from the unlooped render at ${rate} Hz`).toBeLessThan(1e-3);
      expect(r.joins.length).toBeGreaterThan(0);
      for (const j of r.joins) expect(j.faults, `join at ${rate} Hz`).toEqual({ gap: false, click: false });
    }
  });

  test(`${c.name}: a live tempo then key change continues from the same place, with no gap or click`, async ({ page }) => {
    const h = await harness(page);
    const r = await h.live(c.b64, c.item, 48000, 0.8, 3);
    console.log(`live    ${c.name} @48000: diff ${fmt(r.diff.max)} at ${fmt(r.diff.atS)} s, changes ${r.joins.map((j) => `step ${fmt(j.report.stepAtJoin)} vs ${fmt(j.report.maxStepElsewhere)}, rms ${fmt(j.report.minRmsNearJoin)} vs ${fmt(j.report.minRmsElsewhere)}`).join("; ")}`);
    expect(r.status).toBe("playing");
    expect(r.diff.max, "difference from a render that continues by itself").toBeLessThan(1e-3);
    for (const j of r.joins) expect(j.faults).toEqual({ gap: false, click: false });
  });

  test(`${c.name}: a seek while stretched fades out and back in, with no click`, async ({ page }) => {
    const h = await harness(page);
    const r = await h.seek(c.b64, c.item, 48000, 0.8, 3);
    console.log(`seek    ${c.name} @48000: ${r.joins.map((j, k) => `${k ? "restart" : "seek"} step ${fmt(j.report.stepAtJoin)} vs ${fmt(j.report.maxStepElsewhere)}`).join("; ")}, fade out ${fmt(r.fadeOut)}, fade in ${fmt(r.fadeIn)}, from ${fmt(r.positionS)} s for ${fmt(r.targetS)} s`);
    expect(r.status).toBe("playing");
    expect(r.positionS, "the new position starts where the seek asked").toBeCloseTo(r.targetS, 2);
    expect(r.fadeOut, "the old position fades out instead of being cut").toBeGreaterThan(0.5);
    expect(r.fadeIn, "the new position ramps in from silence").toBeLessThan(0.3);
    expect(r.joins[0]!.faults.click, "click at the seek").toBe(false);
    expect(r.joins[1]!.faults.click, "click at the new start").toBe(false);
  });
}
