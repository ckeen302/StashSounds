import { getEngine, usePlayerState } from "@stash/audio";
import type { ItemRow } from "@stash/contracts";
import { formatKey } from "@stash/contracts/format";
import { Button, Download, FilterChip, PlayButton, TextInput, useToast } from "@stash/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { audioContext } from "./kits/store";
import { Dropdown } from "./presets/page";
import { saveFiles, wav } from "./save";
import { renderAsHeard } from "./stretch-offline";

/**
 * Fit it to your track: hear the loop at your project's tempo and key, half-time or double-time,
 * or reversed, in real time on the page's own player, then download exactly what you hear.
 */

const ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const KEYS: [string, string][] = [["", "Original"], ...ROOTS.flatMap((r, i) => [[`${i}:major`, `${r} major`], [`${i}:minor`, `${r} minor`]] as [string, string][])];

/** The smallest shift (−6 to +6) that puts the loop in `target`, using the relative key when the modes differ. */
function shiftTo(from: { root: number; mode: "major" | "minor" }, target: string): number {
  const [r, mode] = target.split(":");
  let root = Number(r);
  if (mode !== from.mode) root = mode === "major" ? root + 9 : root + 3;
  return ((((root - from.root) % 12) + 18) % 12) - 6;
}

export function LoopTools({ row }: { row: ItemRow }) {
  const engine = getEngine();
  const toast = useToast();
  const current = usePlayerState((s) => s.current?.id ?? null);
  const status = usePlayerState((s) => s.status);
  const tempoRatio = usePlayerState((s) => s.tempoRatio);
  const transpose = usePlayerState((s) => s.transpose);
  const [buf, setBuf] = useState<AudioBuffer | null>(null);
  const rev = useRef<{ src: AudioBufferSourceNode; gain: GainNode; ctx: AudioContext } | null>(null);
  const [revPlaying, setRevPlaying] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [bpmText, setBpmText] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  // What to apply the moment it plays, when it isn't playing yet.
  const [want, setWant] = useState({ ratio: 1, semis: 0 });
  // The panel sits right under the page's own transport, so it's in view without scrolling.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let div: HTMLDivElement | null = null;
    let tries = 0;
    let timer = 0;
    const place = () => {
      // Walk up from the tempo readout to the transport's own box: the child of the page column.
      let el: HTMLElement | null = document.querySelector("main [data-tempo-readout]");
      while (el && el.parentElement && el.parentElement.querySelectorAll(":scope > section").length === 0) el = el.parentElement;
      if (!el?.parentElement) {
        if (tries++ < 20) timer = window.setTimeout(place, 100);
        return;
      }
      div = document.createElement("div");
      el.after(div);
      setSlot(div);
    };
    place();
    return () => {
      window.clearTimeout(timer);
      div?.remove();
      setSlot(null);
    };
  }, [row.id]);

  const p = row.playable;
  const base = p.kind === "loop" ? (p.bpm ?? row.bpm ?? null) : null;
  const fwdId = p.id;
  const revId = `${p.id}~rev`;
  const ours = current === fwdId || current === revId;
  const ratio = ours && !reverse ? tempoRatio : want.ratio;
  const semis = ours && !reverse ? transpose : want.semis;
  const playing = revPlaying || (ours && status === "playing");

  useEffect(() => {
    if (p.kind !== "loop") return;
    let alive = true;
    fetch(p.previewUrl)
      .then((r) => r.arrayBuffer())
      .then((d) => audioContext().decodeAudioData(d))
      .then((b) => alive && setBuf(b))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [p]);
  // Reversed sound stops when the page's player starts anything, and on leaving the page.
  useEffect(() => {
    if (status === "playing" && rev.current) {
      rev.current.src.stop();
      rev.current = null;
      setRevPlaying(false);
    }
  }, [status, current]);
  useEffect(() => () => rev.current?.src.stop(), []);

  if (p.kind !== "loop" || !base) return null;

  const loopS = p.loopSamples / p.sampleRate;

  /**
   * Reversed playback runs on its own looping buffer, not the page's player: the player loads
   * previews by URL, and the published page refuses a made-up (blob:) one. Tempo and key are baked
   * into the buffer, so a change while it plays renders it again.
   */
  const stopRev = () => {
    const r = rev.current;
    rev.current = null;
    if (r) {
      r.gain.gain.setTargetAtTime(0, r.ctx.currentTime, 0.01);
      r.src.stop(r.ctx.currentTime + 0.05);
    }
    setRevPlaying(false);
  };
  const playRev = async (r = want.ratio, s = want.semis) => {
    if (!buf) return;
    engine.pause();
    const ctx = audioContext();
    if (ctx.state !== "running") await ctx.resume();
    const out = renderAsHeard(buf, { tempoRatio: r, semitones: s, reverse: true, seconds: loopS });
    const old = rev.current;
    const src = ctx.createBufferSource();
    src.buffer = out;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = engine.getState().volume;
    src.connect(gain).connect(ctx.destination);
    src.start();
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
      old.src.stop(ctx.currentTime + 0.05);
    }
    rev.current = { src, gain, ctx };
    setRevPlaying(true);
  };

  /** Plays forward on the page's player, with the tempo and key carried over. */
  const start = async (r = ratio, s = semis) => {
    stopRev();
    engine.setQueue?.([p], 0);
    await engine.play(p);
    engine.setTempo(base * r);
    engine.setTranspose(s);
  };

  const setRatio = (r: number) => {
    const bpm = Math.max(40, Math.min(300, base * r));
    const nr = bpm / base;
    setWant((w) => ({ ...w, ratio: nr }));
    if (reverse) void playRev(nr, semis);
    else if (ours) engine.setTempo(bpm);
    else void start(nr, semis);
  };
  const setSemis = (n: number) => {
    setWant((w) => ({ ...w, semis: n }));
    if (reverse) void playRev(ratio, n);
    else if (ours) engine.setTranspose(n);
    else void start(ratio, n);
  };

  const liveBpm = Math.round(base * ratio);
  const half = Math.abs(ratio - 0.5) < 0.01;
  const double = Math.abs(ratio - 2) < 0.01;
  const loopKey = row.key ? { root: row.key.root, mode: row.key.mode } : null;
  const heardKey = loopKey ? formatKey({ root: (((loopKey.root + semis) % 12) + 12) % 12, mode: loopKey.mode }) : null;

  const download = async () => {
    if (!buf) return;
    setBusy(true);
    try {
      // Let the button repaint before the stretch takes the main thread.
      await new Promise((r) => setTimeout(r, 30));
      const out = renderAsHeard(buf, { tempoRatio: ratio, semitones: semis, reverse, seconds: loopS });
      const name = `${row.title} ${liveBpm}bpm${heardKey ? ` ${heardKey}` : ""}${reverse ? " reversed" : ""}.wav`;
      const outcome = await saveFiles(name.replace(/\.wav$/, ""), [{ name, data: wav(out) }]);
      if (outcome === "saved") toast({ tone: "success", title: "Downloaded as you hear it", description: name });
      else if (outcome === "failed") toast({ tone: "error", title: "The download did not start", description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  const panel = (
    <section aria-labelledby="fit-title" className={slot ? "flex flex-col" : "mx-auto flex w-full max-w-content flex-col gap-4 px-3 pb-8 tablet:px-4 desktop:px-6"}>
      <div className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 tablet:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <PlayButton title={`${row.title}, as set here`} state={playing ? "playing" : "paused"} onClick={() => (revPlaying ? stopRev() : playing ? engine.pause() : reverse ? void playRev() : void start())} />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 id="fit-title" className="text-title">Fit it to your track</h2>
            <span className="font-mono text-numeric tabular text-text-muted">
              {[`${liveBpm} BPM`, heardKey, half ? "half-time" : double ? "double-time" : null, reverse ? "reversed" : null].filter(Boolean).join(" · ")}
            </span>
          </div>
          <Button variant="primary" icon={Download} disabled={!buf || busy} onClick={() => void download()}>
            {busy ? "Making the file…" : "Download as heard (.wav)"}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(bpmText);
              if (!(Number.isFinite(n) && n >= 40 && n <= 300)) {
                toast({ tone: "error", title: "Type a BPM from 40 to 300" });
                return;
              }
              // Producers fit loops in half- or double-time: a 72 BPM loop goes in a 140 session at
              // 70, not stretched to 140. Take whichever of n, n/2 and 2n needs the least stretch.
              const fit = [n, n / 2, n * 2]
                .filter((t) => t >= 40 && t <= 300)
                .reduce((a, b) => (Math.abs(Math.log(b / base)) < Math.abs(Math.log(a / base)) ? b : a));
              setRatio(fit / base);
              if (fit !== n) toast({ tone: "success", title: `Fit at ${Math.round(fit)} BPM`, description: `${fit < n ? "Half" : "Double"}-time of your ${Math.round(n)} BPM session, so it barely stretches.` });
            }}
          >
            <TextInput label="Your project's BPM" inputMode="numeric" placeholder={String(Math.round(base))} value={bpmText} onChange={(e) => setBpmText(e.target.value.replace(/[^\d.]/g, ""))} className="min-w-0 flex-1" />
            <Button type="submit" variant="secondary">
              Match
            </Button>
          </form>
          <div className="flex flex-col gap-2">
            <span className="text-label text-label-caps text-text-muted">Speed</span>
            <div role="group" aria-label="Speed" className="flex flex-wrap gap-2">
              <FilterChip selected={half} onToggle={() => setRatio(half ? 1 : 0.5)}>
                Half-time
              </FilterChip>
              <FilterChip selected={Math.abs(ratio - 1) < 0.01} onToggle={() => setRatio(1)}>
                Original
              </FilterChip>
              <FilterChip selected={double} onToggle={() => setRatio(double ? 1 : 2)}>
                Double-time
              </FilterChip>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-label text-label-caps text-text-muted">Key</span>
            <div className="flex flex-wrap items-center gap-2">
              {loopKey && (
                <Dropdown
                  name="Your key"
                  value={KEYS.find(([v]) => v === key)?.[1] ?? "Original"}
                  options={KEYS}
                  selected={key}
                  active={key !== ""}
                  onPick={(v) => {
                    setKey(v);
                    setSemis(v ? shiftTo(loopKey, v) : 0);
                  }}
                />
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-label text-label-caps text-text-muted">Direction</span>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                selected={reverse}
                disabled={!buf}
                onToggle={() => {
                  const next = !reverse;
                  setReverse(next);
                  // Hear it at once: reversed on, or back to the page's player going forwards.
                  if (next) void playRev(ratio, semis);
                  else if (revPlaying) void start(want.ratio, want.semis);
                }}
              >
                Reverse
              </FilterChip>
            </div>
          </div>
        </div>
        <p className="text-small text-text-muted">Tempo and key move separately, so a loop slowed to your BPM stays in key. Fine-tune the key with the transport above. The download is the loop with every change here applied.</p>
      </div>
    </section>
  );
  return slot ? createPortal(panel, slot) : panel;
}
