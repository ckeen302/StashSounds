import { Button, FilterChip, PlayButton, Slider, TextInput, Trash, useToast } from "@stash/ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { midiItems, type MidiItem } from "./midi/catalog";
import { useMidiPlayer } from "./midi/pages";
import { FACTORY, type Patch, type Wave } from "./midi/patch";
import { midiPlayer } from "./midi/synth";
import { usePageKeys } from "./shortcuts";

/**
 * Sound design: shape a patch on the demo's synth, play it from the screen or the computer keys,
 * loop a MIDI pattern through it, and keep the patches you like in this browser.
 */

const player = midiPlayer();
const KEY = "stash.demo.patches";
const WAVES: Wave[] = ["sawtooth", "square", "triangle", "sine"];
const WAVE_LABEL: Record<Wave, string> = { sawtooth: "Saw", square: "Square", triangle: "Triangle", sine: "Sine" };
// The computer keys, a piano's worth: A to K white, W E T Y U black; Z and X move the octave.
const KEYMAP: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 };

let mine: Patch[] = [];
const listeners = new Set<() => void>();
let version = 0;
function loadMine(): Patch[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Patch[];
  } catch {
    // Memory copy.
  }
  return mine;
}
function saveMine(next: Patch[]) {
  mine = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // This visit only.
  }
  version++;
  for (const l of listeners) l();
}
function useMine(): Patch[] {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  void v;
  return loadMine();
}

