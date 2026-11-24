import { getEngine, usePlayerState } from "@stash/audio";
import type { ItemRow, MusicalKey } from "@stash/contracts";
import { formatKey } from "@stash/contracts/format";
import {
  Avatar,
  Button,
  ButtonLink,
  Download,
  Ellipsis,
  FilterChip,
  formatCount,
  Heart,
  IconButton,
  Menu,
  PlayButton,
  SearchInput,
  TagChip,
  UiLink,
  useToast,
  Waveform,
  type PlayState,
} from "@stash/ui";
import { useEffect, useMemo, useState } from "react";
import { nowPlaying } from "../app/_shell/now-playing";
import type { Catalog } from "./data";
import { GENRES, useCrateEntries } from "./explore";
import { Dropdown } from "./presets/page";
import { set } from "./store";

/**
 * The Loops tab as a loop library reads: a search bar with dropdown filters and date presets, then
 * one stacked row per loop (who posted it and when, a player, a tag line you can click to filter,
 * the description, download) and numbered pages of 25.
 */

const PER_PAGE = 25;

// What the loop is, read from its tags and title, the way a library files loops by instrument.
const CATEGORIES: [string, RegExp][] = [
  ["Piano", /piano/i],
  ["Keys", /keys|rhodes|organ/i],
  ["Cowbell", /cowbell/i],
  ["Bells", /bell/i],
  ["Pad", /pad|chords/i],
  ["Strings", /string/i],
  ["Guitar", /guitar|arp/i],
  ["Lead", /lead|whistle|stab/i],
  ["808", /808|bass/i],
  ["Drums", /drum|bounce|hat/i],
];
function categoryOf(row: ItemRow): string {
  const text = [row.title, ...row.tags].join(" ");
  return CATEGORIES.find(([, re]) => re.test(text))?.[0] ?? "Other";
}

const TEMPOS: { id: string; label: string; min: number; max: number }[] = [
  { id: "any", label: "Any", min: 0, max: 999 },
  { id: "slow", label: "Under 90", min: 0, max: 89 },
  { id: "mid", label: "90 to 119", min: 90, max: 119 },
  { id: "up", label: "120 to 139", min: 120, max: 139 },
  { id: "fast", label: "140 to 159", min: 140, max: 159 },
  { id: "faster", label: "160 and up", min: 160, max: 999 },
];

const SORTS: Record<
  string,
  { label: string; by: (a: Loop, b: Loop) => number }
> = {
  newest: {
    label: "Newest",
    by: (a, b) => b.row.publishedAt.localeCompare(a.row.publishedAt),
  },
  oldest: {
    label: "Oldest",
    by: (a, b) => a.row.publishedAt.localeCompare(b.row.publishedAt),
  },
  downloads: {
    label: "Most downloaded",
    by: (a, b) => b.row.downloadsCount - a.row.downloadsCount,
  },
  likes: {
    label: "Most liked",
    by: (a, b) => b.row.likesCount - a.row.likesCount,
  },
  slow: {
    label: "BPM, slowest first",
    by: (a, b) => (a.row.bpm ?? 0) - (b.row.bpm ?? 0),
  },
  fast: {
    label: "BPM, fastest first",
    by: (a, b) => (b.row.bpm ?? 0) - (a.row.bpm ?? 0),
  },
  title: {
    label: "Title A to Z",
    by: (a, b) => a.row.title.localeCompare(b.row.title),
  },
};

