import { getEngine } from "@stash/audio";
import type { ItemRow } from "@stash/contracts";
import { saveFiles, wav } from "./save";
import { Button, Download, FilterChip, Pause, Play, RotateCcw, Slider, Stepper, useToast } from "@stash/ui";
import { useEffect, useRef, useState } from "react";
import { audioContext } from "./kits/store";
import { midiPlayer } from "./midi/synth";
import { usePageKeys } from "./shortcuts";

/**
 * Flip it: chop a loop into slices, play them from the keyboard, put them in a new order, reverse
 * it, tape it up or down and filter it, then download the result as a wav. Everything happens in
 * the browser on the loop's preview; the original stays as it is.
 */

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "q", "w", "e", "r", "t", "y", "u", "i"];
const REST = -1;

type Settings = { slices: 4 | 8 | 16; order: number[]; reverse: boolean; semis: number; cutoff: number };

function initial(slices: Settings["slices"]): number[] {
  return Array.from({ length: slices }, (_, i) => i);
}

function reversed(ctx: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i]!;
  }
  return out;
}


/** Schedules the arrangement on any context: each step plays its slice, rests leave a gap. */
function schedule(ctx: BaseAudioContext, buf: AudioBuffer, s: Settings, loopSeconds: number, dest: AudioNode, start: number, fromStep = 0, steps = s.order.length) {
  const rate = 2 ** (s.semis / 12);
  const slice = loopSeconds / s.slices;
  const nodes: AudioBufferSourceNode[] = [];
  for (let k = 0; k < steps; k++) {
    const step = (fromStep + k) % s.order.length;
    const idx = s.order[step]!;
    const when = start + (k * slice) / rate;
    if (idx === REST) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    // A few milliseconds of fade at each edge, so cuts don't click.
    const len = slice / rate;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(1, when + 0.004);
    g.gain.setValueAtTime(1, when + len - 0.006);
    g.gain.linearRampToValueAtTime(0, when + len);
    src.connect(g).connect(dest);
    src.start(when, idx * slice, slice);
    nodes.push(src);
  }
  return nodes;
}

