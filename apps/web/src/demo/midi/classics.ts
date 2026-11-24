import raw from "./classics.json" with { type: "json" };
import { progressionOf, type SongChords } from "./songs";

/**
 * The classic progressions: the moves under decades of records (the axis, the '50s, ii–V–I, the
 * blues, the Andalusian cadence). Each is written out in an example key from roman numerals in a
 * fetched source, with the songs that source names. Chord lengths are set by us; no source gives them.
 */
export type Classic = {
  name: string;
  aka: string[];
  numerals: string[];
  key: string;
  chords: [string, number][];
  examples: { song: string; artist: string }[];
  quote: string;
  source: { label: string; url: string };
};

export const CLASSICS: Classic[] = raw as unknown as Classic[];

/** The classic as a chord chart the song pipeline can voice, at a mid-tempo 90 BPM. */
export function classicChart(c: Classic): SongChords {
  return { song: c.name, artist: "", producer: null, key: c.key, bpm: 90, chords: c.chords, chordSource: c.source };
}

/** Its numerals the way songs are grouped ("I–V–vi–IV"), to find library songs that use it. */
export function classicLabel(c: Classic): string | null {
  return progressionOf(classicChart(c))?.label ?? null;
}
