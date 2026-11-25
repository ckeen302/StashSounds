import { Button, Check, ChevronDown, EmptyState, FilterChip, Menu, Search, SearchInput, SlidersHorizontal, UiLink, type MenuEntry } from "@stash/ui";
import { PageFrame, PageHeader } from "../layout";
import { useMemo, useState } from "react";
import { Cover, coverFor } from "./cover";
import { CONFIDENCE, PRESETS, presetParts, type Confidence, type PresetEntry } from "./data";
import { groupSongs, LEVEL, madeBy, songHref, TOP_PRODUCERS, type Song } from "./songs";

/**
 * The presets tab: the synth and preset behind famous songs. Each song is one card; each sound in it
 * reads like a synth's own display (plugin, bank, preset name), with how sure we are as a meter and
 * where it came from. Nothing plays here: presets belong to their makers, so the page names them and
 * points at the source.
 */

const TONE: Record<Confidence, string> = {
  producer: "bg-accent",
  engineer: "bg-type-midi",
  press: "bg-type-loop",
  community: "bg-border-strong",
};
export const TONE_TEXT: Record<Confidence, string> = {
  producer: "text-accent",
  engineer: "text-type-midi",
  press: "text-type-loop",
  community: "text-text-muted",
};

const FAMILIES: [string, RegExp][] = [
  ["Nexus", /nexus/i],
  ["Omnisphere", /omnisphere/i],
  ["Kontakt", /kontakt|keyscape|output|exhale|una corda|noire|alicia/i],
  ["ElectraX", /electra/i],
  ["Gladiator", /gladiator/i],
  ["Serum", /serum/i],
  ["Sylenth1", /sylenth/i],
  ["Trillian", /trillian/i],
  ["Massive", /massive/i],
  ["Spire", /spire/i],
  ["Vital", /vital/i],
  ["FabFilter Twin", /fabfilter/i],
  ["u-he", /u-he|diva|zebra|tyrell/i],
  ["DUNE", /dune/i],
  ["Rob Papen", /rob papen|predator|albino/i],
  ["Vanguard", /vanguard/i],
  ["NI other", /native instruments|fm8|razor|absynth|reaktor|battery|guitar rig/i],
  ["Reason", /reason/i],
  ["Apple stock", /garageband|logic/i],
  ["FL Studio stock", /image-line|purity|nemesis|fl studio|sytrus|3x ?osc|flex|harmor|harmless|gross beat|fruity|fl keys|directwave|toxic|poizone|transistor/i],
  ["Arturia", /arturia|analog lab|pigments|mini v|jup-8|cs-80/i],
  ["Korg", /korg|triton|m1\b|motif/i],
  ["Roland", /roland|juno|jupiter|srx|fantom|tr-808|tr808|jv-|xv-|d-50|jx-|m-dc1/i],
  ["Hardware", /hardware|v-station|nord|moog|prophet|yamaha|minimoog|rhodes|wurlitzer|omnichord|fairlight|ob-8|planet phatt/i],
];
export function familyOf(plugin: string): string {
  return FAMILIES.find(([, re]) => re.test(plugin))?.[0] ?? "Other";
}

const SOUNDS: [string, RegExp][] = [
  ["808 and bass", /808|bass|sub|low end/i],
  ["Bells", /bell|glock|celesta|music box|chime/i],
  ["Keys and piano", /key|piano|rhodes|organ|ep\b|electric piano|harpsichord|clav/i],
  ["Leads", /lead|melody|whistle|squeak|saw|synth/i],
  ["Pads and atmos", /pad|atmos|ambient|texture|drone/i],
  ["Strings and orchestra", /string|orchestra|violin|cello|brass|horn|harp\b|pizz|orch/i],
  ["Flutes and winds", /flute|wind|pan ?flute|ocarina|recorder|sax/i],
  ["Vocals and choir", /vocal|vox|choir|voice|aaah/i],
  ["Plucks and guitar", /pluck|guitar|arp|stab|kalimba|marimba|koto/i],
  ["Drums and FX", /drum|kit|fx|effect|chop|riser|snare|hat/i],
];
function soundsOf(role: string): string[] {
  return SOUNDS.filter(([, re]) => re.test(role)).map(([n]) => n);
}

const SORTS = {
  sure: { label: "Best sourced first", by: (a: Song, b: Song) => Number(!!coverFor(b.song, b.artist)) - Number(!!coverFor(a.song, a.artist)) || b.best - a.best || b.named - a.named || a.artist.localeCompare(b.artist) },
  artist: { label: "Artist A to Z", by: (a: Song, b: Song) => a.artist.localeCompare(b.artist) || a.song.localeCompare(b.song) },
  sounds: { label: "Most sounds", by: (a: Song, b: Song) => b.entries.length - a.entries.length || a.artist.localeCompare(b.artist) },
  named: { label: "Exact presets first", by: (a: Song, b: Song) => b.named - a.named || b.best - a.best || a.artist.localeCompare(b.artist) },
} as const;
type SortId = keyof typeof SORTS;

