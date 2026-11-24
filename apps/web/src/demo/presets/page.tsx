import { Button, FilterChip, Info, SearchInput, SlidersHorizontal } from "@stash/ui";
import { useEffect, useMemo, useState } from "react";
import { useMidiPlayer } from "../midi/pages";
import { FACTORY } from "../midi/patch";
import { midiPlayer } from "../midi/synth";
import { navigate } from "../router";
import { openPatch } from "../sound-design";
import { CONFIDENCE, PRESETS, SOURCES_READ, type Confidence, type PresetEntry } from "./data";

/**
 * The presets tab: the synth and preset behind songs, each with how sure we are and where it came
 * from. "Hear a sketch" plays a short phrase on the demo's closest patch; it is never the song.
 */

const player = midiPlayer();
const TONE: Record<Confidence, string> = {
  producer: "border-accent text-accent",
  engineer: "border-type-preset text-type-preset",
  press: "border-type-loop text-type-loop",
  community: "border-border-strong text-text-muted",
};

function pluginFamily(p: string): string {
  const m = /(Nexus|Omnisphere|Kontakt|Gladiator|Electra|Trillian|Triton|Reason|Gross Beat|Roland|Nord|Juno|Little Labs)/i.exec(p);
  if (!m) return "Other";
  const f = m[1]!.toLowerCase();
  return f === "electra" ? "ElectraX / Electra2" : f === "juno" || f === "roland" ? "Roland" : m[1]!.replace(/^\w/, (c) => c.toUpperCase());
}

function sketch(e: PresetEntry) {
  const patch = FACTORY.find((p) => p.name === e.sketch) ?? FACTORY[0]!;
  player.setPatch(patch);
  const t = [0, 0.5, 1, 1.5, 2, 3];
  const bass = /bass|808|drums/i.test(e.role);
  const root = bass ? 36 : 60;
  const notes = [0, 3, 7, 10, 7, 3].map((iv, i): [number, number, number, number] => [t[i]!, i === 5 ? 1 : 0.45, root + iv, 100]);
  player.toggle(`sketch-${e.song}-${e.plugin}`, { version: 1, bpm: 120, timeSignature: [4, 4], bars: 1, pitchMin: root, pitchMax: root + 10, drums: false, notes }, "keys");
}

export function PresetsPage() {
  const [conf, setConf] = useState<Confidence | "all">("all");
  const [family, setFamily] = useState<string>("All");
  const [q, setQ] = useState("");
  const families = useMemo(() => ["All", ...new Set(PRESETS.map((p) => pluginFamily(p.plugin)))], []);
  const rows = PRESETS.filter(
    (p) =>
      (conf === "all" || p.confidence === conf) &&
      (family === "All" || pluginFamily(p.plugin) === family) &&
      (!q.trim() || [p.song, p.artist, p.producer, p.plugin, p.preset ?? ""].some((s) => s.toLowerCase().includes(q.trim().toLowerCase()))),
  );
  const s = useMidiPlayer();
  useEffect(
    () => () => {
      player.pause();
      player.setPatch(null);
    },
    [],
  );
  const counts = (c: Confidence) => PRESETS.filter((p) => p.confidence === c).length;

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">Presets</span>
        <h1 className="text-title">The sounds behind the songs</h1>
        <p className="max-w-prose text-body text-text-muted">
          Which synth, and where anyone has said it, which preset is on a song. Producers rarely publish exact presets, so every row says how sure it is and links to
          where it came from. Look at the label before you rely on a row.
        </p>
      </header>

      <section aria-label="How sure" className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-4">
        {(Object.keys(CONFIDENCE) as Confidence[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={conf === c}
            onClick={() => setConf(conf === c ? "all" : c)}
            className={`flex flex-col gap-1 rounded-panel border bg-surface p-4 text-left ${conf === c ? "border-text" : "border-border ui-hover:border-border-strong"}`}
          >
            <span className={`w-fit rounded-control border px-2 text-label text-label-caps ${TONE[c]}`}>{CONFIDENCE[c].label}</span>
            <span className="font-mono text-numeric tabular text-text">{counts(c)} songs</span>
            <span className="text-small text-text-muted">{CONFIDENCE[c].blurb}</span>
          </button>
        ))}
      </section>

      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center">
        <SearchInput label="Search songs, producers, plugins" shortcut="" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} className="tablet:w-80" />
        <div role="group" aria-label="Plugin" className="flex flex-wrap gap-2">
          {families.map((f) => (
            <FilterChip key={f} selected={family === f} onToggle={() => setFamily(f)}>
              {f}
            </FilterChip>
          ))}
        </div>
      </div>

      <ul aria-label="Songs and presets" className="grid grid-cols-1 gap-3 desktop:grid-cols-2">
        {rows.map((e) => {
          const id = `sketch-${e.song}-${e.plugin}`;
          const playing = s.currentId === id && s.status === "playing";
          return (
            <li key={`${e.song}-${e.plugin}`} className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-body-strong text-text">{e.song}</span>
                  <span className="text-small text-text-muted">
                    {e.artist} · prod. {e.producer}
                  </span>
                </div>
                <span className={`shrink-0 rounded-control border px-2 text-label text-label-caps ${TONE[e.confidence]}`}>{CONFIDENCE[e.confidence].label}</span>
              </div>
              <dl className="grid grid-cols-1 gap-2 tablet:grid-cols-3">
                <div className="flex flex-col">
                  <dt className="text-label text-label-caps text-text-muted">Plugin</dt>
                  <dd className="text-small text-text">{e.plugin}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-label text-label-caps text-text-muted">Preset</dt>
                  <dd className="font-mono text-numeric text-text">{e.preset ?? "Not named"}</dd>
                  {e.path && <dd className="text-small text-text-muted">{e.path}</dd>}
                </div>
                <div className="flex flex-col">
                  <dt className="text-label text-label-caps text-text-muted">Used for</dt>
                  <dd className="text-small text-text">{e.role}</dd>
                </div>
              </dl>
              {e.quote && (
                <blockquote className="border-l-2 border-border-strong pl-3 text-small text-text">
                  “{e.quote}”{e.quoteBy && <span className="text-text-muted"> — {e.quoteBy}</span>}
                </blockquote>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a href={e.source.url} target="_blank" rel="noreferrer" className="text-small text-text-muted underline underline-offset-2 ui-hover:text-text">
                  {e.source.label}
                </a>
                <span className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => sketch(e)} aria-pressed={playing}>
                    {playing ? "Stop sketch" : "Hear a sketch"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={SlidersHorizontal}
                    onClick={() => {
                      player.pause();
                      openPatch(FACTORY.find((p) => p.name === e.sketch) ?? FACTORY[0]!);
                      navigate("/sound-design");
                    }}
                  >
                    Shape it
                  </Button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="text-body text-text-muted">Nothing matches. Clear the search or pick another plugin.</p>}

      <section aria-label="About this list" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-label text-label-caps text-text-muted">
          <Info className="size-4" aria-hidden="true" /> About this list
        </h2>
        <p className="text-small text-text-muted">
          Researched 24 November 2026. A sketch plays the nearest patch in the demo, never the real preset or the song. Community rows come from producers matching sounds by
          ear in forum threads; treat them as leads to check, not facts. Sources read:
        </p>
        <ul className="flex flex-col gap-1">
          {SOURCES_READ.map((src) => (
            <li key={src.url}>
              <a href={src.url} target="_blank" rel="noreferrer" className="text-small text-text underline underline-offset-2">
                {src.label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
