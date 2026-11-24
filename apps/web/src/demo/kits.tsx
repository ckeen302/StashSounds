import type { MidiNotesFile } from "@stash/contracts";
import { Button, FilterChip, Pause, Play, RotateCcw, Slider, Upload, useToast } from "@stash/ui";
import { getEngine } from "@stash/audio";
import { useEffect, useRef, useState } from "react";
import { postUpload } from "./midi/catalog";
import { midiPlayer } from "./midi/synth";
import { navigate } from "./router";

/**
 * Drum kits: sixteen pads you play with the mouse, a finger or the keyboard (1-4, Q-R, A-F, Z-V,
 * the way a pad controller sits under the left hand), and a sixteen-step sequencer over them.
 * Every hit is synthesized in the browser; nothing here is a sample of anyone's kit. A pattern
 * posts to Stash as a drum MIDI file, so it opens in the piano roll like any other.
 */

const player = midiPlayer();

type Pad = { name: string; pitch: number; tune: number; stretch: number };
type Kit = { id: string; name: string; blurb: string; bpm: number; swing: number; pads: Pad[]; pattern: Record<number, string> };

const pad = (name: string, pitch: number, tune = 1, stretch = 1): Pad => ({ name, pitch, tune, stretch });

const KITS: Kit[] = [
  {
    id: "trap",
    name: "Trap",
    blurb: "Long 808, crisp clap, tight hats for rolls.",
    bpm: 140,
    swing: 0,
    pads: [
      pad("808 long", 36, 0.8, 4), pad("808 short", 36, 0.85, 1.6), pad("Kick", 36, 1.15, 0.8), pad("Snare", 38, 1.05),
      pad("Clap", 39), pad("Snap", 39, 1.6, 0.5), pad("Rim", 37), pad("Closed hat", 42, 1.1),
      pad("Tight hat", 42, 1.4, 0.5), pad("Open hat", 46, 1, 0.8), pad("Perc", 50, 1.5, 0.5), pad("Low tom", 41),
      pad("Mid tom", 45), pad("High tom", 48), pad("Crash", 49), pad("Ride", 51),
    ],
    pattern: { 0: "x......x..x.....", 4: "........x.......", 7: "x.x.x.x.x.x.xxxx", 9: "..............x." },
  },
  {
    id: "boombap",
    name: "Boom bap",
    blurb: "Fat kick, cracking snare, dusty swing.",
    bpm: 90,
    swing: 0.16,
    pads: [
      pad("Kick", 36, 0.9, 1.1), pad("Kick 2", 35, 0.8, 1.3), pad("Snare", 38, 0.9, 1.3), pad("Snare ghost", 38, 1.1, 0.5),
      pad("Clap", 39, 0.85, 1.2), pad("Rim", 37, 0.9), pad("Shaker", 42, 0.8, 1.4), pad("Hat", 42, 0.9, 1.2),
      pad("Pedal hat", 44, 0.85), pad("Open hat", 46, 0.85, 1.1), pad("Low tom", 41, 0.9), pad("Mid tom", 45, 0.9),
      pad("High tom", 48, 0.9), pad("Conga", 50, 1.2, 0.8), pad("Crash", 49, 0.8), pad("Ride", 51, 0.85),
    ],
    pattern: { 0: "x.....x...x.....", 2: "....x.......x...", 3: ".......x.......x", 7: "x.x.x.x.x.x.x.x." },
  },
  {
    id: "drill",
    name: "Drill",
    blurb: "Sliding 808 hits, late snares, skippy hats.",
    bpm: 142,
    swing: 0.04,
    pads: [
      pad("808 slide", 36, 0.72, 4.5), pad("808 punch", 36, 0.9, 2), pad("Kick", 36, 1.2, 0.7), pad("Snare", 38, 1.15, 0.9),
      pad("Snare 2", 40, 1.25, 0.7), pad("Clap", 39, 1.1, 0.8), pad("Rim", 37, 1.2), pad("Hat", 42, 1.2, 0.8),
      pad("Hat 2", 42, 1.5, 0.4), pad("Open hat", 46, 1.1, 0.6), pad("Perc", 50, 1.7, 0.4), pad("Perc low", 45, 1.4, 0.5),
      pad("Tom", 47, 1.1), pad("Crash", 49, 1.1, 0.8), pad("Splash", 55, 1.2, 0.6), pad("Ride", 59, 1.1),
    ],
    pattern: { 0: "x.........x.....", 1: "......x.......x.", 3: "....x.......x...", 4: ".........x......", 7: "x..x..x.x..x.x.." },
  },
  {
    id: "phonk",
    name: "Phonk",
    blurb: "Distorted-feel 808, cowbell-bright perc, Memphis hats.",
    bpm: 130,
    swing: 0.08,
    pads: [
      pad("808", 36, 0.78, 3), pad("Kick", 36, 1.05, 1), pad("Snare", 38, 1.2, 0.8), pad("Clap", 39, 1.15, 1.1),
      pad("Cowbell", 50, 2.6, 0.9), pad("Cowbell low", 48, 2.4, 0.9), pad("Rim", 37, 1.1), pad("Hat", 42, 1.05),
      pad("Hat open", 46, 1.1, 0.7), pad("Shaker", 44, 1.3, 0.8), pad("Tom low", 41, 1.1), pad("Tom high", 47, 1.2),
      pad("Crash", 49, 0.9), pad("Ride", 51, 1.2), pad("Snap", 39, 1.8, 0.4), pad("Kick 2", 35, 0.95),
    ],
    pattern: { 0: "x.....x...x.....", 3: "....x.......x...", 4: "x..x..x...x..x..", 7: "x.x.x.x.x.x.x.x." },
  },
  {
    id: "jersey",
    name: "Jersey club",
    blurb: "The five-kick bounce, clap on the ands.",
    bpm: 140,
    swing: 0,
    pads: [
      pad("Kick", 36, 1.05, 0.9), pad("Kick 2", 35, 1), pad("Clap", 39, 1.05), pad("Snare", 38, 1.1),
      pad("Bed squeak", 50, 2.2, 0.35), pad("Rim", 37, 1.1), pad("Hat", 42, 1.1), pad("Open hat", 46),
      pad("Crash", 49), pad("Low tom", 41, 1.1), pad("Mid tom", 45, 1.1), pad("High tom", 48, 1.1),
      pad("Perc", 47, 1.6, 0.4), pad("Snap", 39, 1.5, 0.5), pad("Ride", 51), pad("808", 36, 0.8, 2.4),
    ],
    pattern: { 0: "x...x...x..x..x.", 2: "..x...x...x...x.", 6: "x.x.x.x.x.x.x.x." },
  },
];