export function FlipPanel({ row }: { row: ItemRow }) {
  const toast = useToast();
  const [buf, setBuf] = useState<AudioBuffer | null>(null);
  const [rev, setRev] = useState<AudioBuffer | null>(null);
  const [failed, setFailed] = useState(false);
  const [s, setS] = useState<Settings>({ slices: 8, order: initial(8), reverse: false, semis: 0, cutoff: 20000 });
  const [armed, setArmed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [lit, setLit] = useState(-1);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(s);
  const filter = useRef<BiquadFilterNode | null>(null);

  const loopSeconds = row.playable.kind === "loop" ? row.playable.loopSamples / row.playable.sampleRate : 0;

  useEffect(() => {
    live.current = s;
    if (filter.current) filter.current.frequency.value = s.cutoff;
  }, [s]);

  // Fetch and decode the preview once.
  useEffect(() => {
    let alive = true;
    const url = row.playable.kind === "loop" ? row.playable.previewUrl : null;
    if (!url) return;
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((d) => audioContext().decodeAudioData(d))
      .then((b) => {
        if (!alive) return;
        setBuf(b);
        setRev(reversed(audioContext(), b));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [row]);

  // Draw the waveform with the slice lines.
  useEffect(() => {
    const c = canvas.current;
    const b = s.reverse ? rev : buf;
    if (!c || !b || !loopSeconds) return;
    const css = getComputedStyle(document.documentElement);
    const col = (n: string) => css.getPropertyValue(n).trim();
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const h = (c.height = c.clientHeight * devicePixelRatio);
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    const data = b.getChannelData(0);
    const total = Math.min(data.length, Math.round(loopSeconds * b.sampleRate));
    const per = Math.max(1, Math.floor(total / w));
    for (let x = 0; x < w; x++) {
      let peak = 0;
      for (let i = x * per; i < (x + 1) * per && i < total; i += 4) peak = Math.max(peak, Math.abs(data[i]!));
      const slice = Math.floor((x / w) * s.slices);
      g.fillStyle = slice === lit ? col("--color-accent") : col("--color-type-loop");
      const bh = Math.max(1, peak * h * 0.9);
      g.fillRect(x, (h - bh) / 2, 1, bh);
    }
    g.fillStyle = col("--color-border-strong");
    for (let i = 1; i < s.slices; i++) g.fillRect(Math.round((i / s.slices) * w), 0, Math.max(1, devicePixelRatio), h);
  }, [buf, rev, s.reverse, s.slices, lit, loopSeconds]);

  const stopOthers = () => {
    const engine = getEngine();
    const st = engine.getState().status;
    if (st === "playing" || st === "loading") engine.pause();
    midiPlayer().pause();
  };

  const hit = (i: number) => {
    const b = live.current.reverse ? rev : buf;
    if (!b) return;
    stopOthers();
    const ctx = audioContext();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = live.current.cutoff;
    f.connect(ctx.destination);
    schedule(ctx, b, { ...live.current, order: [i] }, loopSeconds, f, ctx.currentTime + 0.005, 0, 1);
    setArmed(i);
    setLit(i);
    window.setTimeout(() => setLit((x) => (x === i ? -1 : x)), 180);
  };

  // The arrangement, looped: one step at a time, a little ahead of the clock.
  useEffect(() => {
    if (!playing || !buf || !rev) return;
    stopOthers();
    const ctx = audioContext();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = live.current.cutoff;
    f.connect(ctx.destination);
    filter.current = f;
    let k = 0;
    let next = ctx.currentTime + 0.05;
    const nodes: AudioBufferSourceNode[] = [];
    const timers: number[] = [];
    const tick = () => {
      while (next < ctx.currentTime + 0.15) {
        const st = live.current;
        const step = k % st.order.length;
        nodes.push(...schedule(ctx, st.reverse ? rev : buf, st, loopSeconds, f, next, step, 1));
        timers.push(window.setTimeout(() => setStep(step), Math.max(0, (next - ctx.currentTime) * 1000)));
        next += loopSeconds / st.slices / 2 ** (st.semis / 12);
        k++;
      }
    };
    tick();
    const id = window.setInterval(tick, 25);
    const off = getEngine().subscribe((e) => {
      if (e.status === "playing" || e.status === "loading") setPlaying(false);
    });
    return () => {
      window.clearInterval(id);
      for (const t of timers) window.clearTimeout(t);
      for (const n of nodes) {
        try {
          n.stop();
        } catch {
          // Already ended.
        }
      }
      f.disconnect();
      filter.current = null;
      off();
      setStep(-1);
    };
  }, [playing, buf, rev, loopSeconds]);

  // Slice keys: 1-8, then Q-I for slices 9-16.
  // The site-wide shortcuts stand aside for this page's own keys.
  usePageKeys(KEYS);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const i = KEYS.indexOf(e.key.toLowerCase());
      if (i >= 0 && i < live.current.slices) {
        e.preventDefault();
        hit(i);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  });

  const update = (patch: Partial<Settings>) => setS((cur) => ({ ...cur, ...patch }));
  const changed = s.reverse || s.semis !== 0 || s.cutoff < 20000 || s.order.some((v, i) => v !== i);

  const download = async () => {
    const b = s.reverse ? rev : buf;
    if (!b) return;
    setBusy(true);
    try {
      const rate = 2 ** (s.semis / 12);
      const seconds = loopSeconds / rate;
      const off = new OfflineAudioContext(b.numberOfChannels, Math.ceil(seconds * b.sampleRate), b.sampleRate);
      const f = off.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = s.cutoff;
      f.connect(off.destination);
      schedule(off, b, s, loopSeconds, f, 0);
      const out = await off.startRendering();
      const name = `${row.slug}-flip${s.semis ? `-${s.semis > 0 ? "up" : "down"}${Math.abs(s.semis)}` : ""}${s.reverse ? "-rev" : ""}.wav`;
      const outcome = await saveFiles(name.replace(/\.wav$/, ""), [{ name, data: wav(out) }]);
      if (outcome === "declined") return;
      if (outcome === "failed") throw new Error("save failed");
      toast({ tone: "success", title: "Your flip is saved", description: `${name}, ${Math.round(Number(row.bpm ?? 0) * rate)} BPM. Credit the original as its license asks.` });
    } catch {
      toast({ tone: "error", title: "Couldn't make the file", description: "Your browser refused to render it. Try again, or try another browser." });
    } finally {
      setBusy(false);
    }
  };

  if (failed) return null;
  const rate = 2 ** (s.semis / 12);
  const bpm = row.bpm ? Math.round(row.bpm * rate * 10) / 10 : null;

  return (
    <section aria-labelledby="flip-title" className="mx-auto flex w-full max-w-content flex-col gap-4 px-3 pb-8 tablet:px-4 desktop:px-6">
      <div className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
        <div className="flex flex-col gap-1 tablet:flex-row tablet:items-end tablet:justify-between">
          <div className="flex flex-col gap-1">
            <h2 id="flip-title" className="text-title">
              Flip it
            </h2>
            <p className="max-w-prose text-small text-text-muted">
              Chop the loop, play the slices with the keys 1 to 8 (Q to I past eight), put them in a new order, reverse it, tape it up or down. Then download your
              version.
            </p>
          </div>
          <span className="font-mono text-numeric tabular text-text">{[bpm ? `${bpm} BPM` : "", s.semis ? `${s.semis > 0 ? "+" : ""}${s.semis} st` : "", s.reverse ? "reversed" : ""].filter(Boolean).join(" · ")}</span>
        </div>

        <canvas ref={canvas} aria-hidden="true" className="h-24 w-full rounded-control bg-bg" />

        <div className="flex flex-col gap-2">
          <span className="text-label text-label-caps text-text-muted">Slices</span>
          <div className="flex flex-wrap items-center gap-2">
            {([4, 8, 16] as const).map((n) => (
              <FilterChip key={n} selected={s.slices === n} onToggle={() => update({ slices: n, order: initial(n) })}>
                {`${n}`}
              </FilterChip>
            ))}
          </div>
          <div role="group" aria-label="Slice pads" className={`grid gap-2 ${s.slices === 4 ? "grid-cols-4" : "grid-cols-4 tablet:grid-cols-8"}`}>
            {Array.from({ length: s.slices }, (_, i) => (
              <button
                key={i}
                type="button"
                disabled={!buf}
                onPointerDown={(e) => {
                  e.preventDefault();
                  hit(i);
                }}
                onKeyDown={(e) => e.key === "Enter" && hit(i)}
                aria-label={`Slice ${i + 1}, key ${KEYS[i]!.toUpperCase()}`}
                data-armed={armed === i || undefined}
                data-hit={lit === i || undefined}
                className="st-box flex h-14 touch-manipulation select-none flex-col justify-between rounded-control border border-border-strong bg-raised p-2 text-left data-armed:border-text data-hit:border-accent data-hit:bg-accent data-hit:text-bg"
              >
                <span className="font-mono text-label opacity-70">{`Key ${KEYS[i]!.toUpperCase()}`}</span>
                <span className="font-mono text-small">{`Slice ${i + 1}`}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-label text-label-caps text-text-muted">New order</span>
            <span className="text-small text-text-muted">{`Tap a step to put slice ${armed === REST ? "rest" : armed + 1} there. Pick a slice by playing it.`}</span>
          </div>
          <ol aria-label="New order" className={`grid gap-1 ${s.slices === 16 ? "grid-cols-8 tablet:grid-cols-16" : s.slices === 8 ? "grid-cols-8" : "grid-cols-4"}`}>
            {s.order.map((v, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-label={`Step ${i + 1}: ${v === REST ? "rest" : `slice ${v + 1}`}`}
                  data-now={step === i || undefined}
                  onClick={() => {
                    update({ order: s.order.map((x, j) => (j === i ? armed : x)) });
                    // Hear what the step now holds, so a tap always answers (even when it already held it).
                    if (armed !== REST) hit(armed);
                  }}
                  className="flex h-10 w-full items-center justify-center rounded-control border border-border bg-bg font-mono text-small text-text data-now:border-accent data-now:text-accent"
                >
                  {v === REST ? "–" : v + 1}
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setArmed(REST)} aria-pressed={armed === REST}>
              Rest
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const o = [...s.order];
                for (let i = o.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [o[i], o[j]] = [o[j]!, o[i]!];
                }
                update({ order: o });
              }}
            >
              Shuffle
            </Button>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => update({ order: initial(s.slices) })}>
              Back in order
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-3 tablet:items-end">
          <div className="flex flex-col gap-2">
            <span className="text-label text-label-caps text-text-muted">Direction</span>
            <div className="flex">
              <FilterChip selected={s.reverse} onToggle={() => update({ reverse: !s.reverse })}>
                Reverse
              </FilterChip>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-label text-label-caps text-text-muted">Tape pitch, semitones</span>
            <Stepper label="Tape pitch" value={s.semis} min={-12} max={12} onChange={(v) => update({ semis: v })} format={(v) => (v > 0 ? `+${v}` : String(v))} valueText={`${s.semis} semitones; the tempo moves with it`} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-label text-label-caps text-text-muted">Filter</span>
              <span className="font-mono text-numeric tabular text-text">{s.cutoff >= 20000 ? "Open" : `${Math.round(s.cutoff)} Hz`}</span>
            </div>
            <Slider
              label="Low-pass filter"
              min={0}
              max={100}
              step={1}
              value={Math.round((Math.log(s.cutoff / 200) / Math.log(100)) * 100)}
              valueText={(v) => `${Math.round(200 * 100 ** (v / 100))} hertz`}
              onValueChange={(v) => update({ cutoff: 200 * 100 ** (v / 100) })}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="primary" icon={playing ? Pause : Play} disabled={!buf} aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Stop the flip" : "Play the flip"}
          </Button>
          <Button variant="secondary" icon={Download} disabled={!buf || busy} onClick={() => void download()}>
            {busy ? "Making the file…" : changed ? "Download your flip (.wav)" : "Download as .wav"}
          </Button>
          {changed && (
            <Button variant="ghost" icon={RotateCcw} onClick={() => setS({ slices: s.slices, order: initial(s.slices), reverse: false, semis: 0, cutoff: 20000 })}>
              Reset
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
