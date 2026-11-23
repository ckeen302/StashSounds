import { useSyncExternalStore } from "react";
import { getEngine } from "./engine.ts";
import { INITIAL_STATE } from "./engine.ts";
import type { EngineState } from "./types.ts";

/** React binding. Select the smallest slice you need; never select position (read getPositionMs per frame). */
export function usePlayerState<T>(select: (state: EngineState) => T): T {
  const engine = getEngine();
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => select(engine.getState()),
    () => select(INITIAL_STATE),
  );
}
