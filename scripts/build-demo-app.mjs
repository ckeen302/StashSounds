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
//   index.html  app.js  app.css  demo/media/*.mp3  worklets/signalsmith-stretch-<v>.mjs
//
// Usage: node scripts/build-demo-app.mjs   (runs scripts/build-demo.mjs first if the media are missing)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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
<link rel="stylesheet" href="app.css">
<style>:root{color-scheme:dark}html,body{height:100%}</style>
<div id="root"></div>
<script type="module" src="app.js"></script>
`,
);

console.log(`demo: ${out.slice(root.length + 1)}  app.js ${(jsBytes / 1024).toFixed(0)} KB, app.css ${(readFileSync(join(out, "app.css")).length / 1024).toFixed(0)} KB, ${loops.length} loops`);
