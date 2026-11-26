import type { ItemRow } from "@stash/contracts";
import type { Catalog } from "./data";
import type { MidiItem } from "./midi/catalog";
import { profile, type Profile } from "./smart-search";

// Building a profile tokenizes every word of an item: a MIDI tab of 1,500 items spent most of its
// first render here, and again on every keystroke. An item's words never change under its id, so
// each profile is built once.
const loopProfiles = new Map<string, Profile>();
const midiProfiles = new Map<string, Profile>();

/** The search profile of a loop: its title, tags, genre, description and the producer it nods to. */
export function loopProfile(row: ItemRow, catalog: Catalog): Profile {
  let p = loopProfiles.get(row.id);
  if (!p) loopProfiles.set(row.id, (p = buildLoopProfile(row, catalog)));
  return p;
}

function buildLoopProfile(row: ItemRow, catalog: Catalog): Profile {
  const item = catalog.page(row.publicId)?.item;
  return profile({
    id: row.id,
    kind: "loop",
    title: row.title,
    bpm: row.bpm ?? null,
    key: row.key ?? null,
    words: [row.title, ...row.tags, item?.genre ?? "", item?.description ?? "", row.owner.displayName, ...(item?.allTags ?? []).map((t) => t.name)],
    publishedAt: row.publishedAt,
  });
}

/** The search profile of a MIDI item; a song's chords carry its artist and producer. */
export function midiProfile(m: MidiItem): Profile {
  let p = midiProfiles.get(m.id);
  if (!p) midiProfiles.set(m.id, (p = buildMidiProfile(m)));
  return p;
}

function buildMidiProfile(m: MidiItem): Profile {
  return profile({
    id: m.id,
    kind: "midi",
    title: m.title,
    bpm: Math.round(m.notes.bpm),
    key: m.key,
    words: [m.title, ...m.tags, m.description, m.kind, m.sound, m.owner.displayName, m.song?.song ?? "", m.song?.artist ?? "", m.song?.producer ?? "", m.kind === "chords" ? "chords" : ""],
    people: m.song ? [m.song.artist, m.song.producer ?? ""] : [],
    publishedAt: m.publishedAt,
  });
}