/** The patch the sound design page has open, shared with the presets page's "open in sound design". */
let pending: Patch | null = null;
export function openPatch(p: Patch) {
  pending = structuredClone(p);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <h2 className="text-label text-label-caps text-text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Knob({ label, value, min, max, step, unit = "", onChange, format }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; format?: (v: number) => string }) {
  const text = format ? format(value) : `${Number.isInteger(step) ? Math.round(value) : value.toFixed(step < 0.1 ? 2 : 1)}${unit}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-small text-text-muted">{label}</span>
        <span className="font-mono text-numeric tabular text-text">{text}</span>
      </div>
      <Slider label={label} value={value} min={min} max={max} step={step} onValueChange={onChange} valueText={() => text} />
    </div>
  );
}

function WavePicker({ label, value, onChange }: { label: string; value: Wave; onChange: (w: Wave) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {WAVES.map((w) => (
        <FilterChip key={w} selected={value === w} onToggle={() => onChange(w)}>
          {WAVE_LABEL[w]}
        </FilterChip>
      ))}
    </div>
  );
}

/** The output, drawn live: a waveform line over a faint spectrum. */
function Scope() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    let raf = 0;
    const wave = new Uint8Array(2048);
    const spec = new Uint8Array(1024);
    const draw = () => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(r.width * dpr)) {
        el.width = Math.round(r.width * dpr);
        el.height = Math.round(r.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = r.width;
      const h = r.height;
      const cs = getComputedStyle(el);
      ctx.clearRect(0, 0, w, h);
      const a = player.analyser;
      if (a) {
        a.getByteFrequencyData(spec);
        ctx.fillStyle = cs.getPropertyValue("--color-type-midi").trim();
        ctx.globalAlpha = 0.35;
        const bins = 96;
        for (let i = 0; i < bins; i++) {
          // Log-spaced bins so the lows get room.
          const idx = Math.floor(2 ** ((i / bins) * Math.log2(spec.length)));
          const v = (spec[idx] ?? 0) / 255;
          const bw = w / bins;
          ctx.fillRect(i * bw + 1, h - v * h, bw - 2, v * h);
        }
        ctx.globalAlpha = 1;
        a.getByteTimeDomainData(wave);
        ctx.strokeStyle = cs.getPropertyValue("--color-accent").trim();
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < wave.length; i += 4) {
          const x = (i / wave.length) * w;
          const y = h / 2 + ((wave[i]! - 128) / 128) * (h / 2.2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        ctx.strokeStyle = cs.getPropertyValue("--color-border-strong").trim();
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} aria-hidden="true" className="st-box h-32 w-full rounded-control border border-border bg-bg" />;
}

function Keyboard({ octave, down, onDown, onUp }: { octave: number; down: Set<number>; onDown: (p: number) => void; onUp: (p: number) => void }) {
  const base = 12 * (octave + 1);
  const whites = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
  const blacks: [number, number][] = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5], [13, 7], [15, 8], [18, 10], [20, 11], [22, 12]];
  const handlers = (p: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      onDown(base + p);
    },
    onPointerUp: () => onUp(base + p),
    onPointerCancel: () => onUp(base + p),
  });
  const name = (p: number) => `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][(base + p) % 12]}${Math.floor((base + p) / 12) - 1}`;
  return (
    <div className="relative h-36 w-full touch-none select-none" role="group" aria-label="Keyboard">
      <div className="flex h-full">
        {whites.map((p) => (
          <button
            key={p}
            type="button"
            aria-label={name(p)}
            {...handlers(p)}
            className={`relative flex-1 rounded-b-control border border-border-strong ${down.has(base + p) ? "bg-accent" : "bg-text"}`}
          >
            {(base + p) % 12 === 0 && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-label text-bg">{name(p)}</span>}
          </button>
        ))}
      </div>
      {blacks.map(([p, after]) => (
        <button
          key={p}
          type="button"
          aria-label={name(p)}
          {...handlers(p)}
          style={{ left: `calc(${((after + 1) / whites.length) * 100}% - ${100 / whites.length / 3}%)`, width: `${(100 / whites.length) * 0.66}%` }}
          className={`absolute top-0 h-3/5 rounded-b-control border border-border ${down.has(base + p) ? "bg-accent" : "bg-bg"}`}
        />
      ))}
    </div>
  );
}

export function SoundDesign() {
  const [patch, setPatch] = useState<Patch>(() => {
    const p = pending ?? structuredClone(FACTORY[0]!);
    pending = null;
    return p;
  });
  const [octave, setOctave] = useState(3);
  const [down, setDown] = useState<Set<number>>(new Set());
  const [loopId, setLoopId] = useState<string>("");
  const [name, setName] = useState("");
  const saved = useMine();
  const s = useMidiPlayer();
  const toast = useToast();
  const melodic = midiItems().filter((m) => !m.notes.drums);
  const loopItem: MidiItem | undefined = melodic.find((m) => m.id === loopId) ?? melodic[0];

  useEffect(() => {
    player.setPatch(patch);
  }, [patch]);
  useEffect(
    () => () => {
      player.pause();
      player.setPatch(null);
    },
    [],
  );

  const on = (p: number) => {
    player.noteOn(p, 104);
    setDown((d) => new Set(d).add(p));
  };
  const off = (p: number) => {
    player.noteOff(p);
    setDown((d) => {
      const n = new Set(d);
      n.delete(p);
      return n;
    });
  };

  // Computer keys play the keyboard.
  // The site-wide shortcuts stand aside for this page's own keys.
  usePageKeys([...Object.keys(KEYMAP), "z", "x"]);
  useEffect(() => {
    const held = new Map<string, number>();
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      const k = e.key.toLowerCase();
      if (k === "z") return setOctave((o) => Math.max(0, o - 1));
      if (k === "x") return setOctave((o) => Math.min(6, o + 1));
      if (KEYMAP[k] === undefined) return;
      e.preventDefault();
      const p = 12 * (octave + 1) + KEYMAP[k]!;
      held.set(k, p);
      on(p);
    };
    const ku = (e: KeyboardEvent) => {
      const p = held.get(e.key.toLowerCase());
      if (p === undefined) return;
      held.delete(e.key.toLowerCase());
      off(p);
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [octave]);

  const set = <K extends keyof Patch>(k: K, v: Patch[K]) => setPatch((p) => ({ ...p, [k]: v }));
  const looping = !!loopItem && s.currentId === `sd-${loopItem.id}` && s.status === "playing";

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-title">Shape a sound</h1>
        <p className="max-w-prose text-body text-text-muted">
          Start from a patch, turn it into your own, and play it on the keys below or your computer keys (A to K, Z and X change the octave). Loop any MIDI from the
          site through it to hear it in a beat. Save the ones you like; they stay in this browser.
        </p>
      </header>

      <Section title="Patches">
        <div role="group" aria-label="Factory patches" className="flex flex-wrap gap-2">
          {FACTORY.map((p) => (
            <FilterChip key={p.name} selected={patch.name === p.name} onToggle={() => setPatch(structuredClone(p))}>
              {p.name}
            </FilterChip>
          ))}
        </div>
        {saved.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-label text-label-caps text-text-muted">Yours</span>
            <div role="group" aria-label="Your patches" className="flex flex-wrap gap-2">
              {saved.map((p) => (
                <FilterChip key={`mine-${p.name}`} selected={patch.name === p.name} onToggle={() => setPatch(structuredClone(p))}>
                  {p.name}
                </FilterChip>
              ))}
            </div>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 desktop:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 desktop:col-span-2">
          <section aria-label="Play" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <PlayButton
                size="hero"
                title={loopItem ? `${loopItem.title} through ${patch.name}` : patch.name}
                state={looping ? "playing" : "paused"}
                onClick={() => loopItem && player.toggle(`sd-${loopItem.id}`, loopItem.notes, loopItem.sound)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="text-small text-text-muted">Loop a pattern through it</span>
                <div role="group" aria-label="Pattern" className="flex flex-wrap gap-2">
                  {melodic.slice(0, 8).map((m) => (
                    <FilterChip
                      key={m.id}
                      selected={loopItem?.id === m.id}
                      onToggle={() => {
                        const wasPlaying = looping;
                        player.pause();
                        setLoopId(m.id);
                        if (wasPlaying) void player.play(`sd-${m.id}`, m.notes, m.sound);
                      }}
                    >
                      {m.title}
                    </FilterChip>
                  ))}
                </div>
              </div>
            </div>
            <Scope />
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-numeric text-text-muted">Octave {octave}</span>
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setOctave((o) => Math.max(0, o - 1))}>
                  Octave down
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setOctave((o) => Math.min(6, o + 1))}>
                  Octave up
                </Button>
              </span>
            </div>
            <Keyboard octave={octave} down={down} onDown={on} onUp={off} />
          </section>

          <div className="grid grid-cols-1 gap-6 tablet:grid-cols-2">
            <Section title="Oscillator 1">
              <WavePicker label="Oscillator 1 wave" value={patch.osc1.wave} onChange={(w) => set("osc1", { ...patch.osc1, wave: w })} />
              <Knob label="Octave" value={patch.osc1.octave} min={-2} max={2} step={1} onChange={(v) => set("osc1", { ...patch.osc1, octave: v })} />
              <Knob label="Unison voices" value={patch.osc1.voices} min={1} max={9} step={1} onChange={(v) => set("osc1", { ...patch.osc1, voices: v })} />
              <Knob label="Unison spread" value={patch.osc1.spread} min={0} max={50} step={1} unit=" ct" onChange={(v) => set("osc1", { ...patch.osc1, spread: v })} />
            </Section>
            <Section title="Oscillator 2, sub and noise">
              <WavePicker label="Oscillator 2 wave" value={patch.osc2.wave} onChange={(w) => set("osc2", { ...patch.osc2, wave: w })} />
              <Knob label="Level" value={patch.osc2.level} min={0} max={1} step={0.05} onChange={(v) => set("osc2", { ...patch.osc2, level: v })} />
              <Knob label="Octave" value={patch.osc2.octave} min={-2} max={2} step={1} onChange={(v) => set("osc2", { ...patch.osc2, octave: v })} />
              <Knob label="Semitones" value={patch.osc2.semis} min={-12} max={12} step={1} onChange={(v) => set("osc2", { ...patch.osc2, semis: v })} />
              <Knob label="Sub" value={patch.sub} min={0} max={1} step={0.05} onChange={(v) => set("sub", v)} />
              <Knob label="Noise" value={patch.noise} min={0} max={0.5} step={0.01} onChange={(v) => set("noise", v)} />
            </Section>
            <Section title="Filter">
              <Knob label="Cutoff" value={patch.filter.cutoff} min={80} max={16000} step={10} unit=" Hz" onChange={(v) => set("filter", { ...patch.filter, cutoff: v })} />
              <Knob label="Resonance" value={patch.filter.resonance} min={0.1} max={15} step={0.1} onChange={(v) => set("filter", { ...patch.filter, resonance: v })} />
              <Knob label="Envelope amount" value={patch.filter.envAmount} min={0} max={10000} step={50} unit=" Hz" onChange={(v) => set("filter", { ...patch.filter, envAmount: v })} />
              <Knob label="Envelope decay" value={patch.filter.decay} min={0.02} max={3} step={0.01} unit=" s" onChange={(v) => set("filter", { ...patch.filter, decay: v })} />
            </Section>
            <Section title="Amp envelope">
              <Knob label="Attack" value={patch.amp.attack} min={0.001} max={2} step={0.001} unit=" s" onChange={(v) => set("amp", { ...patch.amp, attack: v })} />
              <Knob label="Decay" value={patch.amp.decay} min={0.02} max={4} step={0.01} unit=" s" onChange={(v) => set("amp", { ...patch.amp, decay: v })} />
              <Knob label="Sustain" value={patch.amp.sustain} min={0} max={1} step={0.01} onChange={(v) => set("amp", { ...patch.amp, sustain: v })} />
              <Knob label="Release" value={patch.amp.release} min={0.02} max={4} step={0.01} unit=" s" onChange={(v) => set("amp", { ...patch.amp, release: v })} />
            </Section>
            <Section title="Character">
              <Knob label="Drive" value={patch.drive} min={0} max={1} step={0.05} onChange={(v) => set("drive", v)} />
              <Knob label="Pitch drop" value={patch.pitchDrop} min={0} max={24} step={1} unit=" st" onChange={(v) => set("pitchDrop", v)} />
              <Knob label="Vibrato depth" value={patch.vibrato.depth} min={0} max={50} step={1} unit=" ct" onChange={(v) => set("vibrato", { ...patch.vibrato, depth: v })} />
              <Knob label="Vibrato rate" value={patch.vibrato.rate} min={0.5} max={10} step={0.1} unit=" Hz" onChange={(v) => set("vibrato", { ...patch.vibrato, rate: v })} />
            </Section>
            <Section title="Space and level">
              <Knob label="Reverb" value={patch.reverb} min={0} max={1} step={0.05} onChange={(v) => set("reverb", v)} />
              <Knob label="Level" value={patch.level} min={0.1} max={1} step={0.05} onChange={(v) => set("level", v)} />
            </Section>
          </div>
        </div>

        <aside aria-label="Save" className="flex flex-col gap-4">
          <Section title="Save this patch">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const n = name.trim() || `${patch.name} edit`;
                const next = [{ ...patch, name: n }, ...saved.filter((p) => p.name !== n)].slice(0, 30);
                saveMine(next);
                setPatch({ ...patch, name: n });
                setName("");
                toast({ tone: "success", title: "Saved", description: `${n} is in your patches on this device.` });
              }}
            >
              <TextInput label="Name" value={name} placeholder={`${patch.name} edit`} maxLength={40} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" variant="primary">
                Save patch
              </Button>
            </form>
            {saved.some((p) => p.name === patch.name) && (
              <Button variant="danger" icon={Trash} onClick={() => saveMine(saved.filter((p) => p.name !== patch.name))}>
                Delete this patch
              </Button>
            )}
          </Section>
          <Section title="How it works">
            <p className="text-small text-text-muted">
              Oscillator 1 stacks up to nine detuned voices (a supersaw at seven). The filter opens by the envelope amount on every note and falls back to the cutoff
              over the decay. Drive saturates after the filter. Pitch drop starts each note higher and slides down, which is most of an 808.
            </p>
          </Section>
        </aside>
      </div>
    </main>
  );
}
