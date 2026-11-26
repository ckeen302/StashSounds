import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ItemRow } from "@stash/contracts";
import { Button, ButtonLink, Check, EmptyState, FilterChip, SearchInput, UiLink, User, UserPlus, useToast } from "@stash/ui";
import { has } from "../store";
import { setFollow } from "../explore";
import type { RenderLoops } from "../explore";
import { SongCard as PresetSongCard } from "../presets/page";
import { SongCard as SampleSongCard } from "../samples/page";
import { KitCards } from "../kits/pages";
import { useKits } from "../kits/store";
import { MidiList, useMidiItems } from "../midi/pages";
import { allProducers, midiSongKey, producerBySlug, producerPageHref, producerTotal, type ProducerPage } from "./data";

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

type Has = "all" | "kits" | "presets" | "midi" | "samples";
const HAS: { id: Has; name: string; test: (p: ProducerPage) => boolean }[] = [
  { id: "all", name: "All", test: () => true },
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
  const [has, setHas] = useState<Has>("all");
  const [limit, setLimit] = useState(PAGE);
  const needle = fold(q);
  const shown = useMemo(() => {
    const test = HAS.find((h) => h.id === has)!.test;
    // With no search, the directory lists producers with more than one thing here; a search finds anyone.
    const list = all.filter((p) => test(p) && (needle ? fold(p.name).includes(needle) : producerTotal(p) > 1));
    if (!needle) return list;
    // Names that start with what was typed come first.
    return [...list].sort((a, b) => Number(fold(b.name).startsWith(needle)) - Number(fold(a.name).startsWith(needle)));
  }, [all, needle, has]);
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
          <FilterChip key={h.id} selected={has === h.id} onToggle={() => reset(() => setHas(h.id))}>
            {h.name}
          </FilterChip>
        ))}
      </div>
      <p className="font-mono text-numeric tabular text-text-muted">{plural(shown.length, "producer")}</p>
      {shown.length === 0 ? (
        <EmptyState icon={User} title="No producer by that name">
          Check the spelling, or try a shorter part of the name.
        </EmptyState>
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
  const styleNote = `Original Stash sounds made in this style. ${p.name} did not make or endorse them.`;
  return (
    <main className="flex w-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-3 pt-6 pb-8 tablet:px-4 tablet:pt-8 desktop:px-6">
          <UiLink href="/producers" className="self-start text-small text-text-muted ui-hover:text-text">
            ← Producers
          </UiLink>
          <div className="flex flex-col gap-4 tablet:flex-row tablet:items-center tablet:gap-6">
            <ProducerAvatar name={p.name} size="lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-label text-label-caps text-text-muted">Producer</span>
              <h1 className="st-hero-title st-song-title text-balance break-words text-text">{p.name}</h1>
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
            <Grid items={p.presets} first={6} label="Preset songs" render={(s) => <PresetSongCard key={s.key} s={s} />} />
          </Section>
        )}
        {midi.length > 0 && (
          <Section id="midi" title="Chords from their songs" count={midi.length} note="Play the progression, then drag it into your DAW or save the .mid.">
            <MidiList label={`Chords from songs ${p.name} produced`} items={midi} />
          </Section>
        )}
        {p.samples.length > 0 && (
          <Section id="samples" title="Songs and what they sample" count={p.samples.length} note="The records behind their beats, from album credits and MusicBrainz.">
            <Grid items={p.samples} first={6} label="Sampled songs" render={(s) => <SampleSongCard key={s.key} s={s} />} />
          </Section>
        )}
        {sections.length === 0 && (
          <EmptyState icon={User} title="Nothing here yet">
            {`No sounds tied to ${p.name} yet.`}
          </EmptyState>
        )}
      </div>
    </main>
  );
}
