"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getEngine, usePlayerState } from "@stash/audio";
import type { ItemRow } from "@stash/contracts";
import limits from "@stash/contracts/limits.json" with { type: "json" };
import { TRANSPOSE_LIMIT, type PlayState } from "@stash/ui";
import { nowPlaying } from "../_shell/now-playing";
import { browserStorage, readUnmuteVolume, rememberVolume } from "../_shell/volume";

/**
 * The item page's player, bound to the one engine. Tempo, key and volume are read back from engine
 * state, so what the controls show is what is heard. Before this item plays, tempo and key are held
 * here and applied the moment it starts, so "set the tempo, then press play" works. Position is
 * never state: the waveform reads the engine's clock per frame.
 */
export function useItemPlayer(row: ItemRow, queue: ItemRow[]) {
  const engine = getEngine();
  const id = row.playable.id;
  const current = usePlayerState((s) => s.current?.id === id);
  const status = usePlayerState((s) => (s.current?.id === id ? s.status : "idle"));
  const tempoRatio = usePlayerState((s) => s.tempoRatio);
  const transpose = usePlayerState((s) => s.transpose);
  const volume = usePlayerState((s) => s.volume);
  const engineDuration = usePlayerState((s) => (s.current?.id === id ? s.durationMs : 0));

  const baseBpm = row.bpm ?? (row.playable.kind === "loop" || row.playable.kind === "midi" ? (row.playable.bpm ?? null) : null);
  const [want, setWant] = useState<{ bpm: number | null; semitones: number }>({ bpm: baseBpm, semitones: 0 });
  // Loop is the engine's, like tempo and key: off, a loop plays its pass once and stops at the start.
  const loop = usePlayerState((s) => s.loop);
  const restoreVolume = useRef(0.8);
  const pendingSeek = useRef<number | null>(null);
  const durationMs = engineDuration > 0 ? engineDuration : (row.durationMs ?? 0);

  const bpm = current && baseBpm ? baseBpm * tempoRatio : want.bpm;
  const semitones = current ? transpose : want.semitones;

  // Instant play: fetch the preview as soon as the page is up (nothing sounds without a gesture),
  // and create the audio context on the visitor's first tap or key press.
  useEffect(() => {
    engine.preload(row.playable);
  }, [engine, row.playable]);
  useEffect(() => {
    const unlock = () => void engine.unlock();
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, [engine]);

  // A seek asked for before the audio arrived lands once it plays.
  useEffect(() => {
    if (status === "playing" && pendingSeek.current !== null) {
      engine.seek(pendingSeek.current);
      pendingSeek.current = null;
    }
  }, [engine, status]);

  const start = useCallback(() => {
    const at = queue.findIndex((r) => r.playable.id === id);
    void nowPlaying().playFrom(engine, at >= 0 ? queue : [row, ...queue], Math.max(0, at));
    // playFrom has made this item current synchronously; apply what the controls were set to.
    if (baseBpm) engine.setTempo(want.bpm ?? baseBpm);
    engine.setTranspose(want.semitones);
  }, [engine, queue, row, id, want, baseBpm]);

  const toggle = useCallback(() => {
    if (current) void nowPlaying().toggle(engine, row);
    else start();
  }, [current, engine, row, start]);

  const seek = useCallback(
    (fraction: number) => {
      const ms = Math.max(0, Math.min(1, fraction)) * durationMs;
      if (current && status !== "loading") return engine.seek(ms);
      pendingSeek.current = ms;
      if (!current) start();
    },
    [current, status, durationMs, engine, start],
  );

  const setTempo = useCallback(
    (next: number) => {
      if (!baseBpm) return;
      const clamped = Math.max(limits.bpm.min, Math.min(limits.bpm.max, Math.round(next)));
      setWant((w) => ({ ...w, bpm: clamped }));
      if (current) engine.setTempo(clamped);
    },
    [baseBpm, current, engine],
  );

  const setSemitones = useCallback(
    (next: number) => {
      const clamped = Math.max(-TRANSPOSE_LIMIT, Math.min(TRANSPOSE_LIMIT, Math.round(next)));
      setWant((w) => ({ ...w, semitones: clamped }));
      if (current) engine.setTranspose(clamped);
    },
    [current, engine],
  );

  // Remembered the same way as the player bar's (the shell's volume.ts), so the two never disagree.
  const setVolume = useCallback(
    (v: number) => {
      const previous = engine.getState().volume;
      engine.setVolume(v);
      rememberVolume(browserStorage(), previous, v);
    },
    [engine],
  );
  const setMuted = useCallback(
    (muted: boolean) => {
      if (muted) {
        if (volume > 0) restoreVolume.current = volume;
        setVolume(0);
      } else setVolume(readUnmuteVolume(browserStorage()) ?? (restoreVolume.current > 0 ? restoreVolume.current : 0.8));
    },
    [setVolume, volume],
  );

  const getProgress = useCallback(() => {
    if (!current || durationMs <= 0) return 0;
    return engine.getPositionMs() / durationMs;
  }, [current, durationMs, engine]);

  const playState: PlayState = status === "playing" ? "playing" : status === "loading" ? "loading" : status === "error" ? "error" : "paused";

  return {
    current,
    status,
    playState,
    playing: status === "playing",
    durationMs,
    toggle,
    seek,
    getProgress,
    tempo: baseBpm ? { bpm: bpm ?? baseBpm, baseBpm, onChange: setTempo } : undefined,
    keyShift: { semitones, baseKey: row.key, onChange: setSemitones },
    loop: { on: loop, onChange: (on: boolean) => engine.setLoop(on) },
    volume: { value: volume, muted: volume === 0, onChange: setVolume, onMuteChange: setMuted },
    nudgeTempo: (d: number) => (bpm ? setTempo(bpm + d) : undefined),
    nudgeKey: (d: number) => setSemitones(semitones + d),
    nudgeSeek: (fraction: number) => {
      if (!current) return;
      seek(getProgress() + fraction);
    },
  };
}
