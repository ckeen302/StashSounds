import { Button, Check, ChevronDown, FilterChip, Menu, SearchInput, type MenuEntry } from "@stash/ui";
import { useMemo, useState } from "react";
import { Cover, coverFor } from "./cover";
import { CONFIDENCE, PRESETS, type Confidence, type PresetEntry } from "./data";

/**
 * The presets tab: the synth and preset behind famous songs. Each song is one card; each sound in it
 * reads like a synth's own display (plugin, bank, preset name), with how sure we are as a meter and
 * where it came from. Nothing plays here: presets belong to their makers, so the page names them and
 * points at the source.
 */

const LEVEL: Record<Confidence, number> = { producer: 4, engineer: 3, press: 2, community: 1 };
const TONE: Record<Confidence, string> = {
  producer: "bg-accent",
  engineer: "bg-type-preset",
  press: "bg-type-loop",
  community: "bg-border-strong",
};
const TONE_TEXT: Record<Confidence, string> = {
  producer: "text-accent",
  engineer: "text-type-preset",
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
function familyOf(plugin: string): string {
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

type Song = { key: string; song: string; artist: string; producer: string; entries: PresetEntry[]; best: number; named: number };
const SORTS = {
  sure: { label: "Best sourced first", by: (a: Song, b: Song) => b.best - a.best || b.named - a.named || a.artist.localeCompare(b.artist) },
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
  const [limit, setLimit] = useState(PAGE);

  const indexed = useMemo(() => PRESETS.map((p) => ({ p, family: familyOf(p.plugin), sounds: soundsOf(p.role) })), []);
  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const x of indexed) counts.set(x.family, (counts.get(x.family) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [indexed]);
  const stats = useMemo(
    () => ({
      sounds: PRESETS.length,
      exact: PRESETS.filter((p) => p.preset).length,
      songs: new Set(PRESETS.map((p) => `${p.song}|${p.artist}`.toLowerCase())).size,
      producers: PRESETS.filter((p) => p.confidence === "producer").length,
    }),
    [],
  );

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
  const by = new Map<string, Song>();
  for (const e of matching) {
    const key = `${e.song.toLowerCase()}|${e.artist.toLowerCase()}`;
    const s = by.get(key) ?? { key, song: e.song, artist: e.artist, producer: e.producer, entries: [], best: 0, named: 0 };
    s.entries.push(e);
    s.best = Math.max(s.best, LEVEL[e.confidence]);
    if (e.preset) s.named++;
    if (s.producer === "Unknown" && e.producer !== "Unknown") s.producer = e.producer;
    by.set(key, s);
  }
  for (const s of by.values()) s.entries.sort((a, b) => LEVEL[b.confidence] - LEVEL[a.confidence] || Number(!!b.preset) - Number(!!a.preset));
  const songs = [...by.values()].sort(SORTS[sort].by);

  const reset = (f: () => void) => {
    f();
    setLimit(PAGE);
  };
  const counts = (c: Confidence) => PRESETS.filter((p) => p.confidence === c).length;
  const touched = conf !== "all" || family !== "All" || sound !== "All" || named || needle !== "";

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-5 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-label text-label-caps text-text-muted">Presets</span>
          <h1 className="text-display text-balance">The presets behind the songs</h1>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {(
            [
              [stats.sounds, "sounds"],
              [stats.exact, "exact presets"],
              [stats.songs, "songs"],
              [stats.producers, "from the producer"],
            ] as const
          ).map(([n, label]) => (
            <div key={label} className="flex items-baseline gap-2">
              <dd className="font-mono text-title tabular text-accent">{n}</dd>
              <dt className="text-small text-text-muted">{label}</dt>
            </div>
          ))}
        </dl>
      </header>

      {!touched && <FromTheProducer />}

      <SearchInput
        label="Search songs, artists, producers, presets"
        hideLabel
        placeholder="Search a song, artist, producer or preset name"
        shortcut=""
        value={q}
        onChange={(e) => reset(() => setQ(e.target.value))}
        onClear={() => reset(() => setQ(""))}
      />

      {/* The plugin shelf: every VST with its count; tap one to see only its presets. */}
      <section aria-label="Plugins" className="flex flex-col gap-2">
        <span className="text-label text-label-caps text-text-muted">Pick a plugin</span>
        <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:px-0">
          {[["All", PRESETS.length] as [string, number], ...families].map(([f, n]) => {
            const on = family === f;
            return (
              <li key={f} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => reset(() => setFamily(on && f !== "All" ? "All" : f))}
                  className={`flex min-w-24 flex-col items-start gap-1 rounded-control border px-3 py-2 text-left transition-colors ${on ? "border-accent bg-raised" : "border-border bg-surface ui-hover:border-border-strong"}`}
                >
                  <span className={`text-small ${on ? "text-text" : "text-text-muted"}`}>{f === "All" ? "Every plugin" : f}</span>
                  <span className={`font-mono text-body-strong tabular ${on ? "text-accent" : "text-text"}`}>{n}</span>
                </button>
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
        <Dropdown name="Sort" active={false} value={SORTS[sort].label} options={(Object.keys(SORTS) as SortId[]).map((s): [string, string] => [s, SORTS[s].label])} selected={sort} onPick={(v) => reset(() => setSort(v as SortId))} />
        <FilterChip selected={named} onToggle={() => reset(() => setNamed(!named))}>
          Exact preset named
        </FilterChip>
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
              })
            }
          >
            Clear
          </Button>
        )}
        <span aria-live="polite" className="ml-auto font-mono text-numeric tabular text-text-muted">
          {`${songs.length} ${songs.length === 1 ? "song" : "songs"} · ${matching.length} ${matching.length === 1 ? "sound" : "sounds"}`}
        </span>
      </section>

      <ul aria-label="Songs and their presets" className="grid grid-cols-1 items-start gap-3 desktop:grid-cols-2">
        {songs.slice(0, limit).map((s) => (
          <SongCard key={s.key} s={s} />
        ))}
      </ul>
      {songs.length > limit && (
        <Button variant="secondary" className="self-center" onClick={() => setLimit(limit + PAGE)}>
          {`Show ${Math.min(PAGE, songs.length - limit)} more of ${songs.length - limit}`}
        </Button>
      )}
      {songs.length === 0 && <p className="text-body text-text-muted">Nothing matches. Clear the search or pick another plugin.</p>}

      <ConfidenceKey />
    </main>
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

function SongCard({ s }: { s: Song }) {
  return (
    <li className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <div className="flex items-center gap-4">
        <Cover song={s.song} artist={s.artist} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-title break-words text-text">{s.song}</span>
          <span className="text-small text-text">{s.artist}</span>
          <span className="text-small text-text-muted">
            {[coverFor(s.song, s.artist)?.album, s.producer && s.producer !== "Unknown" ? `prod. ${s.producer}` : null].filter(Boolean).join(" · ")}
          </span>
          <span className="font-mono text-numeric tabular text-text-muted">{`${s.entries.length} ${s.entries.length === 1 ? "sound" : "sounds"}`}</span>
        </div>
      </div>
      <ul className="flex flex-col gap-4">
        {s.entries.map((e, i) => (
          <PatchStrip key={`${e.plugin}-${e.preset}-${e.role}-${i}`} e={e} />
        ))}
      </ul>
    </li>
  );
}

function Meter({ c }: { c: Confidence }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-0.5">
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`h-3 w-1.5 rounded-control ${n <= LEVEL[c] ? TONE[c] : "bg-raised"}`} />
      ))}
    </span>
  );
}

