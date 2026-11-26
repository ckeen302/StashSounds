import {
  lazy,
  StrictMode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { getEngine, usePlayerState } from "@stash/audio";
import type { ItemPage, ItemRow } from "@stash/contracts";
import {
  Bell,
  ButtonLink,
  EmptyState,
  LinkProvider,
  ResultList,
  ResultRow,
  Search,
  ToastProvider,
  TooltipProvider,
  User,
  useToast,
  type IconComponent,
  type PlayState,
  type ResultRowProps,
} from "@stash/ui";
import { AppShell } from "../app/_shell/app-shell";
import { navItems } from "../app/_shell/nav";
import { nowPlaying } from "../app/_shell/now-playing";
import { ItemView } from "../app/_item/item-view";
import { buildCatalog, type Catalog } from "./data";
import { LICENSE_LABELS } from "@stash/contracts/format";
import { HashLink } from "./hash-link";
import { navigate, startRouter, usePath } from "./router";
// The Samples tab's catalog is about a third of the demo's script: it loads on its own, after the
// first paint (prefetched once the page is idle, at the bottom), so the rest of the demo starts without it.
const samplesPage = () => import("./samples/page");
const SamplesPage = lazy(() => samplesPage().then((m) => ({ default: m.SamplesPage })));
const SampleSongPage = lazy(() => samplesPage().then((m) => ({ default: m.SampleSongPage })));
const OriginalPage = lazy(() => samplesPage().then((m) => ({ default: m.OriginalPage })));
const SampleArtistPage = lazy(() => samplesPage().then((m) => ({ default: m.SampleArtistPage })));
const SampleProducerPage = lazy(() => samplesPage().then((m) => ({ default: m.SampleProducerPage })));
import { has, set } from "./store";
import { startLooks, useLook } from "./looks";
import { midiItem, type MidiItem } from "./midi/catalog";
import { MidiList, MidiPage, useMidiItems } from "./midi/pages";
import { BATCH_SONGS, progressionOf } from "./midi/songs";
import { CHORD_PACKS, PACK_PROGRESSIONS, TEMPO_BANDS } from "./midi/chord-packs";
import { Dropdown } from "./presets/page";
import { PresetsPage } from "./presets/page";
import { PresetSongPage } from "./presets/song-page";
import { SoundDesign } from "./sound-design";
import { OneShotsPage } from "./oneshots/page";
import { MELODIC } from "./oneshots/melodic";
import { SfxPage } from "./sfx/page";
import { SFX } from "./sfx/library";
import { UploadHub } from "./upload/page";
import {
  BrowsePage,
  LibraryPage,
  NewCrateHost,
  CreatorsPage,
  ProfilePage,
  producerByHandle,
  useCrateEntries,
  type RenderLoops,
} from "./explore";
import { FlipPanel } from "./flip";
import { LoopTools } from "./loop-tools";
import { followerCount } from "./comments-store";
import { Comments, trendScore } from "./social";
import { LoopsPage } from "./loops";
import { pack, PACK_WEEK } from "./packs";
import { ALL_SONGS, madeBy, songHref, TOP_PRODUCERS } from "./presets/songs";
import { PRESETS, type Confidence } from "./presets/data";
import { Cover, coverFor } from "./presets/cover";
import { kits, useKits } from "./kits/store";
import { saveFiles, saveLoopRow } from "./save";
import { SmartSearch, useQuery } from "./search-ui";
import { KitHits, PresetHits, ProducerHits, rank, ShotHits, SfxHits, useOtherHits } from "./search-page";
import { queryWords, textMatch } from "./text-match";
import { loopProfile, midiProfile } from "./search-index";
import { match, moreLike } from "./smart-search";
import { writeMidi } from "./midi/write";
import { KitCards, KitPage, KitsPage, KitUploadPage } from "./kits/pages";
import { DawDragZone } from "./daw-drag";
import { loopSource } from "./daw-sources";
import { attachLoopStyles, allProducers, hrefForProducer, producerBySlug, producerNamed, producerPageHref } from "./producers/data";
import { ProducerPageView, ProducersPage, summaryOf } from "./producers/page";
import { SAMPLE_PRODUCER_NAMES } from "./samples/credits";
import { Button, Download, FilterChip, IconLink, Library as LibraryIcon, SearchInput, UiLink } from "@stash/ui";

/**
 * The browser-only demo (ticket 137): the real shell, player bar, result rows, loop page and audio
 * engine, fed by the demo catalog instead of the database, on a hash router. No server, no account.
 */

const catalog: Catalog = buildCatalog(document.baseURI);

/** A loop's "in the style of" tag ("metro boomin"), which ties it to a producer page. */
function styleOf(row: ItemRow): string | null {
  return catalog.page(row.publicId)?.item.allTags.find((t) => t.kind === "reference")?.name ?? null;
}
attachLoopStyles(catalog.rows.map(styleOf).filter((t): t is string => !!t));

/** A row as this browser's viewer sees it: their like, counted once. */
function withViewer(row: ItemRow): ItemRow {
  const liked = has("likes", row.id);
  const downloaded = has("downloads", row.id);
  return {
    ...row,
    likesCount: row.likesCount + (liked ? 1 : 0),
    downloadsCount: row.downloadsCount + (downloaded ? 1 : 0),
    viewer: { liked },
  };
}

function pageForViewer(page: ItemPage): ItemPage {
  const follows = has("follows", page.owner.id);
  const item = withViewer(page.item);
  return {
    ...page,
    item: { ...page.item, likesCount: item.likesCount, viewer: item.viewer },
    owner: {
      ...page.owner,
      viewerFollows: follows,
      followersCount: page.owner.followersCount + followerCount(page.owner.id),
    },
    moreFromOwner: page.moreFromOwner.map(withViewer),
    similar: page.similar.map(withViewer),
  };
}

let searchQuery = "";
const searchListeners = new Set<() => void>();
function setSearchQuery(q: string) {
  searchQuery = q;
  for (const l of searchListeners) l();
}
function useSearchQuery(): string {
  return useSyncExternalStore(
    (l) => {
      searchListeners.add(l);
      return () => searchListeners.delete(l);
    },
    () => searchQuery,
    () => "",
  );
}

function useRows(): [ItemRow[], () => void] {
  const [version, setVersion] = useState(0);
  const rows = useMemo(() => catalog.rows.map(withViewer), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  return [rows, () => setVersion((v) => v + 1)];
}

/** Loops in feed order: engagement over age (see social.tsx), people you follow lifted. */
function trending(rows: ItemRow[]): ItemRow[] {
  const now = Date.now();
  const score = (r: ItemRow) =>
    trendScore({ id: r.id, ownerId: producerByHandle(r.owner.handle)?.id ?? r.owner.handle, publishedAt: r.publishedAt, likes: r.likesCount, downloads: r.downloadsCount }, now);
  return [...rows].sort((a, b) => score(b) - score(a));
}

/** The loops as result rows: the list is the player's queue, arrows move the selection. */
function LoopList({
  label,
  rows,
  onChange,
}: {
  label: string;
  rows: ItemRow[];
  onChange: () => void;
}) {
  const engine = getEngine();
  const status = usePlayerState((s) => s.status);
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  const toast = useToast();
  const [selected, setSelected] = useState(-1);
  const stateOf = (id: string): PlayState =>
    id !== currentId || status === "idle" ? "paused" : status;
  const play = (i: number) => void nowPlaying().playFrom(engine, rows, i);
  // Five small previews: fetch and decode them all up front, so every row plays at once.
  useEffect(() => {
    for (const r of rows) engine.preload(r.playable);
  }, [engine, rows]);

  return (
    <div
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = Math.max(
            0,
            Math.min(
              rows.length - 1,
              selected + (e.key === "ArrowDown" ? 1 : -1),
            ),
          );
          setSelected(next);
          if (currentId) play(next);
        } else if (e.key === "Enter" && selected >= 0) {
          navigate(rows[selected]!.href);
        }
      }}
    >
      <DawDragZone sources={rows.map(loopSource)}>
      <ResultList label={label} className="st-rows">
        {rows.map((r, i) => (
          <LoopRow
            key={r.id}
            row={r}
            selected={i === selected}
            playState={stateOf(r.playable.id)}
            onPlay={() => {
              setSelected(i);
              play(i);
            }}
            onLike={(liked) => {
              set("likes", r.id, liked);
              onChange();
              if (liked)
                toast({
                  tone: "success",
                  title: "Liked",
                  description: "Saved in this browser. This is the demo.",
                });
            }}
            onDownload={() =>
              void saveLoopRow(r)
                .then(({ outcome, name }) => {
                  if (outcome === "saved") {
                    set("downloads", r.id, true);
                    onChange();
                    toast({ tone: "success", title: "Downloaded", description: name });
                  } else if (outcome === "failed") throw new Error(name);
                })
                .catch(() => toast({ tone: "error", title: "The download did not start", description: "Try again in a moment." }))
            }
          />
        ))}
      </ResultList>
      </DawDragZone>
    </div>
  );
}

