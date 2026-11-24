import { Button, Download, EmptyState, IconButton, PlayButton, SearchInput, Trash, UiLink, Upload, useToast } from "@stash/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, categoryOf, cleanName, decode, labelOf, play, useKits, type Category } from "../kits/store";
import { saveFiles } from "../save";
import { allShots, fileName, fileOf, peaksOf, postShots, removeShot, useMineVersion, type OneShot, type ShotDraft } from "./store";

/**
 * The One-shots tab: every single hit on Stash, sorted by type. Pick a type, run down the list with
 * the arrow keys hearing each one, grab the hit you want as a wav (or the whole type as a zip), and
 * drop your own hits in to post them.
 */

const AUDIO = /\.(wav|wave|mp3|aif|aiff|ogg|flac|m4a)$/i;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_LENGTH_MS = 15_000;
const MAX_ZIP = 60;

/** The order a producer reaches for them. */
const ORDER: Category[] = ["808", "kick", "snare", "clap", "hat", "open hat", "perc", "cymbal", "fx", "vox", "other"];

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** The hit's shape, drawn once its audio is ready. */
function Wave({ shot }: { shot: OneShot }) {
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
    <svg viewBox={`0 0 ${n * 2} 20`} preserveAspectRatio="none" aria-hidden="true" className="os-wave h-8 w-24 shrink-0 tablet:w-40">
      {peaks.map((p, i) => {
        const h = Math.max(1, Math.round(p * 18));
        return <rect key={i} x={i * 2} y={10 - h / 2} width={1.4} height={h} />;
      })}
    </svg>
  );
}

