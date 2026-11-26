#!/usr/bin/env node
// Nightly quality check of the static demo (apps/web/out-demo). Lead-owned tooling.
//
//   pnpm qa:nightly                 build the demo, then check it
//   pnpm qa:nightly --no-build      check the out-demo that is already there
//   options: --per-type N (detail pages per type, default 12)  --day N (rotation day, default today)
//            --clicks N (buttons clicked per page, default 24) --workers N (browser pages, default 3)
//
// It serves out-demo on a local port and, with Playwright's Chromium, visits every tab and a bounded
// sample of every kind of detail page (preset songs, sample songs, sampled records, sample artists and
// producers, kits, packs, MIDI, loops, profiles). The sample rotates by date, so every page is visited
// over the days. On each page it checks:
//   (a) links: every internal href or #hash on the page resolves to a page that is not a not-found
//       page (all of them are resolved against the demo's data; the rest are opened), and every file
//       the page fetched (mp3, jpg, json, worklet) answered 200;
//   (b) media: every mp3 in out-demo is decoded with ffmpeg; one that is undecodable, truncated or
//       peaks below -50 dBFS is flagged (with no ffmpeg, the page's Web Audio decodes them instead);
//   (c) buttons: each visible, enabled button is clicked; one that changes no DOM, navigates nowhere,
//       starts no audio, shows no toast and saves or copies nothing is flagged as dead. Page errors and
//       console errors are flagged too.
// Static checks also run: every cover row points at a tile on a sheet, every sheet exists, and the
// output stays within the Artifact's file limits.
//
// Writes qa-report/report.json and qa-report/report.md (gitignored) and exits 1 on any failure.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const started = Date.now();
const root = join(import.meta.dirname, "..");
const demo = join(root, "apps/web/src/demo");
const out = join(root, "apps/web/out-demo");
const reportDir = join(root, "qa-report");
const req = createRequire(join(root, "package.json"));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const PER_TYPE = Number(arg("per-type", 12));
const CLICKS = Number(arg("clicks", 24));
const WORKERS = Number(arg("workers", 3));
const DAY = Number(arg("day", Math.floor(Date.now() / 86400000)));
const log = (...a) => console.error(`[qa ${((Date.now() - started) / 1000).toFixed(0)}s]`, ...a);

const failures = []; // { kind, page?, detail }
const warnings = [];
const fail = (kind, detail, page) => failures.push({ kind, page, detail });
const warn = (kind, detail, page) => warnings.push({ kind, page, detail });

