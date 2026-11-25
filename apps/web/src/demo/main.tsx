import {
  StrictMode,
  useEffect,
  useMemo,
  useState,
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
import { DemoShell } from "./shell";
import { BRAND } from "./brand";
import { nowPlaying } from "../app/_shell/now-playing";
import { ItemView } from "../app/_item/item-view";
import { buildCatalog, type Catalog } from "./data";
import { HashLink } from "./hash-link";
import { navigate, startRouter, usePath } from "./router";
import { setSearchQuery, useSearchQuery } from "./search-store";
import { has, set } from "./store";
import { startLooks, useLook } from "./looks";
import { midiItem, type MidiItem } from "./midi/catalog";
import { MidiList, MidiPage, useMidiItems } from "./midi/pages";
import { progressionOf } from "./midi/songs";
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
  ProfilePage,
  producerByHandle,
  useCrateEntries,
  type RenderLoops,
} from "./explore";
import { FlipPanel } from "./flip";
import { LoopTools } from "./loop-tools";
import { Comments, trendScore } from "./social";
import { LoopsPage } from "./loops";
import { pack, PACK_WEEK } from "./packs";
import { ALL_SONGS, madeBy, songHref, TOP_PRODUCERS } from "./presets/songs";
import { PRESETS, type Confidence } from "./presets/data";
import { Cover, coverFor } from "./presets/cover";
import { kits } from "./kits/store";
import { saveFiles, saveLoopRow } from "./save";
import { SmartSearch, useQuery } from "./search-ui";
import { KitHits, PresetHits, ProducerHits, ShotHits, SfxHits, useOtherHits } from "./search-page";
import { queryWords, textMatch } from "./text-match";
import { loopProfile, midiProfile } from "./search-index";
import { match, moreLike } from "./smart-search";
import { writeMidi } from "./midi/write";
import { KitPage, KitsPage, KitUploadPage } from "./kits/pages";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Button,
  Disc3,
  Download,
  Drum,
  FilterChip,
  Flame,
  Icon,
  KeyboardMusic,
  Piano,
  PlayButton,
  SearchInput,
  TypeChip,
  UiLink,
  Waveform,
  describeRow,
} from "@stash/ui";
import { formatKey } from "@stash/contracts/format";
import { PageFrame, PageHeader, SectionTitle } from "./layout";

/**
 * The browser-only demo (ticket 137): the real shell, player bar, result rows, loop page and audio
 * engine, fed by the demo catalog instead of the database, on a hash router. No server, no account.
 */

const catalog: Catalog = buildCatalog(document.baseURI);

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
      followersCount: page.owner.followersCount + (follows ? 1 : 0),
    },
    moreFromOwner: page.moreFromOwner.map(withViewer),
    similar: page.similar.map(withViewer),
  };
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
  return <PageFrame>{children}</PageFrame>;
}

const TODAY = Math.floor(Date.now() / 86_400_000);

const RARITY: Record<Confidence, { name: string; text: string }> = {
  producer: { name: "Producer confirmed", text: "text-accent" },
  engineer: { name: "Engineer confirmed", text: "text-type-midi" },
  press: { name: "From an interview", text: "text-type-loop" },
  community: { name: "Community found", text: "text-text-muted" },
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

function SectionHead({ title, sub, href, more, id }: { title: string; sub?: string; href?: string; more?: string; id?: string }) {
  return (
    <SectionTitle
      id={id}
      title={title}
      sub={sub}
      action={
        href && more ? (
          <UiLink href={href} className="group inline-flex shrink-0 items-center gap-1 text-small font-semibold text-text-muted ui-hover:text-text">
            {more}
            <Icon icon={ArrowRight} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </UiLink>
        ) : undefined
      }
    />
  );
}

const GENRES = ["Trap", "Rage", "Pluggnb", "Drill", "Jersey club", "Boom bap", "Phonk", "R&B", "Detroit", "Lo-fi", "Afrobeats", "Memphis"];

/** The hero's equalizer: resting low, moving while anything plays. Decoration only. */
const EQ = Array.from({ length: 40 }, (_, i) => 16 + Math.round(76 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21))));
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

