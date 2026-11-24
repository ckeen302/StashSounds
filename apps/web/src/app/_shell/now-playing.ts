import type { Engine } from "@stash/audio";
import type { ItemRow } from "@stash/contracts";

/** The slice of the engine that starting and stopping a row needs. */
export type PlayerEngine = Pick<Engine, "play" | "pause" | "getState"> & Partial<Pick<Engine, "setQueue">>;

/**
 * The engine knows what plays (a Playable) but not what to call it: Playable has no title or
 * uploader. Whoever starts playback hands over the ItemRow it drew, and the player bar looks the
 * row up by the playable's id. Kept outside React, like the engine, so it survives navigation.
 */
export function createNowPlaying(limit = 200) {
  const rows = new Map<string, ItemRow>();
  /** The last row handed to the engine; never evicted while the bar may still show it. */
  let playing: string | undefined;

  function remember(row: ItemRow) {
    rows.delete(row.playable.id);
    rows.set(row.playable.id, row);
    for (const id of rows.keys()) {
      if (rows.size <= limit) break;
      if (id !== playing && id !== row.playable.id) rows.delete(id);
    }
  }

  /** Play a row, or pause it if it is the one playing, or resume or retry it if it is current. */
  async function toggle(engine: PlayerEngine, row: ItemRow): Promise<void> {
    const state = engine.getState();
    remember(row);
    playing = row.playable.id;
    if (state.current?.id === row.playable.id) {
      if (state.status === "playing" || state.status === "loading") return engine.pause();
      return engine.play();
    }
    return engine.play(row.playable);
  }

  return {
    remember,
    rowFor: (id: string | undefined | null): ItemRow | null => (id ? (rows.get(id) ?? null) : null),
    toggle,
    /** Start a row from a list: the list becomes the queue, so next and previous walk it. */
    async playFrom(engine: PlayerEngine, list: ItemRow[], index: number): Promise<void> {
      const row = list[index];
      if (!row) return;
      const current = engine.getState().current?.id;
      if (current !== row.playable.id) {
        for (const r of list) remember(r);
        engine.setQueue?.(
          list.map((r) => r.playable),
          index,
        );
      }
      return toggle(engine, row);
    },
  };
}

export type NowPlaying = ReturnType<typeof createNowPlaying>;

const KEY = Symbol.for("stash.web.now-playing");

/** One registry for the session, on globalThis like the engine, so module re-evaluation keeps it. */
export function nowPlaying(): NowPlaying {
  const g = globalThis as { [KEY]?: NowPlaying };
  return (g[KEY] ??= createNowPlaying());
}