// 1. Build (or reuse) the demo.
if (!process.argv.includes("--no-build") || !existsSync(join(out, "index.html"))) {
  log("building the demo");
  const r = spawnSync(process.execPath, [join(root, "scripts/build-demo-app.mjs")], { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) {
    console.error("demo build failed");
    process.exit(1);
  }
}

// 2. The demo's own data, bundled for node: every detail page there is, and how a link resolves.
const dataEntry = `
import { ALL_SONGS, songBySlug } from ${JSON.stringify(join(demo, "presets/songs"))};
import { SAMPLE_SONGS, ORIGINALS, ARTISTS, PRODUCERS, sampleSongBySlug, originalBySlug, artistBySlug, producerBySlug, sampleHref, originalHref, artistHref, producerHref } from ${JSON.stringify(join(demo, "samples/data"))};
import { midiItems, midiItem } from ${JSON.stringify(join(demo, "midi/catalog"))};
import { kits, kit } from ${JSON.stringify(join(demo, "kits/store"))};
import { PACKS, pack } from ${JSON.stringify(join(demo, "packs"))};
import { buildCatalog } from ${JSON.stringify(join(demo, "data"))};
import { nameFor, pathFor } from ${JSON.stringify(join(demo, "router"))};
import { allProducers, producerBySlug as producerPage, producerPageHref } from ${JSON.stringify(join(demo, "producers/data"))};
import COVERS from ${JSON.stringify(join(demo, "presets/covers.json"))};
import SHEETS from ${JSON.stringify(join(demo, "presets/cover-sheets.json"))};
import LAZY_COVERS from ${JSON.stringify(join(demo, "samples/covers.json"))};
const catalog = buildCatalog("http://localhost/");
const midiId = (p) => /^\\/midi\\/(?:.*-)?([a-z0-9]+)$/.exec(p)?.[1];
export const pages = {
  "preset song": ALL_SONGS.map((s) => "/presets/" + s.slug),
  "sample song": SAMPLE_SONGS.map(sampleHref),
  "sampled record": ORIGINALS.map(originalHref),
  "sample artist": ARTISTS.map(artistHref),
  "sample producer": PRODUCERS.map(producerHref),
  midi: midiItems().map((m) => m.href),
  kit: kits().map((k) => "/kit/" + k.id),
  pack: PACKS.map((p) => "/pack/" + p.id),
  loop: catalog.rows.map((r) => catalog.hrefOf(r.publicId)).filter(Boolean),
  producer: allProducers().map(producerPageHref),
  profile: [...new Set(catalog.rows.map((r) => r.owner.handle))].map((h) => "/u/" + h),
};
/** true, false (a not-found page), or null (not decidable from the data: open it). */
export function resolves(path) {
  const m = (re) => re.exec(path)?.[1];
  let x;
  if ((x = /^\\/loop\\/(?:.*-)?([a-z0-9]+)$/.exec(path)?.[1])) return !!catalog.page(x);
  if ((x = midiId(path))) return !!midiItem(x);
  if ((x = m(/^\\/presets\\/(.+)$/))) return !!songBySlug(x);
  if ((x = m(/^\\/samples\\/(.+)$/))) return !!sampleSongBySlug(x);
  if ((x = m(/^\\/sampled\\/(.+)$/))) return !!originalBySlug(x);
  if ((x = m(/^\\/samples-artist\\/(.+)$/))) return !!artistBySlug(x);
  if ((x = m(/^\\/samples-producer\\/(.+)$/))) return !!producerBySlug(x);
  if ((x = m(/^\\/kit\\/([a-z0-9]+)$/))) return !!kit(x);
  if ((x = m(/^\\/pack\\/(.+)$/))) return !!pack(x);
  if ((x = m(/^\\/producer\\/(.+)$/))) return !!producerPage(x);
  return null;
}
export const toPath = (href) => (href.startsWith("#") ? pathFor(decodeURIComponent(href.slice(1)), (id) => catalog.hrefOf(id), (id) => midiItem(id)?.href ?? null) : href.split(/[?#]/)[0]);
export { nameFor, COVERS, SHEETS, LAZY_COVERS };
`;
const tmp = mkdtempSync(join(tmpdir(), "qa-nightly-"));
const esbuild = req("esbuild");
await esbuild.build({ stdin: { contents: dataEntry, resolveDir: demo, loader: "ts" }, outfile: join(tmp, "data.mjs"), bundle: true, platform: "node", format: "esm", jsx: "automatic", logLevel: "error" });
const data = await import(pathToFileURL(join(tmp, "data.mjs")).href);

// 3. Static checks on the output.
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    if (f.isDirectory()) walk(p);
    else files.push(relative(out, p));
  }
};
walk(out);
const totalBytes = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
if (files.length > 511) fail("artifact limit", `out-demo has ${files.length} files; an Artifact version holds at most 511`);
if (totalBytes > 256 * 1024 * 1024) fail("artifact limit", `out-demo is ${(totalBytes / 1048576).toFixed(1)} MB; an Artifact version holds at most 256 MB`);
const sheetFiles = new Set(data.SHEETS.sheets);
for (const s of sheetFiles) if (!files.includes(s)) fail("missing file", `cover sheet ${s} is listed in cover-sheets.json but not in out-demo`);
for (const f of files) if (f.startsWith("covers/") && !sheetFiles.has(f)) warn("unused file", `${f} is in out-demo but on no sheet list`);
for (const [key, row] of Object.entries(data.COVERS)) if (!data.SHEETS.tiles[row.file]) fail("broken cover", `${key}: ${row.file} is on no sprite sheet (the page would fetch a file that is not published)`);
for (const [key, row] of Object.entries(data.LAZY_COVERS)) if (!row.t || !data.SHEETS.sheets[row.t[0]]) fail("broken cover", `${key}: samples/covers.json row for ${row.f} has no tile on a published sheet (run scripts/pack-demo-covers.py)`);

