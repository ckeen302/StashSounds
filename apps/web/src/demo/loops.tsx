import { DawDragZone } from "./daw-drag";
import { loopSource } from "./daw-sources";
import { getEngine, usePlayerState } from "@stash/audio";
import type { ItemRow, MusicalKey } from "@stash/contracts";
import { formatKey } from "@stash/contracts/format";
import {
  Avatar,
  Button,
  ButtonLink,
  Download,
  formatCount,
  Ellipsis,
  FilterChip,
  Heart,
  IconButton,
  Menu,
  PlayButton,
  Plus,
  TagChip,
  TextInput,
  UiLink,
  useToast,
  Waveform,
  type PlayState,
} from "@stash/ui";
import { useEffect, useMemo, useState } from "react";
import { nowPlaying } from "../app/_shell/now-playing";
import { LOOP_BYTES, type Catalog } from "./data";
import { GENRES, producerByHandle, useCrateEntries } from "./explore";
import { Dropdown } from "./presets/page";
import { saveLoopRow } from "./save";
import { PACK_WEEK, PACKS } from "./packs";
import { Why } from "./search-ui";
import { BankHead, LcdSmartSearch } from "./bank-head";
import { LoopDeckHero } from "./heroes/loop-deck";
import { loopProfile } from "./search-index";
import { likeness, match, parseQuery, quality, type Profile } from "./smart-search";
import { addPlay, plays, set } from "./store";
import { CommentGlyph, Comments, commentCount, countOrNone, trendScore, useSocialVersion } from "./social";
import { navigate } from "./router";

/**
 * The Loops tab as a loop library reads: a search bar with dropdown filters and date presets, then
 * one stacked row per loop (who posted it and when, a player, a tag line you can click to filter,
 * the description, download) and numbered pages of 25.
 */

const PER_PAGE = 25;

