import { DawDragZone } from "../daw-drag";
import { melodicSource } from "../daw-sources";
import { Button, Download, EmptyState, IconButton, PlayButton, SearchInput, Trash, Upload, useToast } from "@stash/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { CrateMenu } from "../explore";
import { categoryOf, cleanName, decode } from "../kits/store";
import { fileName, INSTRUMENTS, instrumentOf, MELODIC, mineAsMelodic, NOTE_NAMES, peaksOf, playShot, saveMelodic, warmShots, type InstrumentId, type MelodicShot } from "./melodic";
import { postShots, removeShot, useMineVersion, type ShotDraft } from "./store";

/**
 * The One-shots tab: melodic one-shots. Single notes and chords from keys, bells, plucks, pads,
 * leads, guitars, 808s and more, in every key, so a melody or a chord stab needs no heavy synth.
 * Pick an instrument, narrow to a key or to chords, run down the list with the arrow keys hearing
 * each one, and grab the one you want as a wav. Drum hits live in Drum kits.
 */

const AUDIO = /\.(wav|wave|mp3|aif|aiff|ogg|flac|m4a)$/i;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_LENGTH_MS = 15_000;
const MAX_ZIP = 60;

type Kind = "all" | "note" | "chord";
const KINDS: { id: Kind; label: string }[] = [
  { id: "all", label: "Notes and chords" },
  { id: "note", label: "Notes" },
  { id: "chord", label: "Chords" },
];

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** The shot's shape, drawn once its audio is ready. */
function Wave({ shot }: { shot: MelodicShot }) {
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    let live = true;
    void peaksOf(shot).then((p) => live && setPeaks(p));
    return () => {
      live = false;
    };
  }, [shot]);
  const n = peaks.length || 40;
  return (
    <svg viewBox={`0 0 ${n * 2} 20`} preserveAspectRatio="none" aria-hidden="true" className="os-wave hidden h-8 w-24 shrink-0 tablet:block tablet:w-40">
      {peaks.map((p, i) => {
        const h = Math.max(1, Math.round(p * 18));
        return <rect key={i} x={i * 2} y={10 - h / 2} width={1.4} height={h} />;
      })}
    </svg>
  );
}

const PILL = "os-key inline-flex h-9 shrink-0 items-center justify-center rounded-control border border-border bg-surface px-3 text-small text-text-muted ui-hover:border-border-strong ui-hover:text-text aria-pressed:border-accent aria-pressed:bg-raised aria-pressed:text-text";

