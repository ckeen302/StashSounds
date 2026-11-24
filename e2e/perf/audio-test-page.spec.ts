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
  stashEngine: {
    getState(): { status: string; durationMs: number; tempoRatio: number; transpose: number; current: { id: string } | null };
    getPositionMs(): number;
    setTempo(bpm: number): void;
    setTranspose(semitones: number): void;
  };
  __contexts?: number;
  __analyser?: AnalyserNode;
}

test("the audio test page plays a WAV fixture loop", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const stretchRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/vendor/signalsmith-stretch")) stretchRequests.push(r.url()); // the library, not its worklet file
  });
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
  expect(stretchRequests, "the stretch is not loaded for a loop at its original tempo and key").toEqual([]);

  // Ticket 122: halve the tempo and shift the key while it plays. Nothing restarts, the playhead slows
  // to half speed once the stretch takes over, and sound keeps coming out.
  await page.evaluate(() => {
    const e = (window as unknown as PageGlobals).stashEngine;
    e.setTempo(70);
    e.setTranspose(3);
  });
  expect(await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState())).toMatchObject({ status: "playing", tempoRatio: 0.5, transpose: 3 });
  await expect.poll(() => stretchRequests.length, { message: "the stretch loads on the first change" }).toBe(1);
  await page.waitForTimeout(600); // load, hand over at now + latency
  const rate = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const e = (window as unknown as PageGlobals).stashEngine;
        const t0 = performance.now();
        const p0 = e.getPositionMs();
        setTimeout(() => {
          let dp = e.getPositionMs() - p0;
          if (dp < 0) dp += e.getState().durationMs; // wrapped at the loop end
          resolve(dp / (performance.now() - t0));
        }, 1000);
      }),
  );
  expect(rate, "playhead speed after halving the tempo").toBeGreaterThan(0.4);
  expect(rate, "playhead speed after halving the tempo").toBeLessThan(0.6);
  await expect.poll(rms, { message: "the stretched loop reaches the output" }).toBeGreaterThan(0.001);
  expect(await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState())).toMatchObject({ status: "playing", tempoRatio: 0.5, transpose: 3 });
  expect(await page.evaluate(() => (window as unknown as PageGlobals).__contexts)).toBe(1);

  // An absurd tempo is held to the contract's maximum (300 BPM) and the loop keeps sounding through
  // several passes, instead of the stretch reading past its loop and going silent.
  await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.setTempo(1e6));
  expect((await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState())).tempoRatio).toBeCloseTo(300 / 140);
  await page.waitForTimeout(300);
  for (let i = 0; i < 8; i++) {
    expect(await rms(), `sound at the maximum tempo, sample ${i}`).toBeGreaterThan(0.001);
    expect(Number.isFinite(await position())).toBe(true);
    await page.waitForTimeout(250);
  }
  expect(errors).toEqual([]);
});

test("when the stretch cannot load, the loop plays on at its original tempo with no page error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let stretchRequests = 0;
  await page.route("**/vendor/signalsmith-stretch.mjs", (route) => {
    stretchRequests++;
    return route.fulfill({ status: 404, body: "Not found" });
  });
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    const g = window as unknown as { AudioContext: unknown; __analyser?: AnalyserNode };
    g.AudioContext = class extends Real {
      private tap: GainNode;
      constructor(options?: AudioContextOptions) {
        super(options);
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
  await page.selectOption("#fixture", WAV);
  await page.click("#play");
  await page.waitForFunction(() => ["playing", "error"].includes((window as unknown as PageGlobals).stashEngine.getState().status));

  await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.setTempo(70));
  await expect.poll(() => stretchRequests, { message: "the engine tried to load the stretch" }).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState().tempoRatio), { message: "the tempo falls back to the original" })
    .toBe(1);
  expect(await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState())).toMatchObject({ status: "playing", transpose: 0 });

  const position = () => page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getPositionMs());
  const t0 = Date.now();
  const p0 = await position();
  await page.waitForTimeout(500);
  let moved = (await position()) - p0;
  if (moved < 0) moved += WAV_LOOP_MS; // wrapped at the loop end
  expect(moved / (Date.now() - t0), "playhead at the original speed").toBeGreaterThan(0.8);
  const rms = await page.evaluate(() => {
    const a = (window as unknown as PageGlobals).__analyser!;
    const d = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(d);
    return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
  });
  expect(rms, "the loop still reaches the output").toBeGreaterThan(0.001);
  expect(errors).toEqual([]);
});
