import { Button, Check, ChevronDown, Menu, UiLink, type MenuEntry } from "@stash/ui";
import { BankHead, LcdSearch } from "../bank-head";
import { CartridgeHero } from "../heroes/cartridge";
import { useEffect, useMemo, useState } from "react";
import { queryWords, textMatch } from "../text-match";
import { albumOf, Cover, coverFor } from "./cover";
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

/** The tab's search and filters outlive a visit to a song, so Back lands where the producer left off. */
const kept = { conf: "all" as Confidence | "all", family: "All", sound: "All", named: false, sort: "sure" as SortId, q: "", who: "All", limit: PAGE, open: false };

export function PresetsPage() {
  const [conf, setConf] = useState<Confidence | "all">(kept.conf);
  const [family, setFamily] = useState<string>(kept.family);
  const [sound, setSound] = useState<string>(kept.sound);
  const [named, setNamed] = useState(kept.named);
  const [sort, setSort] = useState<SortId>(kept.sort);
  const [q, setQ] = useState(kept.q);
  const [who, setWho] = useState(kept.who);
  const [limit, setLimit] = useState(kept.limit);

  const indexed = useMemo(() => PRESETS.map((p) => ({ p, family: familyOf(p.plugin), sounds: soundsOf(p.role) })), []);
  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const x of indexed) counts.set(x.family, (counts.get(x.family) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [indexed]);
  const needle = q.trim().toLowerCase();
  // Each word has to land somewhere (song, artist, producer, plugin, preset), ignoring accents,
  // apostrophes and one typo: "beyonce", "dont", "travis sicko" and "omnishpere" all find their songs.
  const words = queryWords(q);
  const hit = (p: PresetEntry) => {
    if (!words.length) return true;
    const m = textMatch(
      [
        { text: p.song, weight: 3 },
        { text: p.artist, weight: 3 },
        { text: p.producer, weight: 2 },
        { text: `${p.plugin} ${p.preset ?? ""}`, weight: 1 },
        { text: `${p.role} ${p.path ?? ""}`, weight: 1 },
      ],
      words,
    );
    return !!m?.all;
  };
  const matching = indexed
    .filter(
      (x) =>
        (conf === "all" || x.p.confidence === conf) &&
        (family === "All" || x.family === family) &&
        (sound === "All" || x.sounds.includes(sound)) &&
        (!named || x.p.preset) &&
        (!needle || x.p.song.toLowerCase().includes(needle) || x.p.artist.toLowerCase().includes(needle) || hit(x.p)),
    )
    .map((x) => x.p);
  const songs = groupSongs(matching).filter((x) => who === "All" || madeBy(x, who)).sort(SORTS[sort].by);
  const shownSounds = songs.reduce((n, x) => n + x.entries.length, 0);

  const reset = (f: () => void) => {
    f();
    setLimit(PAGE);
  };
  const [open, setOpen] = useState(kept.open);
  const touched = conf !== "all" || family !== "All" || sound !== "All" || named || needle !== "" || who !== "All";
  useEffect(() => {
    Object.assign(kept, { conf, family, sound, named, sort, q, who, limit, open });
  }, [conf, family, sound, named, sort, q, who, limit, open]);
  const clearAll = () =>
    reset(() => {
      setConf("all");
      setFamily("All");
      setSound("All");
      setNamed(false);
      setQ("");
      setWho("All");
    });

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-5 px-3 py-5 tablet:px-4 desktop:px-6">
      {/* Title, one row of controls, then the songs: plugins, producers and sorting wait behind Filters. */}
      <BankHead
        kicker="PATCH LIBRARY"
        title="Presets"
        hero={<CartridgeHero />}
        blurb="The synth, the bank and the patch behind the songs you're chasing."
        search={
          <LcdSearch
            id="presets-q"
            label="Search songs, artists, producers, presets"
            placeholder="song, artist, plugin or preset"
            value={q}
            onChange={(v) => reset(() => setQ(v))}
          />
        }
        actions={
          <button type="button" className="sp-key" aria-pressed={open} aria-expanded={open} onClick={() => setOpen(!open)}>
            {touched && !needle ? "Filters ·" : "Filters"}
          </button>
        }
      />

      {open && (
      <div className="sp-panel-dark flex flex-col gap-4 p-4">
      {/* The plugin shelf: every VST with its count; tap one to see only its presets. */}
      <section aria-label="Plugins" className="flex flex-col gap-2">
        <h2 className="lib-label-dark">Pick a plugin</h2>
        <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:px-0">
          {[["All", PRESETS.length] as [string, number], ...families].map(([f]) => {
            const on = family === f;
            return (
              <li key={f} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => reset(() => setFamily(on && f !== "All" ? "All" : f))}
                  className="sp-pad lib-pad-chip"
                >
                  <span className="sp-pad-code">{f === "All" ? "ALL" : "VST"}</span>
                  <span className="sp-pad-label">{f === "All" ? "Every plugin" : f}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* The producer shelf: the beatmakers with the most songs here; tap one to see only theirs. */}
      <section aria-label="Producers" className="flex flex-col gap-2">
        <h2 className="lib-label-dark">By producer</h2>
        <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:px-0">
          {TOP_PRODUCERS.map(([name]) => {
            const on = who === name;
            return (
              <li key={name} className="shrink-0">
                <button type="button" className="sp-key sp-key-pill" aria-pressed={on} onClick={() => reset(() => setWho(on ? "All" : name))}>
                  {name}
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
          options={[["all", "Any"], ...(Object.keys(CONFIDENCE) as Confidence[]).map((c): [string, string] => [c, CONFIDENCE[c].label])]}
          selected={conf}
          onPick={(v) => reset(() => setConf(v as Confidence | "all"))}
        />
        <Dropdown
          name="Sound"
          value={sound === "All" ? "Any" : sound}
          options={[["All", "Any"], ...SOUNDS.map(([n]): [string, string] => [n, n])]}
          selected={sound}
          onPick={(v) => reset(() => setSound(v))}
        />
        <Dropdown name="Sort" active={false} value={SORTS[sort].label} options={(Object.keys(SORTS) as SortId[]).map((s): [string, string] => [s, SORTS[s].label])} selected={sort} onPick={(v) => reset(() => setSort(v as SortId))} />
        {touched && (
          <Button
            size="sm"
            variant="ghost"
            onClick={clearAll}
          >
            Clear
          </Button>
        )}
        <span aria-live="polite" className="sr-only">
          {`${songs.length} ${songs.length === 1 ? "song" : "songs"} · ${shownSounds} ${shownSounds === 1 ? "sound" : "sounds"}`}
        </span>
      </section>
      </div>
      )}
      {!open && (
        <span aria-live="polite" className="sr-only">
          {`${songs.length} ${songs.length === 1 ? "song" : "songs"} · ${shownSounds} ${shownSounds === 1 ? "sound" : "sounds"}`}
        </span>
      )}

      <ul aria-label="Songs and their presets" className="lib-grid">
        {songs.slice(0, limit).map((s) => (
          <SongCard key={s.key} s={s} />
        ))}
      </ul>
      {songs.length > limit && (
        <button type="button" className="sp-key self-center" onClick={() => setLimit(limit + PAGE)}>
          Show more
        </button>
      )}
      {songs.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body text-text-muted">
            {needle ? `No presets for “${q.trim()}” yet. Try the song title or the artist's name on its own.` : "Nothing matches. Clear the filters or pick another plugin."}
          </p>
          {touched && (
            <Button size="sm" variant="secondary" onClick={clearAll}>
              Clear search and filters
            </Button>
          )}
        </div>
      )}
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
export function SongCard({ s }: { s: Song }) {
  const album = albumOf(s.song, s.artist) ?? "Album not listed";
  const producer = s.producer && !/^(unknown|not stated)$/i.test(s.producer) ? `prod. ${s.producer}` : "Producer not credited";
  const lead = s.entries.find((e) => e.preset) ?? s.entries[0]!;
  return (
    <li className="h-full">
      <UiLink href={songHref(s.song, s.artist)} className="sp-cart lib-cart group h-full">
        <span className="flex items-start gap-4">
          <span className="sp-cover lib-cover">
            <Cover song={s.song} artist={s.artist} size="fill" placeholder />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="lib-cart-title group-hover:underline">{s.song}</span>
            <span className="lib-cart-line">{s.artist}</span>
            <span className="lib-sub truncate">{album}</span>
            <span className="lib-sub truncate">{producer}</span>
          </span>
        </span>
        <ul className="mt-auto flex flex-col">
          <PatchStrip e={lead} />
        </ul>
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
      <li className="sp-lcd lib-strip">
        <span className="lib-strip-part">{partOf(e.role)}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="sp-lcd-small truncate">{e.plugin}</span>
          <span className="sp-lcd-text truncate">{name}</span>
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
