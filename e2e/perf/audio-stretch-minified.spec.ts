import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Request 135-stretch-in-production-build. In the built web app the time stretch never started:
// signalsmith-stretch builds its worklet by stringifying its own functions, and in the production
// bundle those functions refer to a name from the module around them. The worklet throws
// "g is not defined" before it says it is ready, and the load used to wait forever.
//
// What the bundle does, read from a `next build` chunk (Next 16.4.6, Turbopack): the Emscripten
// factory's Node check reads the free variable `process`, which Turbopack replaces with its process
// polyfill imported at module scope (`var g = A.i(17559)` ... `typeof g.default`). The factory is
// then stringified into the worklet, where `g` does not exist.
//
// The test page serves the library unminified, so the other perf specs never saw this. Here it gets
// the library as the bundle has it: `process` read through a module-scope binding, then minified
// with the SWC minifier of the Next.js the web app uses (apps/web's own `next`, read, not changed).
// The engine itself stays as the test page serves it.

const root = join(import.meta.dirname, "../..");
const WAV = "midnight_keys_140bpm_Am.wav";
const WAV_LOOP_MS = (302400 / 44100) * 1000; // loopSamples / sampleRate from fixtures/manifest.json

let server: ChildProcess;
let origin: string;
let minified: string;

/**
 * The ES module the browser imports, with `process` from module scope as Turbopack has it, minified by
 * the web app's Next.js (SWC). The binding is opaque to the compressor, as an import is.
 */
async function minifiedStretch(): Promise<string> {
  // The package's "import" export, which the browser loads (require() would resolve its CommonJS build).
  const dir = dirname(createRequire(join(root, "packages/audio/package.json")).resolve("signalsmith-stretch"));
  const original = readFileSync(join(dir, "SignalsmithStretch.mjs"), "utf8");
  const src = `const __process_polyfill = globalThis.__polyfills?.process ?? { default: { env: {} } };\n${original.replace(/\bprocess\b(?!\()/g, "__process_polyfill.default")}`;
  if (src === original || !/typeof __process_polyfill\.default/.test(src)) throw new Error("the library no longer reads process: revisit this harness");
  const swc = createRequire(join(root, "apps/web/package.json"))("next/dist/build/swc") as {
    loadBindings(): Promise<unknown>;
    minify(src: string, options: object): Promise<{ code: string }>;
  };
  await swc.loadBindings();
  const { code } = await swc.minify(src, { module: true, compress: true, mangle: true });
  return code;
}

test.beforeAll(async () => {
  minified = await minifiedStretch();
  // The bug's precondition: the names the stringified worklet code refers to are mangled.
  expect(minified).toContain("(_scriptName=>${");
  expect(minified).not.toContain("__process_polyfill");
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

interface PageGlobals {
  stashEngine: {
    getState(): { status: string; tempoRatio: number; transpose: number };
    getPositionMs(): number;
    setTempo(bpm: number): void;
    setTranspose(semitones: number): void;
  };
  __analyser?: AnalyserNode;
  __worklet: { modules: string[]; errors: string[] };
}

/**
 * Taps the output, and records every worklet module added and every processor error. With `deaf`,
 * every worklet node's messages to the page are dropped: a worklet that never says it is ready. With
 * `failFirst`, the first worklet module added is refused as a failed fetch is (worklet module fetches
 * do not pass through page.route, so the refusal is made here, where the library sees it).
 */
async function instrument(page: Page, { deaf = false, failFirst = false } = {}) {
  await page.addInitScript(([deaf, failFirst]) => {
    const g = window as unknown as PageGlobals & { AudioContext: unknown };
    g.__worklet = { modules: [], errors: [] };
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (url: string | URL, options?: WorkletOptions) {
      g.__worklet.modules.push(String(url));
      if (failFirst && g.__worklet.modules.length === 1) return Promise.reject(new DOMException("Unable to load a worklet's module.", "AbortError"));
      return addModule.call(this, url, options);
    };
    const Node = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Node {
      constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
        super(...args);
        this.addEventListener("processorerror", (e) => g.__worklet.errors.push(String((e as ErrorEvent).message ?? "processorerror")));
        if (deaf) {
          const port = super.port;
          Object.defineProperty(this, "port", {
            value: { postMessage: (...a: Parameters<MessagePort["postMessage"]>) => port.postMessage(...a), set onmessage(_: unknown) {} },
          });
        }
      }
    };
    const Real = window.AudioContext;
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
  }, [deaf, failFirst] as const);
  // The main-thread library, minified as in the production build.
  await page.route("**/vendor/signalsmith-stretch.mjs", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: minified }));
}

async function playWav(page: Page) {
  await page.goto(`${origin}/`);
  await page.selectOption("#fixture", WAV);
  await page.click("#play");
  await page.waitForFunction(() => ["playing", "error"].includes((window as unknown as PageGlobals).stashEngine.getState().status));
  expect(await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState().status)).toBe("playing");
}

