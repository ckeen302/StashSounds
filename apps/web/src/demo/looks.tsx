import { useSyncExternalStore } from "react";

/**
 * The demo's theme. It used to offer several "looks" to react to; the Stash look won, and the design
 * system in demo.css (html[data-look="stash"]) is now the only one. The attribute stays, so canvases
 * that read the theme's colors (waveforms, the piano roll) keep one place to watch.
 */
export type LookId = "stash";

const current: LookId = "stash";

export function startLooks() {
  document.documentElement.dataset.look = current;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", "dark");
}

export function useLook(): LookId {
  return useSyncExternalStore(
    () => () => {},
    () => current,
    () => current,
  );
}
