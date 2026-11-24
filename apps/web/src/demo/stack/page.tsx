import { soundIdSchema, type MidiKind, type MusicalKey, type SoundId } from "@stash/contracts";
import {
  Button,
  Download,
  EmptyState,
  FilterChip,
  IconButton,
  Library,
  PlayButton,
  Plus,
  RotateCcw,
  Slider,
  Stepper,
  TextInput,
  Trash,
  TypeChip,
  UiLink,
  X,
  tempoRange,
  useToast,
  volumeText,
} from "@stash/ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { midiItems, midiVersion, subscribeMidi, type MidiItem } from "../midi/catalog";
import { stackPlayer, type StackPlayerState } from "./player";
import {
  KIND_ORDER,
  MAX_LAYERS,
  STARTERS,
  addToStack,
  clearStack,
  defaultName,
  deleteSaved,
  isDrums,
  keyName,
  keyShort,
  loadSaved,
  loadStarter,
  removeLayer,
  saveStack,
  setLayerMuted,
  setLayerSolo,
  setLayerSound,
  setLayerVolume,
  setMatchKeys,
  setStackBpm,
  setStackKey,
  useSavedStacks,
  useStack,
  type ResolvedLayer,
  type ResolvedStack,
} from "./store";

/**
 * Stack: pick up to four MIDI items and hear them together, in time and in key, before
 * downloading any of them. One transport for the whole stack, a stacked roll with one playhead,
 * and per-layer mute, solo, volume and sound.
 */

const player = stackPlayer();

function useStackPlayer(): StackPlayerState {
  return useSyncExternalStore(player.subscribe, player.getState, player.getState);
}

const KIND_LABEL: Record<MidiKind, string> = { chords: "Chords", melody: "Melody", drums: "Drums", bass: "Bass" };
const SOUND_LABEL: Record<SoundId, string> = { keys: "Keys", pluck: "Pluck", pad: "Pad", bass: "Bass", "808": "808", bell: "Bell", strings: "Strings", drums: "Drums" };
const MELODIC_SOUNDS = soundIdSchema.options.filter((o) => o !== "drums");

/** Lane colors, in layer order: the swatch class and the token the canvas reads. */
const LANE = [
  { swatch: "bg-type-midi", text: "text-type-midi", token: "--color-type-midi" },
  { swatch: "bg-type-loop", text: "text-type-loop", token: "--color-type-loop" },
  { swatch: "bg-type-kit", text: "text-type-kit", token: "--color-type-kit" },
  { swatch: "bg-type-preset", text: "text-type-preset", token: "--color-type-preset" },
] as const;
const ROLL_HEIGHT = ["h-32", "h-32", "h-52", "h-72", "h-92"] as const;

function useMidiCatalog(): MidiItem[] {
  const v = useSyncExternalStore(subscribeMidi, midiVersion, midiVersion);
  return useMemo(() => midiItems(), [v]); // eslint-disable-line react-hooks/exhaustive-deps
}

function facts(m: MidiItem): string {
  return [m.key ? keyShort(m.key) : isDrums(m) ? "Drums" : "No key", `${Math.round(m.notes.bpm)} BPM`, `${m.notes.bars} bars`].join(" · ");
}