const WHEN: { id: string; label: string; hours: number }[] = [
  { id: "all", label: "Any time", hours: Infinity },
  { id: "24", label: "Last 24 hours", hours: 24 },
  { id: "48", label: "Last 48 hours", hours: 48 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 days", hours: 24 * 30 },
];

type Loop = {
  row: ItemRow;
  genre: string;
  category: string;
  description: string;
  keyId: string | null;
};
type Filters = {
  q: string;
  genre: string;
  category: string;
  key: string;
  tempo: string;
  bpm: number | null;
  when: string;
  sort: string;
  page: number;
};
const DEFAULT: Filters = {
  q: "",
  genre: "all",
  category: "all",
  key: "all",
  tempo: "any",
  bpm: null,
  when: "all",
  sort: "newest",
  page: 1,
};
// Filters survive leaving the tab and coming back, for this visit.
let saved: Filters = DEFAULT;

const keyId = (k: MusicalKey) => `${k.root}${k.mode}`;
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function postedText(iso: string, now: number): string {
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const mins = Math.max(0, Math.round((now - d.getTime()) / 60_000));
  const ago =
    mins < 60
      ? `${mins} ${mins === 1 ? "minute" : "minutes"} ago`
      : mins < 60 * 24
        ? `${Math.round(mins / 60)} ${Math.round(mins / 60) === 1 ? "hour" : "hours"} ago`
        : `${Math.round(mins / 1440)} ${Math.round(mins / 1440) === 1 ? "day" : "days"} ago`;
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${time} · ${ago}`;
}

const seconds = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}`;

export function LoopsPage({
  catalog,
  rows,
  onChange,
}: {
  catalog: Catalog;
  rows: ItemRow[];
  onChange: () => void;
}) {
  const loops = useMemo<Loop[]>(
    () =>
      rows
        .filter((r) => r.type === "loop")
        .map((row) => {
          const item = catalog.page(row.publicId)?.item;
          return {
            row,
            genre: item?.genre ?? "",
            category: categoryOf(row),
            description: (item?.description ?? "").replace(
              / Demo data:.*$/,
              "",
            ),
            keyId: row.key ? keyId(row.key) : null,
          };
        }),
    [catalog, rows],
  );
  // The demo's loops were posted on set dates: read "how long ago" from just after the newest one,
  // so the date presets keep meaning something whenever the demo is opened.
  const [now] = useState(() => {
    const newest = Math.max(...loops.map((l) => Date.parse(l.row.publishedAt)));
    return Math.min(Date.now(), newest + 6 * 3_600_000);
  });

  const [f, setF] = useState<Filters>(saved);
  const update = (patch: Partial<Filters>) =>
    setF((cur) => {
      saved = { ...cur, page: 1, ...patch };
      return saved;
    });

  const genres = useMemo(
    () =>
      [...new Set(loops.map((l) => l.genre))].sort(
        (a, b) =>
          GENRES.findIndex((g) => g.name === a) -
          GENRES.findIndex((g) => g.name === b),
      ),
    [loops],
  );
  const categories = CATEGORIES.map(([n]) => n).filter((n) =>
    loops.some((l) => l.category === n),
  );
  const keys = useMemo(() => {
    const seen = new Map<string, MusicalKey>();
    for (const l of loops) if (l.row.key) seen.set(keyId(l.row.key), l.row.key);
    return [...seen.values()].sort(
      (a, b) => a.mode.localeCompare(b.mode) || a.root - b.root,
    );
  }, [loops]);

  const tempo = TEMPOS.find((t) => t.id === f.tempo) ?? TEMPOS[0]!;
  const hours = WHEN.find((w) => w.id === f.when)?.hours ?? Infinity;
  const q = f.q.trim().toLowerCase();
  const shown = loops
    .filter((l) => f.genre === "all" || l.genre === f.genre)
    .filter((l) => f.category === "all" || l.category === f.category)
    .filter((l) => f.key === "all" || l.keyId === f.key)
    .filter((l) =>
      f.bpm !== null
        ? l.row.bpm === f.bpm
        : l.row.bpm === null ||
          (l.row.bpm >= tempo.min && l.row.bpm <= tempo.max),
    )
    .filter((l) => now - Date.parse(l.row.publishedAt) <= hours * 3_600_000)
    .filter(
      (l) =>
        !q ||
        [
          l.row.title,
          l.row.owner.handle,
          l.row.owner.displayName,
          l.genre,
          l.category,
          l.description,
          ...l.row.tags,
        ].some((s) => s.toLowerCase().includes(q)),
    )
    .sort(SORTS[f.sort]!.by);

  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const page = Math.min(f.page, pages);
  const from = (page - 1) * PER_PAGE;
  const onPage = shown.slice(from, from + PER_PAGE);
  const queue = onPage.map((l) => l.row);
  const touched = JSON.stringify({ ...f, page: 1 }) !== JSON.stringify(DEFAULT);

  const engine = getEngine();
  useEffect(() => {
    for (const r of queue) engine.preload(r.playable);
  }, [engine, queue]);

  const goTo = (p: number) => {
    update({ page: p });
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-4 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-label text-label-caps text-text-muted">
            Loops
          </span>
          <h1 className="text-title">Free loops from producers</h1>
        </div>
        <ButtonLink href="/upload" variant="secondary" size="sm">
          Upload a loop
        </ButtonLink>
      </header>

      <section
        aria-label="Search loops"
        className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-3"
      >
        <SearchInput
          label="Search loops by title, producer, tag or description"
          hideLabel
          placeholder="Search loops"
          shortcut=""
          value={f.q}
          onChange={(e) => update({ q: e.target.value })}
          onClear={() => update({ q: "" })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            name="Category"
            value={f.category === "all" ? "Any" : f.category}
            selected={f.category}
            options={[
              ["all", "Any"],
              ...categories.map((c): [string, string] => [
                c,
                `${c} ${loops.filter((l) => l.category === c).length}`,
              ]),
            ]}
            onPick={(v) => update({ category: v })}
          />
          <Dropdown
            name="Genre"
            value={f.genre === "all" ? "Any" : f.genre}
            selected={f.genre}
            options={[
              ["all", "Any"],
              ...genres.map((g): [string, string] => [
                g,
                `${g} ${loops.filter((l) => l.genre === g).length}`,
              ]),
            ]}
            onPick={(v) => update({ genre: v })}
          />
          <Dropdown
            name="Key"
            value={
              f.key === "all"
                ? "Any"
                : formatKey(keys.find((k) => keyId(k) === f.key)!)
            }
            selected={f.key}
            options={[
              ["all", "Any"],
              ...keys.map((k): [string, string] => [keyId(k), formatKey(k)]),
            ]}
            onPick={(v) => update({ key: v })}
          />
          <Dropdown
            name="BPM"
            value={
              f.bpm !== null
                ? String(f.bpm)
                : tempo.id === "any"
                  ? "Any"
                  : tempo.label
            }
            selected={f.bpm !== null ? "" : f.tempo}
            options={TEMPOS.map((t): [string, string] => [t.id, t.label])}
            onPick={(v) => update({ tempo: v, bpm: null })}
          />
          <Dropdown
            name="Sort"
            active={false}
            value={SORTS[f.sort]!.label}
            selected={f.sort}
            options={Object.entries(SORTS).map(([id, s]): [string, string] => [
              id,
              s.label,
            ])}
            onPick={(v) => update({ sort: v })}
          />
          {touched && (
            <Button size="sm" variant="ghost" onClick={() => update(DEFAULT)}>
              Clear
            </Button>
          )}
        </div>
        <div
          role="group"
          aria-label="Posted"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-label text-label-caps text-text-muted">
            Quick search
          </span>
          {WHEN.map((w) => (
            <FilterChip
              key={w.id}
              selected={f.when === w.id}
              onToggle={() => update({ when: w.id })}
            >
              {w.label}
            </FilterChip>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          aria-live="polite"
          className="font-mono text-numeric tabular text-text-muted"
        >
          {shown.length === 0
            ? "No loops"
            : `Loops ${from + 1} - ${from + onPage.length} of ${shown.length}`}
        </span>
        <Pager page={page} pages={pages} onPage={goTo} />
      </div>

      {shown.length > 0 ? (
        <ul
          aria-label="Loops"
          className="flex flex-col overflow-hidden rounded-panel border border-border bg-surface"
        >
          {onPage.map((l, i) => (
            <LoopEntry
              key={l.row.id}
              loop={l}
              now={now}
              onPlay={() => void nowPlaying().playFrom(engine, queue, i)}
              onFilter={(patch) => update(patch)}
              onChange={onChange}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-panel border border-border bg-surface p-4">
          <p className="text-body text-text-muted">
            No loops match all of that. Try another tempo or clear the filters.
          </p>
          <Button size="sm" variant="secondary" onClick={() => update(DEFAULT)}>
            Clear filters
          </Button>
        </div>
      )}

      {pages > 1 && (
        <div className="flex justify-center">
          <Pager page={page} pages={pages} onPage={goTo} />
        </div>
      )}
    </main>
  );
}

function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center gap-1">
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <Button
          key={p}
          size="sm"
          variant={p === page ? "primary" : "ghost"}
          aria-current={p === page ? "page" : undefined}
          onClick={() => onPage(p)}
        >
          {String(p)}
        </Button>
      ))}
      {page < pages && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Next page"
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      )}
    </nav>
  );
}

/** One loop: who and when, the player, a tag line that filters, the description and the actions. */
function LoopEntry({
  loop,
  now,
  onPlay,
  onFilter,
  onChange,
}: {
  loop: Loop;
  now: number;
  onPlay: () => void;
  onFilter: (patch: Partial<Filters>) => void;
  onChange: () => void;
}) {
  const { row } = loop;
  const engine = getEngine();
  const toast = useToast();
  const status = usePlayerState((s) => s.status);
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  const mine = currentId === row.playable.id;
  const state: PlayState = !mine || status === "idle" ? "paused" : status;
  const liked = row.viewer?.liked ?? false;
  const crate = useCrateEntries(row.id, row.title);
  const [saving, setSaving] = useState(false);
  const bars = row.length?.unit === "bars" ? row.length.value : null;
  const label = [
    `Loop`,
    bars ? `${bars} bars` : null,
    row.bpm ? `${row.bpm} BPM` : null,
    row.key ? formatKey(row.key) : null,
  ]
    .filter(Boolean)
    .join(", ");

  const download = async () => {
    if (!("previewUrl" in row.playable)) return;
    setSaving(true);
    try {
      const res = await fetch(row.playable.previewUrl);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.title}${row.bpm ? ` ${row.bpm}bpm` : ""}${row.key ? ` ${formatKey(row.key)}` : ""}.mp3`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast({
        tone: "success",
        title: "Downloaded",
        description: `${row.title}. Open it to chop, reverse or pitch it first.`,
      });
    } catch {
      toast({
        tone: "error",
        title: "The download did not start",
        description: "Try again in a moment.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      data-playing={state === "playing" || undefined}
      className={`flex flex-col gap-3 border-b border-border p-3 last:border-b-0 tablet:p-4 ${state === "playing" ? "bg-raised" : ""}`}
    >
      <div className="flex items-start gap-3">
        <UiLink
          href={`/u/${row.owner.handle}`}
          aria-label={`${row.owner.displayName}'s profile`}
          className="shrink-0 rounded-full"
        >
          <Avatar
            name={row.owner.displayName}
            src={row.owner.avatarUrl}
            size={32}
          />
        </UiLink>
        <div className="flex min-w-0 flex-1 flex-col">
          <UiLink
            href={row.href}
            className="truncate text-body-strong text-text ui-hover:underline"
          >
            {row.title}
          </UiLink>
          <span className="text-small text-text-muted">
            {"by "}
            <UiLink
              href={`/u/${row.owner.handle}`}
              className="text-text ui-hover:underline"
            >
              {row.owner.handle}
            </UiLink>
            {` · ${postedText(row.publishedAt, now)}`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 font-mono text-numeric tabular text-text-muted">
          <span title="Downloads" className="flex items-center gap-1">
            <span className="sr-only">Downloads </span>
            <span aria-hidden="true">↓</span>
            {formatCount(row.downloadsCount)}
          </span>
          <span title="Likes" className="flex items-center gap-1">
            <span className="sr-only">Likes </span>
            <span aria-hidden="true">♥</span>
            {formatCount(row.likesCount)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <PlayButton title={row.title} state={state} onClick={onPlay} />
        <div data-loop-wave className="min-w-0 flex-1">
          <Waveform
            peaks={row.peaks}
            type="loop"
            label={label}
            durationMs={row.durationMs}
            playing={mine && status === "playing"}
            getProgress={() =>
              mine && row.durationMs
                ? engine.getPositionMs() / row.durationMs
                : 0
            }
            onScrub={(fr) => {
              if (mine) engine.seek(fr * (row.durationMs ?? 0));
              else onPlay();
            }}
            className="h-10 w-full"
          />
        </div>
        <span className="shrink-0 font-mono text-numeric tabular text-text-muted">
          {seconds(row.durationMs ?? 0)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-label text-label-caps text-text-muted">
          Tags
        </span>
        {row.bpm && (
          <TagChip
            onClick={() => onFilter({ bpm: row.bpm!, tempo: "any" })}
          >{`${row.bpm} bpm`}</TagChip>
        )}
        {loop.genre && (
          <TagChip onClick={() => onFilter({ genre: loop.genre })}>
            {loop.genre}
          </TagChip>
        )}
        <TagChip onClick={() => onFilter({ category: loop.category })}>
          {loop.category}
        </TagChip>
        <TagChip>4/4</TagChip>
        {row.key ? (
          <TagChip
            onClick={() => onFilter({ key: keyId(row.key!) })}
          >{`Key: ${formatKey(row.key)}`}</TagChip>
        ) : (
          <TagChip>Key: none</TagChip>
        )}
        {bars && <TagChip>{`${bars} bars`}</TagChip>}
        {row.tags
          .filter((t) => t.toLowerCase() !== loop.genre.toLowerCase())
          .map((t) => (
            <TagChip key={t} onClick={() => onFilter({ q: t })}>
              {t}
            </TagChip>
          ))}
      </div>

      {loop.description && (
        <p className="line-clamp-2 text-small text-text">{loop.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={Download}
          onClick={() => void download()}
          disabled={saving}
        >
          {saving ? "Downloading" : "Download"}
        </Button>
        <ButtonLink href={row.href} size="sm" variant="secondary">
          Flip it
        </ButtonLink>
        <IconButton
          icon={Heart}
          label={liked ? `Unlike ${row.title}` : `Like ${row.title}`}
          on={liked}
          onClick={() => {
            set("likes", row.id, !liked);
            onChange();
          }}
        />
        <Menu
          entries={crate}
          trigger={
            <IconButton icon={Ellipsis} label={`More for ${row.title}`} />
          }
        />
      </div>
    </li>
  );
}
