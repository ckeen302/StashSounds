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
//   (d) phone: the tabs and half of each day's detail pages are visited again at phone size (390x844,
//       touch, 4x slower CPU); a page wider than the screen is flagged.
//   (e) lag: how long each page takes to show its content and each click to answer, and the main
//       thread's long tasks while loading. A page over budget (3 s desktop, 5 s phone) is flagged; the
//       slowest pages and clicks are listed in the report.
//   (f) flows: search (typed queries reach results and a song page), a song page's parts, share.
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
const DESKTOP_BUDGET_MS = Number(arg("budget", 3000));
const PHONE_BUDGET_MS = Number(arg("phone-budget", 5000));
const PHONE_CPU = Number(arg("phone-cpu", 4));
const SEARCH_BUDGET_MS = 1000; // phone, after the first search; half that on desktop
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
import { SONGS, songAllBySlug } from ${JSON.stringify(join(demo, "song/data"))};
import { buildCatalog } from ${JSON.stringify(join(demo, "data"))};
import { nameFor, pathFor } from ${JSON.stringify(join(demo, "router"))};
import { allProducers, producerBySlug as producerPage, producerPageHref } from ${JSON.stringify(join(demo, "producers/data"))};
import COVERS from ${JSON.stringify(join(demo, "presets/covers.json"))};
import SHEETS from ${JSON.stringify(join(demo, "presets/cover-sheets.json"))};
import LAZY_COVERS from ${JSON.stringify(join(demo, "samples/covers.json"))};
const catalog = buildCatalog("http://localhost/");
const midiId = (p) => /^\\/midi\\/(?:.*-)?([a-z0-9]+)$/.exec(p)?.[1];
export const pages = {
  song: SONGS.map((s) => "/song/" + s.slug),
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
  if ((x = m(/^\\/song\\/(.+)$/))) return !!songAllBySlug(x);
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
const PHONE_SHARE = Number(arg("phone-share", 0.5)); // of each type's daily pages, also visited at phone size
const visits = TABS.map((p) => ({ type: "tab", path: p, device: "desktop" }));
const coverage = {};
for (const [type, all] of Object.entries(data.pages)) {
  const uniq = [...new Set(all)];
  const order = shuffle(uniq, 7919 * (type.length + 1)); // a fixed order per type
  const n = Math.min(PER_TYPE, uniq.length);
  const start = (DAY * n) % Math.max(1, uniq.length);
  const pick = uniq.length <= PER_TYPE ? uniq : Array.from({ length: n }, (_, i) => order[(start + i) % order.length]);
  coverage[type] = { total: uniq.length, visited: pick.length, fullCycleDays: Math.ceil(uniq.length / Math.max(1, n)) };
  for (const p of pick) visits.push({ type, path: p, device: "desktop" });
}
const phoneVisits = visits.filter((v, i, all) => v.type === "tab" || all.filter((w) => w.type === v.type).indexOf(v) < Math.ceil(PER_TYPE * PHONE_SHARE)).map((v) => ({ ...v, device: "phone" }));
visits.push(...phoneVisits);
log(`${visits.length} pages to visit`);

// 7. Visit them.
const { chromium } = req("playwright");
// Muted: the check clicks every play button, and nothing should reach a speaker.
const browser = await chromium.launch({ args: ["--mute-audio"] });
const NOT_FOUND = /isn['’]t here|isn['’]t on Stash yet|isn['’]t in the (presets|samples) yet|No producer by that name|No page for that producer yet/i;
const pageResults = [];
const slow = []; // visits over their time budget, to time again alone
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
  w.__qa.longTasks = 0;
  w.__qa.blocking = 0;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        w.__qa.longTasks++;
        w.__qa.blocking += Math.max(0, e.duration - 50);
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {}
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
  const result = { ...v, ok: true, notFound: false, buttons: 0, dead: [], errors, readyMs: 0, blockingMs: 0, clicks: [] };
  const tag = v.device === "phone" ? " [phone]" : "";
  try {
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    // Ready: the page's own content is on screen (a heading or a main with text), not the shell alone.
    await page.waitForFunction(() => (document.querySelector("main")?.innerText.trim().length ?? 0) > 20 || document.querySelector("main h1, main h2"), null, { timeout: 15000 }).catch(() =>
      page.waitForFunction(() => document.querySelector("#root")?.children.length > 0, null, { timeout: 15000 }),
    );
    result.readyMs = Date.now() - t0;
    const budget = v.device === "phone" ? PHONE_BUDGET_MS : DESKTOP_BUDGET_MS;
    // Several pages load at once here, so an over-budget time is timed again alone before it counts.
    if (result.readyMs > budget && !v.retime) slow.push(v);
    else if (result.readyMs > budget) fail("slow page", `${v.path}${tag} took ${(result.readyMs / 1000).toFixed(1)} s to show its content on its own (budget ${budget / 1000} s)`, v.path);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    result.blockingMs = Math.round(await page.evaluate(() => window.__qa.blocking));
    const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
    if (NOT_FOUND.test(text)) {
      result.notFound = true;
      fail("not found", `${v.path}${tag} (a ${v.type} page from the data) renders a not-found page`, v.path);
    }
    if (v.device === "phone") {
      const wide = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, view: window.innerWidth }));
      if (wide.w > wide.view + 1) fail("phone layout", `${v.path} is ${wide.w}px wide on a ${wide.view}px phone screen (it scrolls sideways)`, v.path);
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
      const c0 = Date.now();
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
      // Poll so the time to the first visible answer is known, not just whether there was one.
      let after = await state();
      while (!changed(after) && Date.now() - c0 < 250) {
        await page.waitForTimeout(16);
        after = await state();
      }
      const answeredMs = changed(after) ? Date.now() - c0 : null;
      await page.waitForTimeout(Math.max(0, 250 - (Date.now() - c0)));
      after = await state();
      // Audio that has to be fetched and decoded first starts later: give it a moment more.
      if (!changed(after)) {
        await page.waitForTimeout(1500);
        after = await state();
      }
      result.buttons++;
      const did = changed(after);
      if (did) result.clicks.push({ label: b.label, ms: answeredMs ?? Date.now() - c0, audio: after.audio !== before.audio });
      if (!did) result.dead.push(b.label || `(unlabelled button #${b.i})`);
      // Undo what the click opened or where it went.
      await page.keyboard.press("Escape").catch(() => {});
      if (after.hash !== before.hash || page.url() !== url) {
        await page.goto(url, { waitUntil: "load" }).catch(() => {});
        await page.waitForTimeout(300);
        await page.$$eval('button, [role="button"]', (bs) => bs.forEach((x, i) => x.setAttribute("data-qa-i", String(i)))).catch(() => {});
      }
    }
    for (const d of result.dead) fail("dead button", `"${d}" did nothing when clicked${tag}`, v.path);
  } catch (e) {
    result.ok = false;
    fail("page failed", `${v.path}${tag}: ${String(e.message).split("\n")[0]}`, v.path);
  }
  for (const e of errors) fail(e.startsWith("page") ? "page error" : "console error", `${e}${tag}`, v.path);
  await page.close().catch(() => {});
  pageResults.push(result);
}

