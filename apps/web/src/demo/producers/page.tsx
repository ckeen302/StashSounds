import { lazy, Suspense, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ItemRow } from "@stash/contracts";
import { Button, ButtonLink, Check, EmptyState, FilterChip, SearchInput, UiLink, User, UserPlus, useToast } from "@stash/ui";
import { has } from "../store";
import { setFollow } from "../explore";
import type { RenderLoops } from "../explore";
import { SongCard as PresetSongCard } from "../presets/page";
import { KitCards } from "../kits/pages";
import { useKits } from "../kits/store";
import { MidiList, useMidiItems } from "../midi/pages";
import { coverFor, tileStyle } from "../presets/cover";
import { allProducers, artistsOf, collaboratorsOf, midiSongKey, producerBySlug, producerPageHref, producerTotal, type ProducerPage } from "./data";

// The sampled songs come from the Samples tab's catalog, which loads on its own (see samples/credits.ts).
const SampledSongs = lazy(() =>
  Promise.all([import("../samples/page"), import("../samples/data")]).then(([{ SongCard }, { SAMPLE_SONGS }]) => ({
    default: function SampledSongs({ songs: at }: { songs: number[] }) {
      const songs = at.map((i) => SAMPLE_SONGS[i]).filter((x) => x !== undefined);
      return <Grid items={songs} first={6} label="Sampled songs" render={(x) => <SongCard key={x.key} s={x} />} />;
    },
  })),
);

/**
 * Producer pages: "/producers" lists every producer with material here, and "/producer/<slug>" gathers
 * one producer's presets, samples, song chords, and the loops and drum kits made in their style.
 */

export function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}