const PAGE = 30;

export function PresetsPage() {
  const [conf, setConf] = useState<Confidence | "all">("all");
  const [family, setFamily] = useState<string>("All");
  const [sound, setSound] = useState<string>("All");
  const [named, setNamed] = useState(false);
  const [sort, setSort] = useState<SortId>("sure");
  const [q, setQ] = useState("");
  const [who, setWho] = useState("All");
  const [limit, setLimit] = useState(PAGE);

  const indexed = useMemo(() => PRESETS.map((p) => ({ p, family: familyOf(p.plugin), sounds: soundsOf(p.role) })), []);
  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const x of indexed) counts.set(x.family, (counts.get(x.family) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [indexed]);
  const needle = q.trim().toLowerCase();
  const matching = indexed
    .filter(
      (x) =>
        (conf === "all" || x.p.confidence === conf) &&
        (family === "All" || x.family === family) &&
        (sound === "All" || x.sounds.includes(sound)) &&
        (!named || x.p.preset) &&
        (!needle || [x.p.song, x.p.artist, x.p.producer, x.p.plugin, x.p.preset ?? "", x.p.role, x.p.path ?? ""].some((s) => s.toLowerCase().includes(needle))),
    )
    .map((x) => x.p);
  const songs = groupSongs(matching).filter((x) => who === "All" || madeBy(x, who)).sort(SORTS[sort].by);
  const shownSounds = songs.reduce((n, x) => n + x.entries.length, 0);

  const reset = (f: () => void) => {
    f();
    setLimit(PAGE);
  };
  const counts = (c: Confidence) => PRESETS.filter((p) => p.confidence === c).length;
  const [open, setOpen] = useState(false);
  const touched = conf !== "all" || family !== "All" || sound !== "All" || named || needle !== "" || who !== "All";

  return (
    <PageFrame className="!gap-6">
      {/* Title, one sticky row of controls, then the songs: plugins, producers and sorting wait behind Filters. */}
      <PageHeader
        eyebrow="Ideas"
        title="Presets"
        lede="The synth, the bank and the patch name behind the songs you're chasing. Sourced from producers, engineers and interviews."
        count={
          <span aria-live="polite">
            <b>{songs.length.toLocaleString("en")}</b> {songs.length === 1 ? "song" : "songs"} · <b>{shownSounds.toLocaleString("en")}</b> {shownSounds === 1 ? "sound" : "sounds"}
          </span>
        }
      />
      <div className="ds-toolbar">
        <div className="flex w-full items-center gap-2">
          <SearchInput
            label="Search songs, artists, producers, presets"
            hideLabel
            placeholder="Song, artist, plugin or preset"
            shortcut=""
            value={q}
            onChange={(e) => reset(() => setQ(e.target.value))}
            onClear={() => reset(() => setQ(""))}
            className="min-w-0 flex-1"
          />
          <Button variant={open || (touched && !needle) ? "primary" : "secondary"} icon={SlidersHorizontal} aria-expanded={open} onClick={() => setOpen(!open)}>
            {touched && !needle ? "Filters ·" : "Filters"}
          </Button>
          <span className="hidden tablet:contents">
            <Dropdown name="Sort" active={false} value={SORTS[sort].label} options={(Object.keys(SORTS) as SortId[]).map((s): [string, string] => [s, SORTS[s].label])} selected={sort} onPick={(v) => reset(() => setSort(v as SortId))} />
          </span>
        </div>
      </div>

      {open && (
      <div className="ds-panel flex flex-col gap-5 p-5">
      {/* The plugin shelf: every VST with its count; tap one to see only its presets. */}
      <section aria-label="Plugins" className="flex flex-col gap-3">
        <span className="ds-eyebrow">Pick a plugin</span>
        <ul className="flex gap-2 overflow-x-auto pb-1 tablet:flex-wrap">
          {[["All", PRESETS.length] as [string, number], ...families].map(([f, n]) => {
            const on = family === f;
            return (
              <li key={f} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => reset(() => setFamily(on && f !== "All" ? "All" : f))}
                  className="ds-pick flex min-w-24 flex-col items-start gap-0.5 px-3 py-2 text-left"
                >
                  <span className={`text-small ${on ? "text-text" : "text-text-muted"}`}>{f === "All" ? "Every plugin" : f}</span>
                  <span className={`text-body-strong tabular ${on ? "text-accent" : "text-text"}`}>{n}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* The producer shelf: the beatmakers with the most songs here; tap one to see only theirs. */}
      <section aria-label="Producers" className="flex flex-col gap-3">
        <span className="ds-eyebrow">By producer</span>
        <ul className="flex gap-2 overflow-x-auto pb-1 tablet:flex-wrap">
          {TOP_PRODUCERS.map(([name, n]) => {
            const on = who === name;
            return (
              <li key={name} className="shrink-0">
                <FilterChip selected={on} onToggle={() => reset(() => setWho(on ? "All" : name))}>
                  {`${name} · ${n}`}
                </FilterChip>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Filters" className="flex flex-wrap items-center gap-2">
        <Dropdown
          name="How sure"
          value={conf === "all" ? "Any" : CONFIDENCE[conf].label}
          options={[["all", `Any ${PRESETS.length}`], ...(Object.keys(CONFIDENCE) as Confidence[]).map((c): [string, string] => [c, `${CONFIDENCE[c].label} ${counts(c)}`])]}
          selected={conf}
          onPick={(v) => reset(() => setConf(v as Confidence | "all"))}
        />
        <Dropdown
          name="Sound"
          value={sound === "All" ? "Any" : sound}
          options={[["All", "Any"], ...SOUNDS.map(([n]): [string, string] => [n, `${n} ${indexed.filter((x) => x.sounds.includes(n)).length}`])]}
          selected={sound}
          onPick={(v) => reset(() => setSound(v))}
        />
        <span className="contents tablet:hidden">
          <Dropdown name="Sort" active={false} value={SORTS[sort].label} options={(Object.keys(SORTS) as SortId[]).map((s): [string, string] => [s, SORTS[s].label])} selected={sort} onPick={(v) => reset(() => setSort(v as SortId))} />
        </span>
        {touched && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              reset(() => {
                setConf("all");
                setFamily("All");
                setSound("All");
                setNamed(false);
                setQ("");
                setWho("All");
              })
            }
          >
            Clear
          </Button>
        )}
      </section>
      </div>
      )}

      <ul aria-label="Songs and their presets" className="ps-grid">
        {songs.slice(0, limit).map((s) => (
          <SongCard key={s.key} s={s} />
        ))}
      </ul>
      {songs.length > limit && (
        <Button variant="secondary" className="self-center" onClick={() => setLimit(limit + PAGE)}>
          {`Show ${Math.min(PAGE, songs.length - limit)} more of ${songs.length - limit}`}
        </Button>
      )}
      {songs.length === 0 && (
        <EmptyState icon={Search} title="Nothing matches">
          Clear the search, or pick another plugin or producer.
        </EmptyState>
      )}
    </PageFrame>
  );
}

/** A filter as one compact button that opens its options. */
export function Dropdown({ name, value, options, selected, onPick, active = value !== "Any" }: { name: string; value: string; options: [string, string][]; selected: string; onPick: (v: string) => void; active?: boolean }) {
  const entries: MenuEntry[] = options.map(([v, label]) => ({ label, icon: v === selected ? Check : undefined, onSelect: () => onPick(v) }));
  return (
    <Menu
      align="start"
      entries={entries}
      trigger={
        <Button size="sm" variant={active ? "primary" : "secondary"} icon={ChevronDown} aria-label={`${name}: ${value}`}>
          {`${name}: ${value}`}
        </Button>
      }
    />
  );
}

/** The short name of the part a preset plays, so every card labels its sounds the same way. */
const PART: [string, RegExp][] = [
  ["808", /808/i],
  ["Bass", /bass|sub\b|low end/i],
  ["Guitar", /guitar/i],
  ["Bells", /bell|glock|celesta|music box|chime|xylophone|vibraphone/i],
  ["Piano", /piano/i],
  ["Organ", /organ/i],
  ["Keys", /key|rhodes|\bep\b|electric piano|harpsichord|clav|wurli/i],
  ["Pad", /pad|atmos|ambient|texture|drone/i],
  ["Strings", /string|violin|cello|pizz|orchestra|harp\b/i],
  ["Brass", /brass|horn|trumpet/i],
  ["Flute", /flute|wind|pan ?flute|ocarina|piccolo|bottle/i],
  ["Vocal", /vocal|vox|choir|voice|aa+h/i],
  ["Pluck", /pluck|kalimba|marimba|koto|steel ?drum/i],
  ["Arp", /arp/i],
  ["Lead", /lead|melody|whistle|hook|riff|solo|saw|sine/i],
  ["Drums", /drum|kit|snare|hat|kick|clap|percussion|conga|toms?\b|beat/i],
  ["FX", /fx|effect|riser|swish|scratch|sweep|stab|hit/i],
  ["Synth", /synth|sequence|sound|layer/i],
];
export function partOf(role: string): string {
  return PART.find(([, re]) => re.test(role))?.[0] ?? "Sound";
}

/**
 * One song, always in the same shape: cover, title, artist, album, producer, then its
 * lead sound (part, plugin, preset). The whole card opens the song. Missing facts keep their line, so no
 * card reads differently from the one next to it. One sound shows (the one with a named preset first).
 */
function SongCard({ s }: { s: Song }) {
  const lead = s.entries.find((e) => e.preset) ?? s.entries[0]!;
  const { name } = presetParts(lead.preset);
  const more = s.entries.length - 1;
  return (
    <li className="h-full">
      <UiLink href={songHref(s.song, s.artist)} className="ds-card ps-card h-full">
        <span className="ds-art">
          <Cover song={s.song} artist={s.artist} size="fill" placeholder />
        </span>
        <span className="flex min-w-0 flex-col px-1">
          <span className="truncate font-display text-h3 text-text">{s.song}</span>
          <span className="truncate text-small text-text-muted">{s.artist}</span>
        </span>
        <span className="mt-auto flex min-w-0 flex-col gap-1.5 px-1">
          <span className="ps-chip self-start">
            <span className="ps-chip-part">{partOf(lead.role)}</span>
            <span className="truncate font-medium text-text">{name}</span>
          </span>
          <span className="truncate text-small text-text-subtle">
            {lead.plugin}
            {more > 0 ? ` · +${more} more` : ""}
          </span>
        </span>
      </UiLink>
    </li>
  );
}

export function Meter({ c }: { c: Confidence }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-0.5">
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`h-3 w-1.5 rounded-control ${n <= LEVEL[c] ? TONE[c] : "bg-raised"}`} />
      ))}
    </span>
  );
}