const KEYS = ["1", "2", "3", "4", "q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"];
const STEPS = 16;

type Grid = boolean[][];
function gridOf(kit: Kit): Grid {
  return kit.pads.map((_, i) => Array.from({ length: STEPS }, (_, s) => kit.pattern[i]?.[s] === "x"));
}

/** The pattern as a drum notes file: one bar, sixteenth steps, swing written into the timing. */
export function patternNotes(kit: Kit, grid: Grid, bpm: number, swing: number): MidiNotesFile {
  const notes: [number, number, number, number][] = [];
  grid.forEach((row, i) =>
    row.forEach((on, s) => {
      if (on) notes.push([+(s * 0.25 + (s % 2 === 1 ? swing * 0.25 : 0)).toFixed(4), 0.25, kit.pads[i]!.pitch, s % 4 === 0 ? 112 : 92]);
    }),
  );
  notes.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const pitches = notes.map((n) => n[2]);
  return { version: 1, bpm, timeSignature: [4, 4], bars: 1, pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches), drums: true, notes };
}

export function KitsPage() {
  const [kitId, setKitId] = useState(KITS[0]!.id);
  const kit = KITS.find((k) => k.id === kitId)!;
  const [grid, setGrid] = useState<Grid>(() => gridOf(kit));
  const [bpm, setBpm] = useState(kit.bpm);
  const [swing, setSwing] = useState(kit.swing);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [lit, setLit] = useState<Set<number>>(new Set());
  const toast = useToast();

  // The scheduler reads the latest settings through a ref, so changing a step mid-bar lands on the next pass.
  const live = useRef({ kit, grid, bpm, swing });
  useEffect(() => {
    live.current = { kit, grid, bpm, swing };
  }, [kit, grid, bpm, swing]);

  const flash = (i: number) => {
    setLit((s) => new Set(s).add(i));
    window.setTimeout(
      () =>
        setLit((s) => {
          const n = new Set(s);
          n.delete(i);
          return n;
        }),
      110,
    );
  };
  const strike = (i: number, velocity = 112) => {
    const p = kit.pads[i]!;
    player.hit(p.pitch, velocity, p.tune, p.stretch);
    flash(i);
  };

  useEffect(() => {
    if (!playing) return;
    player.pause();
    const engine = getEngine();
    if (engine.getState().status === "playing") engine.pause();
    let s = 0;
    let next = player.now() + 0.06;
    const timers: number[] = [];
    const tick = () => {
      const now = player.now();
      while (next < now + 0.12) {
        const { kit: k, grid: g, bpm: b, swing: sw } = live.current;
        const sixteenth = 60 / b / 4;
        g.forEach((row, i) => {
          if (row[s]) player.hit(k.pads[i]!.pitch, s % 4 === 0 ? 118 : 96, k.pads[i]!.tune, k.pads[i]!.stretch, next);
        });
        const shown = s;
        timers.push(window.setTimeout(() => setStep(shown), Math.max(0, (next - now) * 1000)));
        next += sixteenth * (s % 2 === 0 ? 1 + sw : 1 - sw);
        s = (s + 1) % STEPS;
      }
    };
    tick();
    const id = window.setInterval(tick, 25);
    return () => {
      window.clearInterval(id);
      for (const t of timers) window.clearTimeout(t);
      setStep(-1);
    };
  }, [playing]);

  // Pad keys, and Space for the sequencer. Not while typing.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
        return;
      }
      const i = KEYS.indexOf(e.key.toLowerCase());
      if (i >= 0) {
        e.preventDefault();
        strike(i, e.shiftKey ? 70 : 112);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  });

  useEffect(() => () => setPlaying(false), []);

  const pickKit = (k: Kit) => {
    setKitId(k.id);
    setGrid(gridOf(k));
    setBpm(k.bpm);
    setSwing(k.swing);
  };
  const toggleStep = (i: number, s: number) => setGrid((g) => g.map((row, r) => (r === i ? row.map((v, c) => (c === s ? !v : v)) : row)));
  const empty = grid.every((row) => row.every((v) => !v));

  const post = () => {
    const notes = patternNotes(kit, grid, bpm, swing);
    const item = postUpload({
      slug: `${kit.id}-pattern`,
      title: `${kit.name} pattern at ${bpm}`,
      kind: "drums",
      sound: "drums",
      key: null,
      notes,
      tags: [kit.name.toLowerCase(), "drums", "pattern"],
      description: `A one-bar ${kit.name.toLowerCase()} pattern made on the pads${swing > 0 ? `, swung ${Math.round(50 + swing * 50)} percent` : ""}. General MIDI drum map.`,
      license: "royalty_free",
      fileName: `${kit.id}-pattern-${bpm}.mid`,
    });
    setPlaying(false);
    toast({ tone: "success", title: "Posted", description: "Your pattern is on Stash, in this browser. It plays in the piano roll." });
    navigate(item.href);
  };

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">Drum kits</span>
        <h1 className="text-title">Play the pads, build the bar</h1>
        <p className="max-w-prose text-body text-text-muted">
          Hit the pads with the mouse, your finger or the keys 1 to 4, Q to R, A to F and Z to V (hold Shift to play soft). Program a bar in the sequencer, swing
          it, then post it as a MIDI file. Every hit is made in your browser.
        </p>
      </header>

      <div role="group" aria-label="Kit" className="flex flex-wrap gap-2">
        {KITS.map((k) => (
          <FilterChip key={k.id} selected={k.id === kitId} onToggle={() => pickKit(k)}>
            {k.name}
          </FilterChip>
        ))}
      </div>
      <p className="-mt-3 text-small text-text-muted">{kit.blurb}</p>

      <div className="grid grid-cols-1 gap-6 desktop:grid-cols-2">
        <section aria-label="Pads" className="grid grid-cols-4 gap-2 rounded-panel border border-border bg-surface p-3 tablet:gap-3 tablet:p-4">
          {kit.pads.map((p, i) => (
            <button
              key={`${kit.id}-${i}`}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                strike(i);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") strike(i);
              }}
              aria-label={`${p.name}, key ${KEYS[i]!.toUpperCase()}`}
              data-hit={lit.has(i) || undefined}
              className="flex aspect-square touch-manipulation select-none flex-col justify-between rounded-control border border-border-strong bg-raised p-2 text-left transition-colors duration-75 data-hit:border-accent data-hit:bg-accent data-hit:text-bg ui-hover:border-text"
            >
              <span className="font-mono text-label text-label-caps opacity-70">{KEYS[i]!.toUpperCase()}</span>
              <span className="text-small leading-tight">{p.name}</span>
            </button>
          ))}
        </section>

        <section aria-label="Sequencer" className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={playing ? Pause : Play} aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
              {playing ? "Stop" : "Play bar"}
            </Button>
            <Button variant="ghost" icon={RotateCcw} onClick={() => setGrid(kit.pads.map(() => Array.from({ length: STEPS }, () => false)))}>
              Clear
            </Button>
            <Button variant="secondary" icon={Upload} disabled={empty} onClick={post}>
              Post as MIDI
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
            <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-label text-label-caps text-text-muted">Tempo</span>
              <span className="font-mono text-numeric tabular text-text">{`${bpm} BPM`}</span>
            </div>
            <Slider label="Tempo" value={bpm} min={60} max={180} step={1} valueText={(v) => `${v} BPM`} onValueChange={setBpm} />
          </div>
            <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-label text-label-caps text-text-muted">Swing</span>
              <span className="font-mono text-numeric tabular text-text">{`${Math.round(50 + swing * 50)} percent`}</span>
            </div>
            <Slider label="Swing" value={Math.round(swing * 100)} min={0} max={30} step={1} valueText={(v) => `${Math.round(50 + v / 2)} percent`} onValueChange={(v) => setSwing(v / 100)} />
          </div>
          </div>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-0.5">
              <caption className="sr-only">Steps: one row per pad, sixteen steps to the bar</caption>
              <tbody>
                {kit.pads.map((p, i) => (
                  <tr key={`${kit.id}-${i}`}>
                    <th scope="row" className="pr-2 text-left text-small font-normal whitespace-nowrap text-text-muted">
                      {p.name}
                    </th>
                    {grid[i]!.map((on, s) => (
                      <td key={s}>
                        <button
                          type="button"
                          aria-label={`${p.name}, step ${s + 1}`}
                          aria-pressed={on}
                          onClick={() => toggleStep(i, s)}
                          data-now={step === s || undefined}
                          data-beat={s % 4 === 0 || undefined}
                          className="block size-5 rounded-control border border-border bg-bg data-beat:border-border-strong aria-pressed:border-accent aria-pressed:bg-accent data-now:outline-2 data-now:outline-text tablet:size-6"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-small text-text-muted">Space starts and stops the bar. Change steps while it plays; they land on the next pass.</p>
        </section>
      </div>
    </main>
  );
}