/** A loop row with the crate menu: its entries are a hook, so each row is its own component. */
function LoopRow(props: Omit<ResultRowProps, "menu">) {
  const entries = useCrateEntries(props.row.id, props.row.title);
  return <ResultRow {...props} menu={entries} />;
}

/** Loop lists for the discovery pages, each one its own play queue. */
function LoopsFor({ label, rows }: { label: string; rows: ItemRow[] }) {
  // Re-read each row as this viewer sees it, so a like made here shows here, in the order given.
  const [fresh, refresh] = useRows();
  const byId = new Map(fresh.map((r) => [r.id, r]));
  const shown = rows.map((r) => byId.get(r.id) ?? r);
  return <LoopList label={label} rows={shown} onChange={refresh} />;
}
const renderLoops: RenderLoops = (label, rows) => (
  <LoopsFor label={label} rows={rows} />
);

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-8 px-3 py-8 tablet:px-4 desktop:px-6">
      {children}
    </main>
  );
}

const TODAY = Math.floor(Date.now() / 86_400_000);

const RARITY: Record<Confidence, { name: string; text: string }> = {
  producer: { name: "Legendary", text: "text-type-oneshot" },
  engineer: { name: "Epic", text: "text-type-midi" },
  press: { name: "Rare", text: "text-type-loop" },
  community: { name: "Common", text: "text-text-muted" },
};
const BY_LEVEL: Confidence[] = ["community", "community", "press", "engineer", "producer"];

/** Best-sourced songs first, shuffled a little each day so the shelf moves. */
const SHELF = [...ALL_SONGS]
  .map((s, i) => ({ s, k: (coverFor(s.song, s.artist) ? 100000 : 0) + s.best * 10000 + ((i * 7919 + TODAY * 104729) % 9973) }))
  .sort((a, b) => b.k - a.k)
  .slice(0, 14)
  .map((x) => x.s);

function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}

function initialsOf(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function SectionHead({ title, sub, href, more }: { title: string; sub?: string; href?: string; more?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-title">{title}</h2>
        {sub && <p className="text-small text-text-muted">{sub}</p>}
      </div>
      {href && more && (
        <ButtonLink href={href} variant="ghost" size="sm">
          {more}
        </ButtonLink>
      )}
    </div>
  );
}

const GENRES = ["Trap", "Drill", "Pluggnb", "Boom bap", "Rage", "Phonk", "Jersey club", "R&B", "Detroit", "Lo-fi", "Afrobeats", "Memphis"];

/** The hero's equalizer: resting low, moving while anything plays. Decoration only. */
const EQ = Array.from({ length: 48 }, (_, i) => 16 + Math.round(76 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21))));
function HeroEq() {
  const status = usePlayerState((s) => s.status);
  return (
    <div className="st-eq" data-on={status === "playing" || undefined} aria-hidden="true">
      {EQ.map((h, i) => (
        <span key={i} style={{ ["--h" as string]: h, ["--d" as string]: `${(i % 7) * 90}ms` }} />
      ))}
    </div>
  );
}