/** One sound, shown the way a synth's preset display shows it: plugin and bank above, the name big. */
/** One preset. The browse list shows only the sound, the VST and the preset; `detail` adds how sure it is, the source and the quote. */
export function PatchStrip({ e, detail = false }: { e: PresetEntry; detail?: boolean }) {
  const { name, note } = presetParts(e.preset);
  if (!detail)
    return (
      <li className="st-box flex items-center gap-3 rounded-control border border-border-strong bg-bg px-3 py-2">
        <span className="w-16 shrink-0 text-label text-label-caps text-text-muted">{partOf(e.role)}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-small text-text-muted">{e.plugin}</span>
          <span className="truncate font-mono text-body-strong text-accent">{name}</span>
        </span>
      </li>
    );
  return (
    <li className="flex flex-col gap-2">
      <span className="text-label text-label-caps text-text-muted">{/^not stated/i.test(e.role) ? "Sound not stated" : e.role}</span>
      <div className="st-box flex flex-col gap-1 rounded-control border border-border-strong bg-bg px-3 py-2">
        <span className="font-mono text-small break-words text-text-muted">{[e.plugin, e.path].filter(Boolean).join(" › ")}</span>
        <span className="font-mono text-body-strong break-words text-accent">{name}</span>
        {note && <span className="text-small text-text-muted">{note}</span>}
      </div>
      {detail && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2" title={CONFIDENCE[e.confidence].blurb}>
          <Meter c={e.confidence} />
          <span className={`text-label text-label-caps ${TONE_TEXT[e.confidence]}`}>{CONFIDENCE[e.confidence].label}</span>
        </span>
        {!e.source.label ? null : e.source.url ? (
          <a href={e.source.url} target="_blank" rel="noreferrer" className="min-w-0 text-small break-words text-text-muted underline underline-offset-2 ui-hover:text-text">
            {e.source.label}
          </a>
        ) : (
          <span className="min-w-0 text-small break-words text-text-muted">{e.source.label}</span>
        )}
      </div>}
      {detail && e.quote && (
        <blockquote className="border-l-2 border-border-strong pl-3 text-small text-text">
          “{e.quote}”{e.quoteBy && <span className="text-text-muted"> — {e.quoteBy}</span>}
        </blockquote>
      )}
    </li>
  );
}

/** What the meter means, once, at the foot of the list. */
export function ConfidenceKey() {
  return (
    <section aria-label="How sure" className="flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-label text-label-caps text-text-muted">How sure is it</span>
      <ul className="grid grid-cols-1 gap-2 tablet:grid-cols-2">
        {(Object.keys(CONFIDENCE) as Confidence[]).map((c) => (
          <li key={c} className="flex items-start gap-2 text-small text-text-muted">
            <span className="mt-1">
              <Meter c={c} />
            </span>
            <span>
              <span className={TONE_TEXT[c]}>{CONFIDENCE[c].label}.</span> {CONFIDENCE[c].blurb}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
