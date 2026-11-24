import { expect, test, type Browser } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ticket 123: time to first sound on the audio test page, from the click on play to the first
// non-silent sample due at the output. Budgets come from packages/contracts/limits.json.
//
// The output side is timed by a tap on the destination: a ScriptProcessor (created synchronously with
// the context, so it cannot miss the start) finds the first sample above -80 dBFS on the audio clock,
// and getOutputTimestamp() maps that onto the performance clock the click's timeStamp uses. The tap
// takes the later edge of its 256-frame block, so it can only overstate the time, by at most ~6 ms.

const root = join(import.meta.dirname, "../..");
const limits = JSON.parse(readFileSync(join(root, "packages/contracts/limits.json"), "utf8"));
const budget = limits.performance as { firstSoundMsFast: number; firstSoundMsThrottled: number };

/** Previews are MP3; this is the MP3 fixture loop (206 KB at 256 kbps, more than a 192 kbps preview of it). */
const LOOP = "trap_bells_150_F#m.mp3";
const RUNS = 3;

/** No throttling. */
const FAST = null;
/** A mid-range phone on 4G: CPU 4x slower (as budgets.spec.ts), 9 Mbps down, 1.5 Mbps up, 150 ms latency. */
const THROTTLED = { cpu: 4, latency: 150, down: (9e6 / 8) | 0, up: (1.5e6 / 8) | 0 };
/** A slow connection, for the preloaded case: 1.6 Mbps down, 750 kbps up, 562.5 ms latency. */
const SLOW = { cpu: 4, latency: 562.5, down: (1.6e6 / 8) | 0, up: (750e3 / 8) | 0 };
type Profile = typeof THROTTLED | null;

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

interface Globals {
  __clickAt: number | null;
  __soundAt: number | null;
  stashEngine: { getState(): { status: string } };
}

/**
 * One run: fresh browser context, cache off, the profile applied, then click and wait for sound. A
 * cold run presses the button from the keyboard: a mouse click would hover it first, and hovering
 * preloads. A preloaded run hovers, waits for the download, then clicks.
 */
async function firstSound(browser: Browser, profile: Profile, opts: { preloadOnHover: boolean }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      const g = window as unknown as Globals & { AudioContext: unknown };
      g.__clickAt = null;
      g.__soundAt = null;
      document.addEventListener(
        "click",
        (e) => {
          if ((e.target as Element | null)?.id === "play" && g.__clickAt === null) g.__clickAt = e.timeStamp;
        },
        true,
      );
      const Real = window.AudioContext;
      g.AudioContext = class extends Real {
        private tap: GainNode;
        constructor(options?: AudioContextOptions) {
          super(options);
          this.tap = Real.prototype.createGain.call(this);
          this.tap.connect(super.destination);
          const block = 256;
          const probe = Real.prototype.createScriptProcessor.call(this, block, 1, 1);
          this.tap.connect(probe);
          probe.connect(super.destination); // its output is silence; connected so it runs
          probe.onaudioprocess = (e) => {
            if (g.__soundAt !== null) return;
            const x = e.inputBuffer.getChannelData(0);
            for (let i = 0; i < x.length; i++) {
              if (Math.abs(x[i]!) > 1e-4) {
                const t = e.playbackTime + i / this.sampleRate; // the later edge: never understates
                const ts = this.getOutputTimestamp();
                g.__soundAt =
                  ts.performanceTime && ts.contextTime
                    ? ts.performanceTime + (t - ts.contextTime) * 1000
                    : performance.now() + (t - this.currentTime + this.outputLatency) * 1000;
                return;
              }
            }
          };
        }
        override get destination(): AudioDestinationNode {
          return this.tap as unknown as AudioDestinationNode;
        }
      };
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.goto(`${origin}/?loop=${encodeURIComponent(LOOP)}`);
    await expect(page.locator("#fixture")).toHaveValue(LOOP);
    if (profile) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: profile.latency, downloadThroughput: profile.down, uploadThroughput: profile.up });
    }
    const fixtureRequests: number[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/fixtures/")) fixtureRequests.push(Date.now());
    });
    if (opts.preloadOnHover) {
      const done = page.waitForResponse((r) => r.url().includes("/fixtures/"));
      await page.hover("#play");
      await (await done).finished();
    }
    const clickedAt = Date.now();
    if (opts.preloadOnHover) {
      await page.click("#play");
    } else {
      await page.focus("#play");
      await page.keyboard.press("Enter");
    }
    await page.waitForFunction(() => (window as unknown as Globals).__soundAt !== null, null, { timeout: 15_000 });
    const r = await page.evaluate(() => {
      const g = window as unknown as Globals;
      // Resource timing, on the same clock as the click: did any preview download start before it?
      const fixtures = performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname.startsWith("/fixtures/"));
      return {
        ms: g.__soundAt! - g.__clickAt!,
        status: g.stashEngine.getState().status,
        fixtureStartsBeforeClick: fixtures.filter((e) => e.startTime < g.__clickAt!).length,
        fixtureRequests: fixtures.length,
      };
    });
    return { ...r, requestsAfterClick: fixtureRequests.filter((t) => t >= clickedAt).length };
  } finally {
    await context.close();
  }
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test(`first sound on a fast connection, nothing preloaded: under ${budget.firstSoundMsFast} ms`, async ({ browser }) => {
  for (let i = 0; i < RUNS; i++) {
    const r = await firstSound(browser, FAST, { preloadOnHover: false });
    console.log(`first sound fast, cold: ${r.ms.toFixed(0)} ms`);
    expect(r.status).toBe("playing");
    expect(r.ms).toBeGreaterThan(0);
    expect(r.fixtureRequests, "one preview download").toBe(1);
    expect(r.fixtureStartsBeforeClick, "nothing fetched before the click").toBe(0);
    expect(r.ms, "click to first sound (ms), fast").toBeLessThan(budget.firstSoundMsFast);
  }
});

test(`first sound throttled (CPU 4x, 4G), nothing preloaded: under ${budget.firstSoundMsThrottled} ms`, async ({ browser }) => {
  for (let i = 0; i < RUNS; i++) {
    const r = await firstSound(browser, THROTTLED, { preloadOnHover: false });
    console.log(`first sound throttled, cold: ${r.ms.toFixed(0)} ms`);
    expect(r.status).toBe("playing");
    expect(r.fixtureRequests, "one preview download").toBe(1);
    expect(r.fixtureStartsBeforeClick, "nothing fetched before the click").toBe(0);
    // A cold start pays at least one round trip: anything less would mean the throttle did not apply.
    expect(r.ms, "longer than the profile's latency").toBeGreaterThan(THROTTLED.latency);
    expect(r.ms, "click to first sound (ms), throttled").toBeLessThan(budget.firstSoundMsThrottled);
  }
});

test(`first sound on a slow connection after a hover preload: under ${budget.firstSoundMsThrottled} ms and no request after the click`, async ({ browser }) => {
  for (let i = 0; i < RUNS; i++) {
    const r = await firstSound(browser, SLOW, { preloadOnHover: true });
    console.log(`first sound slow, preloaded on hover: ${r.ms.toFixed(0)} ms, requests after click: ${r.requestsAfterClick}`);
    expect(r.status).toBe("playing");
    expect(r.ms).toBeGreaterThan(0);
    expect(r.fixtureStartsBeforeClick, "the preview was fetched on hover").toBe(1);
    expect(r.requestsAfterClick, "play() of a preloaded item makes no request").toBe(0);
    expect(r.ms, "click to first sound (ms), slow but preloaded").toBeLessThan(budget.firstSoundMsThrottled);
  }
});
