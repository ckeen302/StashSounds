import { Avatar, Download, IconButton, PlayButton, UiLink, useToast } from "@stash/ui";
import { useMemo } from "react";
import { ALL_PRODUCERS } from "./explore";
import { labelOf, play, useKits, type Kit } from "./kits/store";
import { allShots, saveShots, useMineVersion, type OneShot } from "./oneshots/store";
import { ALL_SONGS, songHref, type Song } from "./presets/songs";
import { categoryName, downloadSfx, playSfx, SFX, subName, usePlaying, type Sfx } from "./sfx/library";
import { queryWords, textMatch, type Field } from "./text-match";
import type { Producer } from "./data";

/**
 * Search over everything that isn't a loop or MIDI: the presets behind songs, sound effects, drum
 * kits, one-shots and producers. Each kind is matched on its own fields, every query word has to
 * land for a result to count as a match, and results that miss a word come after, as close matches.
 */

export type Ranked<T> = { items: T[]; close: boolean };

/** Every-word matches first; when there are none, the best partial matches, marked as close. */
export function rank<T>(list: T[], fields: (x: T) => Field[], words: string[]): Ranked<T> {
  const scored = list
    .map((x) => ({ x, hit: textMatch(fields(x), words) }))
    .filter((r): r is { x: T; hit: NonNullable<typeof r.hit> } => !!r.hit)
    .sort((a, b) => b.hit.hits - a.hit.hits || b.hit.score - a.hit.score);
  const full = scored.filter((r) => r.hit.all);
  if (full.length) return { items: full.map((r) => r.x), close: false };
  // Close matches need most of the words, so one stray word doesn't flood the page.
  const need = Math.max(1, Math.ceil(words.length / 2));
  return { items: scored.filter((r) => r.hit.hits >= need).map((r) => r.x), close: true };
}

const songFields = (s: Song): Field[] => [
  { text: s.song, weight: 4 },
  { text: s.artist, weight: 3 },
  { text: s.producer, weight: 2 },
  { text: s.entries.map((e) => `${e.plugin} ${e.preset ?? ""} ${e.role}`).join(" "), weight: 2 },
];
const sfxFields = (s: Sfx): Field[] => [
  { text: s.name, weight: 4 },
  { text: `${subName(s.cat, s.sub)} ${categoryName(s.cat)}`, weight: 2 },
  { text: s.tags.join(" "), weight: 1 },
];
const kitFields = (k: Kit): Field[] => [
  { text: k.name, weight: 4 },
  { text: `${k.genre} ${k.owner.displayName} ${k.owner.handle}`, weight: 2 },
  { text: `${k.description} ${[...new Set(k.sounds.map((s) => labelOf(s.category)))].join(" ")}`, weight: 1 },
];
const shotFields = (s: OneShot): Field[] => [
  { text: s.name, weight: 4 },
  { text: `${labelOf(s.category)} ${s.category}`, weight: 3 },
  { text: `${s.genre} ${s.kit?.name ?? ""} ${s.owner.displayName}`, weight: 1 },
];
const producerFields = (p: Producer): Field[] => [
  { text: p.displayName, weight: 4 },
  { text: p.handle, weight: 4 },
];

export type OtherHits = {
  presets: Ranked<Song>;
  sfx: Ranked<Sfx>;
  kits: Ranked<Kit>;
  shots: Ranked<OneShot>;
  producers: Ranked<Producer>;
};

