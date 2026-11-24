// Build-time helper for the web app (request 135-stretch-in-production-build). Node only: never import
// it from browser code.
//
// signalsmith-stretch builds its AudioWorklet by stringifying its own functions, which a minifier
// breaks. The engine instead points the library at this file, the installed SignalsmithStretch.mjs
// unminified, which the app must serve as a static file at STRETCH_WORKLET_PATH:
//
//   import { STRETCH_WORKLET_PATH, stretchWorkletFile } from "@stash/audio/stretch-worklet-file";
//   copyFile(stretchWorkletFile, join("apps/web/public", STRETCH_WORKLET_PATH));
//
// The path names the version, so a cached copy never serves an older library to a newer page.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the installed, unminified SignalsmithStretch.mjs. */
export const stretchWorkletFile = fileURLToPath(import.meta.resolve("signalsmith-stretch"));

const { version } = JSON.parse(readFileSync(join(dirname(stretchWorkletFile), "package.json"), "utf8"));

/** Where the app serves that file. The same as STRETCH_WORKLET_PATH in src/web-audio.ts (a unit test holds them equal). */
export const STRETCH_WORKLET_PATH = `/worklets/signalsmith-stretch-${version}.mjs`;
