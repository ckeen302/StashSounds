import { FilterChip } from "@stash/ui";
import { useSyncExternalStore } from "react";

/**
 * The demo's looks: the same app under different token sets (demo.css, html[data-look]). Studio is
 * the design spec's own; the others are directions to react to. The pick is kept in this browser.
 */
export const LOOKS = [
  { id: "sampler", name: "Sampler", blurb: "The machine: a beige sampler with a green screen, rubber pads and one orange light." },
  { id: "stash", name: "Stash", blurb: "Modern and social: near black, one hot pink, artwork and people up front." },
  { id: "console", name: "Console", blurb: "Fantasy games console: 16 colours, pixel type, loot rarity." },
  { id: "studio", name: "Studio", blurb: "The spec: ink black, one lime light." },
  { id: "tape", name: "Tape", blurb: "70s cassette: warm brown, orange, italic serif." },
  { id: "arcade", name: "Arcade", blurb: "90s CRT: pixel type, magenta glow, scanlines." },
] as const;
export type LookId = (typeof LOOKS)[number]["id"];

const KEY = "stash.demo.look.v5";
const listeners = new Set<() => void>();
let current: LookId = "sampler";

function apply(id: LookId) {
  current = id;
  if (id === "studio") delete document.documentElement.dataset.look;
  else document.documentElement.dataset.look = id;
  const meta = document.querySelector('meta[name="color-scheme"]');
  meta?.setAttribute("content", id === "sampler" ? "light" : "dark");
  for (const l of listeners) l();
}

export function startLooks() {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(KEY);
  } catch {
    // Storage blocked: start on the Sampler.
  }
  const found = LOOKS.find((l) => l.id === saved);
  apply(found ? found.id : "sampler");
}

export function setLook(id: LookId) {
  apply(id);
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // This visit only.
  }
}

export function useLook(): LookId {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => "sampler",
  );
}

/** One chip per look, one per look, with a line on the one picked. */
export function LookPicker() {
  const look = useLook();
  const picked = LOOKS.find((l) => l.id === look)!;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label text-label-caps text-text-muted">Try a look</span>
      <div role="group" aria-label="Look" className="flex flex-wrap gap-2">
        {LOOKS.map((l) => (
          <FilterChip key={l.id} selected={look === l.id} onToggle={() => setLook(l.id)}>
            {l.name}
          </FilterChip>
        ))}
      </div>
      <p className="text-small text-text-muted" aria-live="polite">
        {picked.blurb}
      </p>
    </div>
  );
}