function Home() {
  const [rows, refresh] = useRows();
  const midi = useMidiItems();
  const [q, setQ] = useState("");
  const songs = useMemo(() => {
    const list = midi.filter((m) => m.song);
    // A different handful each day, so the home page does not always open on the same artist.
    return list
      .map((m, i) => ({ m, k: (i * 7919 + TODAY * 104729) % 9973 }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.m);
  }, [midi]);
  const types = [
    { href: "/loops", t: "loop", name: "Loops", count: rows.length },
    { href: "/one-shots", t: "oneshot", name: "One-shots", count: MELODIC.length },
    { href: "/kits", t: "kit", name: "Drums", count: kits().reduce((n, k) => n + k.sounds.length, 0) },
    { href: "/midi", t: "midi", name: "MIDI", count: midi.length },
    { href: "/presets", t: "preset", name: "Presets", count: PRESETS.length },
    { href: "/sfx", t: "oneshot", name: "SFX", count: SFX.length },
  ];
  const search = (text: string) => {
    setSearchQuery(text);
    navigate("/search");
  };
  return (
    <div className="flex flex-col">
      <section className="st-home-hero relative overflow-hidden">
        <HeroEq />
        <div className="relative mx-auto flex w-full max-w-content flex-col gap-5 px-3 pt-6 pb-6 tablet:px-4 tablet:pt-12 desktop:px-6 desktop:pt-14">
          <h1 className="st-hero-title st-home-h1 max-w-4xl text-balance">
            Free sounds that <span className="st-grad">actually hit.</span>
          </h1>
          <ul aria-label="The deal" className="flex flex-wrap gap-x-5 gap-y-1 text-small text-text-muted">
            {["Free. No credits, no trials", "Plays on first click", "Original files"].map((x) => (
              <li key={x} className="inline-flex items-center gap-2">
                <span className="st-check" aria-hidden="true" />
                {x}
              </li>
            ))}
          </ul>
          <form
            role="search"
            className="flex w-full max-w-2xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search(q);
            }}
          >
            <SearchInput
              label="Search sounds"
              hideLabel
              shortcut=""
              placeholder="Try dark piano 140 like metro"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ("")}
              className="min-w-0 flex-1"
            />
            <Button type="submit" variant="primary">
              Search
            </Button>
          </form>
          <ul aria-label="Sound types" className="st-shelf -mx-3 flex gap-2 overflow-x-auto px-3 tablet:mx-0 tablet:flex-wrap tablet:px-0">
            {types.map((t) => (
              <li key={t.href} className="shrink-0">
                <UiLink
                  href={t.href}
                  data-t={t.t}
                  className="st-type flex h-11 items-center gap-2.5 rounded-control border border-border bg-surface px-4 ui-hover:border-border-strong"
                >
                  <span className="st-dot size-2.5 rounded-full" aria-hidden="true" />
                  <span className="text-body-strong text-text">{t.name}</span>
                  <span className="font-mono text-numeric tabular text-text-muted">{t.count.toLocaleString("en")}</span>
                </UiLink>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Page>
        <section aria-labelledby="trending" className="-mt-6 flex flex-col gap-3">
          <div id="trending">
            <SectionHead title="Trending now" href="/loops" more={`All ${rows.length} loops`} />
          </div>
          <LoopList label="Trending now" rows={trending(rows).slice(0, 6)} onChange={refresh} />
        </section>

        <nav aria-label="Genres" className="st-ticker -mx-3 overflow-hidden tablet:mx-0">
          <ul className="st-ticker-track flex w-max gap-2">
            {[...GENRES, ...GENRES].map((g, i) => (
              <li key={`${g}-${i}`} aria-hidden={i >= GENRES.length || undefined}>
                <button
                  type="button"
                  tabIndex={i >= GENRES.length ? -1 : undefined}
                  onClick={() => search(g)}
                  className="st-hero-title st-ticker-item rounded-control border border-border px-5 py-2 text-title text-text-muted ui-hover:border-border-strong ui-hover:text-text"
                >
                  {g}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-labelledby="songs-shelf" className="flex flex-col gap-3">
          <div id="songs-shelf">
            <SectionHead title="Presets behind the songs" href="/presets" more={`All ${ALL_SONGS.length} songs`} />
          </div>
          <ul className="st-shelf -mx-3 flex gap-4 overflow-x-auto px-3 pb-2 tablet:mx-0 tablet:px-0">
            {SHELF.map((s) => {
              const r = RARITY[BY_LEVEL[s.best] ?? "community"];
              return (
                <li key={s.slug} className="w-40 shrink-0 tablet:w-44">
                  <UiLink href={songHref(s.song, s.artist)} className="group flex h-full flex-col gap-3 rounded-panel border border-border bg-surface p-3 ui-hover:border-border-strong">
                    <Cover song={s.song} artist={s.artist} size="fill" placeholder />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-body-strong text-text group-hover:underline">{s.song}</span>
                      <span className="truncate text-small text-text-muted">{s.artist}</span>
                      <span className={`text-small ${r.text}`}>{`${r.name} · ${s.entries.length} ${s.entries.length === 1 ? "sound" : "sounds"}`}</span>
                    </span>
                  </UiLink>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="producers" className="flex flex-col gap-3">
          <div id="producers">
            <SectionHead title="Producers behind the songs" href="/producers" more="All producers" />
          </div>
          <ul className="st-shelf -mx-3 flex gap-5 overflow-x-auto px-3 pb-2 tablet:mx-0 tablet:px-0">
            {TOP_PRODUCERS.slice(0, 12).map(([name, n]) => {
              const first = ALL_SONGS.find((s) => madeBy(s, name));
              return (
                <li key={name} className="w-24 shrink-0 tablet:w-28">
                  <UiLink href={hrefForProducer(name) ?? (first ? songHref(first.song, first.artist) : "/presets")} className="group flex flex-col items-center gap-2 text-center">
                    <span data-hue={hueOf(name)} className="st-avatar st-hero-title flex size-24 items-center justify-center rounded-full text-title tablet:size-28" aria-hidden="true">
                      {initialsOf(name)}
                    </span>
                    <span className="w-full truncate text-body-strong text-text group-hover:underline">{name}</span>
                    <span className="text-small text-text-muted">{`${n} songs`}</span>
                  </UiLink>
                </li>
              );
            })}
          </ul>
        </section>

        {songs.length > 0 && (
          <section className="flex flex-col gap-3">
            <SectionHead title="Chords from the songs" href="/midi" more={`All ${songs.length} songs`} />
            <MidiList label="Song chords" items={songs.slice(0, 6)} />
          </section>
        )}

        <section aria-labelledby="post" className="st-cta flex flex-col gap-4 rounded-panel p-6 tablet:flex-row tablet:items-center tablet:justify-between tablet:p-10">
          <div className="flex flex-col gap-2">
            <h2 id="post" className="st-hero-title text-display">Post a sound. Get followed.</h2>
            <p className="max-w-prose text-body">Heard in one tap. Credited on every download.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["/upload", "Upload a loop"],
              ["/kit-upload", "Post a kit"],
              ["/one-shots", "Post one-shots"],
            ].map(([href, label]) => (
              <UiLink key={href} href={href!} className="inline-flex h-10 items-center rounded-control bg-bg px-4 text-body-strong text-text ui-hover:bg-raised">
                {label}
              </UiLink>
            ))}
          </div>
        </section>
      </Page>
    </div>
  );
}

function ProducerRoute({ slug }: { slug: string }) {
  const [rows] = useRows();
  return <ProducerPageView slug={slug} rows={rows} styleOf={styleOf} renderLoops={renderLoops} />;
}

function BrowseRoute() {
  const [rows] = useRows();
  return <BrowsePage catalog={catalog} rows={rows} renderLoops={renderLoops} />;
}

function LoopsRoute() {
  const [rows, refresh] = useRows();
  return <LoopsPage catalog={catalog} rows={rows} onChange={refresh} />;
}

function ProfileRoute({ handle }: { handle: string }) {
  const [rows] = useRows();
  const theirs = useKits().filter((k) => k.owner.handle === handle);
  return (
    <ProfilePage
      key={handle}
      handle={handle}
      catalog={catalog}
      rows={rows}
      renderLoops={renderLoops}
      kits={<KitCards kits={theirs} label="Drum kits" />}
      kitCount={theirs.length}
    />
  );
}

function CreatorsRoute() {
  const [rows] = useRows();
  const counts: Record<string, number> = {};
  for (const k of useKits()) counts[k.owner.handle] = (counts[k.owner.handle] ?? 0) + 1;
  return <CreatorsPage catalog={catalog} rows={rows} kitCounts={counts} />;
}

function LibraryRoute() {
  const [rows] = useRows();
  return (
    <LibraryPage catalog={catalog} rows={rows} renderLoops={renderLoops} />
  );
}

type SearchKind = "all" | "loops" | "midi" | "presets" | "sfx" | "kits" | "shots" | "producers" | "pages";
let searchKind: SearchKind = "all";

/** Strict matches (every word of the query found) first; close matches only when there are none. */
function rankSmart<T>(list: T[], prof: (x: T) => Parameters<typeof match>[0], q: ReturnType<typeof useQuery>): { items: T[]; close: boolean } {
  const scored = list
    .map((x) => ({ x, hit: match(prof(x), q) }))
    .filter((r): r is { x: T; hit: NonNullable<ReturnType<typeof match>> } => !!r.hit)
    .sort((a, b) => b.hit.score - a.hit.score);
  const full = scored.filter((r) => r.hit.all !== false);
  return full.length ? { items: full.map((r) => r.x), close: false } : { items: scored.map((r) => r.x), close: scored.length > 0 };
}

/** Producer pages that match a search: name and what they have here. */
function ProducerPageHits({ list }: { list: ReturnType<typeof allProducers> }) {
  return (
    <ul aria-label="Producer page results" className="flex flex-col overflow-hidden rounded-panel border border-border bg-surface">
      {list.map((p) => (
        <li key={p.slug} className="flex min-h-14 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
          <UiLink href={producerPageHref(p)} className="flex min-w-0 flex-1 flex-col ui-hover:underline">
            <span className="truncate text-body-strong text-text">{p.name}</span>
            <span className="truncate text-small text-text-muted">{summaryOf(p)}</span>
          </UiLink>
        </li>
      ))}
    </ul>
  );
}

function SearchResults() {
  const [rows, refresh] = useRows();
  const query = useSearchQuery();
  const parsed = useQuery(query);
  const midi = useMidiItems();
  const [kind, setKindState] = useState<SearchKind>(searchKind);
  const setKind = (k: SearchKind) => {
    searchKind = k;
    setKindState(k);
    window.scrollTo({ top: 0 });
  };
  const loops = rankSmart(rows, (r) => loopProfile(r, catalog), parsed);
  const mids = rankSmart(midi, midiProfile, parsed);
  const other = useOtherHits(query);
  const words = queryWords(query);
  // How squarely a group's best result names what was typed: orders the groups, so "kick" leads with
  // one-shots and "god's plan" with the song's chords.
  const lead = (name: string | undefined) => (name ? (textMatch([{ text: name, weight: 1 }], words)?.score ?? 0) : 0);
  const pages = useMemo(() => rank(allProducers(), (p) => [{ text: p.name, weight: 4 }], words), [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups: { id: Exclude<SearchKind, "all">; name: string; n: number; close: boolean; top: number; lead: number; render: (all: boolean) => ReactNode }[] = [
    { id: "pages", name: "Producer pages", n: pages.items.length, close: pages.close, top: 4, lead: lead(pages.items[0]?.name), render: (all) => <ProducerPageHits list={pages.items.slice(0, all ? 200 : 4)} /> },
    { id: "presets", name: "Presets", n: other.presets.items.length, close: other.presets.close, top: 5, lead: lead(other.presets.items[0] && `${other.presets.items[0].song} ${other.presets.items[0].artist}`), render: (all) => <PresetHits songs={other.presets.items.slice(0, all ? 200 : 5)} query={query} /> },
    { id: "loops", name: "Loops", n: loops.items.length, close: loops.close, top: 5, lead: lead(loops.items[0] && `${loops.items[0].title} ${loops.items[0].owner.displayName}`), render: (all) => <LoopList label="Loop results" rows={loops.items.slice(0, all ? 200 : 5)} onChange={refresh} /> },
    { id: "midi", name: "MIDI", n: mids.items.length, close: mids.close, top: 6, lead: lead(mids.items[0] && `${mids.items[0].title} ${mids.items[0].song?.artist ?? ""}`), render: (all) => <MidiList label="MIDI results" items={mids.items.slice(0, all ? 200 : 6)} /> },
    { id: "sfx", name: "SFX", n: other.sfx.items.length, close: other.sfx.close, top: 5, lead: lead(other.sfx.items[0]?.name), render: (all) => <SfxHits list={other.sfx.items.slice(0, all ? 200 : 5)} /> },
    { id: "kits", name: "Drum kits", n: other.kits.items.length, close: other.kits.close, top: 4, lead: lead(other.kits.items[0]?.name), render: (all) => <KitHits list={other.kits.items.slice(0, all ? 200 : 4)} /> },
    { id: "shots", name: "One-shots", n: other.shots.items.length, close: other.shots.close, top: 6, lead: lead(other.shots.items[0]?.name), render: (all) => <ShotHits list={other.shots.items.slice(0, all ? 200 : 6)} /> },
    { id: "producers", name: "Producers", n: other.producers.items.length, close: other.producers.close, top: 5, lead: lead(other.producers.items[0] && `${other.producers.items[0].displayName} ${other.producers.items[0].handle}`), render: (all) => <ProducerHits list={other.producers.items.slice(0, all ? 200 : 5)} /> },
  ];
  // Exact answers lead; groups that only have close matches go last.
  const shown = groups.filter((g) => g.n > 0).sort((a, b) => Number(a.close) - Number(b.close) || b.lead - a.lead);
  const active = kind === "all" ? null : (shown.find((g) => g.id === kind) ?? null);
  const empty = query.trim() !== "" && shown.length === 0;
  return (
    <Page>
      <header className="flex flex-col gap-3">
        <h1 className="text-title">{query.trim() ? `Results for “${query.trim()}”` : "Search"}</h1>
        <SmartSearch value={query} onChange={setSearchQuery} examples={["dark piano 140", "omnisphere", "travis scott", "drill 140-145", "police siren", "c minor"]} />
        {shown.length > 0 && (
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            <FilterChip selected={!active} onToggle={() => setKind("all")}>
              All
            </FilterChip>
            {shown.map((g) => (
              <FilterChip key={g.id} selected={active?.id === g.id} onToggle={() => setKind(g.id)}>
                {`${g.name} ${g.n}`}
              </FilterChip>
            ))}
          </div>
        )}
      </header>
      {empty ? (
        <EmptyState
          icon={Search}
          title="No match"
          action={
            <ButtonLink href="/loops" variant="secondary">
              See every loop
            </ButtonLink>
          }
        >
          Check the spelling or search fewer words, like “dark piano 140” or “carti type beat”.
        </EmptyState>
      ) : active ? (
        <section className="flex flex-col gap-3">
          {active.close && <p className="text-small text-text-muted">No exact match. Closest:</p>}
          {active.render(true)}
        </section>
      ) : (
        shown.map((g) => (
          <section key={g.id} aria-label={g.name} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-body-strong text-text">{g.close ? `${g.name} · close matches` : g.name}</h2>
              {g.n > g.top && (
                <Button size="sm" variant="ghost" onClick={() => setKind(g.id)}>
                  {`See all ${g.n}`}
                </Button>
              )}
            </div>
            {g.render(false)}
          </section>
        ))
      )}
    </Page>
  );
}

/** A hand-picked pack: its loops as one queue, the MIDI that fits, and one zip of all of it. */
function PackPage({ id }: { id: string }) {
  const p = pack(id);
  const [rows] = useRows();
  const midi = useMidiItems();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const query = useQuery(p?.midi ?? "");
  if (!p) return <NotFound />;
  const loops = p.loops
    .map((t) => rows.find((r) => r.title === t))
    .filter((r): r is ItemRow => !!r);
  const fits = midi
    .map((m) => ({ m, hit: match(midiProfile(m), query) }))
    .filter((x) => x.hit)
    .sort((a, b) => b.hit!.score - a.hit!.score)
    .slice(0, 8)
    .map((x) => x.m);
  const download = async () => {
    setBusy(true);
    try {
      const files: { name: string; data: Blob }[] = [];
      for (const r of loops) {
        if (!("previewUrl" in r.playable)) continue;
        const res = await fetch(r.playable.previewUrl);
        if (res.ok)
          files.push({
            name: `Loops/${r.title} ${r.bpm ?? ""}bpm.mp3`.replace(/ bpm/, ""),
            data: await res.blob(),
          });
      }
      for (const m of fits)
        files.push({
          name: `MIDI/${m.title}.mid`,
          data: new Blob([writeMidi(m.notes, m.title)]),
        });
      const out = await saveFiles(`${p.name} (Stash pack)`, files, { title: p.name, kind: "Pack", by: "Stash" });
      if (out === "saved")
        toast({
          tone: "success",
          title: "Pack saved",
          description: `${loops.length} loops and ${fits.length} MIDI files.`,
        });
      else if (out === "failed")
        toast({
          tone: "error",
          title: "The pack did not save",
          description: "Try again in a moment.",
        });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <header className="flex flex-col gap-2">
        <span className="text-label text-label-caps text-text-muted">{`Pack · ${PACK_WEEK}`}</span>
        <h1 className="text-title">{p.name}</h1>
        <p className="max-w-prose text-body text-text-muted">{p.blurb}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={Download}
            disabled={busy}
            onClick={() => void download()}
          >
            {busy
              ? "Packing…"
              : `Download pack (${loops.length} loops, ${fits.length} MIDI)`}
          </Button>
          <ButtonLink href="/loops" variant="secondary">
            All loops
          </ButtonLink>
        </div>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-title">{`Loops ${loops.length}`}</h2>
        {renderLoops("Pack loops", loops)}
      </section>
      {fits.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title">{`MIDI that fits ${fits.length}`}</h2>
          <MidiList label="Pack MIDI" items={fits} />
        </section>
      )}
    </Page>
  );
}

/** Under a loop: the loops and MIDI most like it. */
function MoreLikeThis({ row }: { row: ItemRow }) {
  const [rows] = useRows();
  const midi = useMidiItems();
  const me = loopProfile(row, catalog);
  const loops = moreLike(
    me,
    rows.map((r) => ({ r, profile: loopProfile(r, catalog) })),
    6,
  ).map((x) => x.r);
  const pats = moreLike(
    me,
    midi.map((m) => ({ m, profile: midiProfile(m) })),
    6,
  ).map((x) => x.m);
  if (!loops.length && !pats.length) return null;
  return (
    <section
      aria-label="More like this"
      className="mx-auto flex w-full max-w-content flex-col gap-3 px-3 pb-8 tablet:px-4 desktop:px-6"
    >
      <h2 className="text-title">More like this</h2>
      <p className="text-small text-text-muted">
        Same genre and key first, then tempo, sound and mood.
      </p>
      {loops.length > 0 && renderLoops("Similar loops", loops)}
      {pats.length > 0 && <MidiList label="Similar MIDI" items={pats} />}
    </section>
  );
}

/** What each license badge means: every badge on a row and the item page links here. */
function LicensesPage() {
  return (
    <Page>
      <header className="flex flex-col gap-1">
        <h1 className="text-title">Licenses</h1>
        <p className="text-body text-text-muted">Every sound on Stash carries one of these. The badge on a sound says which.</p>
      </header>
      <ul className="flex flex-col gap-4">
        {(Object.keys(LICENSE_LABELS) as (keyof typeof LICENSE_LABELS)[]).map((kind) => (
          <li key={kind} id={kind} className="flex flex-col gap-1">
            <h2 className="text-body-strong">{LICENSE_LABELS[kind].label}</h2>
            <p className="text-body text-text-muted">{LICENSE_LABELS[kind].summary}</p>
          </li>
        ))}
      </ul>
    </Page>
  );
}

function NotInDemo({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconComponent;
  children: string;
}) {
  return (
    <Page>
      <h1 className="text-title">{title}</h1>
      <EmptyState
        icon={icon}
        title="Not in the demo"
        action={
          <ButtonLink href="/" variant="secondary">
            Back to the loops
          </ButtonLink>
        }
      >
        {children}
      </EmptyState>
    </Page>
  );
}

function LoopPage({ publicId }: { publicId: string }) {
  const page = catalog.page(publicId);
  // Read once per visit to the page, so the viewer's like and follow show as left.
  const view = useMemo(
    () =>
      page
        ? {
            page: pageForViewer(page),
            viewer: { signedIn: true },
            source: "local" as const,
          }
        : null,
    [page],
  );
  if (!view) return <NotFound />;
  return (
    <>
      <ItemView key={publicId} view={view} />
      <LoopTools key={`fit-${publicId}`} row={view.page.item} />
      <div className="mx-auto w-full max-w-content px-3 pb-8 tablet:px-4 desktop:px-6">
        <Comments itemId={view.page.item.id} title={view.page.item.title} />
      </div>
      <FlipPanel key={`flip-${publicId}`} row={view.page.item} />
      <MoreLikeThis key={`like-${publicId}`} row={view.page.item} />
    </>
  );
}

function NotFound() {
  return (
    <Page>
      <EmptyState
        icon={Search}
        title="That page isn't here"
        action={
          <ButtonLink href="/" variant="secondary">
            Back home
          </ButtonLink>
        }
      >
        This link points at something the demo does not have. Search above, or start from home.
      </EmptyState>
    </Page>
  );
}

type MidiFilter = "all" | "chords" | "melody" | "bass" | "hats" | "kit" | "kicksnare" | "perc";
const KINDS: MidiFilter[] = ["all", "chords", "melody", "bass", "hats", "kit", "kicksnare", "perc"];
const KIND_NAME: Record<MidiFilter, string> = {
  all: "All",
  chords: "Chords",
  melody: "Melody",
  bass: "Bass",
  hats: "Hi-hats",
  kit: "Drum patterns",
  kicksnare: "Kicks and snares",
  perc: "Percussion",
};
function midiFilter(m: MidiItem, f: MidiFilter): boolean {
  if (f === "all") return true;
  if (f === "chords" || f === "melody" || f === "bass") return m.kind === f;
  if (m.kind !== "drums") return false;
  const part = m.part ?? "kit";
  return f === "kicksnare" ? part === "kick" || part === "snare" : part === f;
}

type Origin = "all" | "packs" | "songs" | "posts";
const ORIGIN_NAME: Record<Origin, string> = {
  all: "Everything",
  packs: "Chord packs",
  songs: "Chords from songs",
  posts: "Producers' patterns",
};
function originOf(m: MidiItem): Origin {
  return m.pack ? "packs" : m.song ? "songs" : "posts";
}
const KEY_ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
/** The styles the chord packs and the songs come in (a progression's first tag, a song's genre), most first. */
const PACK_STYLES = (() => {
  const n = new Map<string, number>();
  for (const p of PACK_PROGRESSIONS) n.set(p.tags[0]!, (n.get(p.tags[0]!) ?? 0) + 1);
  for (const s of BATCH_SONGS) if (s.genre) n.set(s.genre, (n.get(s.genre) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
})();
/** The packs that hold at least one progression in a style. */
const PACKS_BY_STYLE = new Map(PACK_STYLES.map((t) => [t, new Set(PACK_PROGRESSIONS.filter((p) => p.tags[0] === t).map((p) => p.pack))]));
const PAGE = 60;

function AllMidi() {
  const all = useMidiItems();
  const [origin, setOrigin] = useState<Origin>("all");
  const [kind, setKind] = useState<MidiFilter>("all");
  const [q, setQ] = useState("");
  const [style, setStyle] = useState("all");
  const [tempo, setTempo] = useState("all");
  const [keyRoot, setKeyRoot] = useState("all");
  const [keyMode, setKeyMode] = useState("all");
  const [packName, setPackName] = useState<string | null>(null);
  const [allPacks, setAllPacks] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const query = useQuery(q);
  const classics = all.filter((m) => m.classic);
  const [allClassics, setAllClassics] = useState(false);
  const midi = all
    .filter((m) => !m.classic)
    .filter((m) => origin === "all" || originOf(m) === origin)
    .filter((m) => !packName || m.pack?.name === packName)
    .filter((m) => style === "all" || (m.pack ? m.tags[0] === style : m.tags.includes(style)))
    .filter((m) => {
      const band = TEMPO_BANDS.find((b) => b.id === tempo);
      return !band || (m.notes.bpm >= band.min && m.notes.bpm <= band.max);
    })
    .filter((m) => keyRoot === "all" || m.key?.root === KEY_ROOTS.indexOf(keyRoot))
    .filter((m) => keyMode === "all" || m.key?.mode === keyMode)
    .map((m) => ({ m, hit: match(midiProfile(m), query) }))
    .filter((x) => x.hit)
    .sort((a, b) => b.hit!.score - a.hit!.score)
    .map((x) => x.m);
  const [prog, setProg] = useState<string | null>(null);
  const progressions = useMemo(() => {
    const groups = new Map<string, { label: string; minor: boolean; songs: string[] }>();
    for (const m of all) {
      const p = m.song ? progressionOf(m.song) : null;
      if (!p || !m.song) continue;
      const g = groups.get(p.label) ?? { ...p, songs: [] };
      g.songs.push(m.song.song);
      groups.set(p.label, g);
    }
    return [...groups.values()].filter((g) => g.songs.length >= 3).sort((a, b) => b.songs.length - a.songs.length).slice(0, 8);
  }, [all]);
  const kinded = midi.filter((m) => midiFilter(m, kind));
  const shown = prog ? kinded.filter((m) => m.song && progressionOf(m.song)?.label === prog) : kinded;
  const packCounts = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of all) if (m.pack) n.set(m.pack.name, (n.get(m.pack.name) ?? 0) + 1);
    return n;
  }, [all]);
  const packs = CHORD_PACKS.filter((p) => style === "all" || PACKS_BY_STYLE.get(style)?.has(p.name));
  const filtered = style !== "all" || tempo !== "all" || keyRoot !== "all" || keyMode !== "all" || !!packName;
  // A new filter starts the list at its first page again.
  const filterKey = [origin, kind, q, style, tempo, keyRoot, keyMode, packName, prog].join("|");
  const [lastKey, setLastKey] = useState(filterKey);
  if (lastKey !== filterKey) {
    setLastKey(filterKey);
    setLimit(PAGE);
  }
  return (
    <Page>
      <header className="flex flex-col gap-1">
        <h1 className="text-title">MIDI</h1>
      </header>
      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="min-w-0 flex-1">
          <SmartSearch
            value={q}
            onChange={setQ}
            placeholder="Try: c minor 140 like metro"
            examples={[]}
          />
        </div>
        <div
          role="group"
          aria-label="Where it comes from"
          className="flex flex-wrap gap-2"
        >
          {(Object.keys(ORIGIN_NAME) as Origin[]).map((o) => (
            <FilterChip
              key={o}
              selected={origin === o}
              onToggle={() => setOrigin(o)}
            >
              {ORIGIN_NAME[o]}
            </FilterChip>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Filter MIDI" className="flex flex-wrap items-center gap-2">
        <Dropdown
          name="Style"
          value={style === "all" ? "Any" : style}
          selected={style}
          options={[["all", "Any"], ...PACK_STYLES.map((t): [string, string] => [t, t])]}
          onPick={(v) => {
            setStyle(v);
            setPackName(null);
          }}
        />
        <Dropdown
          name="Tempo"
          value={TEMPO_BANDS.find((b) => b.id === tempo)?.label ?? "Any"}
          selected={tempo}
          options={[["all", "Any"], ...TEMPO_BANDS.map((b): [string, string] => [b.id, `${b.label} BPM`])]}
          onPick={setTempo}
        />
        <Dropdown name="Key" value={keyRoot === "all" ? "Any" : keyRoot} selected={keyRoot} options={[["all", "Any"], ...KEY_ROOTS.map((k): [string, string] => [k, k])]} onPick={setKeyRoot} />
        <Dropdown
          name="Scale"
          value={keyMode === "all" ? "Any" : keyMode === "minor" ? "Minor" : "Major"}
          selected={keyMode}
          options={[["all", "Any"], ["minor", "Minor"], ["major", "Major"]]}
          onPick={setKeyMode}
        />
        {packName && (
          <FilterChip selected onToggle={() => setPackName(null)}>
            {packName}
          </FilterChip>
        )}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStyle("all");
              setTempo("all");
              setKeyRoot("all");
              setKeyMode("all");
              setPackName(null);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {!q && packs.length > 0 && (kind === "all" || kind === "chords") && (origin === "all" || origin === "packs") && (
        <section aria-labelledby="chord-packs" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="chord-packs" className="text-title">Chord packs</h2>
            <p className="text-small text-text-muted">{`${packCounts.size} packs, ${[...packCounts.values()].reduce((a, b) => a + b, 0)} voiced progressions written for Stash. Pick a pack to hear every progression in it.`}</p>
          </div>
          <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-4">
            {(allPacks ? packs : packs.slice(0, 8)).map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  aria-pressed={packName === p.name}
                  data-t="midi"
                  onClick={() => {
                    setPackName(packName === p.name ? null : p.name);
                    setOrigin("all");
                  }}
                  className="st-type flex h-full w-full flex-col items-start gap-2 rounded-panel border border-border bg-surface p-4 text-left ui-hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-raised"
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className="st-hero-title text-title text-text">{p.name}</span>
                    <span className="shrink-0 text-small text-text-muted">{p.style}</span>
                  </span>
                  <span className="text-small text-text">{`${packCounts.get(p.name) ?? 0} progressions`}</span>
                  <span className="line-clamp-2 text-small text-text-muted">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
          {packs.length > 8 && (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setAllPacks(!allPacks)}>
              {allPacks ? "Show fewer" : `Show all ${packs.length} packs`}
            </Button>
          )}
        </section>
      )}
      {!q && !filtered && classics.length > 0 && (kind === "all" || kind === "chords") && (
        <section aria-labelledby="classics" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="classics" className="text-title">Classic progressions</h2>
          </div>
          <MidiList label="Classic progressions" items={allClassics ? classics : classics.slice(0, 8)} />
          {classics.length > 8 && (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setAllClassics(!allClassics)}>
              {allClassics ? "Show fewer" : `Show all ${classics.length}`}
            </Button>
          )}
        </section>
      )}
      {progressions.length > 0 && !filtered && (
        <section aria-labelledby="progressions" className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="progressions" className="text-title">Most-used progressions</h2>
              <p className="text-small text-text-muted">The same moves under the biggest songs, in roman numerals so the key doesn&apos;t matter. Pick one to hear every song on it.</p>
            </div>
            {prog && (
              <Button variant="ghost" size="sm" onClick={() => setProg(null)}>
                Show all
              </Button>
            )}
          </div>
          <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-4">
            {progressions.map((g) => (
              <li key={g.label}>
                <button
                  type="button"
                  aria-pressed={prog === g.label}
                  data-t="midi"
                  onClick={() => {
                    setProg(prog === g.label ? null : g.label);
                    setOrigin("all");
                  }}
                  className="st-type flex h-full w-full flex-col items-start gap-2 rounded-panel border border-border bg-surface p-4 text-left ui-hover:border-border-strong aria-pressed:border-accent aria-pressed:bg-raised"
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className="st-hero-title text-title text-text">{g.label}</span>
                    <span className="shrink-0 text-small text-text-muted">{g.minor ? "Minor" : "Major"}</span>
                  </span>
                  <span className="text-small text-text">{`${g.songs.length} songs`}</span>
                  <span className="line-clamp-2 text-small text-text-muted">{g.songs.slice(0, 4).join(", ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <FilterChip key={k} selected={kind === k} onToggle={() => setKind(k)}>
            {KIND_NAME[k]}
          </FilterChip>
        ))}
      </div>
      <MidiList label="MIDI" items={shown.slice(0, limit)} />
      {shown.length === 0 && <p className="text-body text-text-muted">Nothing matches. Clear a filter or the search.</p>}
      {shown.length > limit && (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setLimit(limit + PAGE)}>
          {`Show ${Math.min(PAGE, shown.length - limit)} more of ${shown.length}`}
        </Button>
      )}
    </Page>
  );
}

const TABS = [
  { href: "/", name: "Home" },
  { href: "/loops", name: "Loops" },
  { href: "/midi", name: "MIDI" },
  { href: "/kits", name: "Drums" },
  { href: "/one-shots", name: "One-shots" },
  { href: "/sfx", name: "SFX" },
  { href: "/presets", name: "Presets" },
  { href: "/samples", name: "Samples" },
  { href: "/producers", name: "Producers" },
  { href: "/upload", name: "Upload" },
];

/** The demo's own tabs across the top of every page, for the screens the app's rail does not list yet. */
function DemoTabs() {
  const path = usePath();
  const current = (href: string) =>
    href === "/"
      ? path === "/"
      : path === href ||
        (href === "/midi" && path.startsWith("/midi")) ||
        (href === "/presets" && path.startsWith("/presets/")) ||
        (href === "/samples" && (path.startsWith("/samples") || path.startsWith("/sampled/")) && !path.startsWith("/samples-producer/")) ||
        (href === "/producers" && (path.startsWith("/producer/") || path.startsWith("/samples-producer/"))) ||
        (href === "/kits" &&
          (path.startsWith("/kit/") || path === "/kit-upload"));
  // On a phone the strip scrolls: keep the current tab in view (opening Samples from a link shows it).
  const strip = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const ul = strip.current;
    const tab = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!ul || !tab || ul.scrollWidth <= ul.clientWidth) return;
    const left = tab.offsetLeft - ul.offsetLeft;
    if (left < ul.scrollLeft || left + tab.offsetWidth > ul.scrollLeft + ul.clientWidth - 48)
      ul.scrollTo({ left: Math.max(0, left - 24), behavior: "smooth" });
  }, [path]);
  return (
    <nav aria-label="Demo sections" className="border-b border-border bg-bg">
      <ul ref={strip} className="mx-auto flex max-w-content gap-1 overflow-x-auto px-3 tablet:px-4 desktop:px-6">
        {TABS.map((t) => (
          <li key={t.href} className="shrink-0">
            <UiLink
              href={t.href}
              aria-current={current(t.href) ? "page" : undefined}
              className={`flex h-11 items-center border-b-2 px-3 text-body-strong ${current(t.href) ? "border-accent text-text" : "border-transparent text-text-muted ui-hover:text-text"}`}
            >
              {t.name}
            </UiLink>
          </li>
        ))}
        <li className="sticky right-0 ml-auto flex shrink-0 items-center bg-bg pl-1">
          {/* On a phone the tabs scroll under this icon: fade them out instead of cutting a word. */}
          <span aria-hidden className="pointer-events-none absolute top-0 right-full h-full w-6 bg-linear-to-l from-bg to-transparent desktop:hidden" />
          <IconLink href="/library" icon={LibraryIcon} label="Your crates and license receipts" aria-current={path === "/library" ? "page" : undefined} />
        </li>
      </ul>
    </nav>
  );
}

// The demo keeps Browse and Library out of the app's rail and phone tab bar: the demo tabs list the
// catalog, and crates and receipts sit behind the Library icon at the end of the demo tabs.
for (let i = navItems.length - 1; i >= 0; i--) if (navItems[i]!.href === "/browse/loops" || navItems[i]!.href === "/library") navItems.splice(i, 1);

function Route() {
  const path = usePath();
  useEffect(() => {
    const page = /^\/loop\/(?:.*-)?([a-z0-9]+)$/.exec(path);
    const midiPage = /^\/midi\/(?:.*-)?([a-z0-9]+)$/.exec(path);
    const title = page
      ? catalog.page(page[1]!)?.item.title
      : midiPage
        ? midiItem(midiPage[1]!)?.title
        : null;
    const producer = /^\/producer\/([a-z0-9-]+)$/.exec(path);
    const name = title ?? (producer ? producerBySlug(producer[1]!)?.name : null);
    document.title = name ? `${name} · Stash demo` : "Stash demo";
  }, [path]);
  const loop = /^\/loop\/(?:.*-)?([a-z0-9]+)$/.exec(path);
  if (loop) return <LoopPage publicId={loop[1]!} />;
  const midi = /^\/midi\/(?:.*-)?([a-z0-9]+)$/.exec(path);
  if (midi) return <MidiPage key={midi[1]} publicId={midi[1]!} />;
  if (path === "/") return <Home />;
  if (path.startsWith("/browse")) return <BrowseRoute />;
  if (path === "/search") return <SearchResults />;
  if (path === "/upload") return <UploadHub />;
  if (path === "/midi") return <AllMidi />;
  if (path === "/one-shots") return <OneShotsPage />;
  if (path === "/sfx") return <SfxPage />;
  if (path === "/sound-design") return <SoundDesign />;
  if (path === "/presets") return <PresetsPage />;
  if (path.startsWith("/presets/"))
    return <PresetSongPage key={path} slug={path.slice(9)} />;
  if (path === "/samples") return <SamplesPage />;
  if (path.startsWith("/samples/")) return <SampleSongPage key={path} slug={path.slice(9)} />;
  if (path.startsWith("/sampled/")) return <OriginalPage key={path} slug={path.slice(9)} />;
  if (path.startsWith("/samples-artist/")) return <SampleArtistPage key={path} slug={path.slice(16)} />;
  if (path.startsWith("/samples-producer/")) {
    // The samples tab's producer links open the full producer page when there is one.
    const spName = SAMPLE_PRODUCER_NAMES[path.slice(18)];
    const full = spName ? producerNamed(spName) : null;
    if (full) return <ProducerRoute key={full.slug} slug={full.slug} />;
    return <SampleProducerPage key={path} slug={path.slice(18)} />;
  }
  if (path === "/producers") return <ProducersPage />;
  if (path.startsWith("/producer/")) return <ProducerRoute key={path} slug={path.slice(10)} />;
  if (path === "/library") return <LibraryRoute />;
  if (path === "/kits") return <KitsPage />;
  if (path === "/creators") return <CreatorsRoute />;
  const kitPage = /^\/kit\/([a-z0-9]+)$/.exec(path);
  if (kitPage) return <KitPage key={kitPage[1]} id={kitPage[1]!} />;
  if (path === "/kit-upload") return <KitUploadPage />;
  if (path.startsWith("/pack/")) return <PackPage id={path.slice(6)} />;
  if (path === "/loops") return <LoopsRoute />;
  if (path === "/licenses") return <LicensesPage />;
  if (path === "/notifications")
    return (
      <NotInDemo title="Notifications" icon={Bell}>
        Notifications arrive when producers you follow post. The demo has no
        account to send them to.
      </NotInDemo>
    );
  const profile = /^\/u\/([a-z0-9_]+)$/.exec(path);
  if (profile) return <ProfileRoute handle={profile[1]!} />;
  if (path === "/login")
    return (
      <NotInDemo title="Profile" icon={User}>
        Sign-in and profiles need an account. In the demo you are already
        treated as signed in.
      </NotInDemo>
    );
  return <NotFound />;
}

function App() {
  // Canvases (waveforms, the piano roll) read the theme when they mount: a new look remounts the page.
  const look = useLook();
  return (
    <LinkProvider component={HashLink}>
      <TooltipProvider>
        <ToastProvider viewport={false}>
          <AppShell>
            <DemoTabs />
            <Suspense fallback={null}>
              <Route key={look} />
            </Suspense>
            <NewCrateHost />
          </AppShell>
        </ToastProvider>
      </TooltipProvider>
    </LinkProvider>
  );
}

startLooks();
// iPhones mute Web Audio with the ring switch unless the page says it plays media (Safari 17+).
try {
  const session = (navigator as { audioSession?: { type: string } })
    .audioSession;
  if (session) session.type = "playback";
} catch {
  // Older Safari: nothing to set.
}
startRouter(catalog.hrefOf, (id) => midiItem(id)?.href ?? null);

// Any app link that is not a packages/ui link (plain anchors) stays in the page.
document.addEventListener("click", (e) => {
  if (
    e.defaultPrevented ||
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey
  )
    return;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  const href = a?.getAttribute("href");
  if (a && href?.startsWith("/")) {
    e.preventDefault();
    navigate(href);
  }
});
// The top bar's search form searches the demo's loops instead of leaving the page.
document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (form.getAttribute("role") === "search") {
    setSearchQuery(String(new FormData(form).get("q") ?? ""));
    navigate("/search");
  }
});

document.body.className = "h-dvh overflow-hidden bg-bg text-text";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// Once the page has loaded and gone idle, download (without running) the parts that load later, so
// opening the Samples tab does not wait on the network. scripts/build-demo-app.mjs lists them.
window.addEventListener(
  "load",
  () => {
    const go = () => {
      let later: string[] = [];
      try {
        later = JSON.parse(document.getElementById("demo-later")?.textContent ?? "[]") as string[];
      } catch {
        return;
      }
      for (const href of later) {
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.href = href;
        document.head.append(link);
      }
    };
    if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 5000 });
    else setTimeout(go, 2000);
  },
  { once: true },
);
