import { Button, Check, ChevronDown, FilterChip, Menu, SearchInput, type MenuEntry } from "@stash/ui";
import { useMemo, useState } from "react";
import { CONFIDENCE, PRESETS, type Confidence, type PresetEntry } from "./data";

/**
 * The presets tab: the synth and preset behind famous songs, which sound in the song it is, how
 * sure we are and where it came from. Nothing plays here: presets belong to their makers, so the
 * page names them and points at the source.
 */

const TONE: Record<Confidence, string> = {
  producer: "border-accent text-accent",
  engineer: "border-type-preset text-type-preset",
  press: "border-type-loop text-type-loop",
  community: "border-border-strong text-text-muted",
};

const FAMILIES: [string, RegExp][] = [
  ["Nexus", /nexus/i],
  ["Omnisphere", /omnisphere/i],
  ["Kontakt", /kontakt|keyscape|output|exhale|una corda|noire|alicia/i],
  ["ElectraX / Electra2", /electra/i],
  ["Gladiator", /gladiator/i],
  ["Serum", /serum/i],
  ["Sylenth1", /sylenth/i],
  ["Trillian", /trillian/i],
  ["Massive", /massive/i],
  ["Spire", /spire/i],
  ["Vital", /vital/i],
  ["Native Instruments (other)", /native instruments|fm8|razor|absynth|reaktor|battery|guitar rig/i],
  ["Reason", /reason/i],
  ["Apple stock", /garageband|logic/i],
  ["FL Studio stock", /image-line|purity|nemesis|fl studio|sytrus|3x ?osc|flex|harmor|harmless|gross beat|fruity|fl keys|directwave|toxic|poizone|transistor/i],
  ["Arturia", /arturia|analog lab|pigments|mini v|jup-8|cs-80/i],
  ["Korg", /korg|triton|m1|motif/i],
  ["Roland", /roland|juno|jupiter|srx|fantom|tr-808|tr808|jv-|xv-|d-50/i],
  ["Hardware", /hardware|v-station|nord|moog|prophet|yamaha|minimoog|rhodes|wurlitzer/i],
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
  ["Strings and orchestra", /string|orchestra|violin|cello|brass|horn|harp\b/i],
  ["Flutes and winds", /flute|wind|pan ?flute|ocarina|recorder|sax/i],
  ["Vocals and choir", /vocal|vox|choir|voice/i],
  ["Plucks and guitar", /pluck|guitar|arp|stab|kalimba|marimba|koto/i],
  ["Drums and FX", /drum|kit|fx|effect|chop|riser|snare|hat/i],
];
function soundsOf(role: string): string[] {
  return SOUNDS.filter(([, re]) => re.test(role)).map(([n]) => n);
}

const PAGE = 60;

