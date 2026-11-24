import { describe, expect, it, vi } from "vitest";
import type { EngineState, Playable } from "@stash/audio";
import type { ItemRow } from "@stash/contracts";
import { createNowPlaying, type PlayerEngine } from "./now-playing";
import { readUnmuteVolume, readVolume, rememberVolume, UNMUTE_KEY, VOLUME_KEY, writeVolume } from "./volume";

const row = (n: number): ItemRow =>
  ({
    id: `id-${n}`,
    title: `Loop ${n}`,
    playable: { kind: "loop", id: `play${n}`, previewUrl: `https://media.example/${n}.ogg`, loopSamples: 44100, sampleRate: 44100 },
  }) as ItemRow;

function fakeEngine(state: Partial<EngineState> = {}) {
  const s: EngineState = { status: "idle", current: null, durationMs: 0, tempoRatio: 1, transpose: 0, volume: 0.8, loop: true, queue: [], queueIndex: 0, ...state };
  const engine: PlayerEngine & { s: EngineState } = {
    s,
    play: vi.fn(async (item?: Playable) => {
      if (item) s.current = item;
      s.status = "playing";
    }),
    pause: vi.fn(() => {
      s.status = "paused";
    }),
    getState: () => s,
  };
  return engine;
}

describe("now playing", () => {
  it("remembers the row and plays its playable", async () => {
    const np = createNowPlaying();
    const engine = fakeEngine();
    await np.toggle(engine, row(1));
    expect(engine.play).toHaveBeenCalledWith(row(1).playable);
    expect(np.rowFor("play1")?.title).toBe("Loop 1");
  });

  it("pauses the row that is playing and resumes it without reloading", async () => {
    const np = createNowPlaying();
    const engine = fakeEngine();
    await np.toggle(engine, row(1));
    await np.toggle(engine, row(1));
    expect(engine.pause).toHaveBeenCalledTimes(1);
    await np.toggle(engine, row(1));
    expect(engine.play).toHaveBeenLastCalledWith();
  });

  it("retries a row that failed", async () => {
    const np = createNowPlaying();
    const engine = fakeEngine({ status: "error", current: row(2).playable });
    await np.toggle(engine, row(2));
    expect(engine.play).toHaveBeenLastCalledWith();
  });

  it("switches to another row", async () => {
    const np = createNowPlaying();
    const engine = fakeEngine();
    await np.toggle(engine, row(1));
    await np.toggle(engine, row(2));
    expect(engine.play).toHaveBeenLastCalledWith(row(2).playable);
    expect(np.rowFor("play2")?.title).toBe("Loop 2");
  });

  it("plays from a list: every row is remembered and the list becomes the queue", async () => {
    const np = createNowPlaying();
    const engine = { ...fakeEngine(), setQueue: vi.fn() };
    const list = [row(1), row(2), row(3)];
    await np.playFrom(engine, list, 1);
    expect(engine.setQueue).toHaveBeenCalledWith(list.map((r) => r.playable), 1);
    expect(engine.play).toHaveBeenLastCalledWith(row(2).playable);
    expect(np.rowFor("play3")?.title).toBe("Loop 3");
    // Pressing the playing row again pauses and leaves the queue alone.
    await np.playFrom(engine, list, 1);
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(engine.setQueue).toHaveBeenCalledTimes(1);
  });

  it("knows nothing about an id it never saw", () => {
    expect(createNowPlaying().rowFor("nope")).toBeNull();
    expect(createNowPlaying().rowFor(undefined)).toBeNull();
  });

  it("keeps a bounded number of rows", async () => {
    const np = createNowPlaying(3);
    const engine = fakeEngine();
    for (let i = 1; i <= 5; i++) await np.toggle(engine, row(i));
    expect(np.rowFor("play1")).toBeNull();
    expect(np.rowFor("play5")?.title).toBe("Loop 5");
  });

  it("the current row is never evicted", async () => {
    const np = createNowPlaying(2);
    const engine = fakeEngine();
    await np.toggle(engine, row(1));
    np.remember(row(2));
    np.remember(row(3));
    expect(np.rowFor("play1")?.title).toBe("Loop 1");
  });
});

describe("remembered volume", () => {
  const store = (v: string | null) => ({ getItem: vi.fn(() => v), setItem: vi.fn() });

  it("reads a stored volume", () => {
    expect(readVolume(store("0.35"))).toBe(0.35);
  });
  it("ignores missing, malformed and out-of-range values", () => {
    expect(readVolume(store(null))).toBeNull();
    expect(readVolume(store("loud"))).toBeNull();
    expect(readVolume(store("Infinity"))).toBeNull();
    expect(readVolume(store("1.5"))).toBe(1);
    expect(readVolume(store("-1"))).toBe(0);
    expect(readVolume(null)).toBeNull();
  });
  it("treats a blank stored value as no value, not as muted", () => {
    // Number("") is 0: a blank entry must not silence the player.
    expect(readVolume(store(""))).toBeNull();
    expect(readVolume(store("   "))).toBeNull();
  });
  it("survives storage that throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readVolume(broken)).toBeNull();
    expect(() => writeVolume(broken, 0.5)).not.toThrow();
  });
  it("writes under one key", () => {
    const s = store(null);
    writeVolume(s, 0.42);
    expect(s.setItem).toHaveBeenCalledWith(VOLUME_KEY, "0.42");
  });
});

describe("the level from before mute", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("is kept when the volume goes to 0, so unmute after a reload returns to it", () => {
    const s = memory();
    rememberVolume(s, 0.6, 0);
    expect(s.m.get(VOLUME_KEY)).toBe("0");
    expect(readUnmuteVolume(s)).toBe(0.6);
  });
  it("is not overwritten by moves that are not a mute", () => {
    const s = memory();
    rememberVolume(s, 0.6, 0);
    rememberVolume(s, 0, 0);
    expect(readUnmuteVolume(s)).toBe(0.6);
    rememberVolume(s, 0, 0.3);
    expect(s.m.get(VOLUME_KEY)).toBe("0.3");
    expect(readUnmuteVolume(s)).toBe(0.6);
  });
  it("ignores a blank, zero or malformed level, and storage that throws", () => {
    for (const raw of ["", "0", "loud", null]) {
      expect(readUnmuteVolume({ getItem: (k: string) => (k === UNMUTE_KEY ? raw : null) })).toBeNull();
    }
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readUnmuteVolume(broken)).toBeNull();
    expect(() => rememberVolume(broken, 0.5, 0)).not.toThrow();
  });
});
