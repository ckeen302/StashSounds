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
import { midiItem } from "./midi/catalog";
import { MidiList, MidiPage, useMidiItems } from "./midi/pages";
import { progressionOf } from "./midi/songs";
import { PresetsPage } from "./presets/page";
import { PresetSongPage } from "./presets/song-page";
import { SoundDesign } from "./sound-design";
import { OneShotsPage } from "./oneshots/page";
import { UploadHub } from "./upload/page";
import {
  BrowsePage,
  LibraryPage,
  NewCrateHost,
  ProfilePage,
  useCrateEntries,
  type RenderLoops,
} from "./explore";
import { FlipPanel } from "./flip";
import { LoopTools } from "./loop-tools";
import { LoopsPage } from "./loops";
import { pack, PACK_WEEK } from "./packs";
import { ALL_SONGS, madeBy, songHref, TOP_PRODUCERS } from "./presets/songs";
import { PRESETS, type Confidence } from "./presets/data";
import { kits } from "./kits/store";
import { saveFiles, saveLoopRow } from "./save";
import { SmartSearch, useQuery } from "./search-ui";
import { loopProfile, midiProfile } from "./search-index";
import { match, moreLike } from "./smart-search";
import { writeMidi } from "./midi/write";
import { KitPage, KitsPage, KitUploadPage } from "./kits/pages";
import type { MidiKind } from "@stash/contracts";
import { Button, Download, FilterChip, SearchInput, UiLink } from "@stash/ui";

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
  .map((s, i) => ({ s, k: s.best * 10000 + ((i * 7919 + TODAY * 104729) % 9973) }))
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
  const hits = kits().reduce((n, k) => n + k.sounds.length, 0);
  const types = [
    { href: "/loops", t: "loop", name: "Loops", blurb: "Change tempo and key while it plays", count: rows.length },
    { href: "/one-shots", t: "oneshot", name: "One-shots", blurb: "Every single hit, sorted by type", count: hits },
    { href: "/kits", t: "kit", name: "Drum kits", blurb: "Kicks, 808s, snares and hats", count: kits().length },
    { href: "/midi", t: "midi", name: "MIDI", blurb: "Real progressions from the songs", count: midi.length },
    { href: "/presets", t: "preset", name: "Presets", blurb: "The synth patch on the record", count: PRESETS.length },
  ];
  const search = (text: string) => {
    setSearchQuery(text);
    navigate("/search");
  };
  return (
    <div className="flex flex-col">
      <section className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 pt-10 pb-6 tablet:px-4 desktop:px-6 desktop:pt-16">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-small text-text-muted">
          <span className="st-dot size-2 rounded-full" aria-hidden="true" />
          The sound network for producers
        </span>
        <h1 className="st-hero-title st-hero-xl text-display max-w-4xl text-balance">
          Find the sound. Hear it now. <span className="st-grad">Follow who made it.</span>
        </h1>
        <p className="max-w-prose text-body text-text-muted">
          Loops, one-shots, drum kits and MIDI from producers, plus the exact presets behind the records you know. Every sound plays the moment you tap it, so you
          can stop digging through YouTube.
        </p>
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
        <div className="flex flex-wrap gap-2" aria-label="Searches to try">
          {["pluggnb bells", "drill 142", "boom bap 90", "c minor", "phonk cowbell"].map((x) => (
            <FilterChip key={x} onToggle={() => search(x)}>
              {x}
            </FilterChip>
          ))}
        </div>
      </section>

      <Page>
        <ul aria-label="Sound types" className="grid grid-cols-2 gap-3 tablet:grid-cols-3 desktop:grid-cols-5">
          {types.map((t) => (
            <li key={t.href} className={t.t === "loop" ? "col-span-2 tablet:col-span-1" : undefined}>
              <UiLink
                href={t.href}
                data-t={t.t}
                className="st-type flex h-full flex-col gap-3 rounded-panel border border-border bg-surface p-4 ui-hover:border-border-strong"
              >
                <span className="flex items-center gap-2">
                  <span className="st-dot size-2.5 rounded-full" aria-hidden="true" />
                  <span className="text-body-strong text-text">{t.name}</span>
                </span>
                <span className="st-hero-title text-title text-text">{t.count.toLocaleString("en")}</span>
                <span className="text-small text-text-muted">{t.blurb}</span>
              </UiLink>
            </li>
          ))}
        </ul>

        <section aria-labelledby="trending" className="flex flex-col gap-3">
          <div id="trending">
            <SectionHead title="New loops" sub="Tap to hear. Arrows move, Space plays." href="/loops" more={`All ${rows.length} loops`} />
          </div>
          <LoopList label="New loops" rows={rows.slice(0, 6)} onChange={refresh} />
        </section>

        <section aria-labelledby="songs-shelf" className="flex flex-col gap-3">
          <div id="songs-shelf">
            <SectionHead title="Presets behind the songs" sub="The synth and patch on the record, graded by who said so." href="/presets" more={`All ${ALL_SONGS.length} songs`} />
          </div>
          <ul className="st-shelf -mx-3 flex gap-4 overflow-x-auto px-3 pb-2 tablet:mx-0 tablet:px-0">
            {SHELF.map((s) => {
              const r = RARITY[BY_LEVEL[s.best] ?? "community"];
              return (
                <li key={s.slug} className="w-40 shrink-0 tablet:w-44">
                  <UiLink href={songHref(s.song, s.artist)} className="group flex h-full flex-col justify-between gap-6 rounded-panel border border-border bg-surface p-4 ui-hover:border-border-strong">
                    <span className="st-box line-clamp-2 rounded-control text-small text-text-muted">{s.entries.find((e) => e.preset)?.plugin ?? s.entries[0]?.plugin}</span>
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
            <SectionHead title="Producers behind the songs" sub="Whose sound you can find here, by the songs we've sourced." href="/presets" more="See their presets" />
          </div>
          <ul className="st-shelf -mx-3 flex gap-5 overflow-x-auto px-3 pb-2 tablet:mx-0 tablet:px-0">
            {TOP_PRODUCERS.slice(0, 12).map(([name, n]) => {
              const first = ALL_SONGS.find((s) => madeBy(s, name));
              return (
                <li key={name} className="w-24 shrink-0 tablet:w-28">
                  <UiLink href={first ? songHref(first.song, first.artist) : "/presets"} className="group flex flex-col items-center gap-2 text-center">
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
            <SectionHead title="Chords from the songs" sub="Real progressions at their key and tempo, in a piano roll." href="/midi" more={`All ${songs.length} songs`} />
            <MidiList label="Song chords" items={songs.slice(0, 6)} />
          </section>
        )}

        <section aria-labelledby="post" className="st-cta flex flex-col gap-4 rounded-panel p-6 tablet:flex-row tablet:items-center tablet:justify-between tablet:p-10">
          <div className="flex flex-col gap-2">
            <h2 id="post" className="st-hero-title text-display">Post a sound. Build a following.</h2>
            <p className="max-w-prose text-body">Producers who post here get heard in one tap, credited on every download, and followed by the people who use their sounds.</p>
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
      <LoopTools key={`fit-${publicId}`} row={view.page.item} />
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
  const kinded = kind === "all" ? midi : midi.filter((m) => m.kind === kind);
  const shown = prog ? kinded.filter((m) => m.song && progressionOf(m.song)?.label === prog) : kinded;
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
              {ORIGIN_NAME[o]}
            </FilterChip>
          ))}
        </div>
      </div>
      {!q && classics.length > 0 && (
        <section aria-labelledby="classics" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="classics" className="text-title">Classic progressions</h2>
            <p className="max-w-prose text-small text-text-muted">The moves under decades of records: the four-chord axis, the &apos;50s, ii–V–I, the blues, the Andalusian cadence and more. Play one, shift it to your key, and drag the MIDI into your DAW.</p>
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
  { href: "/one-shots", name: "One-shots" },
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
  if (path === "/upload") return <UploadHub />;
  if (path === "/midi") return <AllMidi />;
  if (path === "/one-shots") return <OneShotsPage />;
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