/** The bento's right card: the loop most played this week, ready on one press. */
function FeaturedLoop({ list }: { list: ItemRow[] }) {
  const engine = getEngine();
  const status = usePlayerState((s) => s.status);
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  const toast = useToast();
  const row = list[0];
  if (!row) return null;
  const on = currentId === row.playable.id && status !== "idle";
  const state: PlayState = on ? status : "paused";
  const key = row.key ? formatKey(row.key) : "—";
  return (
    <aside aria-label="Featured loop" className="hm-feature" data-on={(on && status === "playing") || undefined}>
      <span className="hm-feature-glow" aria-hidden="true" />
      <div className="relative flex items-center justify-between gap-3">
        <span className="ds-eyebrow inline-flex items-center gap-2">
          <Icon icon={Flame} className="text-accent" />
          Most played this week
        </span>
        <TypeChip type="loop" />
      </div>
      <div className="relative flex items-center gap-4">
        <PlayButton size="hero" title={row.title} state={state} onClick={() => void nowPlaying().playFrom(engine, list, 0)} />
        <div className="flex min-w-0 flex-col">
          <UiLink href={row.href} className="truncate font-display text-h2 text-text ui-hover:underline">
            {row.title}
          </UiLink>
          <UiLink href={`/u/${row.owner.handle}`} className="truncate text-small text-text-muted ui-hover:text-text">
            {`@${row.owner.handle}`}
          </UiLink>
        </div>
      </div>
      <div className="ds-wave-fill ds-wave-tall relative my-auto">
        <Waveform peaks={row.peaks} type={row.type} label={describeRow(row)} durationMs={row.durationMs} />
      </div>
      <dl className="relative grid grid-cols-3 gap-2">
        {[
          ["BPM", String(row.bpm ?? "—")],
          ["Key", key],
          ["Bars", String(row.length?.value ?? "—")],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 rounded-tile bg-surface-2/60 px-3 py-2">
            <dt className="ds-eyebrow">{k}</dt>
            <dd className="text-h3 tabular text-text">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="relative flex gap-2">
        <Button
          variant="secondary"
          icon={Download}
          className="flex-1"
          onClick={() =>
            void saveLoopRow(row)
              .then(({ outcome, name }) => {
                if (outcome === "saved") toast({ tone: "success", title: "Downloaded", description: name });
                else if (outcome === "failed") throw new Error(name);
              })
              .catch(() => toast({ tone: "error", title: "The download did not start", description: "Try again in a moment." }))
          }
        >
          Download
        </Button>
        <ButtonLink href={row.href} variant="ghost" icon={ArrowUpRight}>
          Open
        </ButtonLink>
      </div>
    </aside>
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
  const hot = trending(rows);
  const collage = SHELF.filter((s) => coverFor(s.song, s.artist)).slice(0, 3);
  const tiles: { href: string; t: string; name: string; count: number; blurb: string; icon: IconComponent; big?: boolean; wide?: boolean }[] = [
    { href: "/presets", t: "preset", name: "Presets", count: PRESETS.length, blurb: `The exact synth patches behind ${ALL_SONGS.length} songs.`, icon: Disc3, big: true },
    { href: "/kits", t: "kit", name: "Drums", count: kits().reduce((n, k) => n + k.sounds.length, 0), blurb: "Full kits and single hits, ready to drag in.", icon: Drum, wide: true },
    { href: "/midi", t: "midi", name: "MIDI", count: midi.length, blurb: "Chords from the songs, played on real drums.", icon: KeyboardMusic, wide: true },
    { href: "/loops", t: "loop", name: "Loops", count: rows.length, blurb: "Tempo-synced and key-shifted as you listen.", icon: AudioLines, wide: true },
    { href: "/one-shots", t: "oneshot", name: "One-shots", count: MELODIC.length, blurb: "Every note, all 12 keys.", icon: Piano },
    { href: "/sfx", t: "sfx", name: "SFX", count: SFX.length, blurb: "Sirens, horns, risers.", icon: Flame },
  ];
  const search = (text: string) => {
    setSearchQuery(text);
    navigate("/search");
  };
  return (
    <PageFrame>
      <div className="hm-bento">
        <section aria-labelledby="hero-title" className="hm-hero">
          <HeroEq />
          <div className="relative flex flex-col gap-5">
            <ul aria-label="The deal" className="flex flex-wrap gap-x-5 gap-y-1 text-small text-text-muted">
              {["Free. No credits, no trials", "Plays on first click", "Original files"].map((x) => (
                <li key={x} className="inline-flex items-center gap-2">
                  <span className="st-check" aria-hidden="true" />
                  {x}
                </li>
              ))}
            </ul>
            <h1 id="hero-title" className="max-w-3xl">
              Free sounds that <span className="st-grad">actually hit.</span>
            </h1>
            <form
              role="search"
              className="flex w-full max-w-2xl gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                search(q);
              }}
            >
              <SearchInput
                label="Search sounds"
                hideLabel
                shortcut=""
                placeholder="Try “dark piano 140 like metro”"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onClear={() => setQ("")}
                className="min-w-0 flex-1"
              />
              <Button type="submit" variant="primary">
                Search
              </Button>
            </form>
            <div role="group" aria-label="Genres" className="hm-chips">
              {GENRES.slice(0, 8).map((g) => (
                <FilterChip key={g} onToggle={() => search(g)}>
                  {g}
                </FilterChip>
              ))}
            </div>
          </div>
        </section>

        <FeaturedLoop list={hot.slice(0, 6)} />

        <ul aria-label="Sound types" className="hm-tiles">
          {tiles.map((t) => (
            <li key={t.href} className={t.big ? "hm-tile-big" : undefined} data-span={t.wide ? 2 : undefined}>
              <UiLink href={t.href} data-t={t.t} className={`hm-tile h-full ${t.big ? "hm-tile-big" : ""}`}>
                {t.big && (
                  <span className="hm-collage" aria-hidden="true">
                    {collage.map((s, i) => (
                      <span key={s.slug} style={{ ["--r" as string]: `${(i - 1) * 7}deg` }}>
                        <Cover song={s.song} artist={s.artist} size="fill" />
                      </span>
                    ))}
                  </span>
                )}
                <span className="hm-tile-icon">
                  <Icon icon={t.icon} size={20} />
                </span>
                <span className="relative flex flex-col gap-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`font-display ${t.big ? "text-h1" : "text-h2"} text-text`}>{t.name}</span>
                    <span className="text-small font-medium tabular text-text-muted">{t.count.toLocaleString("en")}</span>
                  </span>
                  <span className="text-small text-text-muted">{t.blurb}</span>
                </span>
              </UiLink>
            </li>
          ))}
        </ul>
      </div>

      <section aria-labelledby="trending" className="ds-section">
        <SectionHead id="trending" title="Trending now" sub="What producers are pulling this week." href="/loops" more={`All ${rows.length} loops`} />
        <LoopList label="Trending now" rows={hot.slice(0, 6)} onChange={refresh} />
      </section>

      <section aria-labelledby="songs-shelf" className="ds-section">
        <SectionHead id="songs-shelf" title="Presets behind the songs" sub="The synth, the bank, the patch name. Sourced." href="/presets" more={`All ${ALL_SONGS.length} songs`} />
        <ul className="st-shelf ds-scroll-x gap-4 pb-2">
          {SHELF.map((s) => {
            const r = RARITY[BY_LEVEL[s.best] ?? "community"];
            return (
              <li key={s.slug} className="w-40 tablet:w-48">
                <UiLink href={songHref(s.song, s.artist)} className="ds-card ps-card h-full">
                  <span className="ds-art">
                    <Cover song={s.song} artist={s.artist} size="fill" placeholder />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 px-1">
                    <span className="truncate text-body-strong text-text">{s.song}</span>
                    <span className="truncate text-small text-text-muted">{s.artist}</span>
                    <span className={`truncate text-small ${r.text}`}>{`${s.entries.length} ${s.entries.length === 1 ? "sound" : "sounds"} · ${r.name}`}</span>
                  </span>
                </UiLink>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="producers" className="ds-section">
        <SectionHead id="producers" title="Producers behind the songs" href="/presets" more="All presets" />
        <ul className="st-shelf ds-scroll-x gap-5 pb-2">
          {TOP_PRODUCERS.slice(0, 12).map(([name, n]) => {
            const first = ALL_SONGS.find((s) => madeBy(s, name));
            return (
              <li key={name} className="w-24 tablet:w-28">
                <UiLink href={first ? songHref(first.song, first.artist) : "/presets"} className="group flex flex-col items-center gap-2 text-center">
                  <span
                    data-hue={hueOf(name)}
                    className="st-avatar flex size-24 items-center justify-center rounded-full font-display text-h2 transition-transform duration-300 ease-spring group-hover:scale-105 tablet:size-28"
                    aria-hidden="true"
                  >
                    {initialsOf(name)}
                  </span>
                  <span className="w-full truncate text-body-strong text-text">{name}</span>
                  <span className="text-small tabular text-text-muted">{`${n} songs`}</span>
                </UiLink>
              </li>
            );
          })}
        </ul>
      </section>

      {songs.length > 0 && (
        <section aria-labelledby="chords" className="ds-section">
          <SectionHead id="chords" title="Chords from the songs" sub="Play them on the real drum sounds, drag the MIDI into your DAW." href="/midi" more={`All ${songs.length} songs`} />
          <MidiList label="Song chords" items={songs.slice(0, 6)} />
        </section>
      )}

      <nav aria-label="More genres" className="st-ticker -mx-3 overflow-hidden tablet:mx-0">
        <ul className="st-ticker-track flex w-max gap-3">
          {[...GENRES, ...GENRES].map((g, i) => (
            <li key={`${g}-${i}`} aria-hidden={i >= GENRES.length || undefined}>
              <button
                type="button"
                tabIndex={i >= GENRES.length ? -1 : undefined}
                onClick={() => search(g)}
                className="st-ticker-item font-display text-h1 text-text-subtle transition-colors duration-200 ui-hover:text-text"
              >
                {g}
                <span aria-hidden="true" className="ml-3 text-accent">✦</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="post" className="st-cta flex flex-col gap-6 p-8 tablet:flex-row tablet:items-end tablet:justify-between tablet:p-12">
        <div className="relative flex flex-col gap-3">
          <h2 id="post">
            Post a sound.
            <br />
            Get followed.
          </h2>
          <p className="max-w-prose text-body font-medium">Heard in one tap. Credited on every download.</p>
        </div>
        <div className="relative flex flex-wrap gap-2">
          {[
            ["/upload", "Upload a loop"],
            ["/kit-upload", "Post a kit"],
            ["/one-shots", "Post one-shots"],
          ].map(([href, label]) => (
            <UiLink
              key={href}
              href={href!}
              className="inline-flex h-11 items-center rounded-pill bg-bg px-5 text-body-strong text-text transition-transform duration-200 ease-spring ui-hover:-translate-y-0.5 ui-active:scale-95"
            >
              {label}
            </UiLink>
          ))}
        </div>
      </section>
    </PageFrame>
  );
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
  return (
    <ProfilePage
      key={handle}
      handle={handle}
      catalog={catalog}
      rows={rows}
      renderLoops={renderLoops}
    />
  );
}

function LibraryRoute() {
  const [rows] = useRows();
  return (
    <LibraryPage catalog={catalog} rows={rows} renderLoops={renderLoops} />
  );
}

type SearchKind = "all" | "loops" | "midi" | "presets" | "sfx" | "kits" | "shots" | "producers";
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
  const groups: { id: Exclude<SearchKind, "all">; name: string; n: number; close: boolean; top: number; lead: number; render: (all: boolean) => ReactNode }[] = [
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
          Check the spelling, or search fewer words.
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
      const out = await saveFiles(`${p.name} (Stash pack)`, files);
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
        title="That loop isn't here"
        action={
          <ButtonLink href="/" variant="secondary">
            Back to the loops
          </ButtonLink>
        }
      >
        The demo has five loops. This link points at something else.
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

type Origin = "all" | "songs" | "posts";
const ORIGIN_NAME: Record<Origin, string> = {
  all: "Everything",
  songs: "Chords from songs",
  posts: "Producers' patterns",
};

function AllMidi() {
  const all = useMidiItems();
  const [origin, setOrigin] = useState<Origin>("all");
  const [kind, setKind] = useState<MidiFilter>("all");
  const [q, setQ] = useState("");
  const query = useQuery(q);
  const classics = all.filter((m) => m.classic);
  const [allClassics, setAllClassics] = useState(false);
  const midi = all
    .filter((m) => !m.classic)
    .filter((m) => origin === "all" || (origin === "songs") === !!m.song)
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
  return (
    <Page>
      <PageHeader
        eyebrow="Ideas"
        title="MIDI"
        lede="Chord progressions from the songs and producers' patterns. Every preview plays on real drum sounds; drag the file straight into your DAW."
        count={
          <span>
            <b>{all.length.toLocaleString("en")}</b> MIDI files
          </span>
        }
      />
      <div className="ds-toolbar flex-col !items-stretch gap-3 tablet:flex-row tablet:!items-center tablet:justify-between">
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
      {!q && classics.length > 0 && (kind === "all" || kind === "chords") && (
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
      {progressions.length > 0 && (
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
                  className="ds-pick flex h-full w-full flex-col items-start gap-2 p-4 text-left"
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className="font-display text-h2 text-text">{g.label}</span>
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
      <div role="group" aria-label="Kind" className="ds-scroll-x tablet:mx-0 tablet:flex-wrap tablet:px-0">
        {KINDS.map((k) => (
          <FilterChip key={k} selected={kind === k} onToggle={() => setKind(k)}>
            {KIND_NAME[k]}
          </FilterChip>
        ))}
      </div>
      <MidiList label="MIDI" items={shown} />
    </Page>
  );
}

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
    document.title = title ? `${title} · ${BRAND.name}` : `${BRAND.name} · ${BRAND.tagline}`;
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
  if (path === "/library") return <LibraryRoute />;
  if (path === "/kits") return <KitsPage />;
  const kitPage = /^\/kit\/([a-z0-9]+)$/.exec(path);
  if (kitPage) return <KitPage key={kitPage[1]} id={kitPage[1]!} />;
  if (path === "/kit-upload") return <KitUploadPage />;
  if (path.startsWith("/pack/")) return <PackPage id={path.slice(6)} />;
  if (path === "/loops") return <LoopsRoute />;
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
          <DemoShell>
            <Route key={look} />
            <NewCrateHost />
          </DemoShell>
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
