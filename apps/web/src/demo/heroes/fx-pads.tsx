import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { getEngine } from "@stash/audio";
import { audioContext } from "../kits/store";
import { SFX, sprite, warm, type Sfx } from "../sfx/library";
import { pageKey, PAD_KEYS } from "./daily";

/**
 * The SFX page's hero: the producer's FX rack, eight big pads with the sounds a beat reaches for
 * (air horn, dub siren, rewind, tag, tape stop, riser, sub drop, braam). They ring over each other,
 * so an air horn can fire over a siren. Keys 1-4 and Q-R play them once the rack has focus.
 */

const RACK: [string, string, string][] = [
  ["producer", "air-horns", "Air horn"],
  ["producer", "dub-sirens", "Dub siren"],
  ["producer", "rewinds", "Rewind"],
  ["producer", "tag-fx", "Tag FX"],
  ["transitions", "tape-stops", "Tape stop"],
  ["transitions", "risers", "Riser"],
  ["impacts", "sub-drops", "Sub drop"],
  ["impacts", "braams", "Braam"],
];

async function fire(s: Sfx) {
  const engine = getEngine();
  const st = engine.getState().status;
  if (st === "playing" || st === "loading") engine.pause();
  const buf = await sprite(s.file).catch(() => null);
  if (!buf) return;
  const c = audioContext();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start(0, s.start, s.duration);
}

export function FxPadsHero() {
  const pads = useMemo(
    () =>
      RACK.flatMap(([cat, sub, name]) => {
        const s = SFX.find((x) => x.cat === cat && x.sub === sub);
        return s ? [{ s, name }] : [];
      }),
    [],
  );
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    for (const p of pads) warm(p.s);
  }, [pads]);
  const strike = (n: number, el?: HTMLElement | null) => {
    const p = pads[n];
    if (!p) return;
    void fire(p.s);
    setLast(p.s.name);
    el?.animate([{ filter: "brightness(1.6)", transform: "translateY(3px)" }, { filter: "none", transform: "none" }], { duration: 220, easing: "ease-out" });
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!pageKey(e.nativeEvent)) return;
    const n = PAD_KEYS.indexOf(e.key.toLowerCase() as (typeof PAD_KEYS)[number]);
    if (n < 0 || n >= pads.length) return;
    e.preventDefault();
    e.stopPropagation();
    strike(n, e.currentTarget.children[n] as HTMLElement);
  };
  return (
    <div className="sp-panel-dark sp-hero-deck flex flex-col gap-3 p-3 tablet:p-4">
      <div role="group" aria-label="FX rack" className="sp-hero-pads sp-hero-pads-8" onKeyDown={onKeyDown}>
        {pads.map((p, n) => (
          <button
            key={p.s.id}
            type="button"
            className="sp-pad sp-hero-pad"
            aria-label={`Fire ${p.s.name}`}
            aria-keyshortcuts={PAD_KEYS[n]!.toUpperCase()}
            onPointerEnter={() => warm(p.s)}
            onPointerDown={(e) => (e.button === 0 || e.pointerType !== "mouse") && strike(n, e.currentTarget)}
            onClick={(e) => e.detail === 0 && strike(n, e.currentTarget)}
          >
            <span className="sp-pad-code flex w-full justify-between">
              <span>{`FX${n + 1}`}</span>
              <kbd className="sp-hero-kbd" aria-hidden="true">
                {PAD_KEYS[n]!.toUpperCase()}
              </kbd>
            </span>
            <span className="sp-pad-label">{p.name}</span>
          </button>
        ))}
      </div>
      <p className="sp-lcd sp-hero-readout m-0" aria-live="polite">
        {last ? `FIRED > ${last.toUpperCase()}` : "FIRE AWAY. THEY STACK."}
      </p>
    </div>
  );
}
