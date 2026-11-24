// Copies the time stretch's AudioWorklet file into apps/web/public (request 135-serve-stretch-worklet).
// The engine loads the worklet from this static path, because the bundled library cannot be
// stringified into a worklet after Turbopack rewrites it. Runs before `next build` and `next dev`.
// The copy is not committed: it is the installed library, so it always matches the lockfile.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const web = join(import.meta.dirname, "../apps/web");
// Resolve from apps/web, which depends on @stash/audio; the repo root does not.
const entry = createRequire(join(web, "package.json")).resolve("@stash/audio/stretch-worklet-file");
const { STRETCH_WORKLET_PATH, stretchWorkletFile } = await import(pathToFileURL(entry).href);

const to = join(web, "public", STRETCH_WORKLET_PATH);
await mkdir(dirname(to), { recursive: true });
await copyFile(stretchWorkletFile, to);
console.log(`stretch worklet: ${STRETCH_WORKLET_PATH}`);
