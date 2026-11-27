import { useEffect, useMemo, useRef, useState } from "react";
import { getEngine } from "@stash/audio";
import { midiPlayer } from "../midi/synth";
import { usePageKeys } from "../shortcuts";
import { audioContext, CATEGORIES, clipBuffer, play, warmSounds, type Category, type Kit, type KitSound } from "../kits/store";
import { daily, pageKey, PAD_KEYS, roundRobin } from "./daily";

/**
 * The Drums page's hero: today's kit as sixteen big pads, played with a finger, a mouse or the keys
 * 1-4, Q-R, A-F and Z-V. Pads ring over each other the way a drum machine's do (a hat never cuts the
 * kick off), and the screen above shows the last pad hit. Arrows on the screen change the kit.
 */

const ORDER: Category[] = ["kick", "808", "snare", "clap", "hat", "open hat", "perc", "cymbal", "fx", "vox", "other"];

function labelOf(c: Category): string {
  return CATEGORIES.find((x) => x.id === c)?.label ?? c;
}

/** Plays a kit sound on top of whatever is ringing. */
async function hitPad(s: KitSound) {
  const engine = getEngine();
  const st = engine.getState().status;
  if (st === "playing" || st === "loading") engine.pause();
  if (s.hit) {
    midiPlayer().hit(s.hit.pitch, 112, s.hit.tune, s.hit.stretch);
    return;
  }
  if (s.clip) {
    const buf = await clipBuffer(s.clip).catch(() => null);
    if (!buf) return;
    const c = audioContext();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start();
    return;
  }
  void play(s);
}

export function DrumPadsHero({ kits }: { kits: Kit[] }) {
  const playable = useMemo(() => kits.filter((k) => k.sounds.length >= 4), [kits]);
  const first = daily(playable, 4);
  const [at, setAt] = useState(() => Math.max(0, first ? playable.indexOf(first) : 0));
  const kit = playable[at % Math.max(1, playable.length)];
  const pads = useMemo(() => (kit ? roundRobin(kit.sounds, (s) => s.category, ORDER, 16) : []), [kit]);
  const [last, setLast] = useState<{ n: number; s: KitSound } | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (kit) warmSounds(kit.sounds);
  }, [kit]);

  const strike = (n: number) => {
    const s = pads[n];
    if (!s) return;
    void hitPad(s);
    setLast({ n, s });
    const el = grid.current?.children[n] as HTMLElement | undefined;
    el?.animate([{ filter: "brightness(1.6)", transform: "translateY(3px)" }, { filter: "none", transform: "none" }], { duration: 160, easing: "ease-out" });
  };

  usePageKeys([...PAD_KEYS]);
  const strikeRef = useRef(strike);
  useEffect(() => {
    strikeRef.current = strike;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageKey(e)) return;
      const n = PAD_KEYS.indexOf(e.key.toLowerCase() as (typeof PAD_KEYS)[number]);
      if (n < 0) return;
      e.preventDefault();
      strikeRef.current(n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!kit) return null;
  const turn = (d: number) => {
    setAt((i) => (i + d + playable.length) % playable.length);
    setLast(null);
  };
  return (
    <div className="sp-panel-dark sp-hero-deck flex flex-col gap-3 p-3 tablet:p-4">
      <div className="sp-lcd sp-hero-readout flex items-center gap-2">
        <button type="button" className="sp-lcd-enter" aria-label="Previous kit" onClick={() => turn(-1)}>
          &#9664;
        </button>
        <span className="min-w-0 flex-1 truncate text-center">
          <span className="sr-only">Today&apos;s kit: </span>
          {kit.name.toUpperCase()}
        </span>
        <button type="button" className="sp-lcd-enter" aria-label="Next kit" onClick={() => turn(1)}>
          &#9654;
        </button>
      </div>
      <div ref={grid} role="group" aria-label={`Pads of ${kit.name}`} className="sp-hero-pads">
        {pads.map((s, n) => (
          <button
            key={s.id}
            type="button"
            className="sp-pad sp-hero-pad"
            data-cat={s.category}
            aria-label={`Pad ${n + 1}: ${s.name}`}
            aria-keyshortcuts={PAD_KEYS[n]!.toUpperCase()}
            onPointerDown={(e) => {
              if (e.button === 0 || e.pointerType !== "mouse") strike(n);
            }}
            onClick={(e) => e.detail === 0 && strike(n)}
          >
            <span className="sp-pad-code flex w-full justify-between">
              <span>{String(n + 1).padStart(2, "0")}</span>
              <kbd className="sp-hero-kbd" aria-hidden="true">
                {PAD_KEYS[n]!.toUpperCase()}
              </kbd>
            </span>
            <span className="sp-pad-label">{labelOf(s.category)}</span>
          </button>
        ))}
      </div>
      <p className="sp-lcd sp-hero-readout m-0" aria-live="polite">
        {last ? `PAD ${String(last.n + 1).padStart(2, "0")} > ${last.s.name.toUpperCase()}` : "HIT A PAD. OR PLAY 1-4  Q-R  A-F  Z-V"}
      </p>
    </div>
  );
}