// Reduced motion stops the genre ticker, so its chips scroll into view and click like any other.
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: "reduce", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" },
};
const contexts = {};
async function contextFor(device) {
  if (contexts[device]) return contexts[device];
  const ctx = await browser.newContext(DEVICES[device]);
  await ctx.addInitScript(HOOKS);
  // A phone's CPU is slower than this machine's: every phone page runs at a quarter of the speed.
  if (device === "phone") ctx.on("page", (p) => ctx.newCDPSession(p).then((c) => c.send("Emulation.setCPUThrottlingRate", { rate: PHONE_CPU })).catch(() => {}));
  return (contexts[device] = ctx);
}
const queue = [...visits];
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    for (let v; (v = queue.shift()); ) {
      await visit(await contextFor(v.device), v);
      if (pageResults.length % 10 === 0) log(`${pageResults.length}/${visits.length} pages`);
    }
  }),
);

// Pages over budget, timed again one at a time (no clicks).
for (const v of slow.slice(0, 20)) {
  const again = { ...v, retime: true };
  const page = await (await contextFor(v.device)).newPage();
  const t0 = Date.now();
  await page.goto(`${base}#${data.nameFor(v.path)}`, { waitUntil: "load", timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => (document.querySelector("main")?.innerText.trim().length ?? 0) > 20 || document.querySelector("main h1, main h2"), null, { timeout: 15000 }).catch(() => {});
  const ms = Date.now() - t0;
  await page.close().catch(() => {});
  const budget = v.device === "phone" ? PHONE_BUDGET_MS : DESKTOP_BUDGET_MS;
  const row = pageResults.find((x) => x.path === v.path && x.device === v.device);
  if (row) row.readyAloneMs = ms;
  if (ms > budget) fail("slow page", `${again.path}${v.device === "phone" ? " [phone]" : ""} took ${(ms / 1000).toFixed(1)} s to show its content on its own (budget ${budget / 1000} s)`, v.path);
}

// 7b. Flows: what a producer does end to end, on both sizes.
async function flow(device, name, steps) {
  const page = await (await contextFor(device)).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  page.on("popup", (p) => p.close().catch(() => {}));
  const t0 = Date.now();
  try {
    await steps(page);
    flows.push({ device, name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    flows.push({ device, name, ok: false, ms: Date.now() - t0, error: String(e.message).split("\n")[0] });
    fail("broken flow", `${name} [${device}]: ${String(e.message).split("\n")[0]}`);
  }
  for (const e of errs) fail("page error", `${e} (during the ${name} flow) [${device}]`);
  await page.close().catch(() => {});
}
const flows = [];
const searches = [];
const SEARCHES = [
  ["carti", /Playboi Carti/i],
  ["kayne", /Kanye/i],
  ["dark 808", /./],
];
for (const device of Object.keys(DEVICES)) {
  await flow(device, "search to a song page", async (page) => {
    for (const [q, want] of SEARCHES) {
      await page.goto(`${base}#${data.nameFor("/search")}`, { waitUntil: "load" });
      const box = page.locator('main input[type="search"]').first();
      await box.waitFor({ timeout: 10000 });
      const t = Date.now();
      await box.fill(q);
      await page.waitForFunction((src) => new RegExp(src, "i").test(document.querySelector("main")?.innerText ?? ""), want.source, { timeout: 8000 }).catch(() => {
        throw new Error(`searching "${q}" never showed a result matching ${want}`);
      });
      const ms = Date.now() - t;
      // The first search also loads the song index; after that each one should answer as you type.
      const budget = q === SEARCHES[0][0] ? (device === "phone" ? PHONE_BUDGET_MS : DESKTOP_BUDGET_MS) : device === "phone" ? SEARCH_BUDGET_MS : SEARCH_BUDGET_MS / 2;
      searches.push({ device, q, ms });
      if (ms > budget) fail("slow search", `"${q}" took ${(ms / 1000).toFixed(1)} s to show results (budget ${budget / 1000} s) [${device}]`);
    }
    const song = page.locator('main a[href*="song"]').first();
    if (await song.count()) {
      await song.click();
      await page.waitForFunction(() => location.hash.includes("song-"), null, { timeout: 8000 });
      await page.locator("main h1").first().waitFor({ timeout: 8000 });
    } else throw new Error(`no song in the results for "${SEARCHES.at(-1)[0]}"`);
  });
  await flow(device, "song page parts", async (page) => {
    const s = data.pages.song.find((p) => /playboi-carti|kanye/.test(p)) ?? data.pages.song[0];
    await page.goto(`${base}#${data.nameFor(s)}`, { waitUntil: "load" });
    await page.locator("main h1").first().waitFor({ timeout: 10000 });
    const jumps = await page.locator('nav[aria-label="On this page"] a').count();
    if (!jumps) throw new Error(`${s} shows no parts to jump to`);
    if (!(await page.locator("#drums").count())) throw new Error(`${s} has no drum kit part`);
  });
}
for (const ctx of Object.values(contexts)) await ctx.close();

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
const pct = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);
function lagOf(rows) {
  const out = {};
  for (const d of Object.keys(DEVICES)) {
    const r = rows.filter((x) => x.device === d && x.ok);
    const ready = r.map((x) => x.readyMs);
    const clicks = r.flatMap((x) => x.clicks.filter((c) => !c.audio).map((c) => c.ms));
    out[d] = {
      pages: r.length,
      readyMedianMs: pct(ready, 0.5),
      readyP95Ms: pct(ready, 0.95),
      clickMedianMs: pct(clicks, 0.5),
      clickP95Ms: pct(clicks, 0.95),
      blockingP95Ms: pct(r.map((x) => x.blockingMs), 0.95),
      slowest: [...r].sort((a, b) => b.readyMs - a.readyMs).slice(0, 5).map((x) => ({ path: x.path, ms: x.readyMs })),
    };
  }
  return out;
}
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
  lag: lagOf(pageResults),
  flows,
  searches,
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
  "## Lag",
  "",
  "| Device | Pages | Content shown (median / p95) | Click answered (median / p95) | Main thread blocked while loading (p95) | Slowest page |",
  "|---|---|---|---|---|---|",
  ...Object.entries(summary.lag).map(([d, l]) => `| ${d} | ${l.pages} | ${l.readyMedianMs} / ${l.readyP95Ms} ms | ${l.clickMedianMs} / ${l.clickP95Ms} ms | ${l.blockingP95Ms} ms | ${l.slowest[0] ? `\`${l.slowest[0].path}\` ${l.slowest[0].ms} ms` : ""} |`),
  "",
  "## Flows",
  "",
  ...flows.map((f) => `- ${f.ok ? "ok" : "FAILED"}: ${f.name} [${f.device}], ${(f.ms / 1000).toFixed(1)} s${f.error ? `: ${f.error}` : ""}`),
  ...(searches.length ? ["", `Search answered in: ${searches.map((x) => `"${x.q}" ${x.ms} ms [${x.device}]`).join(", ")}.`] : []),
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