/** One sound, shown the way a synth's preset display shows it: plugin and bank above, the name big. */
function PatchStrip({ e }: { e: PresetEntry }) {
  return (
    <li className="flex flex-col gap-2">
      <span className="text-label text-label-caps text-text-muted">{/^not stated/i.test(e.role) ? "Sound not stated" : e.role}</span>
      <div className="flex flex-col gap-1 rounded-control border border-border-strong bg-bg px-3 py-2">
        <span className="font-mono text-small break-words text-text-muted">{[e.plugin, e.path].filter(Boolean).join(" › ")}</span>
        <span className={`font-mono text-body-strong break-words ${e.preset ? "text-accent" : "text-text-muted"}`}>{e.preset ?? "Preset not named"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2" title={CONFIDENCE[e.confidence].blurb}>
          <Meter c={e.confidence} />
          <span className={`text-label text-label-caps ${TONE_TEXT[e.confidence]}`}>{CONFIDENCE[e.confidence].label}</span>
        </span>
        <a href={e.source.url} target="_blank" rel="noreferrer" className="min-w-0 text-small break-words text-text-muted underline underline-offset-2 ui-hover:text-text">
          {e.source.label}
        </a>
      </div>
      {e.quote && (
        <blockquote className="border-l-2 border-border-strong pl-3 text-small text-text">
          “{e.quote}”{e.quoteBy && <span className="text-text-muted"> — {e.quoteBy}</span>}
        </blockquote>
      )}
    </li>
  );
}

/** The surest rows first: presets the song's own producer named, as a sideways shelf. */
function FromTheProducer() {
  const rows = PRESETS.filter((p) => p.confidence === "producer" && p.preset);
  if (!rows.length) return null;
  return (
    <section aria-label="Straight from the producer" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Meter c="producer" />
        <span className="text-label text-label-caps text-accent">Straight from the producer</span>
        <span className="font-mono text-numeric tabular text-text-muted">{rows.length}</span>
      </div>
      <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:px-0">
        {rows.map((e, i) => (
          <li key={`${e.song}-${e.preset}-${i}`} className="flex w-64 shrink-0 flex-col gap-2 rounded-panel border border-accent bg-surface p-3">
            <div className="flex items-center gap-3">
              <Cover song={e.song} artist={e.artist} size="sm" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-body-strong text-text">{e.song}</span>
                <span className="truncate text-small text-text-muted">{`${e.artist} · ${e.role}`}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 rounded-control border border-border-strong bg-bg px-3 py-2">
              <span className="truncate font-mono text-small text-text-muted">{e.plugin}</span>
              <span className="font-mono text-body-strong break-words text-accent">{e.preset}</span>
            </div>
            <a href={e.source.url} target="_blank" rel="noreferrer" className="mt-auto truncate text-small text-text-muted underline underline-offset-2 ui-hover:text-text">
              {e.quoteBy ? `Said by ${e.quoteBy}` : e.source.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the meter means, once, at the foot of the list. */
function ConfidenceKey() {
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
