#!/usr/bin/env node
/**
 * Bare test page for the audio engine (ticket 121). No bundler and no dependency: TypeScript files
 * under packages/audio are transpiled on request with the workspace's own `typescript`, and the
 * fixture loops listed in fixtures/manifest.json are served next to them.
 *
 *   pnpm --filter @stash/audio test-page          then open http://127.0.0.1:4173
 *   PORT=5000 pnpm --filter @stash/audio test-page
 *   PORT=0 ...                                     any free port; the first line printed names it
 *
 * Every Playable it hands the page goes through playableSchema.parse, so manifest drift fails loudly.
 * It listens on 127.0.0.1 only.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { playableSchema } from "@stash/contracts";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = resolve(pkg, "../../fixtures");
const port = Number(process.env.PORT ?? 4173);
/** The stretch library, served as is; the page's import map points the bare specifier here. */
const stretchFile = fileURLToPath(import.meta.resolve("signalsmith-stretch"));

const manifest = JSON.parse(await readFile(join(fixtures, "manifest.json"), "utf8"));
/** Ready loops only; each is served at /fixtures/<file name>. */
const loops = manifest.fixtures
  .filter((f) => f.type === "loop" && !f.hostile && f.path.startsWith("generated/loops/"))
  .map((f) => ({
    name: f.path.split("/").pop(),
    path: f.path,
    bpm: f.expect.bpm,
    loopSamples: f.expect.loopSamples,
    sampleRate: f.expect.sampleRate,
  }));

/** The loops as Playables served from `origin`, each checked against the contract. */
function playables(origin) {
  return loops.map((l) =>
    playableSchema.parse({
      kind: "loop",
      id: l.name,
      previewUrl: `${origin}/fixtures/${encodeURIComponent(l.name)}`,
      loopSamples: l.loopSamples,
      sampleRate: l.sampleRate,
      bpm: l.bpm,
    }),
  );
}
playables("http://127.0.0.1"); // fail at startup, not on the first request

const types = { ".html": "text/html; charset=utf-8", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".aiff": "audio/aiff" };

function inside(root, file) {
  return file === root || file.startsWith(root + sep);
}

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "content-type": types[".html"] });
      return res.end(await readFile(join(pkg, "test-page/index.html")));
    }
    if (path === "/vendor/signalsmith-stretch.mjs") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      return res.end(await readFile(stretchFile));
    }
    if (path === "/fixtures.json") {
      const body = JSON.stringify(playables(`http://${req.headers.host ?? "127.0.0.1"}`));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(body);
    }
    if (path.startsWith("/fixtures/")) {
      const loop = loops.find((l) => l.name === path.slice("/fixtures/".length));
      if (!loop) throw Object.assign(new Error("not a fixture loop"), { code: "ENOENT" });
      const ext = loop.name.slice(loop.name.lastIndexOf("."));
      res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream" });
      return res.end(await readFile(join(fixtures, loop.path)));
    }
    if (path.endsWith(".ts")) {
      const file = resolve(pkg, `.${path}`);
      if (!inside(join(pkg, "src"), file) && !inside(join(pkg, "test-page"), file)) {
        throw Object.assign(new Error("outside the package"), { code: "ENOENT" });
      }
      const out = ts.transpileModule(await readFile(file, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
        fileName: file,
      });
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      return res.end(out.outputText);
    }
    throw Object.assign(new Error("not found"), { code: "ENOENT" });
  } catch (err) {
    const missing = err && err.code === "ENOENT";
    if (!missing) console.error("[test-page]", req.method, req.url, err);
    res.writeHead(missing ? 404 : 500, { "content-type": "text/plain" });
    res.end(missing ? "Not found" : "Internal error");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Audio test page: http://127.0.0.1:${server.address().port}`));