// 4. Media: decode every mp3.
const mp3s = files.filter((f) => f.endsWith(".mp3"));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const media = [];
const run = (cmd, args) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let o = "";
    let e = "";
    p.stdout.on("data", (d) => (o += d));
    p.stderr.on("data", (d) => (e += d));
    p.on("close", (code) => resolve({ code, o, e }));
  });
if (hasFfmpeg) {
  log(`decoding ${mp3s.length} mp3 files with ffmpeg`);
  const queue = [...mp3s];
  await Promise.all(
    Array.from({ length: Math.max(2, cpus().length) }, async () => {
      for (let f; (f = queue.shift()); ) {
        const file = join(out, f);
        // The header's length, then a full decode: its errors, its peak and how many samples came out.
        const probe = await run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels:format=duration", "-of", "json", file]);
        const info = (() => {
          try {
            return JSON.parse(probe.o);
          } catch {
            return {};
          }
        })();
        const rate = Number(info.streams?.[0]?.sample_rate) || 0;
        const channels = Number(info.streams?.[0]?.channels) || 0;
        const headerSec = Number(info.format?.duration) || 0;
        const strict = await run("ffmpeg", ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"]);
        const vol = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
        const peak = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(vol.e)?.[1];
        const samples = Math.max(0, ...[...vol.e.matchAll(/n_samples:\s*(\d+)/g)].map((m) => Number(m[1])));
        const decodedSec = rate && channels ? samples / channels / rate : 0;
        const errors = strict.e.split("\n").filter((l) => l.trim());
        const row = { file: f, bytes: statSync(file).size, headerSec, decodedSec: +decodedSec.toFixed(3), peakDb: peak === undefined || peak === "-inf" ? -Infinity : Number(peak), errors: errors.slice(0, 3) };
        media.push(row);
        if (probe.code !== 0 || !rate) fail("bad audio", `${f}: ffprobe finds no audio stream`);
        else if (strict.code !== 0 || errors.length > 0) fail("bad audio", `${f}: does not decode cleanly (${errors[0] ?? `ffmpeg exit ${strict.code}`})`);
        else if (!(row.peakDb > -50)) fail("silent audio", `${f}: peaks at ${row.peakDb} dBFS (below -50)`);
        else if (headerSec > 0 && decodedSec < headerSec - 0.5) fail("truncated audio", `${f}: decodes ${decodedSec.toFixed(2)} s of the ${headerSec.toFixed(2)} s its header says`);
      }
    }),
  );
}

// 5. Serve out-demo.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp3": "audio/mpeg", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".wav": "audio/wav", ".woff2": "font/woff2" };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, "http://x").pathname);
  const f = join(out, p === "/" ? "index.html" : p);
  if (!f.startsWith(out) || !existsSync(f) || statSync(f).isDirectory()) {
    rs.writeHead(404).end("not found");
    return;
  }
  rs.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" }).end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
log(`serving out-demo at ${base}`);

// 6. Which pages to visit: every tab, and a rotating window of each detail type.
const TABS = ["/", "/browse/loops", "/loops", "/midi", "/one-shots", "/sfx", "/sound-design", "/presets", "/samples", "/kits", "/kit-upload", "/producers", "/creators", "/upload", "/library", "/licenses", "/search", "/notifications", "/login"];
const shuffle = (xs, seed) => {
  const a = [...xs];
  let s = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const visits = TABS.map((p) => ({ type: "tab", path: p }));
const coverage = {};
for (const [type, all] of Object.entries(data.pages)) {
  const uniq = [...new Set(all)];
  const order = shuffle(uniq, 7919 * (type.length + 1)); // a fixed order per type
  const n = Math.min(PER_TYPE, uniq.length);
  const start = (DAY * n) % Math.max(1, uniq.length);
  const pick = uniq.length <= PER_TYPE ? uniq : Array.from({ length: n }, (_, i) => order[(start + i) % order.length]);
  coverage[type] = { total: uniq.length, visited: pick.length, fullCycleDays: Math.ceil(uniq.length / Math.max(1, n)) };
  for (const p of pick) visits.push({ type, path: p });
}
log(`${visits.length} pages to visit`);

// 7. Visit them.
const { chromium } = req("playwright");
// Muted: the check clicks every play button, and nothing should reach a speaker.
const browser = await chromium.launch({ args: ["--mute-audio"] });
const NOT_FOUND = /isn['’]t here|isn['’]t in the (presets|samples) yet|No producer by that name|No page for that producer yet/i;
const pageResults = [];
const hrefs = new Map(); // href -> first page it was seen on
const fetched = new Map(); // url -> status

// Hooks installed before the app runs: what a click caused.
const HOOKS = () => {
  const w = window;
  w.__qa = { audio: 0, saves: 0, copies: 0, mutations: 0, jumps: 0 };
  // A jump to a section counts even when the page is already there (a short page cannot scroll).
  const into = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...a) {
    w.__qa.jumps++;
    return into.apply(this, a);
  };
  const AC = w.AudioContext || w.webkitAudioContext;
  if (AC) {
    // Each source type has its own start(): count them all.
    for (const T of [w.AudioScheduledSourceNode, w.AudioBufferSourceNode, w.OscillatorNode, w.ConstantSourceNode]) {
      if (!T || !Object.prototype.hasOwnProperty.call(T.prototype, "start")) continue;
      const start = T.prototype.start;
      T.prototype.start = function (...a) {
        w.__qa.audio++;
        return start.apply(this, a);
      };
    }
    const resume = AC.prototype.resume;
    AC.prototype.resume = function (...a) {
      w.__qa.audio++;
      return resume.apply(this, a);
    };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    w.__qa.audio++;
    return play.apply(this, a);
  };
  const blob = URL.createObjectURL;
  URL.createObjectURL = function (...a) {
    w.__qa.saves++;
    return blob.apply(this, a);
  };
  if (navigator.clipboard) {
    const wt = navigator.clipboard.writeText?.bind(navigator.clipboard);
    if (wt) navigator.clipboard.writeText = (t) => ((w.__qa.copies++), wt(t).catch(() => {}));
  }
  // A new tab counts as the button doing something; the check never opens one.
  w.open = () => {
    w.__qa.saves++;
    return null;
  };
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver((m) => (w.__qa.mutations += m.length)).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  });
};

