import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
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

// PR #10 delta review (lead, advisory): the library keeps a rejected addModule on the context, so one
// transient failure (a 404 during a deploy) would disable the stretch until reload. After a failed
// load, the next attempt adds the module itself once more, with a cache-busting query.
describe("createBrowserStretch after a failed load", () => {
  /** A worklet that refuses the first `failures` modules, and a node class that works once one is in. */
  function world(failures: number) {
    const added: string[] = [];
    let registered = false;
    const ctx = {
      audioWorklet: {
        addModule: (url: string | URL) => {
          added.push(String(url));
          if (added.length <= failures) return Promise.reject(new Error("404"));
          registered = true;
          return Promise.resolve();
        },
      },
    };
    class FakeWorkletNode {
      port = {
        postMessage: () => undefined,
        set onmessage(fn: (e: { data: unknown[] }) => void) {
          queueMicrotask(() => fn({ data: ["ready", {}] }));
        },
      };
      constructor() {
        if (!registered) throw new DOMException("not registered", "InvalidStateError");
      }
    }
    return { ctx: ctx as unknown as AudioContextLike, added, FakeWorkletNode };
  }

  it("retries once with ?r=1, and the node is made", async () => {
    const { ctx, added, FakeWorkletNode } = world(1);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    try {
      await expect(createBrowserStretch(ctx)).rejects.toThrow("404");
      const node = await createBrowserStretch(ctx);
      expect(node).toBeInstanceOf(FakeWorkletNode);
      expect(added).toEqual([STRETCH_WORKLET_PATH, `${STRETCH_WORKLET_PATH}?r=1`]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("retries only once: after a second failure it fails without another request", async () => {
    const { ctx, added, FakeWorkletNode } = world(2);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    try {
      await expect(createBrowserStretch(ctx)).rejects.toThrow();
      await expect(createBrowserStretch(ctx)).rejects.toThrow();
      await expect(createBrowserStretch(ctx)).rejects.toThrow();
      expect(added).toEqual([STRETCH_WORKLET_PATH, `${STRETCH_WORKLET_PATH}?r=1`]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
