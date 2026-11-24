import {
  StrictMode,
  useEffect,
  useMemo,
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
import { nowPlaying } from "../app/_shell/now-playing";
import { ItemView } from "../app/_item/item-view";
import { buildCatalog, type Catalog } from "./data";
import { HashLink } from "./hash-link";
import { navigate, startRouter, usePath } from "./router";
import { has, set } from "./store";
import { startLooks, useLook } from "./looks";
import { Sprite, spriteForRole } from "./pixel";
import { midiItem } from "./midi/catalog";
import { MidiList, MidiPage, UploadPage, useMidiItems } from "./midi/pages";
import { PresetsPage } from "./presets/page";
import { PresetSongPage } from "./presets/song-page";
import { SoundDesign } from "./sound-design";
import {
  BrowsePage,
  LibraryPage,
  NewCrateHost,
  ProfilePage,
  useCrateEntries,
  type RenderLoops,
} from "./explore";
import { FlipPanel } from "./flip";
import { LoopsPage } from "./loops";
import { pack, PACK_WEEK } from "./packs";
import { songHref } from "./presets/songs";
import { PRESETS, type Confidence } from "./presets/data";
import { kits } from "./kits/store";
import { saveFiles } from "./save";
import { SmartSearch, useQuery } from "./search-ui";
import { loopProfile, midiProfile } from "./search-index";
import { match, moreLike } from "./smart-search";
import { writeMidi } from "./midi/write";
import { KitPage, KitsPage, KitUploadPage } from "./kits/pages";
import type { MidiKind } from "@stash/contracts";
import { Button, Download, FilterChip, UiLink } from "@stash/ui";

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
      <ResultList label={label}>
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
            onDownload={() => navigate(r.href)}
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
  return (
    <main className="mx-auto flex max-w-content flex-col gap-8 px-3 py-8 tablet:px-4 desktop:px-6">
      {children}
    </main>
  );
}

const TODAY = Math.floor(Date.now() / 86_400_000);

const RARITY: Record<
  Confidence,
  { name: string; frame: string; text: string; mark: string }
> = {
  producer: {
    name: "Legendary",
    frame: "px-frame-y",
    text: "px-c-yellow",
    mark: "★",
  },
  engineer: { name: "Epic", frame: "px-frame-p", text: "px-c-pink", mark: "♦" },
  press: { name: "Rare", frame: "px-frame-b", text: "px-c-blue", mark: "◆" },
  community: {
    name: "Common",
    frame: "px-frame-g",
    text: "px-c-lav",
    mark: "●",
  },
};

/** One of each rarity that names a preset, so the home page shows what the grades mean. */
const LOOT = (["producer", "press", "community"] as Confidence[]).flatMap(
  (c) => {
    const row = PRESETS.find((p) => p.confidence === c && p.preset);
    return row ? [row] : [];
  },
);