export function useOtherHits(query: string): OtherHits {
  const kits = useKits();
  const mine = useMineVersion();
  return useMemo(() => {
    const words = queryWords(query);
    const none = { items: [], close: false };
    if (!words.length) return { presets: none, sfx: none, kits: none, shots: none, producers: none };
    return {
      presets: rank(ALL_SONGS, songFields, words),
      sfx: rank(SFX, sfxFields, words),
      kits: rank(kits, kitFields, words),
      shots: rank(allShots(kits), shotFields, words),
      producers: rank(ALL_PRODUCERS, producerFields, words),
    };
    // `mine` changes when the viewer posts one-shots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kits, mine]);
}

const ROW = "flex min-h-14 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0";
const LIST = "overflow-hidden rounded-panel border border-border bg-surface";

export function PresetHits({ songs, query }: { songs: Song[]; query: string }) {
  const words = queryWords(query);
  return (
    <ul aria-label="Preset results" className={LIST}>
      {songs.map((s) => {
        // The sounds that matched the search first, so "omnisphere" shows the Omnisphere patch.
        const shown = [...s.entries].sort((a, b) => (textMatch([{ text: `${b.plugin} ${b.preset ?? ""}`, weight: 1 }], words)?.score ?? 0) - (textMatch([{ text: `${a.plugin} ${a.preset ?? ""}`, weight: 1 }], words)?.score ?? 0)).slice(0, 2);
        return (
          <li key={s.key} className={ROW}>
            <UiLink href={songHref(s.song, s.artist)} className="flex min-w-0 flex-1 flex-col ui-hover:underline">
              <span className="truncate text-body-strong text-text">{`${s.song} · ${s.artist}`}</span>
              <span className="truncate text-small text-text-muted">{shown.map((e) => (e.preset ? `${e.plugin}: ${e.preset}` : e.plugin)).join(" · ")}</span>
            </UiLink>
            <span className="shrink-0 font-mono text-numeric tabular text-text-muted">{`${s.entries.length} ${s.entries.length === 1 ? "sound" : "sounds"}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function SfxHits({ list }: { list: Sfx[] }) {
  const playing = usePlaying();
  const toast = useToast();
  return (
    <ul aria-label="Sound effect results" className={LIST}>
      {list.map((s) => (
        <li key={s.id} className={ROW}>
          <PlayButton title={s.name} state={playing.loading === s.id ? "loading" : playing.id === s.id ? "playing" : "paused"} onClick={() => void playSfx(s)} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body-strong text-text">{s.name}</span>
            <span className="truncate text-small text-text-muted">{`${categoryName(s.cat)} · ${subName(s.cat, s.sub)} · ${s.duration.toFixed(1)} s`}</span>
          </span>
          <IconButton
            icon={Download}
            label={`Download ${s.name}`}
            onClick={() =>
              void downloadSfx([s], s.name).then((o) => {
                if (o === "saved") toast({ tone: "success", title: "Downloaded", description: s.name });
              })
            }
          />
        </li>
      ))}
    </ul>
  );
}

export function KitHits({ list }: { list: Kit[] }) {
  return (
    <ul aria-label="Drum kit results" className={LIST}>
      {list.map((k) => (
        <li key={k.id} className={ROW}>
          <UiLink href={`/kit/${k.id}`} className="flex min-w-0 flex-1 flex-col ui-hover:underline">
            <span className="truncate text-body-strong text-text">{k.name}</span>
            <span className="truncate text-small text-text-muted">{`${k.genre} · ${k.sounds.length} sounds · ${k.owner.displayName}`}</span>
          </UiLink>
        </li>
      ))}
    </ul>
  );
}

export function ShotHits({ list }: { list: OneShot[] }) {
  const toast = useToast();
  return (
    <ul aria-label="One-shot results" className={LIST}>
      {list.map((s) => (
        <li key={s.id} className={ROW}>
          <PlayButton title={s.name} state="paused" onClick={() => void play(s, s.id)} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body-strong text-text">{s.name}</span>
            <span className="truncate text-small text-text-muted">{[labelOf(s.category), s.kit?.name].filter(Boolean).join(" · ")}</span>
          </span>
          <IconButton
            icon={Download}
            label={`Download ${s.name}`}
            onClick={() =>
              void saveShots([s], s.name).then(({ outcome }) => {
                if (outcome === "saved") toast({ tone: "success", title: "Downloaded", description: s.name });
              })
            }
          />
        </li>
      ))}
    </ul>
  );
}

export function ProducerHits({ list }: { list: Producer[] }) {
  return (
    <ul aria-label="Producer results" className={LIST}>
      {list.map((p) => (
        <li key={p.id} className={ROW}>
          <UiLink href={`/u/${p.handle}`} className="flex min-w-0 flex-1 items-center gap-3 ui-hover:underline">
            <Avatar name={p.displayName} src={null} size={32} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body-strong text-text">{p.displayName}</span>
              <span className="truncate text-small text-text-muted">{`@${p.handle}`}</span>
            </span>
          </UiLink>
        </li>
      ))}
    </ul>
  );
}