async function visit(ctx, v) {
  const page = await ctx.newPage();
  const errors = [];
  let acting = "";
  const when = () => (acting ? ` (after clicking "${acting}")` : " (while loading)");
  page.on("pageerror", (e) => errors.push(`page error: ${e.message.split("\n")[0]}${when()}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console error: ${m.text().slice(0, 200)}${when()}`);
  });
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(base)) fetched.set(u, Math.max(fetched.get(u) ?? 0, r.status()));
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (u.startsWith(base) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) fetched.set(u, -1);
  });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  page.on("popup", (p) => p.close().catch(() => {}));
  page.on("download", (d) => d.cancel().catch(() => {}));
  const url = `${base}#${data.nameFor(v.path)}`;
  const result = { ...v, ok: true, notFound: false, buttons: 0, dead: [], errors };
  try {
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => document.querySelector("#root")?.children.length > 0, null, { timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
    if (NOT_FOUND.test(text)) {
      result.notFound = true;
      fail("not found", `${v.path} (a ${v.type} page from the data) renders a not-found page`, v.path);
    }
    // App links ("/path" or "#name"); a "#id" that names an element on this page is an in-page anchor.
    const links = await page.$$eval("a[href]", (as) =>
      as.map((a) => a.getAttribute("href")).filter((h) => h && (h.startsWith("/") || (h.startsWith("#") && h.length > 1 && !document.getElementById(decodeURIComponent(h.slice(1)))))),
    );
    for (const h of links) if (!hrefs.has(h)) hrefs.set(h, v.path);
    // Buttons: one of each kind (same label once a number or title is set aside), up to CLICKS.
    const buttons = await page.$$eval('button, [role="button"]', (bs) =>
      bs.map((b, i) => {
        b.setAttribute("data-qa-i", String(i));
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        const visible = r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        const disabled = b.disabled || b.getAttribute("aria-disabled") === "true";
        // A chip or tab that is already the chosen one does nothing when chosen again, by design.
        const chosen = ["aria-pressed", "aria-selected", "aria-checked"].some((a) => b.getAttribute(a) === "true") || b.getAttribute("data-state") === "active" || b.hasAttribute("aria-current");
        const label = (b.getAttribute("aria-label") || b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
        return { i, label, visible, disabled, chosen };
      }),
    );
    const kinds = new Set();
    const todo = buttons.filter((b) => {
      if (!b.visible || b.disabled || b.chosen) return false;
      const kind = b.label.replace(/\d+/g, "#").split(" ").slice(0, 2).join(" ");
      if (kinds.has(kind)) return false;
      kinds.add(kind);
      return true;
    });
    for (const b of todo.slice(0, CLICKS)) {
      const loc = page.locator(`[data-qa-i="${b.i}"]`);
      if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) continue;
      const state = () =>
        page.evaluate(() => {
          // Scroll positions count: a button that jumps to a section only scrolls.
          let scroll = window.scrollY;
          for (const el of document.querySelectorAll("main, #content, [data-scroll], .overflow-auto, .overflow-y-auto, .overflow-x-auto")) scroll += el.scrollTop + el.scrollLeft;
          return { ...window.__qa, hash: location.hash, html: document.body.innerHTML.length, scroll };
        });
      const before = await state();
      acting = b.label || "an unlabelled button";
      try {
        await loc.click({ timeout: 2000, noWaitAfter: true });
      } catch {
        // A moving element (the genre ticker) never settles: click it where it is.
        try {
          await loc.click({ timeout: 2000, noWaitAfter: true, force: true });
        } catch (e) {
          warn("unclickable", `"${b.label}" could not be clicked (${String(e.message).split("\n")[0]})`, v.path);
          continue;
        }
      }
      const changed = (a) => a.hash !== before.hash || a.mutations !== before.mutations || a.audio !== before.audio || a.saves !== before.saves || a.copies !== before.copies || a.jumps !== before.jumps || a.html !== before.html || a.scroll !== before.scroll;
      await page.waitForTimeout(250);
      let after = await state();
      // Audio that has to be fetched and decoded first starts later: give it a moment more.
      if (!changed(after)) {
        await page.waitForTimeout(1500);
        after = await state();
      }
      result.buttons++;
      const did = changed(after);
      if (!did) result.dead.push(b.label || `(unlabelled button #${b.i})`);
      // Undo what the click opened or where it went.
      await page.keyboard.press("Escape").catch(() => {});
      if (after.hash !== before.hash || page.url() !== url) {
        await page.goto(url, { waitUntil: "load" }).catch(() => {});
        await page.waitForTimeout(300);
        await page.$$eval('button, [role="button"]', (bs) => bs.forEach((x, i) => x.setAttribute("data-qa-i", String(i)))).catch(() => {});
      }
    }
    for (const d of result.dead) fail("dead button", `"${d}" did nothing when clicked`, v.path);
  } catch (e) {
    result.ok = false;
    fail("page failed", `${v.path}: ${String(e.message).split("\n")[0]}`, v.path);
  }
  for (const e of errors) fail(e.startsWith("page") ? "page error" : "console error", e, v.path);
  await page.close().catch(() => {});
  pageResults.push(result);
}

