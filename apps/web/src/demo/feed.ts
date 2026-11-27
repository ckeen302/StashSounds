/**
 * The home feed's two shelves that change with the person: picks from what they liked, saved and
 * followed, and what was added most recently. Pure functions over the catalog and this browser's
 * likes, so the rules are testable; the home page renders them. Nothing here counts anything for
 * the person to see.
 */

/** A loop as the feed reads it. */
export type FeedLoop = { id: string; title: string; ownerId: string; bpm: number | null; tags: string[]; genre: string | null; style: string | null; publishedAt: string };
/** A song as the feed reads it. */
export type FeedSong = { slug: string; song: string; artist: string; producers: string[]; year: number | null };

export type Signals = {
  /** Loops liked or downloaded in this browser. */
  liked: ReadonlySet<string>;
  /** Producers followed (their ids). */
  followed: ReadonlySet<string>;
  /** Songs saved to a crate (their slugs). */
  savedSongs: ReadonlySet<string>;
};

export type LoopPick = { loop: FeedLoop; because: string };
export type SongPick = { song: FeedSong; because: string };

const low = (x: string) => x.toLowerCase().trim();
const leadOf = (artist: string) => low(artist.split(/ feat\.? | featuring | ft\.? | with |,| & | x /i)[0] ?? artist);

/**
 * Loops like the ones liked: the same producer's style, genre, tags and tempo, and loops by people
 * followed. Each pick names the liked loop (or the follow) it came from. Never a loop already liked.
 */
export function loopPicks(loops: FeedLoop[], s: Signals, n = 6): LoopPick[] {
  const seeds = loops.filter((l) => s.liked.has(l.id));
  if (!seeds.length && !s.followed.size) return [];
  const scored: { loop: FeedLoop; score: number; because: string }[] = [];
  for (const l of loops) {
    if (s.liked.has(l.id)) continue;
    let best = 0;
    let because = "";
    for (const x of seeds) {
      let sc = 0;
      if (l.style && l.style === x.style) sc += 3;
      if (l.ownerId === x.ownerId) sc += 2;
      if (l.genre && l.genre === x.genre) sc += 2;
      sc += l.tags.filter((t) => x.tags.includes(t)).length;
      if (l.bpm && x.bpm && Math.abs(l.bpm - x.bpm) <= 5) sc += 1;
      if (sc > best) {
        best = sc;
        because = `Because you liked ${x.title}`;
      }
    }
    if (s.followed.has(l.ownerId)) {
      best += 3;
      if (!because) because = "From someone you follow";
    }
    // One tag in common is chance, not a pick.
    if (best >= 3) scored.push({ loop: l, score: best, because });
  }
  scored.sort((a, b) => b.score - a.score || b.loop.publishedAt.localeCompare(a.loop.publishedAt));
  // No more than two from one producer, so a single like does not fill the shelf with one name.
  const per = new Map<string, number>();
  const out: LoopPick[] = [];
  for (const x of scored) {
    const k = per.get(x.loop.ownerId) ?? 0;
    if (k >= 2) continue;
    per.set(x.loop.ownerId, k + 1);
    out.push({ loop: x.loop, because: x.because });
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Songs to open next: by the producers and artists of songs saved to a crate, and by the producers
 * whose style the liked loops are in. Never a song already saved.
 */
export function songPicks(songs: FeedSong[], s: Signals, likedStyles: string[], n = 8): SongPick[] {
  const saved = songs.filter((x) => s.savedSongs.has(x.slug));
  // producer -> why, with {p} for the producer as the song credits them ("metro boomin" in a tag reads "Metro Boomin")
  const producers = new Map<string, string>();
  const artists = new Map<string, string>();
  for (const x of saved) {
    for (const p of x.producers) if (!producers.has(low(p))) producers.set(low(p), `Produced by {p}, like ${x.song}`);
    if (!artists.has(leadOf(x.artist))) artists.set(leadOf(x.artist), `More from ${x.artist.split(/ feat\.? | featuring | ft\.? /i)[0]}`);
  }
  for (const st of likedStyles) if (!producers.has(low(st))) producers.set(low(st), "Produced by {p}, whose style you liked");
  if (!producers.size && !artists.size) return [];
  const out: SongPick[] = [];
  const ranked = [...songs].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  for (const x of ranked) {
    if (s.savedSongs.has(x.slug)) continue;
    const credit = x.producers.find((p) => producers.has(low(p)));
    const byProducer = credit ? producers.get(low(credit))!.replace("{p}", credit) : undefined;
    const because = byProducer ?? artists.get(leadOf(x.artist));
    if (!because) continue;
    out.push({ song: x, because });
    if (out.length >= n) break;
  }
  return out;
}

/** The newest loops, a few per uploader so one big drop does not take the whole shelf. */
export function newLoops(loops: FeedLoop[], n = 6): FeedLoop[] {
  const sorted = [...loops].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const per = new Map<string, number>();
  const out: FeedLoop[] = [];
  for (const l of sorted) {
    const k = per.get(l.ownerId) ?? 0;
    if (k >= 2) continue;
    per.set(l.ownerId, k + 1);
    out.push(l);
    if (out.length >= n) break;
  }
  return out;
}

/** The newest songs on Stash: this year's and last year's releases first. */
export function newSongs(songs: FeedSong[], n = 10): FeedSong[] {
  return songs
    .filter((x) => x.year)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.song.localeCompare(b.song))
    .slice(0, n);
}
