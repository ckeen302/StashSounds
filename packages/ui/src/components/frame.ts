"use client";

import { useEffect } from "react";

/**
 * Runs `frame` once whenever it changes, and on every animation frame while `running`. The
 * playhead reads the audio clock here (build spec: position is not state), so a playing bar
 * repaints sixty times a second without a React render.
 */
export function useFrameLoop(frame: () => void, running: boolean): void {
  useEffect(() => {
    let id = 0;
    const tick = () => {
      frame();
      if (running) id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [frame, running]);
}
