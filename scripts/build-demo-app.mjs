#!/usr/bin/env node
// The browser-only demo as one static page (ticket 137). Lead-owned.
//
// It bundles the real shell, player bar, result rows, loop page and audio engine
// (apps/web/src/demo/main.tsx) with esbuild, and swaps out only what needs a server:
//   - next/navigation         -> apps/web/src/demo/next-navigation.ts (a hash router)
//   - app/_item/actions-source -> apps/web/src/demo/actions-source.ts (local actions, no server)
//   - the stretch worklet's absolute path -> one relative to the page
// Every URL in the output is relative, so the folder runs from any static host, under any path,
// including inside an Artifact frame.
//
// Output: apps/web/out-demo/ (gitignored)
//   index.html  app.js  app.css  demo/media/*.mp3  demo/midi/samples.json  worklets/signalsmith-stretch-<v>.mjs
// The looks' display fonts load from Google Fonts (the one font host an Artifact frame allows).
//
// Usage: node scripts/build-demo-app.mjs   (runs scripts/build-demo.mjs first if the media are missing)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const web = join(root, "apps/web");
const demoSrc = join(web, "src/demo");
const out = join(web, "out-demo");
const webRequire = createRequire(join(web, "package.json"));

const esbuild = createRequire(join(root, "package.json"))("esbuild");
const postcss = createRequire(webRequire.resolve("@tailwindcss/postcss"))("postcss");
const tailwind = webRequire("@tailwindcss/postcss");