const queue = [...visits];
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(HOOKS);
    for (let v; (v = queue.shift()); ) {
      await visit(ctx, v);
      if (pageResults.length % 10 === 0) log(`${pageResults.length}/${visits.length} pages`);
    }
    await ctx.close();
  }),
);

// 8. Links: resolve every href seen against the data; open the ones the data cannot decide.
log(`${hrefs.size} distinct internal links`);
const open = [];
for (const [h, from] of hrefs) {
  const path = data.toPath(h);
  if (path === "/not-found") {
    fail("broken link", `${h} names no page (seen on ${from})`, from);
    continue;
  }
  const r = data.resolves(path);
  if (r === false) fail("broken link", `${h} goes to a not-found page (seen on ${from})`, from);
  else if (r === null && !visits.some((v) => v.path === path)) open.push([h, path, from]);
}
const seenPaths = new Set();
const ctx = await browser.newContext();
const lp = await ctx.newPage();
for (const [h, path, from] of open) {
  if (seenPaths.has(path)) continue;
  seenPaths.add(path);
  try {
    await lp.goto(`${base}#${data.nameFor(path)}`, { waitUntil: "load" });
    await lp.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const text = await lp.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
    if (NOT_FOUND.test(text)) fail("broken link", `${h} goes to a not-found page (seen on ${from})`, from);
  } catch (e) {
    fail("broken link", `${h} could not be opened: ${String(e.message).split("\n")[0]}`, from);
  }
}
// Web Audio decode when there's no ffmpeg: every mp3, in the page.
if (!hasFfmpeg) {
  await lp.goto(base, { waitUntil: "load" });
  for (const f of mp3s) {
    const r = await lp.evaluate(async (u) => {
      try {
        const buf = await (await fetch(u)).arrayBuffer();
        const a = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf);
        let peak = 0;
        for (let c = 0; c < a.numberOfChannels; c++) for (const x of a.getChannelData(c)) peak = Math.max(peak, Math.abs(x));
        return { ok: true, sec: a.duration, peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }, f);
    media.push({ file: f, ...r });
    if (!r.ok) fail("bad audio", `${f}: ${r.error}`);
    else if (!(r.peakDb > -50)) fail("silent audio", `${f}: peaks at ${r.peakDb} dBFS (below -50)`);
  }
}
await ctx.close();
await browser.close();
server.close();
rmSync(tmp, { recursive: true, force: true });

for (const [u, status] of fetched) if (status !== 200 && status !== 304 && status !== 206) fail("bad fetch", `${u.slice(base.length)} answered ${status === -1 ? "nothing (request failed)" : status}`);

// 9. Report.
mkdirSync(reportDir, { recursive: true });
const byKind = {};
for (const f of failures) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
const summary = {
  when: new Date().toISOString(),
  rotationDay: DAY,
  seconds: Math.round((Date.now() - started) / 1000),
  output: { files: files.length, megabytes: +(totalBytes / 1048576).toFixed(1) },
  pagesVisited: pageResults.length,
  buttonsClicked: pageResults.reduce((n, r) => n + r.buttons, 0),
  linksChecked: hrefs.size,
  filesFetched: fetched.size,
  mp3sDecoded: media.length,
  coverage,
  failures: failures.length,
  failuresByKind: byKind,
  warnings: warnings.length,
};
writeFileSync(join(reportDir, "report.json"), JSON.stringify({ summary, failures, warnings, pages: pageResults, media }, null, 1));
const md = [
  `# Demo nightly QA, ${summary.when.slice(0, 10)}`,
  "",
  `${failures.length === 0 ? "PASS" : "FAIL"}: ${failures.length} failures, ${warnings.length} warnings, in ${summary.seconds} s.`,
  "",
  `Visited ${summary.pagesVisited} pages, clicked ${summary.buttonsClicked} buttons, checked ${summary.linksChecked} internal links and ${summary.filesFetched} fetched files, decoded ${summary.mp3sDecoded} mp3s. Output: ${summary.output.files} files, ${summary.output.megabytes} MB.`,
  "",
  "## Coverage (rotation day " + DAY + ")",
  "",
  "| Type | Pages | Visited today | Days for a full cycle |",
  "|---|---|---|---|",
  ...Object.entries(coverage).map(([t, c]) => `| ${t} | ${c.total} | ${c.visited} | ${c.fullCycleDays} |`),
  "",
  "## Failures",
  "",
  ...(failures.length ? Object.keys(byKind).flatMap((k) => [`### ${k} (${byKind[k]})`, "", ...failures.filter((f) => f.kind === k).slice(0, 200).map((f) => `- ${f.page ? `\`${f.page}\`: ` : ""}${f.detail}`), ""]) : ["None.", ""]),
  "## Warnings",
  "",
  ...(warnings.length ? warnings.slice(0, 200).map((w) => `- ${w.kind}: ${w.page ? `\`${w.page}\`: ` : ""}${w.detail}`) : ["None."]),
  "",
];
writeFileSync(join(reportDir, "report.md"), md.join("\n"));
log(`done: ${failures.length} failures (${JSON.stringify(byKind)}), ${warnings.length} warnings; report in qa-report/`);
process.exit(failures.length ? 1 : 0);