// What the loop is, read from its tags and title, the way a library files loops by instrument.
const CATEGORIES: [string, RegExp][] = [
  ["Drums", /drum loop/i],
  ["Flute", /flute/i],
  ["Mallets", /marimba|kalimba/i],
  ["Piano", /piano/i],
  ["Keys", /keys|rhodes|organ/i],
  ["Cowbell", /cowbell/i],
  ["Bells", /bell/i],
  ["Pad", /pad|chords/i],
  ["Strings", /string/i],
  ["Brass", /brass|horn/i],
  ["Harp", /harp/i],
  ["Guitar", /guitar|arp/i],
  ["Lead", /lead|whistle|stab/i],
  ["808", /808|bass/i],
  ["Drums", /drum|bounce|hat/i],
  ["Melody", /melody|synth/i],
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

const trend = (l: Loop) =>
  trendScore({ id: l.row.id, ownerId: producerByHandle(l.row.owner.handle)?.id ?? l.row.owner.handle, publishedAt: l.row.publishedAt, likes: l.row.likesCount, downloads: l.row.downloadsCount }, Date.now());

/** A count button in a loop's corner: like, download, comment. */
const PILL =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-control border border-border bg-raised px-2.5 font-mono text-numeric tabular text-text-muted ui-hover:border-border-strong ui-hover:text-text aria-pressed:border-accent aria-pressed:text-accent aria-pressed:*:fill-current aria-expanded:border-border-strong aria-expanded:text-text disabled:opacity-60";

const SORTS: Record<
  string,
  { label: string; by: (a: Loop, b: Loop) => number }
> = {
  match: {
    label: "Best match",
    // Relevance when there is a search, trending when there is not.
    by: (a, b) => b.score - a.score || trend(b) - trend(a),
  },
  trending: {
    label: "Trending",
    by: (a, b) => trend(b) - trend(a),
  },
  best: {
    label: "Best (downloads per play)",
    by: (a, b) =>
      quality(b.row.downloadsCount, plays(b.row.id)) - quality(a.row.downloadsCount, plays(a.row.id)) ||
      b.row.publishedAt.localeCompare(a.row.publishedAt),
  },
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
  profile: Profile;
  score: number;
  why: string[];
  /** Every plain word of the search was found. */
  all?: boolean;
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
  /** "More like this": the loop the list is ranked against. */
  like: string | null;
  /** Tags picked from a loop's tag line or the tag cloud; a loop must carry every one. */
  tags: string[];
  /** Advanced search: a BPM range, either end open. */
  bpmFrom: number | null;
  bpmTo: number | null;
  tsig: string;
};
const DEFAULT: Filters = {
  q: "",
  genre: "all",
  category: "all",
  key: "all",
  tempo: "any",
  bpm: null,
  when: "all",
  sort: "match",
  page: 1,
  like: null,
  tags: [],
  bpmFrom: null,
  bpmTo: null,
  tsig: "all",
};
// Filters survive leaving the tab and coming back, for this visit.
let saved: Filters = DEFAULT;

/** Every loop in the demo is in 4/4; the tag still filters, so the tag line reads the same everywhere. */
const TSIG = "4/4";
const norm = (t: string) => t.trim().toLowerCase();
const sizeText = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
/** A loop's tags as one set: its own tags, genre and category, for the tag filter and the cloud. */
const tagSet = (l: Pick<Loop, "row" | "genre" | "category">) => new Set([...l.row.tags, l.genre, l.category].filter(Boolean).map(norm));

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
            profile: loopProfile(row, catalog),
            score: 0,
            why: [] as string[],
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

  // The tag cloud: the tags most loops carry, with how many carry each.
  const cloud = useMemo(() => {
    const n = new Map<string, number>();
    for (const l of loops) for (const t of l.row.tags.map(norm)) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n.entries()].filter(([t]) => t.length > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 18);
  }, [loops]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advanced, setAdvanced] = useState(() => saved.bpmFrom !== null || saved.bpmTo !== null || saved.tsig !== "all");
  const [fromText, setFromText] = useState(saved.bpmFrom === null ? "" : String(saved.bpmFrom));
  const [toText, setToText] = useState(saved.bpmTo === null ? "" : String(saved.bpmTo));
  const toggleTag = (t: string) => {
    const k = norm(t);
    update({ tags: f.tags.includes(k) ? f.tags.filter((x) => x !== k) : [...f.tags, k], like: null });
  };

  const tempo = TEMPOS.find((t) => t.id === f.tempo) ?? TEMPOS[0]!;
  const hours = WHEN.find((w) => w.id === f.when)?.hours ?? Infinity;
  const query = parseQuery(f.q);
  const likeOf = f.like ? loops.find((l) => l.row.id === f.like) ?? null : null;
  const matched = loops
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
    .filter(() => f.tsig === "all" || f.tsig === TSIG)
    .filter((l) => (f.bpmFrom === null || (l.row.bpm ?? 0) >= f.bpmFrom) && (f.bpmTo === null || (l.row.bpm ?? 999) <= f.bpmTo))
    .filter((l) => {
      if (!f.tags.length) return true;
      const have = tagSet(l);
      return f.tags.every((t) => have.has(t));
    })
    .flatMap((l): Loop[] => {
      if (likeOf) {
        if (l.row.id === likeOf.row.id) return [];
        const m = likeness(likeOf.profile, l.profile);
        return m.score >= 3 ? [{ ...l, score: m.score, why: m.why }] : [];
      }
      const m = match(l.profile, query);
      return m ? [{ ...l, score: m.score, why: m.why, all: m.all !== false }] : [];
    })
    .sort(SORTS[f.sort]!.by);
  // A search word nothing has: keep the close matches. Otherwise only loops with every word.
  const exact = matched.filter((l) => l.all !== false);
  const shown = exact.length ? exact : matched;

  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const page = Math.min(f.page, pages);
  const from = (page - 1) * PER_PAGE;
  const onPage = shown.slice(from, from + PER_PAGE);
  const queue = onPage.map((l) => l.row);
  const touched = JSON.stringify({ ...f, page: 1 }) !== JSON.stringify(DEFAULT);
  // What is narrowing the list right now, each one removable on its own.
  const applied: [string, Partial<Filters>][] = [
    ...(f.q ? [[`"${f.q}"`, { q: "" }] as [string, Partial<Filters>]] : []),
    ...f.tags.map((t): [string, Partial<Filters>] => [t, { tags: f.tags.filter((x) => x !== t) }]),
    ...(f.category !== "all" ? [[f.category, { category: "all" }] as [string, Partial<Filters>]] : []),
    ...(f.genre !== "all" ? [[f.genre, { genre: "all" }] as [string, Partial<Filters>]] : []),
    ...(f.key !== "all" ? [[`Key: ${formatKey(keys.find((k) => keyId(k) === f.key)!)}`, { key: "all" }] as [string, Partial<Filters>]] : []),
    ...(f.bpm !== null ? [[`${f.bpm} bpm`, { bpm: null }] as [string, Partial<Filters>]] : []),
    ...(f.tempo !== "any" ? [[`${tempo.label} BPM`, { tempo: "any" }] as [string, Partial<Filters>]] : []),
    ...(f.bpmFrom !== null || f.bpmTo !== null ? [[`${f.bpmFrom ?? 40} to ${f.bpmTo ?? 300} BPM`, { bpmFrom: null, bpmTo: null }] as [string, Partial<Filters>]] : []),
    ...(f.tsig !== "all" ? [[f.tsig, { tsig: "all" }] as [string, Partial<Filters>]] : []),
    ...(f.when !== "all" ? [[WHEN.find((w) => w.id === f.when)!.label, { when: "all" }] as [string, Partial<Filters>]] : []),
  ];
  // The search box already shows its own words: the filter row lists only the filters.
  const filtersOn = applied.filter(([, patch]) => !("q" in patch));

  const engine = getEngine();
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  useEffect(() => {
    for (const r of queue) engine.preload(r.playable);
  }, [engine, queue]);

  const goTo = (p: number) => {
    update({ page: p });
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-3 px-3 py-5 tablet:px-4 desktop:px-6">
      {/* Title, one row of controls, then the loops: everything else waits behind Filters. */}
      <BankHead
        kicker="LOOP BANK"
        title="Free loops"
        blurb="Search by sound, tempo, key, genre or producer."
        search={<LcdSmartSearch id="loops-q" placeholder="dark piano 140" value={f.q} onChange={(v) => update({ q: v, like: null })} />}
        hero={<LoopDeckHero rows={loops.map((l) => l.row)} />}
        actions={
          <>
            <button type="button" className="sp-key" aria-pressed={filtersOpen} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
              {filtersOn.length ? `Filters · ${filtersOn.length}` : "Filters"}
            </button>
            {/* The Upload tab is one tap away in the nav on a phone. */}
            <UiLink href="/upload" className="sp-key sp-key-hot st-wide-only">
              Upload
            </UiLink>
          </>
        }
      />

      {filtersOpen && (
      <section
        aria-label="Filters"
        className="lib-tray flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            name="Category"
            value={f.category === "all" ? "Any" : f.category}
            selected={f.category}
            options={[
              ["all", "Any"],
              ...categories.map((c): [string, string] => [c, c]),
            ]}
            onPick={(v) => update({ category: v })}
          />
          <Dropdown
            name="Genre"
            value={f.genre === "all" ? "Any" : f.genre}
            selected={f.genre}
            options={[
              ["all", "Any"],
              ...genres.map((g): [string, string] => [g, g]),
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
          <Button size="sm" variant="ghost" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            {advanced ? "Hide advanced search" : "Advanced search"}
          </Button>
        </div>
        {advanced && (
          <form
            aria-label="Advanced search"
            className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              const read = (t: string) => (t.trim() === "" ? null : Math.max(40, Math.min(300, Math.round(Number(t)))));
              const a = read(fromText);
              const b = read(toText);
              const [lo, hi] = a !== null && b !== null && a > b ? [b, a] : [a, b];
              update({ bpmFrom: lo, bpmTo: hi, bpm: null, tempo: "any" });
            }}
          >
            <TextInput label="BPM from" inputMode="numeric" placeholder="40" value={fromText} onChange={(e) => setFromText(e.target.value.replace(/[^\d]/g, ""))} className="w-28" />
            <TextInput label="BPM to" inputMode="numeric" placeholder="300" value={toText} onChange={(e) => setToText(e.target.value.replace(/[^\d]/g, ""))} className="w-28" />
            <Dropdown
              name="Time signature"
              value={f.tsig === "all" ? "Any" : f.tsig}
              selected={f.tsig}
              options={[["all", "Any"], [TSIG, TSIG]]}
              onPick={(v) => update({ tsig: v })}
            />
            <Button type="submit" size="sm" variant="secondary">
              Search
            </Button>
          </form>
        )}
        {/* One sideways row on a phone, so the loops stay near the top; wrapped from tablet up. */}
        <div role="group" aria-label="Popular tags" className="-mx-3 flex items-center gap-2 overflow-x-auto border-t border-border px-3 pt-3 pb-1 tablet:mx-0 tablet:flex-wrap tablet:overflow-visible tablet:px-0 tablet:pb-0">
          <span className="text-label text-label-caps text-text-muted">Popular tags</span>
          {cloud.map(([t]) => (
            <FilterChip key={t} selected={f.tags.includes(t)} onToggle={() => toggleTag(t)}>
              {t}
            </FilterChip>
          ))}
        </div>
      </section>
      )}

      {filtersOn.length > 0 && (
        <div role="group" aria-label="Filters on" className="flex flex-wrap items-center gap-2">
          <span className="text-label text-label-caps text-text-muted">Showing</span>
          {filtersOn.map(([label, patch]) => (
            <TagChip
              key={label}
              onRemove={() => {
                if ("bpmFrom" in patch) {
                  setFromText("");
                  setToText("");
                }
                update(patch);
              }}
            >
              {label}
            </TagChip>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFromText("");
              setToText("");
              update({ ...DEFAULT, sort: f.sort });
            }}
          >
            Clear all
          </Button>
        </div>
      )}

      {likeOf && (
        <div className="sp-lcd flex flex-wrap items-center justify-between gap-2">
          <span className="text-body text-text">
            {"More like "}
            <UiLink href={likeOf.row.href} className="text-body-strong ui-hover:underline">
              {likeOf.row.title}
            </UiLink>
            <span className="text-text-muted">{": same genre and key first, then tempo, sound and mood."}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => update({ like: null })}>
            Back to every loop
          </Button>
        </div>
      )}


      <div className="flex flex-wrap items-center justify-between gap-2">
        <span aria-live="polite" className="sr-only">
          {shown.length === 0
            ? "No loops"
            : `Loops ${from + 1} - ${from + onPage.length} of ${shown.length}`}
        </span>
        <Pager page={page} pages={pages} onPage={goTo} />
      </div>

      {shown.length > 0 ? (
        <DawDragZone sources={onPage.map((l) => loopSource(l.row))}>
        <ul
          aria-label="Loops"
          className="lib-loops"
        >
          {onPage.map((l, i) => (
            <LoopEntry
              key={l.row.id}
              loop={l}
              now={now}
              onPlay={() => {
                if (currentId !== l.row.playable.id) addPlay(l.row.id);
                void nowPlaying().playFrom(engine, queue, i);
              }}
              onFilter={(patch) => update(patch)}
              onTag={toggleTag}
              activeTags={f.tags}
              onChange={onChange}
            />
          ))}
        </ul>
        </DawDragZone>
      ) : (
        <div className="sp-lcd flex flex-col items-start gap-3">
          <p className="sp-lcd-small m-0">
            {f.q.trim()
              ? `Nothing here matches "${f.q.trim()}" yet. Try a sound, mood or tempo instead, like "dark piano 140", or clear the filters.`
              : "No loops match all of that. Try another tempo or clear the filters."}
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

      {!likeOf && query.empty && page === 1 && <PackStrip />}
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
    <nav aria-label="Pages" className="lib-pager">
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <button key={p} type="button" className="sp-key" aria-current={p === page ? "page" : undefined} onClick={() => onPage(p)}>
          {String(p).padStart(2, "0")}
        </button>
      ))}
      {page < pages && (
        <button type="button" className="sp-key" aria-label="Next page" onClick={() => onPage(page + 1)}>
          Next
        </button>
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
  onTag,
  activeTags,
  onChange,
}: {
  loop: Loop;
  now: number;
  onPlay: () => void;
  onFilter: (patch: Partial<Filters>) => void;
  onTag: (t: string) => void;
  activeTags: string[];
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
  const [talk, setTalk] = useState(false);
  useSocialVersion();
  const comments = commentCount(row.id);
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
      const { outcome, name } = await saveLoopRow(row);
      if (outcome === "saved") {
        set("downloads", row.id, true);
        onChange();
        toast({ tone: "success", title: "Downloaded", description: `${name}. Its license receipt is under the Library icon at the top.` });
      } else if (outcome === "failed") {
        toast({ tone: "error", title: "The download did not start", description: "Try again in a moment." });
      }
    } catch {
      toast({ tone: "error", title: "The download did not start", description: "Try again in a moment." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      data-playing={state === "playing" || undefined}
      className="lib-loop flex flex-col gap-3 p-3 tablet:p-4"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
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
        {/* Counts sit beside the title on wider screens and under it on a phone. */}
        <div className="flex shrink-0 basis-full items-center gap-1.5 pl-11 tablet:basis-auto tablet:pl-0">
          <button
            type="button"
            aria-pressed={liked}
            aria-label={`${liked ? "Unlike" : "Like"} ${row.title}, ${row.likesCount} likes`}
            onClick={() => {
              set("likes", row.id, !liked);
              onChange();
            }}
            className={PILL}
          >
            <Heart className="size-4" aria-hidden="true" />
            {countOrNone(row.likesCount)}
          </button>
          <button type="button" aria-label={`Download ${row.title}, ${row.downloadsCount} downloads`} onClick={() => void download()} disabled={saving} className={PILL}>
            <Download className="size-4" aria-hidden="true" />
            {countOrNone(row.downloadsCount)}
          </button>
          {plays(row.id) > 0 && (
            <span aria-label={`${plays(row.id)} plays`} title="Plays" className={PILL}>
              <PlayGlyph />
              {formatCount(plays(row.id))}
            </span>
          )}
          <button type="button" aria-expanded={talk} aria-label={`Comments on ${row.title}, ${comments}`} onClick={() => setTalk(!talk)} className={PILL}>
            <CommentGlyph />
            {countOrNone(comments)}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <PlayButton title={row.title} state={state} onClick={onPlay} />
        <div data-loop-wave className="lib-wave min-w-0 flex-1">
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
        <span className="lib-chip-lcd inline-flex shrink-0">
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
        <TagChip onClick={() => onFilter({ tsig: TSIG })}>{TSIG}</TagChip>
        {row.key ? (
          <TagChip
            onClick={() => onFilter({ key: keyId(row.key!) })}
          >{`Key: ${formatKey(row.key)}`}</TagChip>
        ) : (
          <TagChip>Key: none</TagChip>
        )}
        {bars && <TagChip>{`${bars} bars`}</TagChip>}
        {LOOP_BYTES.has(row.id) && <TagChip>{sizeText(LOOP_BYTES.get(row.id)!)}</TagChip>}
        {row.tags
          .filter((t) => norm(t) !== norm(loop.genre))
          .map((t) => (
            <TagChip key={t} aria-pressed={activeTags.includes(norm(t))} onClick={() => onTag(t)}>
              {t}
            </TagChip>
          ))}
      </div>

      {loop.description && (
        <p className="text-small text-text">
          <span className="text-text-muted">{"Description: "}</span>
          {loop.description}
        </p>
      )}
      <Why why={loop.why} />

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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onFilter({ like: row.id, q: "" });
            window.scrollTo({ top: 0 });
          }}
        >
          More like this
        </Button>
        <IconButton icon={Plus} label={`More from ${row.owner.handle}`} onClick={() => navigate(`/u/${row.owner.handle}`)} />
        <Menu
          entries={crate}
          trigger={
            <IconButton icon={Ellipsis} label={`More for ${row.title}`} />
          }
        />
      </div>
      {talk && <Comments itemId={row.id} title={row.title} compact />}
    </li>
  );
}

/** This week's hand-picked packs, as a row of cards above the list. */
function PackStrip() {
  return (
    <section aria-label="Packs" className="flex flex-col gap-3">
      <div className="sp-head">
        <h2 className="sp-label">{`Cartridges · packs picked this week · ${PACK_WEEK}`}</h2>
      </div>
      {/* A sideways row on a phone, so the loops stay near the top; a grid from tablet up. */}
      <ul className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:grid tablet:grid-cols-2 tablet:overflow-visible tablet:px-0 desktop:grid-cols-3">
        {PACKS.map((p) => (
          <li key={p.id} className="w-64 shrink-0 tablet:w-auto">
            <UiLink href={`/pack/${p.id}`} className="sp-cart lib-cart h-full">
              <span className="lib-cart-title">{p.name}</span>
              <span className="lib-sub line-clamp-2">{p.blurb}</span>
              <span className="sp-pad-meta mt-auto">LOOPS + MIDI</span>
            </UiLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A play triangle, drawn like the interface's other icons (24 grid, 2 px stroke, current colour). */
function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  );
}