export function PresetsPage() {
  const [conf, setConf] = useState<Confidence | "all">("all");
  const [family, setFamily] = useState<string>("All");
  const [sound, setSound] = useState<string>("All");
  const [named, setNamed] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const indexed = useMemo(() => PRESETS.map((p) => ({ p, family: familyOf(p.plugin), sounds: soundsOf(p.role) })), []);
  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const x of indexed) counts.set(x.family, (counts.get(x.family) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [indexed]);

  const needle = q.trim().toLowerCase();
  const rows = indexed
    .filter(
      (x) =>
        (conf === "all" || x.p.confidence === conf) &&
        (family === "All" || x.family === family) &&
        (sound === "All" || x.sounds.includes(sound)) &&
        (!named || x.p.preset) &&
        (!needle || [x.p.song, x.p.artist, x.p.producer, x.p.plugin, x.p.preset ?? "", x.p.role].some((s) => s.toLowerCase().includes(needle))),
    )
    .map((x) => x.p)
    .sort((a, b) => a.artist.localeCompare(b.artist) || a.song.localeCompare(b.song));
  const reset = (f: () => void) => {
    f();
    setLimit(PAGE);
  };
  const counts = (c: Confidence) => PRESETS.filter((p) => p.confidence === c).length;

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">Presets</span>
        <h1 className="text-title">The presets behind the songs</h1>
      </header>

      <section aria-label="Filters" className="flex flex-col gap-3 tablet:flex-row tablet:flex-wrap tablet:items-center">
        <SearchInput label="Search songs, artists, producers, presets" hideLabel shortcut="" value={q} onChange={(e) => reset(() => setQ(e.target.value))} onClear={() => reset(() => setQ(""))} className="tablet:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            name="How sure"
            value={conf === "all" ? "Any" : CONFIDENCE[conf].label}
            options={[["all", `Any ${PRESETS.length}`], ...(Object.keys(CONFIDENCE) as Confidence[]).map((c): [string, string] => [c, `${CONFIDENCE[c].label} ${counts(c)}`])]}
            selected={conf}
            onPick={(v) => reset(() => setConf(v as Confidence | "all"))}
          />
          <Dropdown
            name="VST"
            value={family === "All" ? "Any" : family}
            options={[["All", `Any ${PRESETS.length}`], ...families.map(([f, n]): [string, string] => [f, `${f} ${n}`])]}
            selected={family}
            onPick={(v) => reset(() => setFamily(v))}
          />
          <Dropdown
            name="Sound"
            value={sound === "All" ? "Any" : sound}
            options={[["All", "Any"], ...SOUNDS.map(([n]): [string, string] => [n, `${n} ${indexed.filter((x) => x.sounds.includes(n)).length}`])]}
            selected={sound}
            onPick={(v) => reset(() => setSound(v))}
          />
          <FilterChip selected={named} onToggle={() => reset(() => setNamed(!named))}>
            Exact preset named
          </FilterChip>
          <span aria-live="polite" className="font-mono text-numeric tabular text-text-muted">{`${rows.length} ${rows.length === 1 ? "sound" : "sounds"}`}</span>
        </div>
      </section>

      <ul aria-label="Songs and presets" className="grid grid-cols-1 gap-3 desktop:grid-cols-2">
        {rows.slice(0, limit).map((e, i) => (
          <PresetCard key={`${e.song}-${e.plugin}-${e.role}-${i}`} e={e} />
        ))}
      </ul>
      {rows.length > limit && (
        <Button variant="secondary" className="self-center" onClick={() => setLimit(limit + PAGE)}>
          {`Show ${Math.min(PAGE, rows.length - limit)} more of ${rows.length - limit}`}
        </Button>
      )}
      {rows.length === 0 && <p className="text-body text-text-muted">Nothing matches. Clear the search or pick another filter.</p>}

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

function PresetCard({ e }: { e: PresetEntry }) {
  return (
    <li className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-body-strong text-text">{e.song}</span>
          <span className="text-small text-text-muted">
            {e.artist}
            {e.producer && e.producer !== "Unknown" ? ` · prod. ${e.producer}` : ""}
          </span>
        </div>
        <span className={`shrink-0 rounded-control border px-2 text-label text-label-caps ${TONE[e.confidence]}`}>{CONFIDENCE[e.confidence].label}</span>
      </div>
      <dl className="grid grid-cols-1 gap-2 tablet:grid-cols-3">
        <div className="flex min-w-0 flex-col">
          <dt className="text-label text-label-caps text-text-muted">Preset</dt>
          <dd className="font-mono text-numeric break-words text-text">{e.preset ?? "Not named"}</dd>
          {e.path && <dd className="text-small text-text-muted">{e.path}</dd>}
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-label text-label-caps text-text-muted">VST</dt>
          <dd className="text-small text-text">{e.plugin}</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-label text-label-caps text-text-muted">Sound in the song</dt>
          <dd className="text-small text-text">{e.role}</dd>
        </div>
      </dl>
      {e.quote && (
        <blockquote className="border-l-2 border-border-strong pl-3 text-small text-text">
          “{e.quote}”{e.quoteBy && <span className="text-text-muted"> — {e.quoteBy}</span>}
        </blockquote>
      )}
      <a href={e.source.url} target="_blank" rel="noreferrer" className="w-fit text-small text-text-muted underline underline-offset-2 ui-hover:text-text">
        {e.source.label}
      </a>
    </li>
  );
}