export function initialsOf(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** "38 presets · 57 samples · 4 MIDI · 1 kit", leaving out what they have none of. */
export function summaryOf(p: ProducerPage): string {
  return [
    p.kitStyles.size > 0 && plural(p.kitStyles.size, "kit"),
    p.loopCount > 0 && plural(p.loopCount, "loop"),
    p.presets.length > 0 && plural(p.presets.length, "preset song"),
    p.midiSongs.size > 0 && `${p.midiSongs.size} MIDI`,
    p.samples.length > 0 && plural(p.samples.length, "sampled song"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function ProducerAvatar({ name, size }: { name: string; size: "md" | "lg" }) {
  return (
    <span
      data-hue={hueOf(name)}
      aria-hidden="true"
      className={`st-avatar st-hero-title flex shrink-0 items-center justify-center rounded-full ${size === "lg" ? "size-24 text-display tablet:size-32" : "size-16 text-title"}`}
    >
      {initialsOf(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Following a producer: kept in this browser, read live so the button and the list agree.

let tick = 0;
const listeners = new Set<() => void>();
function useFollowing(slug: string): [boolean, (on: boolean) => void] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tick,
    () => 0,
  );
  const id = `producer:${slug}`;
  return [
    has("follows", id),
    (on) => {
      setFollow(id, on);
      tick++;
      for (const l of listeners) l();
    },
  ];
}

function FollowButton({ p }: { p: ProducerPage }) {
  const [on, setOn] = useFollowing(p.slug);
  const toast = useToast();
  return (
    <Button
      variant={on ? "secondary" : "primary"}
      icon={on ? Check : UserPlus}
      aria-pressed={on}
      onClick={() => {
        setOn(!on);
        toast({ tone: "success", title: on ? `Unfollowed ${p.name}` : `Following ${p.name}`, description: "Saved in this browser. This is the demo." });
      }}
    >
      {on ? "Following" : "Follow"}
    </Button>
  );
}

// ---------------------------------------------------------------------------------------------
// The directory.

type Has = "all" | "following" | "kits" | "presets" | "midi" | "samples";
const HAS: { id: Has; name: string; test: (p: ProducerPage) => boolean }[] = [
  { id: "all", name: "All", test: () => true },
  { id: "following", name: "Following", test: (p) => has("follows", `producer:${p.slug}`) },
  { id: "kits", name: "Drum kits and loops", test: (p) => p.kitStyles.size + p.loopCount > 0 },
  { id: "presets", name: "Presets", test: (p) => p.presets.length > 0 },
  { id: "midi", name: "MIDI", test: (p) => p.midiSongs.size > 0 },
  { id: "samples", name: "Samples", test: (p) => p.samples.length > 0 },
];
const PAGE = 48;

const fold = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

export function ProducersPage() {
  const all = allProducers();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Has>("all");
  const [limit, setLimit] = useState(PAGE);
  const needle = fold(q);
  const shown = useMemo(() => {
    const test = HAS.find((h) => h.id === filter)!.test;
    // With no search, the directory lists producers with more than one thing here; a search (or the
    // ones you follow) finds anyone.
    const list = all.filter((p) => test(p) && (needle ? fold(p.name).includes(needle) : filter === "following" || producerTotal(p) > 1));
    if (!needle) return list;
    // Names that start with what was typed come first.
    return [...list].sort((a, b) => Number(fold(b.name).startsWith(needle)) - Number(fold(a.name).startsWith(needle)));
  }, [all, needle, filter]);
  const reset = (f: () => void) => {
    f();
    setLimit(PAGE);
  };
  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-title">Producers</h1>
        <p className="text-small text-text-muted">One page per producer: the presets on their songs, the records they sample, the chords from their songs, and drum kits and loops made in their style.</p>
      </header>
      <SearchInput
        label="Search producers"
        hideLabel
        placeholder="Metro Boomin, Pi'erre Bourne, Alchemist..."
        shortcut=""
        value={q}
        onChange={(e) => reset(() => setQ(e.target.value))}
        onClear={() => reset(() => setQ(""))}
      />
      <div role="group" aria-label="Has" className="flex flex-wrap gap-2">
        {HAS.map((h) => (
          <FilterChip key={h.id} selected={filter === h.id} onToggle={() => reset(() => setFilter(h.id))}>
            {h.name}
          </FilterChip>
        ))}
      </div>
      <p className="font-mono text-numeric tabular text-text-muted">{plural(shown.length, "producer")}</p>
      {shown.length === 0 ? (
        filter === "following" && !needle ? (
          <EmptyState icon={UserPlus} title="You don't follow any producers yet">
            {"Open a producer's page and press Follow to keep them here."}
          </EmptyState>
        ) : (
          <EmptyState icon={User} title="No producer by that name">
            Check the spelling, or try a shorter part of the name.
          </EmptyState>
        )
      ) : (
        <ul aria-label="Producers" className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
          {shown.slice(0, limit).map((p) => (
            <li key={p.slug} className="h-full">
              <UiLink href={producerPageHref(p)} className="group flex h-full items-center gap-4 rounded-panel border border-border bg-surface p-4 ui-hover:border-border-strong">
                <ProducerAvatar name={p.name} size="md" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-title text-text group-hover:underline">{p.name}</span>
                  <span className="line-clamp-2 text-small text-text-muted">{summaryOf(p)}</span>
                </span>
              </UiLink>
            </li>
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setLimit(limit + PAGE)}>
          {`Show ${Math.min(PAGE, shown.length - limit)} more of ${shown.length.toLocaleString("en")}`}
        </Button>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// One producer.

function Section({ id, title, count, note, children }: { id: string; title: string; count: number; note?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <h2 id={`${id}-h`} className="text-title text-text">
            {title}
          </h2>
          <span className="font-mono text-numeric tabular text-text-muted">{count}</span>
        </div>
        {note && <p className="text-small text-text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** A grid that shows its first few and a button for the rest. */
function Grid<T>({ items, first, label, render }: { items: T[]; first: number; label: string; render: (x: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, first);
  return (
    <>
      <ul aria-label={label} className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
        {shown.map(render)}
      </ul>
      {items.length > shown.length && (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setAll(true)}>
          {`Show all ${items.length}`}
        </Button>
      )}
    </>
  );
}

/** "Future, Travis Scott and 21 Savage" */
const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Producers they share songs with, each a link to their page. */
function WorksWith({ p }: { p: ProducerPage }) {
  const people = collaboratorsOf(p);
  if (!people.length) return null;
  return (
    <section id="works-with" aria-labelledby="works-with-h" className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="works-with-h" className="text-title text-text">
          Producers they work with
        </h2>
        <p className="text-small text-text-muted">Credited together on the songs here.</p>
      </div>
      <ul aria-label={`Producers who work with ${p.name}`} className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-4">
        {people.map(({ page: o, songs }) => (
          <li key={o.slug}>
            <UiLink href={producerPageHref(o)} className="group flex items-center gap-3 rounded-panel border border-border p-3 ui-hover:border-border-strong">
              <span data-hue={hueOf(o.name)} aria-hidden="true" className="st-avatar st-hero-title flex size-10 shrink-0 items-center justify-center rounded-full text-body">
                {initialsOf(o.name)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body text-text group-hover:underline">{o.name}</span>
                <span className="text-small text-text-muted">{plural(songs, "song")} together</span>
              </span>
            </UiLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Missing() {
  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <EmptyState icon={User} title="No page for that producer yet" action={<ButtonLink href="/producers" variant="secondary">All producers</ButtonLink>}>
        Search the producers for another spelling of the name.
      </EmptyState>
    </main>
  );
}

export function ProducerPageView({ slug, rows, styleOf, renderLoops }: { slug: string; rows: ItemRow[]; styleOf: (row: ItemRow) => string | null; renderLoops: RenderLoops }) {
  const p = producerBySlug(slug);
  const kitsAll = useKits();
  const midiAll = useMidiItems();
  if (!p) return <Missing />;
  const kits = kitsAll.filter((k) => k.inspiredBy && p.kitStyles.has(k.inspiredBy));
  const loops = rows.filter((r) => {
    const s = styleOf(r);
    return !!s && p.styleTags.has(s.toLowerCase());
  });
  const midi = midiAll.filter((m) => m.song && p.midiSongs.has(midiSongKey(m.song.song, m.song.artist)));
  const sections: { id: string; name: string; n: number }[] = [
    { id: "kits", name: "Drum kits", n: kits.length },
    { id: "loops", name: "Loops", n: loops.length },
    { id: "presets", name: "Presets", n: p.presets.length },
    { id: "midi", name: "MIDI", n: midi.length },
    { id: "samples", name: "Samples", n: p.samples.length },
  ].filter((s) => s.n > 0);
  const artists = artistsOf(p);
  // Songs with their album art first, so the page opens on covers rather than blank tiles.
  const presets = [...p.presets].sort((a, b) => Number(!!coverFor(b.song, b.artist)) - Number(!!coverFor(a.song, a.artist)));
  // The backdrop: the cover of their best-known song that has one.
  const cover =
    presets.map((s) => coverFor(s.song, s.artist)).find((c) => !!c) ??
    midi.map((m) => (m.song ? coverFor(m.song.song, m.song.artist) : null)).find((c) => !!c) ??
    null;
  const styleNote = `Original Stash sounds made in this style. ${p.name} did not make or endorse them.`;
  return (
    <main className="flex w-full flex-col">
      <header className="st-song-hero relative overflow-hidden border-b border-border">
        {cover && <span aria-hidden="true" className="st-song-backdrop" style={tileStyle(cover.file)} />}
        <div className="relative mx-auto flex w-full max-w-content flex-col gap-4 px-3 pt-6 pb-8 tablet:px-4 tablet:pt-8 desktop:px-6">
          <UiLink href="/producers" className="self-start text-small text-text-muted ui-hover:text-text">
            ← Producers
          </UiLink>
          <div className="flex flex-col gap-4 tablet:flex-row tablet:items-center tablet:gap-6">
            <ProducerAvatar name={p.name} size="lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-label text-label-caps text-text-muted">Producer</span>
              <h1 className="st-hero-title st-song-title text-balance break-words text-text">{p.name}</h1>
              {artists.length > 0 && <p className="text-body text-text-muted">{`Songs for ${andList(artists)}`}</p>}
            </div>
            <div className="shrink-0">
              <FollowButton p={p} />
            </div>
          </div>
          {sections.length > 0 && (
            <nav aria-label={`${p.name} on Stash`} className="flex flex-wrap gap-2">
              {sections.map((s) => (
                <Button key={s.id} variant="secondary" size="sm" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  {`${s.name} · ${s.n}`}
                </Button>
              ))}
            </nav>
          )}
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-3 py-8 tablet:px-4 desktop:px-6">
        {kits.length > 0 && (
          <Section id="kits" title={`Drum kits in the style of ${p.name}`} count={kits.length} note={styleNote}>
            <KitCards kits={kits} label="Drum kits" />
          </Section>
        )}
        {loops.length > 0 && (
          <Section id="loops" title={`Loops in the style of ${p.name}`} count={loops.length} note={styleNote}>
            {renderLoops(`Loops in the style of ${p.name}`, loops)}
          </Section>
        )}
        {p.presets.length > 0 && (
          <Section id="presets" title="Presets on their songs" count={p.presets.length} note="Which synth and preset is on each song, with how sure the source is.">
            <Grid items={presets} first={6} label="Preset songs" render={(s) => <PresetSongCard key={s.key} s={s} />} />
          </Section>
        )}
        {midi.length > 0 && (
          <Section id="midi" title="Chords from their songs" count={midi.length} note="Play the progression, then drag it into your DAW or save the .mid.">
            <MidiList label={`Chords from songs ${p.name} produced`} items={midi} />
          </Section>
        )}
        {p.samples.length > 0 && (
          <Section id="samples" title="Songs and what they sample" count={p.samples.length} note="The records behind their beats, from album credits and MusicBrainz.">
            <Suspense fallback={null}>
              <SampledSongs songs={p.samples} />
            </Suspense>
          </Section>
        )}
        <WorksWith p={p} />
        {sections.length === 0 && (
          <EmptyState icon={User} title="Nothing here yet">
            {`No sounds tied to ${p.name} yet.`}
          </EmptyState>
        )}
      </div>
    </main>
  );
}
