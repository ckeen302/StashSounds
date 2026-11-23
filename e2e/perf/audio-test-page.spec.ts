import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

// Ticket 121: the bare audio test page plays a fixture loop in a real browser. It runs under
// `pnpm perf` because ticket 123 adds time to first sound on this same page.
// The page is served by packages/audio/test-page/serve.mjs, not the web app.

const WAV = "midnight_keys_140bpm_Am.wav";
const WAV_LOOP_MS = (302400 / 44100) * 1000; // loopSamples / sampleRate from fixtures/manifest.json

let server: ChildProcess;
let origin: string;

test.beforeAll(async () => {
  server = spawn(process.execPath, [join(import.meta.dirname, "../../packages/audio/test-page/serve.mjs")], {
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
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

interface PageGlobals {
  stashEngine: { getState(): { status: string; durationMs: number; current: { id: string } | null }; getPositionMs(): number };
  __contexts?: number;
  __analyser?: AnalyserNode;
}

test("the audio test page plays a WAV fixture loop", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Count contexts and tap the output so the test can tell that real samples reach the destination.
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    const g = window as unknown as { AudioContext: unknown; __contexts?: number; __analyser?: AnalyserNode };
    g.AudioContext = class extends Real {
      private tap: GainNode;
      constructor(options?: AudioContextOptions) {
        super(options);
        g.__contexts = (g.__contexts ?? 0) + 1;
        this.tap = Real.prototype.createGain.call(this);
        const analyser = Real.prototype.createAnalyser.call(this);
        analyser.fftSize = 2048;
        this.tap.connect(super.destination);
        this.tap.connect(analyser);
        g.__analyser = analyser;
      }
      override get destination(): AudioDestinationNode {
        return this.tap as unknown as AudioDestinationNode;
      }
    };
  });

  await page.goto(`${origin}/`);
  await expect(page.locator("#fixture option")).not.toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as PageGlobals).__contexts ?? 0), "no audio context before the gesture").toBe(0);

  await page.selectOption("#fixture", WAV);
  await page.click("#play");
  await page.waitForFunction(() => ["playing", "error"].includes((window as unknown as PageGlobals).stashEngine.getState().status));
  const state = await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState());
  expect(state.status).toBe("playing");
  expect(state.current?.id).toBe(WAV);
  expect(state.durationMs).toBeCloseTo(WAV_LOOP_MS, 0);

  const position = () => page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getPositionMs());
  const first = await position();
  await expect.poll(position, { message: "getPositionMs() advances on the audio clock" }).toBeGreaterThan(first + 200);

  const rms = () =>
    page.evaluate(() => {
      const a = (window as unknown as PageGlobals).__analyser!;
      const d = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    });
  await expect.poll(rms, { message: "samples reach the output" }).toBeGreaterThan(0.001);

  expect(await page.evaluate(() => (window as unknown as PageGlobals).__contexts)).toBe(1);
  expect(errors).toEqual([]);
});