// 1. Media: the previews and peaks from the loop fixtures.
const loops = JSON.parse(readFileSync(join(demoSrc, "generated/loops.json"), "utf8")).loops;
if (loops.some((l) => !existsSync(join(web, "public", l.preview.path)))) {
  const r = spawnSync(process.execPath, [join(root, "scripts/build-demo.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
// The loops rendered from the demo's MIDI patterns (scripts/build-demo-loops.mjs makes them).
const moreLoops = JSON.parse(readFileSync(join(demoSrc, "generated/more-loops.json"), "utf8")).loops;
if (moreLoops.some((l) => !existsSync(join(web, "public", l.preview.path)))) {
  const r = spawnSync(process.execPath, [join(root, "scripts/build-demo-loops.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
loops.push(...moreLoops);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 2. Styles: the app's Tailwind build, plus the two latin font faces inlined (an Artifact frame
// loads fonts only from data: URIs or Google Fonts).
const cssFrom = join(demoSrc, "demo.css");
const css = await postcss([tailwind({ base: web, optimize: { minify: true } })]).process(readFileSync(cssFrom, "utf8"), { from: cssFrom });
const font = (pkg, file, family, weights) => {
  const data = readFileSync(join(dirname(webRequire.resolve(`${pkg}/package.json`)), "files", file)).toString("base64");
  return `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${weights};src:url(data:font/woff2;base64,${data}) format('woff2-variations')}`;
};
writeFileSync(
  join(out, "app.css"),
  font("@fontsource-variable/inter", "inter-latin-wght-normal.woff2", "Inter Variable", "100 900") +
    font("@fontsource-variable/jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2", "JetBrains Mono Variable", "100 800") +
    css.css,
);

// 3. Script.
const swaps = {
  name: "demo-swaps",
  setup(build) {
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: join(demoSrc, "next-navigation.ts") }));
    build.onResolve({ filter: /\/actions-source$/ }, (args) =>
      args.importer.includes(join("app", "_item")) ? { path: join(demoSrc, "actions-source.ts") } : undefined,
    );
    build.onResolve({ filter: /^next(\/|$)/ }, (args) => ({ errors: [{ text: `the demo cannot use ${args.path} (imported by ${args.importer})` }] }));
    // The demo's looks re-point the CSS tokens; canvases (the waveform) read the JS copies. Make those
    // follow the page's current values, so a waveform drawn under a look takes that look's colors.
    build.onLoad({ filter: /packages[\\/]ui[\\/]src[\\/]tokens\.ts$/ }, (args) => ({
      contents:
        readFileSync(args.path, "utf8") +
        `
if (typeof document !== "undefined") {
  let look: string | undefined = "-";
  let cache: Record<string, string> = {};
  const live = (name: string, fallback: string): string => {
    const now = document.documentElement.dataset.look;
    if (now !== look) {
      look = now;
      cache = {};
    }
    return (cache[name] ??= getComputedStyle(document.documentElement).getPropertyValue("--color-" + name).trim() || fallback);
  };
  for (const [k, v] of Object.entries(color)) Object.defineProperty(color, k, { get: () => live(k, v), enumerable: true });
  for (const [k, v] of Object.entries(typeColor)) Object.defineProperty(typeColor, k, { get: () => live("type-" + k, v), enumerable: true });
}
`,
      loader: "ts",
    }));
    // The published page's files are private to the people it is shared with, so they are served
    // only with the viewer's cookies. The engine fetches previews without credentials (they live on
    // a public media host in Stash), which the artifact host refuses: send them on the demo.
    build.onLoad({ filter: /packages[\\/]audio[\\/]src[\\/]loader\.ts$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const from = 'this.fetch(url, { credentials: "omit", signal: controller.signal })';
      if (!src.includes(from)) throw new Error("loader.ts: the preview fetch moved; update the demo build");
      return { contents: src.replace(from, 'this.fetch(url, { credentials: "same-origin", signal: controller.signal })'), loader: "ts" };
    });
    // The published page cannot start a browser download: the item page's Download goes through the
    // demo's save (the page's downloads capability, as a zip) instead.
    build.onLoad({ filter: /app[\\/]_item[\\/]download-record\.tsx$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const from = "export async function saveFile(";
      if (!src.includes(from)) throw new Error("download-record.tsx: saveFile moved; update the demo build");
      const demoSave = JSON.stringify(join(demoSrc, "save.ts"));
      return {
        contents:
          src.replace(from, "async function originalSaveFile(") +
          `\nimport { saveFetched as __demoSave } from ${demoSave};\nexport async function saveFile(_how: unknown, url: string, fileName: string): Promise<void> {\n  if ((await __demoSave(url, fileName)) === "failed") throw new Error("save failed");\n}\nvoid originalSaveFile;\n`,
        loader: "tsx",
      };
    });
    build.onLoad({ filter: /packages[\\/]audio[\\/]src[\\/]web-audio\.ts$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const from = "export const STRETCH_WORKLET_PATH = `/worklets/signalsmith-stretch-${STRETCH_VERSION}.mjs`;";
      if (!src.includes(from)) throw new Error("web-audio.ts: STRETCH_WORKLET_PATH moved; update the demo build");
      return {
        contents: src.replace(from, "export const STRETCH_WORKLET_PATH = new URL(`worklets/signalsmith-stretch-${STRETCH_VERSION}.mjs`, document.baseURI).href;"),
        loader: "ts",
      };
    });
  },
};
const result = await esbuild.build({
  entryPoints: [join(demoSrc, "main.tsx")],
  outfile: join(out, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [swaps],
  logLevel: "warning",
  logOverride: { "unsupported-directive": "silent" },
  metafile: true,
});
const jsBytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);

// 4. Files the page fetches: previews and the stretch worklet.
for (const l of loops) {
  mkdirSync(dirname(join(out, l.preview.path)), { recursive: true });
  copyFileSync(join(web, "public", l.preview.path), join(out, l.preview.path));
}
// The upload page's sample files: the MIDI fixtures, good and broken.
mkdirSync(join(out, "demo/midi"), { recursive: true });
const midiFiles = [
  ...["sad_piano_chords_72bpm_C#m.mid", "bell_melody_150_F#m.mid", "808_bassline_140_Am.mid", "drill_drums_142.mid"].map((f) => join(root, "fixtures/generated/midi", f)),
  join(root, "fixtures/generated/hostile/not_midi.mid"),
];
// One JSON file of base64 bytes, keyed by the original name: an Artifact frame does not serve .mid.
writeFileSync(
  join(out, "demo/midi/samples.json"),
  JSON.stringify(Object.fromEntries(midiFiles.map((f) => [basename(f), readFileSync(f).toString("base64")]))),
);
// The SFX tab's sprites (scripts/build-demo-sfx.py makes them; they are committed).
mkdirSync(join(out, "demo/sfx"), { recursive: true });
for (const f of readdirSync(join(demoSrc, "sfx/media"))) if (f.endsWith(".mp3")) copyFileSync(join(demoSrc, "sfx/media", f), join(out, "demo/sfx", f));
const worklet = await import(pathToFileURL(webRequire.resolve("@stash/audio/stretch-worklet-file")).href);
mkdirSync(join(out, "worklets"), { recursive: true });
copyFileSync(worklet.stretchWorkletFile, join(out, worklet.STRETCH_WORKLET_PATH.replace(/^\//, "")));

// 5. The page. No doctype or html/head/body of its own: an Artifact wraps it in its skeleton, and a
// browser opening the file directly builds the same document around it.
writeFileSync(
  join(out, "index.html"),
  `<title>Stash demo</title>
<meta name="description" content="Find a sound, hear it instantly, grab it. A browser-only demo of Stash with five loops.">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Jersey+10&family=Pixelify+Sans:wght@500;700&family=Fraunces:ital,opsz,wght@1,9..144,600&family=Silkscreen&family=Space+Grotesk:wght@500;700&family=Space+Mono:wght@400;700&family=VT323&display=swap">
<link rel="stylesheet" href="app.css">
<style>:root{color-scheme:dark}html,body{height:100%}</style>
<div id="root"></div>
<script type="module" src="app.js"></script>
`,
);

console.log(`demo: ${out.slice(root.length + 1)}  app.js ${(jsBytes / 1024).toFixed(0)} KB, app.css ${(readFileSync(join(out, "app.css")).length / 1024).toFixed(0)} KB, ${loops.length} loops`);
