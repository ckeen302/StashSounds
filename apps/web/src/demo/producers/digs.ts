import type { SampleSong } from "../samples/data";

const lead = (artist: string) => (artist.split(/ feat\.? | featuring | ft\.? | with /i)[0] ?? artist).trim();
const flat = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/^the /, "").replace(/[^a-z0-9]/g, "");

/**
 * The artists a producer goes back to: whose records turn up in at least two of their songs,
 * most often first. One song sampling three cuts from one album counts once, and the producer's
 * own records (J Dilla flipping J Dilla) are left out.
 */
export function digsOf(songs: SampleSong[], self = "", max = 8): string[] {
  const own = flat(self);
  const by = new Map<string, { name: string; songs: Set<string> }>();
  for (const s of songs)
    for (const u of s.samples) {
      const name = lead(u.artist);
      const k = flat(name);
      if (!k || k === own || k === flat(lead(s.artist))) continue;
      const e = by.get(k) ?? { name, songs: new Set<string>() };
      e.songs.add(s.key);
      by.set(k, e);
    }
  return [...by.values()]
    .filter((e) => e.songs.size >= 2)
    .sort((a, b) => b.songs.size - a.songs.size || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((e) => e.name);
}