export function StackPage() {
  const stack = useStack();
  const ps = useStackPlayer();
  const toast = useToast();
  const playing = ps.status === "playing";

  useEffect(() => () => player.pause(), []);

  // Space plays and pauses the stack.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.isContentEditable)) return;
      e.preventDefault();
      player.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const bars = stack.beatsPerBar > 0 ? Math.round(stack.lengthBeats / stack.beatsPerBar) : 0;
  const empty = stack.layers.length === 0;

  return (
    <main aria-labelledby="stack-title" className="@container mx-auto flex w-full max-w-content flex-col gap-8 px-3 pt-6 pb-8 tablet:px-4 desktop:px-6 desktop:pt-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <TypeChip type="midi" />
          <span className="text-small text-text-muted">Up to {MAX_LAYERS} layers · one tempo · one key</span>
        </div>
        <h1 id="stack-title" className="text-display text-text">
          Stack
        </h1>
        <p className="max-w-160 text-body text-text-muted">
          Layer chords, a melody, an 808 and drums from different producers and hear them together before you download any of them. Melodic layers move to one key; drums never do.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 cq-xl:grid-cols-3 cq-xl:gap-8">
        <div className="flex min-w-0 flex-col gap-6 cq-xl:col-span-2">
          <section aria-label="Stack player" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <PlayButton size="hero" title="the stack" state={playing ? "playing" : "paused"} disabled={empty} onClick={() => player.toggle()} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span data-stack-facts className="font-mono text-numeric tabular text-text">
                  {[`${stack.bpm} BPM`, stack.key ? keyShort(stack.key) : null, `${bars} ${bars === 1 ? "bar" : "bars"}`].filter(Boolean).join(" · ")}
                </span>
                <span className="text-small text-text-muted">
                  {empty ? "Add a layer to start" : `${stack.layers.length} of ${MAX_LAYERS} layers · shorter layers repeat to fill the loop`}
                </span>
              </span>
              <IconButton icon={RotateCcw} label="Back to the start" disabled={empty} onClick={() => player.seek(0)} />
            </div>
            {empty ? (
              <EmptyState icon={Library} title="Nothing stacked yet">
                Load a starter stack or add a layer from the list below.
              </EmptyState>
            ) : (
              <StackRoll stack={stack} playing={playing} />
            )}
            <Globals stack={stack} />
          </section>

          <section aria-labelledby="layers-title" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="layers-title" className="text-title text-text">
                Layers
              </h2>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Download}
                  disabled={empty}
                  onClick={() => toast({ tone: "info", title: "Downloads are off in the demo", description: `In Stash this saves ${stack.layers.length} .mid files, each at ${stack.bpm} BPM and moved to ${stack.key ? keyName(stack.key) : "its key"}, with their license records.` })}
                >
                  Download all
                </Button>
                <Button variant="ghost" size="sm" icon={Trash} disabled={empty} onClick={() => clearStack()}>
                  Clear
                </Button>
              </div>
            </div>
            {stack.layers.length > 0 && (
              <ul aria-label="Layers" className="flex flex-col gap-3">
                {stack.layers.map((l) => (
                  <LayerRow key={l.uid} layer={l} />
                ))}
              </ul>
            )}
          </section>

          <AddLayer stack={stack} />
        </div>

        <aside aria-label="Starter and saved stacks" className="flex min-w-0 flex-col gap-6">
          <Starters />
          <Saved stack={stack} />
        </aside>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Tempo and key

function Globals({ stack }: { stack: ResolvedStack }) {
  const range = tempoRange(stack.baseBpm);
  const key: MusicalKey = stack.key ?? { root: 0, mode: "minor" };
  const hasMelodic = stack.layers.some((l) => !l.drums && l.item.key);
  return (
    <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 tablet:grid-cols-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-label text-label-caps text-text-muted">Tempo</span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-numeric tabular text-text">{stack.bpm} BPM</span>
            {stack.bpm !== stack.baseBpm && (
              <Button variant="ghost" size="sm" onClick={() => setStackBpm(null)}>
                {`Reset to ${stack.baseBpm}`}
              </Button>
            )}
          </span>
        </div>
        <Slider
          label="Tempo"
          value={stack.bpm}
          min={Math.min(range.min, stack.bpm)}
          max={Math.max(range.max, stack.bpm)}
          step={1}
          disabled={stack.layers.length === 0}
          valueText={(v) => `${v} BPM`}
          onValueChange={(v) => setStackBpm(v)}
        />
        <span className="text-small text-text-muted">Follows the first layer until you move it.</span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-label text-label-caps text-text-muted">Key</span>
          {stack.key && stack.baseKey && (stack.key.root !== stack.baseKey.root || stack.key.mode !== stack.baseKey.mode) && (
            <Button variant="ghost" size="sm" onClick={() => setStackKey(null)}>
              {`Reset to ${keyShort(stack.baseKey)}`}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Stepper
            label="Stack key"
            value={key.root}
            min={0}
            max={11}
            display={keyShort(key)}
            valueText={keyName(key)}
            onChange={hasMelodic && stack.matchKeys ? (root) => setStackKey({ root, mode: key.mode }) : undefined}
          />
          <FilterChip selected={key.mode === "minor"} disabled={!hasMelodic || !stack.matchKeys} onToggle={() => setStackKey({ root: key.root, mode: "minor" })}>
            Minor
          </FilterChip>
          <FilterChip selected={key.mode === "major"} disabled={!hasMelodic || !stack.matchKeys} onToggle={() => setStackKey({ root: key.root, mode: "major" })}>
            Major
          </FilterChip>
          <FilterChip selected={stack.matchKeys} onToggle={() => setMatchKeys(!stack.matchKeys)}>
            Match keys
          </FilterChip>
        </div>
        <span className="text-small text-text-muted">
          {stack.matchKeys ? "Each melodic layer moves the shortest way, at most six semitones; minor layers land on the relative minor of a major key." : "Off: every layer plays in its own key."}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One layer

function LayerRow({ layer: l }: { layer: ResolvedLayer }) {
  const lane = LANE[l.index % LANE.length]!;
  const m = l.item;
  return (
    <li data-layer={l.index} data-audible={l.audible || undefined} className={`flex flex-col gap-3 rounded-panel border border-border bg-surface p-3 ${l.audible ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={`size-3 shrink-0 rounded-full ${lane.swatch}`} />
        <div className="flex min-w-0 flex-1 flex-col">
          <UiLink href={m.href} className="truncate text-body-strong text-text ui-hover:underline">
            {m.title}
          </UiLink>
          <span className="truncate text-small text-text-muted">
            @{m.owner.handle} · {KIND_LABEL[m.kind]} · {facts(m)}
          </span>
        </div>
        <span data-transpose={l.transpose} className={`hidden shrink-0 font-mono text-numeric tabular tablet:block ${l.transpose !== 0 ? lane.text : "text-text-muted"}`}>
          {l.readout}
        </span>
        <IconButton icon={X} label={`Remove ${m.title}`} onClick={() => removeLayer(l.uid)} />
      </div>
      <span className={`font-mono text-numeric tabular tablet:hidden ${l.transpose !== 0 ? lane.text : "text-text-muted"}`}>{l.readout}</span>
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip selected={l.muted} onToggle={() => setLayerMuted(l.uid, !l.muted)} aria-label={`Mute ${m.title}`}>
          Mute
        </FilterChip>
        <FilterChip selected={l.solo} onToggle={() => setLayerSolo(l.uid, !l.solo)} aria-label={`Solo ${m.title}`}>
          Solo
        </FilterChip>
        <Slider label={`Volume, ${m.title}`} value={l.volume} onValueChange={(v) => setLayerVolume(l.uid, v)} valueText={volumeText} className="w-28" />
        {!l.drums && (
          <div role="group" aria-label={`Sound for ${m.title}`} className="flex flex-wrap gap-2">
            {MELODIC_SOUNDS.map((o) => (
              <FilterChip key={o} selected={l.sound === o} onToggle={() => setLayerSound(l.uid, o)}>
                {SOUND_LABEL[o]}
              </FilterChip>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Add a layer

function AddLayer({ stack }: { stack: ResolvedStack }) {
  const items = useMidiCatalog();
  const [kind, setKind] = useState<MidiKind | "all">("all");
  const full = stack.layers.length >= MAX_LAYERS;
  const inStack = new Set(stack.layers.map((l) => l.itemId));
  const shown = kind === "all" ? items : items.filter((m) => m.kind === kind);
  return (
    <section aria-labelledby="add-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="add-title" className="text-title text-text">
          Add a layer
        </h2>
        <span className="text-small text-text-muted">{full ? `The stack is full: remove a layer to add another.` : `${MAX_LAYERS - stack.layers.length} open`}</span>
      </div>
      <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-2">
        <FilterChip selected={kind === "all"} onToggle={() => setKind("all")}>
          {`All ${items.length}`}
        </FilterChip>
        {KIND_ORDER.map((k) => (
          <FilterChip key={k} selected={kind === k} onToggle={() => setKind(kind === k ? "all" : k)}>
            {`${KIND_LABEL[k]} ${items.filter((m) => m.kind === k).length}`}
          </FilterChip>
        ))}
      </div>
      <ul aria-label="MIDI to add" className="overflow-hidden rounded-panel border border-border bg-surface">
        {shown.map((m) => {
          const added = inStack.has(m.id);
          return (
            <li key={m.id} className="flex h-16 items-center gap-3 border-b border-border px-3 last:border-b-0 tablet:h-14">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-strong text-text">{m.title}</span>
                <span className="truncate text-small text-text-muted">
                  @{m.owner.handle} · {KIND_LABEL[m.kind]}
                </span>
              </div>
              <span className="hidden w-14 shrink-0 font-mono text-numeric tabular text-text tablet:block">{m.key ? keyShort(m.key) : "—"}</span>
              <span className="w-16 shrink-0 text-right font-mono text-numeric tabular text-text">{Math.round(m.notes.bpm)} BPM</span>
              <Button variant={added ? "ghost" : "secondary"} size="sm" icon={Plus} disabled={full || added} onClick={() => addToStack(m.id)} aria-label={added ? `${m.title} is in the stack` : `Add ${m.title} to the stack`}>
                {added ? "Added" : "Add"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Starter and saved stacks

function Starters() {
  const items = useMidiCatalog();
  const byPublic = new Map(items.map((m) => [m.publicId, m]));
  return (
    <section aria-labelledby="starters-title" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <h2 id="starters-title" className="text-label text-label-caps text-text-muted">
        Starter stacks
      </h2>
      <ul className="flex flex-col gap-3">
        {STARTERS.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-body-strong text-text">{s.name}</span>
              <Button variant="secondary" size="sm" onClick={() => loadStarter(s.id)} aria-label={`Load ${s.name}`}>
                Load
              </Button>
            </div>
            <p className="text-small text-text-muted">{s.blurb}</p>
            <ul aria-label={`${s.name} layers`} className="flex flex-wrap gap-1">
              {s.items.map((id, i) => {
                const m = byPublic.get(id);
                return m ? (
                  <li key={id} className="flex items-center gap-1 text-small text-text">
                    <span aria-hidden="true" className={`size-2 rounded-full ${LANE[i % LANE.length]!.swatch}`} />
                    {m.title}
                    {i < s.items.length - 1 ? <span className="text-text-muted">,</span> : null}
                  </li>
                ) : null;
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Saved({ stack }: { stack: ResolvedStack }) {
  const saved = useSavedStacks();
  const [name, setName] = useState("");
  const toast = useToast();
  const items = useMidiCatalog();
  const titles = new Map(items.map((m) => [m.id, m.title]));
  const empty = stack.layers.length === 0;
  return (
    <section aria-labelledby="saved-title" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <h2 id="saved-title" className="text-label text-label-caps text-text-muted">
        Your stacks
      </h2>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const s = saveStack(name);
          if (s) {
            setName("");
            toast({ tone: "success", title: "Stack saved", description: `${s.name} is kept in this browser.` });
          }
        }}
      >
        <TextInput label="Name" size="sm" value={name} placeholder={empty ? "Add a layer first" : defaultName()} disabled={empty} onChange={(e) => setName(e.target.value)} className="flex-1" />
        <Button type="submit" variant="primary" size="sm" disabled={empty}>
          Save
        </Button>
      </form>
      {saved.length === 0 ? (
        <p className="text-small text-text-muted">Saved stacks stay in this browser.</p>
      ) : (
        <ul aria-label="Saved stacks" className="flex flex-col gap-2">
          {saved.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-strong text-text">{s.name}</span>
                <span className="truncate text-small text-text-muted">
                  {s.stack.layers.map((l) => titles.get(l.itemId) ?? "Missing MIDI").join(", ")}
                </span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => loadSaved(s.id)} aria-label={`Load ${s.name}`}>
                Load
              </Button>
              <IconButton icon={Trash} label={`Delete ${s.name}`} onClick={() => deleteSaved(s.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The stacked roll

type Colors = { bg: string; surface: string; border: string; strong: string; muted: string; accent: string; lanes: string[] };

function readColors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v("--color-bg"),
    surface: v("--color-surface"),
    border: v("--color-border"),
    strong: v("--color-border-strong"),
    muted: v("--color-text-muted"),
    accent: v("--color-accent"),
    lanes: LANE.map((l) => v(l.token)),
  };
}

const MAX_VISIBLE_BEATS = 32;
const TOP = 18;

function StackRoll({ stack, playing }: { stack: ResolvedStack; playing: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useRef({ beatW: 0, windowStart: 0 });

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let colors = readColors(box);
    let raf = 0;
    let w = 0;
    let h = 0;
    const L = stack.lengthBeats;
    const bpb = stack.beatsPerBar || 4;
    const visible = Math.min(L, Math.max(bpb, Math.floor(MAX_VISIBLE_BEATS / bpb) * bpb));
    // Rows per lane: the pitch span (shifted), or one row per drum sound.
    const lanes = stack.layers.map((l) => {
      const notes = l.item.notes.notes;
      if (l.drums) {
        const rows = [...new Set(notes.map((n) => n[2]))].sort((a, b) => b - a);
        return { l, rows: new Map(rows.map((p, i) => [p, i])), count: rows.length, hi: 0 };
      }
      const lo = l.item.notes.pitchMin + l.transpose - 1;
      const hi = Math.max(l.item.notes.pitchMax + l.transpose + 1, lo + 8);
      return { l, rows: null, count: hi - lo + 1, hi };
    });

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (L <= 0 || lanes.length === 0) return;
      const beat = player.getBeat();
      const live = playing || beat > 0;
      const windowStart = Math.floor(beat / visible) * visible;
      const beatW = w / visible;
      layout.current = { beatW, windowStart };
      const laneH = (h - TOP) / lanes.length;

      ctx.fillStyle = colors.surface;
      ctx.fillRect(0, TOP, w, h - TOP);
      lanes.forEach((_, i) => {
        if (i % 2) {
          ctx.fillStyle = colors.bg;
          ctx.fillRect(0, TOP + i * laneH, w, laneH);
        }
      });

      // Grid: beats faint, bars strong, bar numbers on top.
      for (let b = 0; b <= visible; b++) {
        const x = Math.round(b * beatW) + 0.5;
        const abs = windowStart + b;
        const isBar = Math.abs(abs % bpb) < 1e-6;
        ctx.strokeStyle = isBar ? colors.strong : colors.border;
        ctx.globalAlpha = isBar ? 0.7 : 0.6;
        ctx.beginPath();
        ctx.moveTo(x, TOP);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (isBar && b < visible) {
          ctx.fillStyle = colors.muted;
          ctx.font = "500 10px 'JetBrains Mono Variable', ui-monospace, monospace";
          ctx.textBaseline = "middle";
          ctx.fillText(String(Math.round(abs / bpb) + 1), x + 4, TOP / 2);
        }
      }
      ctx.strokeStyle = colors.border;
      for (let i = 1; i < lanes.length; i++) {
        const y = Math.round(TOP + i * laneH) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Notes, lane by lane, repeated to fill the loop.
      lanes.forEach(({ l, rows, count, hi }, li) => {
        const color = colors.lanes[l.index % colors.lanes.length] ?? colors.accent;
        const y0 = TOP + li * laneH + 3;
        const rowH = (laneH - 6) / count;
        const len = l.lengthBeats;
        for (let k = 0; k * len < L; k++) {
          const off = k * len;
          if (off > windowStart + visible || off + len < windowStart) continue;
          for (const [s, nl, pitch, vel] of l.item.notes.notes) {
            const at = off + s;
            if (at >= L || at + nl < windowStart || at > windowStart + visible) continue;
            const r = rows ? rows.get(pitch) : hi - (pitch + l.transpose);
            if (r === undefined || r < 0 || r >= count) continue;
            const end = l.drums ? at + Math.max(nl, 0.22) : at + nl;
            const on = live && beat >= at && beat < end;
            const x = (at - windowStart) * beatW;
            const nw = Math.max(l.drums ? Math.min(beatW * 0.2, 6) : 2, nl * beatW - 1);
            ctx.globalAlpha = (l.audible ? 1 : 0.3) * (on ? 1 : 0.45 + (vel / 127) * 0.55);
            ctx.fillStyle = on ? colors.accent : color;
            ctx.fillRect(x, y0 + r * rowH, nw, Math.max(1.5, rowH - 1));
          }
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.font = "600 10px 'JetBrains Mono Variable', ui-monospace, monospace";
        ctx.textBaseline = "top";
        const tag = `${li + 1} ${l.item.title}${l.transpose ? ` ${l.transpose > 0 ? "+" : "−"}${Math.abs(l.transpose)}` : ""}`;
        const tw = ctx.measureText(tag).width;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = colors.bg;
        ctx.fillRect(4, TOP + li * laneH + 3, tw + 8, 14);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillText(tag, 8, TOP + li * laneH + 5);
      });

      if (live) {
        const x = (beat - windowStart) * beatW;
        ctx.fillStyle = colors.accent;
        ctx.fillRect(Math.round(x) - 1, TOP, 2, h - TOP);
        ctx.beginPath();
        ctx.moveTo(x - 5, 0);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x, 8);
        ctx.closePath();
        ctx.fill();
      }
      if (playing) raf = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => {
      const r = box.getBoundingClientRect();
      w = r.width;
      h = r.height;
      cancelAnimationFrame(raf);
      draw();
    });
    ro.observe(box);
    const mo = new MutationObserver(() => {
      colors = readColors(box);
      cancelAnimationFrame(raf);
      draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-look"] });
    // A seek while paused moves the playhead: redraw on player changes.
    const unsub = player.subscribe(() => {
      cancelAnimationFrame(raf);
      draw();
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      unsub();
    };
  }, [stack, playing]);

  const label = `Stacked piano roll: ${stack.layers.map((l) => `${l.item.title}${l.transpose ? `, moved ${l.transpose > 0 ? "up" : "down"} ${Math.abs(l.transpose)}` : ""}`).join("; ")}`;
  return (
    <div
      ref={wrap}
      role="img"
      aria-label={label}
      data-stack-roll
      className={`relative cursor-pointer overflow-hidden rounded-control border border-border ${ROLL_HEIGHT[Math.min(stack.layers.length, 4)]}`}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const l = layout.current;
        if (l.beatW <= 0) return;
        player.seek(l.windowStart + (e.clientX - r.left) / l.beatW);
        if (!playing) void player.play();
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </div>
  );
}