export function OneShotsPage() {
  const mineVersion = useMineVersion();
  const toast = useToast();
  const all = useMemo(() => {
    void mineVersion;
    return [...mineAsMelodic(), ...MELODIC];
  }, [mineVersion]);
  const [inst, setInst] = useState<InstrumentId | "all">("keys");
  const [root, setRoot] = useState<number | "all">("all");
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  const needle = q.trim().toLowerCase();
  const matching = all.filter(
    (s) =>
      (!needle || [s.name, s.label, s.spoken, instrumentOf(s.instrument).label].some((x) => x.toLowerCase().includes(needle))) &&
      (root === "all" || s.root === root) &&
      (kind === "all" || s.kind === kind),
  );
  const shots = inst === "all" ? matching : matching.filter((s) => s.instrument === inst);
  const count = (i: InstrumentId) => matching.filter((s) => s.instrument === i).length;
  const current = shots[Math.min(selected, Math.max(0, shots.length - 1))];
  const reset = () => setSelected(0);

  const grab = async (list: MelodicShot[], zipName: string) => {
    setBusy(zipName);
    try {
      const { outcome, names } = await saveMelodic(list.slice(0, MAX_ZIP), zipName);
      if (outcome === "empty") {
        toast({ tone: "error", title: "Nothing to save", description: "The audio for these sounds isn't in this browser anymore." });
        return;
      }
      if (outcome === "saved") toast({ tone: "success", title: names.length === 1 ? "Saved" : `Saved ${names.length} one-shots`, description: names.length === 1 ? names[0]! : `${zipName}.zip` });
      else if (outcome === "failed") toast({ tone: "error", title: "Couldn't save", description: "Try again in a moment." });
    } finally {
      setBusy(null);
    }
  };

  const hear = (i: number) => {
    setSelected(i);
    const s = shots[i];
    if (s) void playShot(s);
    // Render the neighbours now, so arrowing to them plays without a wait.
    warmShots([shots[i + 1], shots[i - 1]].filter((x): x is MelodicShot => !!x));
  };
  // The first rows of whatever is showing are ready before the first tap.
  useEffect(() => {
    warmShots(shots.slice(0, 4));
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = Math.max(0, Math.min(shots.length - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
        hear(n);
        listRef.current?.children[n]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === " " && current) {
        e.preventDefault();
        void playShot(current);
      } else if ((e.key === "d" || e.key === "D") && current) {
        e.preventDefault();
        void grab([current], fileName(current).replace(/\.\w+$/, ""));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const add = async (files: File[]) => {
    const bad: string[] = [];
    const drafts: ShotDraft[] = [];
    for (const f of files) {
      if (!AUDIO.test(f.name)) {
        if (!f.name.startsWith(".")) bad.push(`${f.name}: not an audio file (wav, mp3, aiff, ogg, flac)`);
        continue;
      }
      if (f.size > MAX_FILE) {
        bad.push(`${f.name}: over 8 MB; a one-shot should be much smaller`);
        continue;
      }
      try {
        const data = await f.arrayBuffer();
        const buf = await decode(data);
        if (buf.duration * 1000 > MAX_LENGTH_MS) {
          bad.push(`${f.name}: ${buf.duration.toFixed(0)} seconds long; that's a loop, post it on the upload page`);
          continue;
        }
        drafts.push({ name: cleanName(f.name), category: categoryOf(f.name), durationMs: Math.round(buf.duration * 1000), data, ext: (/\.(\w+)$/.exec(f.name)?.[1] ?? "wav").toLowerCase() });
      } catch {
        bad.push(`${f.name}: the browser couldn't read this audio`);
      }
    }
    setProblems(bad);
    if (drafts.length) {
      const n = await postShots(drafts);
      setInst("all");
      setRoot("all");
      setKind("all");
      setQ("");
      setSelected(0);
      toast({ tone: "success", title: n === 1 ? "Posted" : `Posted ${n} one-shots`, description: "They're at the top of the list, in this browser." });
    }
  };

  const instName = inst === "all" ? "one-shots" : instrumentOf(inst).label.toLowerCase();

  return (
    <main
      className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void add([...e.dataTransfer.files]);
      }}
    >
      <header className="flex flex-col gap-4 tablet:flex-row tablet:items-end tablet:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-title">One-shots</h1>
          <p className="text-body text-text-muted">{`Single notes and chords from keys, bells, plucks, pads, leads, guitars and 808s, in all 12 keys. Drop them in your sampler and play a melody without loading a heavy synth. ${MELODIC.length} sounds.`}</p>
        </div>
        <label className="os-upload st-wide-only inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-control bg-accent px-4 text-body-strong text-bg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
          <Upload className="size-4" aria-hidden="true" />
          Post your one-shots
          <input type="file" accept="audio/*,.wav,.mp3,.aif,.aiff,.flac,.ogg" multiple className="sr-only" onChange={(e) => void add([...(e.target.files ?? [])])} />
        </label>
      </header>

      <div role="group" aria-label="Instrument" className="os-types -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:grid tablet:grid-cols-5 tablet:overflow-visible tablet:px-0 tablet:pb-0 desktop:grid-cols-8">
        {INSTRUMENTS.map((i) => (
          <button
            key={i.id}
            type="button"
            aria-pressed={inst === i.id}
            data-cat={i.id}
            onClick={() => {
              setInst(i.id);
              reset();
            }}
            className="os-type flex w-24 shrink-0 flex-col items-start gap-1 rounded-control border border-border bg-surface p-3 text-left tablet:w-auto ui-hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-raised"
          >
            <span className="os-type-count font-mono text-title tabular text-text">{count(i.id)}</span>
            <span className="text-label text-label-caps text-text-muted">{i.label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={inst === "all"}
          onClick={() => {
            setInst("all");
            reset();
          }}
          className="os-type flex w-24 shrink-0 flex-col items-start gap-1 rounded-control border border-border bg-surface p-3 text-left tablet:w-auto ui-hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-raised"
        >
          <span className="os-type-count font-mono text-title tabular text-text">{matching.length}</span>
          <span className="text-label text-label-caps text-text-muted">All</span>
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Key" className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:flex-wrap tablet:overflow-visible tablet:px-0">
          <button type="button" aria-pressed={root === "all"} className={PILL} onClick={() => {
            setRoot("all");
            reset();
          }}>
            Any key
          </button>
          {NOTE_NAMES.map((n, r) => (
            <button key={n} type="button" aria-pressed={root === r} className={`${PILL} font-mono`} onClick={() => {
            setRoot(r);
            reset();
          }} aria-label={n.length > 1 ? `${n[0]} sharp` : n}>
              {n}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
          <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center">
            <div role="group" aria-label="Notes or chords" className="flex gap-1">
              {KINDS.map((k) => (
                <button key={k.id} type="button" aria-pressed={kind === k.id} className={PILL} onClick={() => {
            setKind(k.id);
            reset();
          }}>
                  {k.label}
                </button>
              ))}
            </div>
            <SearchInput
              label="Search one-shots"
              hideLabel
              placeholder="Search: rhodes, F#m7, bell..."
              shortcut=""
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                reset();
              }}
              onClear={() => setQ("")}
              className="tablet:w-72"
            />
          </div>
          {shots.length > 1 && (
            <Button variant="secondary" icon={Download} loading={busy === "zip"} onClick={() => void grab(shots, `stash-${instName.replace(/\s+/g, "-")}`)}>
              {shots.length > MAX_ZIP ? `Grab the first ${MAX_ZIP}` : `Grab all ${shots.length}`}
            </Button>
          )}
        </div>
      </div>

      {shots.length > 0 ? (
        <DawDragZone sources={shots.map(melodicSource)} className="overflow-hidden rounded-panel border border-border bg-surface">
          <ul ref={listRef} aria-label="One-shots">
            {shots.map((s, i) => {
              const ins = instrumentOf(s.instrument);
              return (
                <li key={s.id} data-selected={s === current || undefined} className="os-row flex min-h-16 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 data-selected:bg-raised ui-hover:bg-raised">
                  <PlayButton title={s.name} state="paused" onPointerDown={(e) => e.button === 0 && hear(i)} onClick={(e) => e.detail === 0 && hear(i)} />
                  <button type="button" onClick={() => hear(i)} className="flex min-w-0 flex-1 flex-col text-left" aria-label={`Hear ${s.name}${s.spoken ? `, ${s.spoken}` : ""}`}>
                    <span className="truncate text-body-strong text-text">{s.name}</span>
                    <span className="truncate text-small text-text-muted">{s.mine ? `${ins.label} · posted from this browser` : `${ins.label} · ${s.kind === "chord" ? `Chord, ${s.pitches.length} notes` : "Single note"}`}</span>
                  </button>
                  {s.label && <span className="os-key inline-flex h-7 shrink-0 items-center justify-center rounded-control border border-border-strong px-2 font-mono text-small text-text">{s.label}</span>}
                  <Wave shot={s} />
                  <span className="hidden w-14 shrink-0 text-right font-mono text-numeric tabular text-text-muted desktop:block">{seconds(s.durationMs)}</span>
                  <IconButton icon={Download} label={`Download ${s.name}`} size="md" disabled={busy !== null} onClick={() => void grab([s], fileName(s).replace(/\.\w+$/, ""))} />
                  <CrateMenu itemId={`oneshot:${s.id}`} title={s.name} kind="One-shot" href="/one-shots" size="sm" />
                  {s.mine && (
                    <IconButton
                      icon={Trash}
                      label={`Remove ${s.name}`}
                      size="md"
                      onClick={() => {
                        removeShot(s.id);
                        toast({ tone: "success", title: "Removed", description: `${s.name} is gone from this browser.` });
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </DawDragZone>
      ) : (
        <EmptyState icon={Upload} title="Nothing matches">
          Try another key, clear the search, or drop your own one-shots on this page to post them.
        </EmptyState>
      )}

      {problems.length > 0 && (
        <ul role="alert" aria-label="Files left out" className="flex flex-col gap-1 rounded-panel border border-border bg-surface p-4 text-small text-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <section aria-label="Post your one-shots" data-over={over || undefined} className="flex flex-col items-center gap-2 rounded-panel border-2 border-dashed border-border-strong p-6 text-center data-over:border-accent data-over:bg-raised">
        <Upload className="size-6 text-text-muted" aria-hidden="true" />
        <p className="text-body-strong text-text">Drop wav, mp3 or aiff one-shots anywhere on this page to post them</p>
        <p className="text-small text-text-muted">Name them with the instrument and note, like Bell_F#4 or Rhodes Cm7, and they get sorted for you. Up to 8 MB and 15 seconds each. In the demo they stay in this browser. Drum hits go in a drum kit.</p>
      </section>

      <p className="text-small text-text-muted">Arrow keys move and play, Space plays again, D downloads the selected sound.</p>
    </main>
  );
}
