import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Budgets live in packages/contracts/limits.json (performance). Ticket 135 points these checks at the
// loop item page: largest paint, layout shift and script before audio on a mid-range phone on 4G, and
// time to first sound from the space key on a fast connection.
const root = join(import.meta.dirname, "../..");
const limits = JSON.parse(readFileSync(join(root, "packages/contracts/limits.json"), "utf8"));
const budget = limits.performance as { itemPageLcpMs: number; itemPageCls: number; scriptBeforeAudioBytes: number; firstSoundMsFast: number };

// A mid-range phone: 4x CPU slowdown, on 4G (the same profile as audio-first-sound.spec.ts).
const CPU_SLOWDOWN = 4;
const NETWORK_4G = { offline: false, latency: 150, downloadThroughput: (9e6 / 8) | 0, uploadThroughput: (1.5e6 / 8) | 0 };

/** A fixture loop page, served with no database when the server runs with STASH_DEV_PAGES=1. */
const LOOP_PAGE = "/loop/dusty-soul-chops-k3j9x0a2b1";
/** Previews are MP3: the fixture loop page's preview is answered with the MP3 fixture. */
const mp3 = readFileSync(join(root, "fixtures/generated/loops/trap_bells_150_F#m.mp3"));

async function serveAudio(page: Page) {
  await page.route("https://media.stash.local/**", (route) =>
    route.fulfill({ status: 200, body: mp3, headers: { "content-type": "audio/mpeg", "access-control-allow-origin": "*" } }),
  );
}

for (const { path, network } of [
  { path: "/", network: false },
  { path: LOOP_PAGE, network: true },
]) {
  test(`${path} stays inside the page budgets`, async ({ page }) => {
    await serveAudio(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
    if (network) {
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", NETWORK_4G);
    }
    let scriptBytes = 0;
    page.on("response", async (res) => {
      if (res.request().resourceType() === "script") {
        // responseBodySize is the encoded (compressed) size on the wire.
        scriptBytes += (await res.request().sizes()).responseBodySize;
      }
    });
    await page.goto(path, { waitUntil: "networkidle" });
    const { lcp, cls } = await page.evaluate(
      () =>
        new Promise<{ lcp: number; cls: number }>((resolve) => {
          let lcp = 0;
          let cls = 0;
          new PerformanceObserver((l) => l.getEntries().forEach((e) => (lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((l) =>
            l.getEntries().forEach((e) => {
              const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
              if (!shift.hadRecentInput) cls += shift.value;
            }),
          ).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve({ lcp, cls }), 500);
        }),
    );
    console.log(`${path}: LCP ${Math.round(lcp)} ms, CLS ${cls.toFixed(4)}, script ${Math.round(scriptBytes / 1024)} KB`);
    expect(lcp, "largest contentful paint was measured").toBeGreaterThan(0);
    expect(lcp, "largest contentful paint (ms)").toBeLessThan(budget.itemPageLcpMs);
    expect(cls, "cumulative layout shift").toBeLessThan(budget.itemPageCls);
    expect(scriptBytes, "compressed script bytes before audio").toBeLessThan(budget.scriptBeforeAudioBytes);
  });
}

/**
 * Time to first sound on the loop page: from the space key (the keydown's timeStamp) to the first
 * non-silent sample due at the output. A tap on the destination, created with the context, finds that
 * sample on the audio clock and getOutputTimestamp() maps it onto the performance clock (the method of
 * audio-first-sound.spec.ts). The page preloads its preview, so a visitor who reads the title first
 * hears it at once; this waits for that download, as a visitor would, then presses space.
 */
test("the loop page sounds within the first-sound budget after space", async ({ page }) => {
  await serveAudio(page);
  await page.addInitScript(() => {
    const g = window as unknown as { __keyAt: number | null; __soundAt: number | null; AudioContext: typeof AudioContext };
    g.__keyAt = null;
    g.__soundAt = null;
    document.addEventListener("keydown", (e) => {
      if (e.key === " " && g.__keyAt === null) g.__keyAt = e.timeStamp;
    }, true);
    const Real = window.AudioContext;
    g.AudioContext = class extends Real {
      private tap: GainNode;
      constructor(options?: AudioContextOptions) {
        super(options);
        this.tap = Real.prototype.createGain.call(this);
        this.tap.connect(super.destination);
        const probe = Real.prototype.createScriptProcessor.call(this, 256, 1, 1);
        this.tap.connect(probe);
        probe.connect(super.destination);
        probe.onaudioprocess = (e) => {
          if (g.__soundAt !== null) return;
          const x = e.inputBuffer.getChannelData(0);
          for (let i = 0; i < x.length; i++) {
            if (Math.abs(x[i]!) > 1e-4) {
              const t = e.playbackTime + i / this.sampleRate;
              const ts = this.getOutputTimestamp();
              g.__soundAt = ts.performanceTime && ts.contextTime ? ts.performanceTime + (t - ts.contextTime) * 1000 : performance.now() + (t - this.currentTime + this.outputLatency) * 1000;
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
  const preview = page.waitForResponse((r) => r.url().startsWith("https://media.stash.local/"));
  await page.goto(LOOP_PAGE);
  await (await preview).finished();
  await page.keyboard.press("Space");
  const ms = await page
    .waitForFunction(() => {
      const g = window as unknown as { __keyAt: number | null; __soundAt: number | null };
      return g.__keyAt !== null && g.__soundAt !== null ? g.__soundAt - g.__keyAt : null;
    }, undefined, { timeout: 5000 })
    .then((h) => h.jsonValue() as Promise<number>);
  console.log(`loop page first sound after space: ${Math.round(ms)} ms`);
  expect(ms).toBeLessThan(budget.firstSoundMsFast);
});
