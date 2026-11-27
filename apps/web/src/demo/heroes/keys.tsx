import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { getEngine } from "@stash/audio";
import { audioContext } from "../kits/store";
import { bufferOf, INSTRUMENTS, MELODIC, NOTE_NAMES, warmShots, type MelodicShot } from "../oneshots/melodic";
import { daily, NOTE_KEYS, pageKey } from "./daily";

/**
 * The One-shots page's hero: one octave of big keys playing today's instrument, note by note, from
 * the same one-shots the page lists. Plays with a finger, a mouse, or A W S E D F T G Y H U J on a
 * computer keyboard. Notes ring over each other, so a melody sounds like one.
 */

const PLAYABLE = INSTRUMENTS.filter((i) => i.notes);
const BLACK = new Set([1, 3, 6, 8, 10]);

async function sound(s: MelodicShot) {
  const engine = getEngine();
  const st = engine.getState().status;
  if (st === "playing" || st === "loading") engine.pause();
  const b = await bufferOf(s, true);
  if (!b) return;
  const c = audioContext();
  const src = c.createBufferSource();
  src.buffer = b;
  src.connect(c.destination);
  src.start();
}

export function KeysHero() {
  const [at, setAt] = useState(() => Math.max(0, PLAYABLE.indexOf(daily(PLAYABLE, 7)!)));
  const inst = PLAYABLE[at]!;
  const notes = useMemo(() => NOTE_NAMES.map((_, r) => MELODIC.find((m) => m.instrument === inst.id && m.kind === "note" && m.root === r)!), [inst]);
  const [last, setLast] = useState<MelodicShot | null>(null);
  const keys = useRef<HTMLDivElement>(null);

  // Render the octave ahead of the first touch, so the first note plays at once.
  useEffect(() => warmShots(notes), [notes]);

  const strike = (r: number) => {
    const s = notes[r];
    if (!s) return;
    void sound(s);
    setLast(s);
    const el = keys.current?.querySelector<HTMLElement>(`[data-root="${r}"]`);
    el?.animate([{ filter: "brightness(1.35)", transform: "translateY(4px)" }, { filter: "none", transform: "none" }], { duration: 200, easing: "ease-out" });
  };
  // The computer keys play while the keyboard has focus (tap any key first), so the page's own
  // keys (D downloads the picked one-shot) keep working everywhere else.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!pageKey(e.nativeEvent)) return;
    const r = NOTE_KEYS.indexOf(e.key.toLowerCase() as (typeof NOTE_KEYS)[number]);
    if (r < 0) return;
    e.preventDefault();
    e.stopPropagation();
    strike(r);
  };

  const turn = (d: number) => {
    setAt((i) => (i + d + PLAYABLE.length) % PLAYABLE.length);
    setLast(null);
  };
  const whites = notes.map((_, r) => r).filter((r) => !BLACK.has(r));
  return (
    <div className="sp-panel-dark sp-hero-deck flex flex-col gap-3 p-3 tablet:p-4">
      <div className="sp-lcd sp-hero-readout flex items-center gap-2">
        <button type="button" className="sp-lcd-enter" aria-label="Previous instrument" onClick={() => turn(-1)}>
          &#9664;
        </button>
        <span className="min-w-0 flex-1 truncate text-center" aria-live="polite">{`${inst.sound.toUpperCase()}${last ? ` > ${last.label}` : ""}`}</span>
        <button type="button" className="sp-lcd-enter" aria-label="Next instrument" onClick={() => turn(1)}>
          &#9654;
        </button>
      </div>
      <div ref={keys} role="group" aria-label={`${inst.sound}, one octave`} className="sp-hero-keys" onKeyDown={onKeyDown}>
        {whites.map((r, i) => (
          <button
            key={r}
            type="button"
            data-root={r}
            className="sp-hero-white"
            aria-label={notes[r]!.spoken}
            aria-keyshortcuts={NOTE_KEYS[r]!.toUpperCase()}
            onPointerDown={(e) => (e.button === 0 || e.pointerType !== "mouse") && strike(r)}
            onClick={(e) => e.detail === 0 && strike(r)}
            style={{ gridColumn: `${i * 2 + 1} / span 2` }}
          >
            <span aria-hidden="true">{NOTE_KEYS[r]!.toUpperCase()}</span>
          </button>
        ))}
        {[...BLACK].map((r) => {
          // A black key sits on the line between the two white keys around it.
          const col = whites.filter((w) => w < r).length * 2;
          return (
            <button
              key={r}
              type="button"
              data-root={r}
              className="sp-hero-black"
              aria-label={notes[r]!.spoken}
              aria-keyshortcuts={NOTE_KEYS[r]!.toUpperCase()}
              onPointerDown={(e) => (e.button === 0 || e.pointerType !== "mouse") && strike(r)}
              onClick={(e) => e.detail === 0 && strike(r)}
              style={{ gridColumn: `${col} / span 2` }}
            >
              <span aria-hidden="true">{NOTE_KEYS[r]!.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
