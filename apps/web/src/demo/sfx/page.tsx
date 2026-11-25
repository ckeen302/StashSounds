import { Button, Download, EmptyState, FilterChip, IconButton, PlayButton, Search, SearchInput, TagChip, useToast } from "@stash/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { CrateMenu } from "../explore";
import {
  categoryName, downloadSfx, fileName, haystack, licenseLabel, playSfx, position, SFX, SFX_CATEGORIES, sourceLine, stop, subName, usePlaying, warm, type Sfx,
} from "./library";

/**
 * The SFX tab: a deep library of sound effects, browsed by category and subcategory (Animals >
 * Big cats, Vehicles > Supercars, Phones and voicemail > Voicemail...). Every row plays on a tap,
 * shows its waveform (tap it to jump), and downloads as a wav with its license.
 */

const PAGE = 60;
const MAX_ZIP = 40;

type Sort = "featured" | "short" | "long";

function seconds(s: number): string {
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

/** The sound's shape; while it plays, the part already heard is lit. Tap it to play from there. */
function Wave({ s, playing, onSeek }: { s: Sfx; playing: boolean; onSeek: (fraction: number) => void }) {
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setDone(position() / s.duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, s.duration]);
  const n = s.peaks.length;
  const lit = playing ? Math.round(done * n) : 0;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      }}
      className="sfx-wave h-8 w-16 shrink-0 cursor-pointer tablet:h-10 tablet:w-28 desktop:w-56"
    >
      <svg viewBox={`0 0 ${n * 3} 24`} preserveAspectRatio="none" className="size-full">
        {s.peaks.map((p, i) => {
          const h = Math.max(1.5, p * 22);
          return <rect key={i} x={i * 3} y={12 - h / 2} width={2} height={h} data-lit={i < lit || undefined} />;
        })}
      </svg>
    </button>
  );
}

