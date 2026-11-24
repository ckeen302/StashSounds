import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STRETCH_WORKLET_PATH, createBrowserStretch } from "../src/web-audio.ts";
import * as file from "../stretch-worklet-file.mjs";
import type { AudioContextLike } from "../src/web-audio.ts";

// Request 135-stretch-in-production-build. signalsmith-stretch builds its worklet by stringifying its
// own functions, which minification breaks ("g is not defined" in the worklet). The engine gives the
// library a module URL instead: the installed SignalsmithStretch.mjs, unminified, which the web app
// serves at a path that names the version.
const installed = fileURLToPath(import.meta.resolve("signalsmith-stretch"));
const version = (JSON.parse(readFileSync(join(dirname(installed), "package.json"), "utf8")) as { version: string }).version;

describe("the stretch worklet file", () => {
  it("is served at a path that names the installed version", () => {
    expect(STRETCH_WORKLET_PATH).toBe(`/worklets/signalsmith-stretch-${version}.mjs`);
  });
  it("the build-time helper names the same path and the installed, unminified file", () => {
    expect(file.STRETCH_WORKLET_PATH).toBe(STRETCH_WORKLET_PATH);
    expect(file.stretchWorkletFile).toBe(installed);
    expect(readFileSync(file.stretchWorkletFile, "utf8")).toContain("function registerWorkletProcessor(Module, audioNodeKey)");
  });
});

describe("createBrowserStretch", () => {
  /** A context whose worklet records the module it is asked to add, then refuses it. */
  function context() {
    const added: string[] = [];
    const ctx = {
      audioWorklet: {
        addModule: (url: string | URL) => {
          added.push(String(url));
          return Promise.reject(new Error("no worklets here"));
        },
      },
    };
    return { ctx: ctx as unknown as AudioContextLike, added };
  }

  it("adds the worklet from the served file, never from a stringified blob", async () => {
    const { ctx, added } = context();
    await expect(createBrowserStretch(ctx)).rejects.toThrow("no worklets here");
    expect(added).toEqual([STRETCH_WORKLET_PATH]);
  });
  it("takes another module URL when given one", async () => {
    const { ctx, added } = context();
    await expect(createBrowserStretch(ctx, "/elsewhere/stretch.mjs")).rejects.toThrow();
    expect(added).toEqual(["/elsewhere/stretch.mjs"]);
  });
});