export function OneShotsPage() {
  const kits = useKits();
  const mineVersion = useMineVersion();
  const toast = useToast();
  const all = useMemo(() => {
    void mineVersion;
    return allShots(kits);
  }, [kits, mineVersion]);
  const [cat, setCat] = useState<Category | "all">("808");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  const needle = q.trim().toLowerCase();
  const matching = all.filter((s) => !needle || [s.name, s.owner.handle, s.owner.displayName, s.genre, s.kit?.name ?? "", labelOf(s.category)].some((x) => x.toLowerCase().includes(needle)));
  const shots = cat === "all" ? matching : matching.filter((s) => s.category === cat);
  const count = (c: Category) => matching.filter((s) => s.category === c).length;
  const types = ORDER.filter((c) => count(c) > 0);
  const current = shots[Math.min(selected, Math.max(0, shots.length - 1))];

  const grab = async (list: OneShot[], zipName: string) => {
    setBusy(zipName);
    try {
      const files: { name: string; data: Blob }[] = [];
      const used = new Set<string>();
      for (const s of list.slice(0, MAX_ZIP)) {
        const data = await fileOf(s);
        if (!data) continue;
        let name = fileName(s);
        for (let i = 2; used.has(name); i++) name = fileName(s).replace(/(\.\w+)$/, `_${i}$1`);
        used.add(name);
        files.push({ name, data });
      }
      if (files.length === 0) {
        toast({ tone: "error", title: "Nothing to save", description: "The audio for these hits isn't in this browser anymore." });
        return;
      }
      const outcome = await saveFiles(zipName, files);
      if (outcome === "saved") toast({ tone: "success", title: files.length === 1 ? "Saved" : `Saved ${files.length} hits`, description: files.length === 1 ? files[0]!.name : `${zipName}.zip` });
      else if (outcome === "failed") toast({ tone: "error", title: "Couldn't save", description: "Try again in a moment." });
    } finally {
      setBusy(null);
    }
  };

  const hear = (i: number) => {
    setSelected(i);
    const s = shots[i];
    if (s) void play(s);
  };

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
        void play(current);
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
      const first = drafts[0]!.category;
      setCat(drafts.every((d) => d.category === first) ? first : "all");
      setQ("");
      setSelected(0);
      toast({ tone: "success", title: n === 1 ? "Posted" : `Posted ${n} hits`, description: "They're at the top of the list, in this browser." });
    }
  };

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
          <span className="text-label text-label-caps text-text-muted">One-shots</span>
          <h1 className="text-title">Every hit, one tap away</h1>
          <p className="max-w-prose text-body text-text-muted">
            {`${all.length} single hits from every kit on Stash, sorted by type. Pick a type, run down the list with the arrow keys to hear each one, and grab the one that fits as a wav.`}
          </p>
        </div>
        <label className="os-upload inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-control bg-accent px-4 text-body-strong text-bg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
          <Upload className="size-4" aria-hidden="true" />
          Post your one-shots
          <input type="file" accept="audio/*,.wav,.mp3,.aif,.aiff,.flac,.ogg" multiple className="sr-only" onChange={(e) => void add([...(e.target.files ?? [])])} />
        </label>
      </header>

      <div role="group" aria-label="Sound type" className="os-types grid grid-cols-3 gap-2 tablet:grid-cols-5">
        {types.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={cat === c}
            data-cat={c.replace(" ", "-")}
            onClick={() => {
              setCat(c);
              setSelected(0);
            }}
            className="os-type flex flex-col items-start gap-1 rounded-control border border-border bg-surface p-3 text-left ui-hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-raised"
          >
            <span className="os-type-count font-mono text-title tabular text-text">{count(c)}</span>
            <span className="text-label text-label-caps text-text-muted">{CATEGORIES.find((x) => x.id === c)!.plural}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={cat === "all"}
          onClick={() => {
            setCat("all");
            setSelected(0);
          }}
          className="os-type flex flex-col items-start gap-1 rounded-control border border-border bg-surface p-3 text-left ui-hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-raised"
        >
          <span className="os-type-count font-mono text-title tabular text-text">{matching.length}</span>
          <span className="text-label text-label-caps text-text-muted">All</span>
        </button>
      </div>

      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <SearchInput
          label="Search hits, kits, producers"
          hideLabel
          placeholder="Search hits, kits, producers"
          shortcut=""
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSelected(0);
          }}
          onClear={() => setQ("")}
          className="tablet:w-80"
        />
        {shots.length > 1 && (
          <Button
            variant="secondary"
            icon={Download}
            loading={busy === "zip"}
            onClick={() => void grab(shots, cat === "all" ? "stash-one-shots" : `stash-${CATEGORIES.find((x) => x.id === cat)!.plural.toLowerCase().replace(/\s+/g, "-")}`)}
          >
            {shots.length > MAX_ZIP ? `Grab the first ${MAX_ZIP}` : `Grab all ${shots.length}`}
          </Button>
        )}
      </div>

      {shots.length > 0 ? (
        <div className="overflow-hidden rounded-panel border border-border bg-surface">
          <ul ref={listRef} aria-label="One-shots">
            {shots.map((s, i) => (
              <li
                key={s.id}
                data-selected={s === current || undefined}
                className="os-row flex min-h-16 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 data-selected:bg-raised ui-hover:bg-raised"
              >
                <PlayButton title={s.name} state="paused" onClick={() => hear(i)} />
                <button type="button" onClick={() => hear(i)} className="flex min-w-0 flex-1 flex-col text-left" aria-label={`Hear ${s.name}`}>
                  <span className="truncate text-body-strong text-text">{s.name}</span>
                  <span className="truncate text-small text-text-muted">
                    {s.mine && !s.kit ? "Posted from this browser" : `@${s.owner.handle} · ${s.genre}`}
                  </span>
                </button>
                <Wave shot={s} />
                <span className="hidden w-20 shrink-0 text-small text-text-muted desktop:block">{labelOf(s.category)}</span>
                <span className="hidden w-16 shrink-0 text-right font-mono text-numeric tabular text-text-muted tablet:block">{seconds(s.durationMs)}</span>
                {s.kit && (
                  <UiLink href={`/kit/${s.kit.id}`} className="hidden w-48 shrink-0 truncate text-small text-text-muted ui-hover:text-text desktop:block">
                    {s.kit.name}
                  </UiLink>
                )}
                {!s.kit && <span className="hidden w-48 shrink-0 desktop:block" />}
                <IconButton icon={Download} label={`Download ${s.name}`} size="md" disabled={busy !== null} onClick={() => void grab([s], fileName(s).replace(/\.\w+$/, ""))} />
                {s.mine && !s.kit && (
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
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState icon={Upload} title="No hits match">
          Clear the search, or drop your own one-shots on this page to post them.
        </EmptyState>
      )}

      {problems.length > 0 && (
        <ul role="alert" aria-label="Files left out" className="flex flex-col gap-1 rounded-panel border border-border bg-surface p-4 text-small text-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <section
        aria-label="Post your one-shots"
        data-over={over || undefined}
        className="flex flex-col items-center gap-2 rounded-panel border-2 border-dashed border-border-strong p-6 text-center data-over:border-accent data-over:bg-raised"
      >
        <Upload className="size-6 text-text-muted" aria-hidden="true" />
        <p className="text-body-strong text-text">Drop wav, mp3 or aiff hits anywhere on this page to post them</p>
        <p className="text-small text-text-muted">Each one is sorted by its file name (kick, 808, snare...). Up to 8 MB and 15 seconds each. In the demo they stay in this browser.</p>
      </section>

      <p className="text-small text-text-muted">Arrow keys move and play, Space plays again, D downloads the selected hit.</p>
    </main>
  );
}