export function SfxPage() {
  const toast = useToast();
  const playing = usePlaying();
  const [cat, setCat] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("featured");
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => () => stop(), []);

  const needle = q.trim().toLowerCase();
  const words = needle.split(/\s+/).filter(Boolean);
  const matching = useMemo(() => SFX.filter((s) => words.every((w) => haystack(s).includes(w))), [needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const inCat = cat ? matching.filter((s) => s.cat === cat) : matching;
  const list = useMemo(() => {
    const l = sub ? inCat.filter((s) => s.sub === sub) : inCat;
    if (sort === "short") return [...l].sort((a, b) => a.duration - b.duration);
    if (sort === "long") return [...l].sort((a, b) => b.duration - a.duration);
    return l;
  }, [inCat, sub, sort]);
  const visible = list.slice(0, shown);
  const current = list[Math.min(selected, Math.max(0, list.length - 1))];

  const pick = (c: string | null, s: string | null = null) => {
    setCat(c);
    setSub(s);
    setShown(PAGE);
    setSelected(0);
  };

  const hear = (i: number, from = 0) => {
    setSelected(i);
    const s = list[i];
    if (s) void playSfx(s, from);
  };

  const grab = async (items: Sfx[], zipName: string, key: string) => {
    setBusy(key);
    try {
      const outcome = await downloadSfx(items.slice(0, MAX_ZIP), zipName);
      if (outcome === "saved")
        toast({ tone: "success", title: items.length === 1 ? "Saved" : `Saved ${Math.min(items.length, MAX_ZIP)} sounds`, description: items.length === 1 ? `${fileName(items[0]!)} with its license` : `${zipName}.zip` });
      else if (outcome === "failed" || outcome === "empty") toast({ tone: "error", title: "Couldn't save", description: "Try again in a moment." });
    } catch {
      toast({ tone: "error", title: "Couldn't save", description: "The sound didn't load. Check the connection and try again." });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"))) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = Math.max(0, Math.min(visible.length - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
        hear(n);
        listRef.current?.children[n]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === " " && current) {
        e.preventDefault();
        void playSfx(current);
      } else if ((e.key === "d" || e.key === "D") && current) {
        e.preventDefault();
        void grab([current], fileName(current).replace(/\.wav$/, ""), current.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const where = cat ? (sub ? `${categoryName(cat)} / ${subName(cat, sub)}` : categoryName(cat)) : needle ? "Everything" : "All sound effects";
  const catCount = (id: string) => matching.filter((s) => s.cat === id).length;
  const subCount = (id: string) => inCat.filter((s) => s.sub === id).length;
  const zipName = `stash-sfx-${(cat ?? "all") + (sub ? `-${sub}` : "")}`;

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-3 px-3 py-4 tablet:px-4 desktop:px-6">
      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <h1 className="text-title">Sound effects</h1>
        <SearchInput
          label="Search sound effects"
          hideLabel
          placeholder="Search: lion, siren, voicemail, lambo..."
          shortcut=""
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShown(PAGE);
            setSelected(0);
          }}
          onClear={() => setQ("")}
          className="tablet:w-96"
        />
      </div>

      <div className="flex flex-col gap-2">
        <nav aria-label="SFX categories" className="-mx-3 flex gap-2 overflow-x-auto px-3 tablet:mx-0 tablet:flex-wrap tablet:px-0">
          <FilterChip selected={cat === null} onToggle={() => pick(null)}>
            {`All · ${matching.length}`}
          </FilterChip>
          {SFX_CATEGORIES.filter((c) => catCount(c.id) > 0).map((c) => (
            <FilterChip key={c.id} selected={cat === c.id} onToggle={() => pick(c.id)}>
              {`${c.name} · ${catCount(c.id)}`}
            </FilterChip>
          ))}
        </nav>
        {cat && (
          <div role="group" aria-label={`${categoryName(cat)} subcategories`} className="-mx-3 flex gap-2 overflow-x-auto px-3 tablet:mx-0 tablet:flex-wrap tablet:px-0">
            <FilterChip selected={sub === null} onToggle={() => pick(cat)}>
              {`All ${categoryName(cat).toLowerCase()}`}
            </FilterChip>
            {SFX_CATEGORIES.find((c) => c.id === cat)!
              .subs.filter((s) => subCount(s.id) > 0)
              .map((s) => (
                <FilterChip key={s.id} selected={sub === s.id} onToggle={() => pick(cat, s.id)}>
                  {`${s.name} · ${subCount(s.id)}`}
                </FilterChip>
              ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-small text-text-muted">{`${where} · ${list.length} ${list.length === 1 ? "sound" : "sounds"}`}</span>
        <div className="flex items-center gap-2">
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-8 rounded-control border border-border-strong bg-bg px-2 text-small text-text"
          >
            <option value="featured">Featured</option>
            <option value="short">Shortest</option>
            <option value="long">Longest</option>
          </select>
          {list.length > 1 && (cat || needle) && (
            <Button variant="secondary" size="sm" icon={Download} loading={busy === "zip"} disabled={busy !== null && busy !== "zip"} onClick={() => void grab(list, zipName, "zip")}>
              {list.length > MAX_ZIP ? `Grab ${MAX_ZIP}` : `Grab all`}
            </Button>
          )}
        </div>
      </div>

      {list.length > 0 ? (
        <div className="overflow-hidden rounded-panel border border-border bg-surface">
          <ul ref={listRef} aria-label="Sound effects">
            {visible.map((s, i) => {
              const isPlaying = playing.id === s.id;
              const state = playing.loading === s.id ? "loading" : isPlaying ? "playing" : playing.error === s.id ? "error" : "paused";
              return (
                <li
                  key={s.id}
                  data-selected={s === current || undefined}
                  data-playing={isPlaying || undefined}
                  onPointerEnter={() => warm(s)}
                  className="sfx-row flex min-h-16 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 data-selected:bg-raised ui-hover:bg-raised"
                >
                  <PlayButton title={s.name} state={state} onPointerDown={(e) => e.button === 0 && hear(i)} onClick={(e) => e.detail === 0 && hear(i)} />
                  <button type="button" onClick={() => hear(i)} className="flex min-w-0 flex-1 flex-col text-left" aria-label={`Hear ${s.name}`}>
                    <span className="truncate text-body-strong text-text">{s.name}</span>
                    <span className="truncate text-small text-text-muted">
                      {`${cat && sub ? "" : `${subName(s.cat, s.sub)} · `}${sourceLine(s)} · ${licenseLabel(s)}`}
                    </span>
                  </button>
                  <span className="hidden w-48 shrink-0 flex-wrap gap-1 overflow-hidden desktop:flex" aria-label="Tags">
                    {s.tags.slice(0, 2).map((t) => (
                      <TagChip key={t} onClick={() => setQ(t)}>
                        {t}
                      </TagChip>
                    ))}
                  </span>
                  <Wave s={s} playing={isPlaying} onSeek={(f) => hear(i, f * s.duration)} />
                  <span className="hidden w-14 shrink-0 text-right font-mono text-numeric tabular text-text-muted tablet:block">{seconds(s.duration)}</span>
                  {s.source.kind === "recording" ? (
                    <a
                      href={s.source.page}
                      target="_blank"
                      rel="noreferrer"
                      className="hidden w-14 shrink-0 text-small text-text-muted underline ui-hover:text-text desktop:block"
                      aria-label={`Source of ${s.name} on Wikimedia Commons`}
                    >
                      Source
                    </a>
                  ) : (
                    <span className="hidden w-14 shrink-0 desktop:block" />
                  )}
                  <IconButton icon={Download} label={`Download ${s.name}`} size="md" disabled={busy !== null} onClick={() => void grab([s], fileName(s).replace(/\.wav$/, ""), s.id)} />
                  <CrateMenu itemId={`sfx:${s.id}`} title={s.name} kind="Sound effect" href="/sfx" size="sm" />
                </li>
              );
            })}
          </ul>
          {list.length > shown && (
            <div className="flex justify-center border-t border-border p-3">
              <Button variant="ghost" onClick={() => setShown((n) => n + PAGE)}>{`Show more (${list.length - shown} left)`}</Button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState icon={Search} title="No sound effects match">
          Try a simpler word, like roar, siren, phone or boom, or pick a category above.
        </EmptyState>
      )}

      <p className="text-small text-text-muted">
        {
          "Free to use in your music: Stash originals and public-domain or CC0 recordings. Each download includes its license. Keys: arrows play, D downloads."
        }
      </p>
    </main>
  );
}
