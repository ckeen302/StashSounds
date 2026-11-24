"use client";

import { useCallback, useEffect, useState } from "react";
import { getEngine, usePlayerState } from "@stash/audio";
import { PlayerBar, PlayerSheet } from "@stash/ui";
import { nowPlaying } from "./now-playing";
import { browserStorage, readUnmuteVolume, readVolume, rememberVolume } from "./volume";

/**
 * The player bar wired to the engine. It selects the smallest slices of engine state (status, the
 * current id, duration, volume, whether the queue has neighbours) and hands the bar the engine's
 * clock to read per frame; position never enters React state.
 */
export function PlayerDock() {
  const engine = getEngine();
  const status = usePlayerState((s) => s.status);
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  const durationMs = usePlayerState((s) => s.durationMs);
  const volume = usePlayerState((s) => s.volume);
  const hasPrevious = usePlayerState((s) => s.queueIndex > 0);
  const hasNext = usePlayerState((s) => s.queueIndex >= 0 && s.queueIndex < s.queue.length - 1);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Read on the first client render; it changes no markup, only where unmute returns to.
  const [unmuteVolume, setUnmuteVolume] = useState<number | undefined>(() => readUnmuteVolume(browserStorage()) ?? undefined);
  const row = nowPlaying().rowFor(currentId);

  // The remembered volume, applied before anything plays (design spec, Accessibility: Sound).
  useEffect(() => {
    const saved = readVolume(browserStorage());
    if (saved !== null) engine.setVolume(saved);
  }, [engine]);

  const getPositionMs = useCallback(() => engine.getPositionMs(), [engine]);
  const controls = {
    status: row ? status : ("idle" as const),
    durationMs,
    getPositionMs,
    onPlayPause: () => {
      if (row) void nowPlaying().toggle(engine, row);
    },
    onSeek: (ms: number) => engine.seek(ms),
    onPrevious: hasPrevious ? () => engine.previous() : undefined,
    onNext: hasNext ? () => engine.next() : undefined,
    volume,
    unmuteVolume,
    onVolumeChange: (v: number) => {
      // A mute keeps the level it left, across reloads too (PR #12 review).
      if (v === 0 && volume > 0) setUnmuteVolume(volume);
      engine.setVolume(v);
      rememberVolume(browserStorage(), volume, v);
    },
  };

  return (
    <>
      <PlayerBar item={row} {...controls} onOpenSheet={() => setSheetOpen(true)} />
      {row && <PlayerSheet item={row} {...controls} open={sheetOpen} onOpenChange={setSheetOpen} />}
    </>
  );
}
