import { Button, FilterChip } from "@stash/ui";
import { useMemo, useState } from "react";
import { Dropdown } from "../presets/page";
import { useQuery } from "../search-ui";
import { BankHead, LcdSmartSearch } from "../bank-head";
import { midiProfile } from "../search-index";
import { match } from "../smart-search";
import type { MidiItem } from "./catalog";
import { CHORD_PACKS, PACK_PROGRESSIONS, TEMPO_BANDS } from "./chord-packs";
import { MidiList, useMidiItems } from "./pages";
import { BATCH_SONGS, progressionOf } from "./songs";

/**
 * The MIDI tab: chord packs, classic progressions, chords from songs and producers' patterns, with
 * search and filters. (Moved out of main.tsx so the library pages own their screens.)
 */

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

export function AllMidi() {
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
    <main className="mx-auto flex w-full max-w-content flex-col gap-8 px-3 py-5 tablet:px-4 desktop:px-6">
      <BankHead
        kicker="MIDI BANK"
        title="MIDI"
        blurb="Chord packs, progressions from songs and producers' patterns. Hear one, change the key, drag it into your DAW."
        search={<LcdSmartSearch id="midi-q" value={q} onChange={setQ} placeholder="c minor 140 like metro" />}
      />
      <div role="group" aria-label="Where it comes from" className="flex flex-wrap gap-2">
        {(Object.keys(ORIGIN_NAME) as Origin[]).map((o) => (
          <button key={o} type="button" className="sp-key sp-key-pill" aria-pressed={origin === o} onClick={() => setOrigin(o)}>
            {ORIGIN_NAME[o]}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Filter MIDI" className="lib-tray flex flex-wrap items-center gap-2">
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
          <div className="sp-head">
            <h2 id="chord-packs" className="sp-label">Cartridges · chord packs</h2>
          </div>
          <p className="lib-note">Voiced progressions written for Stash. Pick a pack to hear every progression in it.</p>
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
                  className="sp-cart lib-cart lib-cart-btn h-full w-full text-left"
                >
                  <span className="lib-cart-title">{p.name}</span>
                  <span className="lib-chip-lcd inline-flex self-start">{p.style}</span>
                  <span className="lib-sub line-clamp-2">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
          {packs.length > 8 && (
            <button type="button" className="sp-key self-start" onClick={() => setAllPacks(!allPacks)}>
              {allPacks ? "Show fewer" : "Show all packs"}
            </button>
          )}
        </section>
      )}
      {!q && !filtered && classics.length > 0 && (kind === "all" || kind === "chords") && (
        <section aria-labelledby="classics" className="flex flex-col gap-3">
          <div className="sp-head">
            <h2 id="classics" className="sp-label">Classic progressions</h2>
          </div>
          <MidiList label="Classic progressions" items={allClassics ? classics : classics.slice(0, 8)} />
          {classics.length > 8 && (
            <button type="button" className="sp-key self-start" onClick={() => setAllClassics(!allClassics)}>
              {allClassics ? "Show fewer" : "Show all"}
            </button>
          )}
        </section>
      )}
      {progressions.length > 0 && !filtered && (!q || prog) && (
        <section aria-labelledby="progressions" className="flex flex-col gap-3">
          <div className="sp-head">
            <h2 id="progressions" className="sp-label">Most-used progressions</h2>
            {prog && (
              <button type="button" className="sp-key sp-key-pill" onClick={() => setProg(null)}>
                Show all
              </button>
            )}
          </div>
          <p className="lib-note">The same moves under the biggest songs, in roman numerals so the key doesn&apos;t matter. Pick one to hear every song on it.</p>
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
                  className="sp-cart lib-cart lib-cart-btn h-full w-full text-left"
                >
                  <span className="lib-chip-lcd lib-chip-lcd-lg inline-flex self-start">{g.label}</span>
                  <span className="lib-cart-line">{g.minor ? "Minor" : "Major"}</span>
                  <span className="lib-sub line-clamp-2">{g.songs.slice(0, 4).join(", ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="sp-head">
        <h2 className="sp-label">Bank select</h2>
      </div>
      <div role="group" aria-label="Kind" className="lib-shelf -mt-5">
        {KINDS.map((k, i) => (
          <button key={k} type="button" className="sp-pad lib-pad-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
            <span className="sp-pad-code">{k === "all" ? "ALL" : `M${String(i).padStart(2, "0")}`}</span>
            <span className="sp-pad-label">{KIND_NAME[k]}</span>
          </button>
        ))}
      </div>
      {shown.length > 0 && <MidiList label="MIDI" items={shown.slice(0, limit)} />}
      {shown.length === 0 && <p className="sp-lcd sp-lcd-small m-0">Nothing matches. Clear a filter or the search.</p>}
      {shown.length > limit && (
        <button type="button" className="sp-key self-start" onClick={() => setLimit(limit + PAGE)}>
          Show more
        </button>
      )}
    </main>
  );
}