/** Playhead speed over one second of wall clock, in loop ms per ms. */
function playheadRate(page: Page) {
  return page.evaluate(
    (loopMs) =>
      new Promise<number>((resolve) => {
        const e = (window as unknown as PageGlobals).stashEngine;
        const t0 = performance.now();
        const p0 = e.getPositionMs();
        setTimeout(() => {
          let dp = e.getPositionMs() - p0;
          if (dp < 0) dp += loopMs; // wrapped at the loop end
          resolve(dp / (performance.now() - t0));
        }, 1000);
      }),
    WAV_LOOP_MS,
  );
}

const rms = (page: Page) =>
  page.evaluate(() => {
    const a = (window as unknown as PageGlobals).__analyser!;
    const d = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(d);
    return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
  });

test("with the library minified as in the production build, a tempo and key change is heard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await instrument(page);
  await playWav(page);

  await page.evaluate(() => {
    const e = (window as unknown as PageGlobals).stashEngine;
    e.setTempo(280); // twice the loop's 140 BPM
    e.setTranspose(3);
  });
  await page.waitForTimeout(800); // load, hand over at now + latency
  const rate = await playheadRate(page);
  console.log(`playhead at ${rate.toFixed(3)}x after a change to double tempo`);
  expect(await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState())).toMatchObject({ status: "playing", tempoRatio: 2, transpose: 3 });
  expect(rate, "playhead at double speed: the stretch took over").toBeGreaterThan(1.8);
  expect(rate, "playhead at double speed: the stretch took over").toBeLessThan(2.2);
  await expect.poll(() => rms(page), { message: "the stretched loop reaches the output" }).toBeGreaterThan(0.001);
  const worklet = await page.evaluate(() => (window as unknown as PageGlobals).__worklet);
  expect(worklet.errors, "the stretch worklet runs").toEqual([]);
  expect(worklet.modules, "the worklet comes from the served, unminified file").toEqual([expect.stringMatching(/^\/worklets\/signalsmith-stretch-\d+\.\d+\.\d+\.mjs$/)]);
  expect(errors).toEqual([]);
});

test("a stretch worklet that never says it is ready falls back to the original tempo and key within 3 s", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // As the minified worklet did after its error: the node is made, and never says it is ready.
  await instrument(page, { deaf: true });
  await playWav(page);

  // Timed in the page, from the change to the state that says the tempo is back at the original.
  const waited = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const e = (window as unknown as PageGlobals).stashEngine as PageGlobals["stashEngine"] & { subscribe(l: (s: { tempoRatio: number }) => void): () => void };
        const t0 = performance.now();
        const stop = e.subscribe((s) => {
          if (s.tempoRatio === 1) {
            stop();
            resolve(performance.now() - t0);
          }
        });
        e.setTempo(280);
        setTimeout(() => reject(new Error("the tempo never fell back")), 10_000);
      }),
  );
  console.log(`fallback after ${Math.round(waited)} ms`);
  expect(waited, "not before the 3 s deadline").toBeGreaterThanOrEqual(2900);
  expect(waited, "at the 3 s deadline").toBeLessThan(3500);
  expect(await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState())).toMatchObject({ status: "playing", transpose: 0 });
  const rate = await playheadRate(page);
  expect(rate, "playhead at the original speed").toBeGreaterThan(0.9);
  expect(rate, "playhead at the original speed").toBeLessThan(1.1);
  expect(await rms(page), "the loop still reaches the output").toBeGreaterThan(0.001);
  expect(errors).toEqual([]);
});

// PR #10 delta review (lead, advisory): the library keeps a rejected addModule on the context. One
// failed fetch of the worklet file must not disable the stretch until reload.
test("after one failed fetch of the worklet file, the next tempo change loads it again and is heard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await instrument(page, { failFirst: true });
  await playWav(page);
  const engine = () => page.evaluate(() => (window as unknown as PageGlobals).stashEngine.getState());

  await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.setTempo(280));
  await expect.poll(async () => (await engine()).tempoRatio, { message: "the first load fails and falls back" }).toBe(1);
  await page.evaluate(() => (window as unknown as PageGlobals).stashEngine.setTempo(280));
  await page.waitForTimeout(800);
  const rate = await playheadRate(page);
  console.log(`after the retry: playhead at ${rate.toFixed(3)}x`);
  expect(await engine()).toMatchObject({ status: "playing", tempoRatio: 2 });
  expect(rate, "the stretch took over on the second try").toBeGreaterThan(1.8);
  expect(rate).toBeLessThan(2.2);
  const worklet = await page.evaluate(() => (window as unknown as PageGlobals).__worklet);
  expect(worklet.modules).toEqual([expect.stringMatching(/\/worklets\/signalsmith-stretch-[\d.]+\.mjs$/), expect.stringMatching(/\/worklets\/signalsmith-stretch-[\d.]+\.mjs\?r=1$/)]);
  expect(errors).toEqual([]);
});