function Home() {
  const [rows, refresh] = useRows();
  const midi = useMidiItems();
  const songs = useMemo(() => {
    const list = midi.filter((m) => m.song);
    // A different handful each day, so the home page does not always open on the same artist.
    return list
      .map((m, i) => ({ m, k: (i * 7919 + TODAY * 104729) % 9973 }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.m);
  }, [midi]);
  const modes = [
    {
      href: "/loops",
      name: "Loops",
      blurb: "Play, then change tempo and key while it plays",
      count: `${rows.length}`,
    },
    {
      href: "/presets",
      name: "Presets behind the songs",
      blurb: "The synth and patch on the records you know",
      count: `${PRESETS.length}`,
    },
    {
      href: "/midi",
      name: "Chords from the songs",
      blurb: "Real progressions at their key and tempo",
      count: `${songs.length}`,
    },
    {
      href: "/kits",
      name: "Drum kits",
      blurb: "Kicks, 808s, snares and hats",
      count: `${kits().length}`,
    },
    {
      href: "/sound-design",
      name: "Sound design",
      blurb: "Knobs, a scope and your keyboard",
      count: "",
    },
    {
      href: "/browse",
      name: "Dig by key and tempo",
      blurb: "A BPM range, a key and the keys that mix",
      count: "",
    },
  ];
  return (
    <Page>
      <section className="grid grid-cols-1 items-center gap-8 desktop:grid-cols-2">
        <div className="flex flex-col gap-5">
          <span className="px-caps text-small px-c-peach">
            ★ Player 1 · New game
          </span>
          <h1 aria-label="Find it. Hear it. Flip it." className="flex flex-col">
            <span className="px-title-line px-c-yellow">Find it.</span>
            <span className="px-title-line px-c-pink">Hear it.</span>
            <span className="px-title-line px-c-blue">Flip it.</span>
          </h1>
          <p className="max-w-prose text-body text-text-muted">
            Loops, drum kits, MIDI and the exact presets behind the songs, for
            producers done digging through YouTube. Every sound plays the second
            you press it.
          </p>
          <div className="flex flex-wrap gap-4">
            <ButtonLink href="/loops" variant="primary">
              ▶ Start digging
            </ButtonLink>
            <ButtonLink href="/presets" variant="secondary">
              Presets behind the songs
            </ButtonLink>
          </div>
        </div>
        <div className="px-stage" aria-hidden="true">
          <span className="px-bubble px-caps text-small">{`${rows[0]?.bpm ?? 140} bpm, let's go!`}</span>
          <Sprite id="speaker" size={56} />
          <Sprite id="producer" size={176} className="px-bob" />
          <Sprite id="sampler" size={150} />
        </div>
      </section>

      <section aria-labelledby="modes" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="modes" className="text-title">
            Select mode
          </h2>
          <span className="px-caps text-small text-text-muted">
            Pick one to play
          </span>
        </div>
        <ul className="px-frame px-menu grid grid-cols-1 tablet:grid-cols-2">
          {modes.map((m) => (
            <li key={m.href}>
              <UiLink href={m.href}>
                <span className="px-cur px-blink">▶</span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-body-strong text-text">{m.name}</span>
                  <span className="truncate text-small text-text-muted">
                    {m.blurb}
                  </span>
                </span>
                <span className="px-caps text-small px-c-yellow">
                  {m.count}
                </span>
              </UiLink>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="loot" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="loot" className="text-title">
            Loot: presets behind the songs
          </h2>
          <ButtonLink href="/presets" variant="ghost" size="sm">
            {`All ${PRESETS.length}`}
          </ButtonLink>
        </div>
        <ul className="grid grid-cols-1 gap-6 px-1 py-1 tablet:grid-cols-3">
          {LOOT.map((e) => {
            const r = RARITY[e.confidence];
            return (
              <li
                key={`${e.song}-${e.preset}`}
                className={`px-frame ${r.frame}`}
              >
                <UiLink
                  href={songHref(e.song, e.artist)}
                  className="flex items-center gap-4 p-4"
                >
                  <span className="px-slot size-16">
                    <Sprite id={spriteForRole(e.role)} size={44} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className={`px-caps text-small ${r.text}`}
                    >{`${r.mark} ${r.name}`}</span>
                    <span className="truncate text-title text-text">
                      {e.preset}
                    </span>
                    <span className="truncate text-small text-text-muted">{`${e.song} · ${e.plugin}`}</span>
                  </span>
                </UiLink>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-title">Sound test</h2>
          <span className="px-caps text-small text-text-muted">
            Space plays · arrows pick
          </span>
        </div>
        <LoopList label="Sound test" rows={rows} onChange={refresh} />
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-title">MIDI, live in the piano roll</h2>
          <ButtonLink href="/midi" variant="ghost" size="sm">
            {`All ${midi.length} MIDI`}
          </ButtonLink>
        </div>
        <MidiList
          label="MIDI"
          items={midi.filter((m) => !m.song).slice(0, 6)}
        />
      </section>
      {songs.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-title">Chords from the songs</h2>
            <ButtonLink href="/midi" variant="ghost" size="sm">
              {`All ${songs.length} songs`}
            </ButtonLink>
          </div>
          <MidiList label="Song chords" items={songs.slice(0, 6)} />
        </section>
      )}
    </Page>
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

function SearchResults() {
  const [rows, refresh] = useRows();
  const query = useSearchQuery();
  const parsed = useQuery(query);
  const ranked = <T,>(list: T[], prof: (x: T) => Parameters<typeof match>[0]) =>
    list
      .map((x) => ({ x, hit: match(prof(x), parsed) }))
      .filter((r) => r.hit)
      .sort((a, b) => b.hit!.score - a.hit!.score)
      .map((r) => r.x);
  const hits = ranked(rows, (r) => loopProfile(r, catalog));
  const midi = useMidiItems();
  const midiHits = ranked(midi, midiProfile);
  return (
    <Page>
      <header className="flex flex-col gap-3">
        <span className="text-label text-label-caps text-text-muted">
          Search
        </span>
        <h1 className="text-title">
          {query.trim()
            ? `Results for “${query.trim()}”`
            : "Search every sound"}
        </h1>
        <SmartSearch
          value={query}
          onChange={setSearchQuery}
          examples={[
            "dark piano 140 like metro",
            "pluggnb bells",
            "drill 140-145",
            "boom bap 90",
            "c minor",
            "drake",
          ]}
        />
      </header>
      {hits.length > 0 || midiHits.length > 0 ? (
        <>
          {hits.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-title">{`Loops ${hits.length}`}</h2>
              <LoopList label="Search results" rows={hits} onChange={refresh} />
            </section>
          )}
          {midiHits.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-title">{`MIDI ${midiHits.length}`}</h2>
              <MidiList label="MIDI results" items={midiHits.slice(0, 60)} />
            </section>
          )}
        </>
      ) : (
        <EmptyState
          icon={Search}
          title="Nothing matches all of that"
          action={
            <ButtonLink href="/loops" variant="secondary">
              See every loop
            </ButtonLink>
          }
        >
          Drop one of the chips above, or try “trap”, “bells 150” or “like
          dilla”.
        </EmptyState>
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

const KINDS: (MidiKind | "all")[] = [
  "all",
  "chords",
  "melody",
  "bass",
  "drums",
];
const KIND_NAME: Record<MidiKind | "all", string> = {
  all: "All",
  chords: "Chords",
  melody: "Melody",
  bass: "Bass",
  drums: "Drums",
};

type Origin = "all" | "songs" | "posts";
const ORIGIN_NAME: Record<Origin, string> = {
  all: "Everything",
  songs: "Chords from songs",
  posts: "Producers' patterns",
};

function AllMidi() {
  const all = useMidiItems();
  const [origin, setOrigin] = useState<Origin>("all");
  const [kind, setKind] = useState<MidiKind | "all">("all");
  const [q, setQ] = useState("");
  const query = useQuery(q);
  const midi = all
    .filter((m) => origin === "all" || (origin === "songs") === !!m.song)
    .map((m) => ({ m, hit: match(midiProfile(m), query) }))
    .filter((x) => x.hit)
    .sort((a, b) => b.hit!.score - a.hit!.score)
    .map((x) => x.m);
  const shown = kind === "all" ? midi : midi.filter((m) => m.kind === kind);
  return (
    <Page>
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">MIDI</span>
        <h1 className="text-title">Every MIDI pattern</h1>
        <p className="max-w-prose text-body text-text-muted">
          Original patterns across trap, boom bap, plugg, rage, drill, phonk,
          R&B, lo-fi, Jersey club and West Coast, and the chord progressions of
          popular songs at their key and tempo, each with where the chords came
          from. Press play to hear any of them in the piano roll.
        </p>
      </header>
      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="min-w-0 flex-1">
          <SmartSearch
            value={q}
            onChange={setQ}
            placeholder="Try: c minor 140 like metro"
            examples={[
              "like metro",
              "pierre bells",
              "drake",
              "dilla chords",
              "d minor drill",
              "sza",
            ]}
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
              {`${ORIGIN_NAME[o]} ${o === "all" ? all.length : all.filter((m) => (o === "songs") === !!m.song).length}`}
            </FilterChip>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <FilterChip key={k} selected={kind === k} onToggle={() => setKind(k)}>
            {`${KIND_NAME[k]} ${k === "all" ? midi.length : midi.filter((m) => m.kind === k).length}`}
          </FilterChip>
        ))}
      </div>
      <MidiList label="MIDI" items={shown} />
    </Page>
  );
}

const TABS = [
  { href: "/", name: "Home" },
  { href: "/browse", name: "Browse" },
  { href: "/loops", name: "Loops" },
  { href: "/midi", name: "MIDI" },
  { href: "/kits", name: "Drum kits" },
  { href: "/sound-design", name: "Sound design" },
  { href: "/presets", name: "Presets" },
  { href: "/library", name: "Library" },
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
        (href === "/kits" &&
          (path.startsWith("/kit/") || path === "/kit-upload"));
  return (
    <nav aria-label="Demo sections" className="border-b border-border bg-bg">
      <ul className="mx-auto flex max-w-content gap-1 overflow-x-auto px-3 tablet:px-4 desktop:px-6">
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
      </ul>
    </nav>
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
    document.title = title ? `${title} · Stash demo` : "Stash demo";
  }, [path]);
  const loop = /^\/loop\/(?:.*-)?([a-z0-9]+)$/.exec(path);
  if (loop) return <LoopPage publicId={loop[1]!} />;
  const midi = /^\/midi\/(?:.*-)?([a-z0-9]+)$/.exec(path);
  if (midi) return <MidiPage key={midi[1]} publicId={midi[1]!} />;
  if (path === "/") return <Home />;
  if (path.startsWith("/browse")) return <BrowseRoute />;
  if (path === "/search") return <SearchResults />;
  if (path === "/upload") return <UploadPage />;
  if (path === "/midi") return <AllMidi />;
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
          <AppShell>
            <DemoTabs />
            <Route key={look} />
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
