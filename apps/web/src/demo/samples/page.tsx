import {
  Button,
  ButtonLink,
  EmptyState,
  UiLink,
} from "@stash/ui";
import { BankHead, LcdSearch } from "../bank-head";
import { daily } from "../heroes/daily";
import { useState, type ReactNode } from "react";
import { CrateMenu } from "../explore";
import { Comments } from "../social";
import "./covers";
import "../song/data";
import { Cover, coverFor } from "../presets/cover";
import {
  ARTISTS,
  artistBySlug,
  artistHref,
  artistOf,
  asOriginal,
  asSong,
  decadeOf,
  GENRES,
  listenHref,
  listenLabel,
  ORIGINALS,
  originalBySlug,
  originalHref,
  originalOf,
  producerBySlug,
  producerHref,
  producerOf,
  PRODUCERS,
  SAMPLE_SONGS,
  sampleHref,
  type Original,
  type SampleArtist,
  type SampleProducer,
  type SampleSong,
  type SampleUse,
} from "./data";

/**
 * The Samples tab: which songs sample which records, both ways. Four ways in: by song, by most
 * sampled record, by artist (most sampled first) and by producer. A song's page pairs it with each
 * record it samples, side by side with a way to hear both, and lists the songs that sampled it in
 * turn; record, artist and producer pages hang off those links.
 */

const PAGE = 48;
const DECADES = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s"];
type View = "songs" | "records" | "artists" | "producers";
const VIEWS: [View, string][] = [
  ["songs", "Songs"],
  ["records", "Most sampled"],
  ["artists", "Artists"],
  ["producers", "Producers"],
];

// Songs with their album cover first, then newest, so the tab opens on art.
// (Each song's cover is looked up once, not on every comparison: the sort compared 9,000 songs.)
const ORDERED = SAMPLE_SONGS.map((s) => ({
  s,
  art: coverFor(s.song, s.artist) ? 1 : 0,
}))
  .sort((a, b) => b.art - a.art || (b.s.year ?? 0) - (a.s.year ?? 0))
  .map(({ s }) => s);

const flat = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const known = (g: string) => g !== "Other";
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const line = (...parts: (string | number | null | undefined | false)[]) =>
  parts.filter(Boolean).join(" · ");

export function SamplesPage() {
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState<string | null>(null);
  const [decade, setDecade] = useState<string | null>(null);
  const [view, setView] = useState<View>("songs");
  const [limit, setLimit] = useState(PAGE);
  const reset = (f: () => void) => {
    f();
    setLimit(PAGE);
  };
  const needle = flat(q.trim());
  // Every word has to show up somewhere, so "kanye stronger" or "dilla donuts" finds the song
  // even though no one field holds both words. Punctuation is ignored ("jay z" finds "Jay-Z").
  const loose = (x: string) => flat(x).replace(/[^\p{L}\p{N}]+/gu, " ");
  const words = loose(needle).split(" ").filter(Boolean);
  const has = (...xs: string[]) => {
    if (!words.length) return true;
    const hay = " " + loose(xs.join(" ")) + " ";
    const squashed = hay.replace(/ /g, "");
    return words.every((w) => hay.includes(w) || squashed.includes(w));
  };
  const fits = (u: { genre: string; year: number | null }) =>
    (!genre || u.genre === genre) && (!decade || decadeOf(u.year) === decade);

  const songs =
    view === "songs"
      ? ORDERED.filter(
          (s) =>
            s.samples.some(fits) &&
            has(
              s.song,
              s.artist,
              s.album ?? "",
              ...s.producers,
              ...s.samples.flatMap((u) => [u.title, u.artist]),
            ),
        )
      : [];
  const records =
    view === "records"
      ? ORIGINALS.filter(
          (o) =>
            fits(o) &&
            has(o.title, o.artist, ...o.uses.map((x) => x.song.song)),
        )
      : [];
  const artists =
    view === "artists"
      ? ARTISTS.filter((a) => a.sampledTimes > 0 && has(a.name))
      : [];
  const producers =
    view === "producers" ? PRODUCERS.filter((p) => has(p.name)) : [];
  const shown = {
    songs: songs.length,
    records: records.length,
    artists: artists.length,
    producers: producers.length,
  }[view];
  const unit = {
    songs: "song",
    records: "record",
    artists: "artist",
    producers: "producer",
  }[view];
  const filtered = view === "songs" || view === "records";
  const touched = !!(needle || (filtered && (genre || decade)));

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-4 px-3 py-5 tablet:px-4 desktop:px-6">
      <BankHead
        kicker="SAMPLE FINDER"
        title="Samples"
        hero={<FlipHero />}
        blurb="Hip-hop and R&B songs and the records they sample. From Wikipedia's album credits and song articles, and MusicBrainz."
        search={
          <LcdSearch
            id="samples-q"
            label="Search songs, artists, producers and sampled records"
            placeholder="song, artist, producer or the record it samples"
            value={q}
            onChange={(v) => reset(() => setQ(v))}
          />
        }
      />

      <div
        role="tablist"
        aria-label="Browse by"
        className="lib-shelf"
      >
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => reset(() => setView(v))}
            data-hot={view === v || undefined}
            className="sp-pad lib-pad-chip"
          >
            <span className="sp-pad-code">VIEW</span>
            <span className="sp-pad-label">{label}</span>
          </button>
        ))}
      </div>

      {filtered && (
        <section aria-label="Filters" className="flex flex-col gap-3">
          <div className="sp-head">
            <h2 className="sp-label">Sampled from</h2>
          </div>
          <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:flex-wrap tablet:px-0">
            {GENRES.filter(([g]) => known(g)).map(([g]) => (
              <li key={g} className="shrink-0">
                <button type="button" className="sp-key sp-key-pill" aria-pressed={genre === g} onClick={() => reset(() => setGenre(genre === g ? null : g))}>
                  {g}
                </button>
              </li>
            ))}
          </ul>
          <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:px-0">
            {DECADES.map((d) => (
              <li key={d} className="shrink-0">
                <button type="button" className="sp-key sp-key-dark sp-key-pill" aria-pressed={decade === d} onClick={() => reset(() => setDecade(decade === d ? null : d))}>
                  {d}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center gap-2">
        <span aria-live="polite" className="sr-only">
          {plural(shown, unit)}
        </span>
        {touched && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              reset(() => {
                setQ("");
                setGenre(null);
                setDecade(null);
              })
            }
          >
            Clear
          </Button>
        )}
      </div>

      {view === "songs" && (
        <ul
          aria-label="Songs and what they sample"
          className="lib-grid"
        >
          {songs.slice(0, limit).map((s) => (
            <SongCard key={s.key} s={s} />
          ))}
        </ul>
      )}
      {view === "records" && (
        <ol aria-label="Most sampled records" className="lib-rack lib-rank flex flex-col gap-1">
          {records.slice(0, limit).map((o, i) => (
            <RecordRow key={o.key} o={o} n={i + 1} />
          ))}
        </ol>
      )}
      {view === "artists" && (
        <ol
          aria-label="Most sampled artists"
          className="lib-rack lib-rank grid grid-cols-1 gap-1 tablet:grid-cols-2"
        >
          {artists.slice(0, limit).map((a, i) => (
            <RankRow
              key={a.slug}
              href={artistHref(a)}
              n={i + 1}
              title={a.name}
              sub={line(...a.records.slice(0, 3).map((r) => r.title))}
              detail={`Biggest: ${a.records[0]?.title ?? ""}`}
            />
          ))}
        </ol>
      )}
      {view === "producers" && (
        <ol
          aria-label="Producers who sample"
          className="lib-rack lib-rank grid grid-cols-1 gap-1 tablet:grid-cols-2"
        >
          {producers.slice(0, limit).map((p, i) => (
            <RankRow
              key={p.slug}
              href={producerHref(p)}
              n={i + 1}
              title={p.name}
              sub={line(
                ...[...new Set(p.songs.map((s) => s.artist))].slice(0, 3),
              )}
              detail={`Flipped ${topArtists(p.songs, 3).join(", ")}`}
            />
          ))}
        </ol>
      )}
      {shown > limit && (
        <button type="button" className="sp-key self-center" onClick={() => setLimit(limit + PAGE)}>
          Show more
        </button>
      )}
      {shown === 0 && (
        <p className="sp-lcd sp-lcd-small m-0">
          Nothing matches. Clear the search or pick another genre.
        </p>
      )}
    </main>
  );
}

const EXT = {
  primary: "border-accent bg-accent text-bg ui-hover:bg-accent/85",
  secondary: "border-border-strong bg-surface text-text ui-hover:bg-raised",
  ghost: "border-transparent text-text ui-hover:bg-raised",
};

/** A link that leaves the demo (YouTube, an article): opens in a new tab, styled as a small button. */
export function ExtLink({
  href,
  variant,
  children,
}: {
  href: string;
  variant: keyof typeof EXT;
  children: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex h-8 items-center rounded-control border px-3 text-body-strong pointer-coarse:h-10 ${EXT[variant]}`}
    >
      {children}
    </a>
  );
}

/** The artists a set of songs samples most, most first. */
function topArtists(songs: SampleSong[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const s of songs)
    for (const u of s.samples)
      counts.set(u.artist, (counts.get(u.artist) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([a]) => a);
}

function UseBadge({ u }: { u: SampleUse }) {
  return (
    <span className="shrink-0 rounded-control border border-border-strong px-2 py-0.5 text-label text-label-caps text-text">
      {u.type === "sample" ? "Sample" : "Replayed"}
    </span>
  );
}

export function SongCard({ s }: { s: SampleSong }) {
  const sampledIn = asOriginal(s)?.uses.length ?? 0;
  const first = s.samples[0];
  return (
    <li className="h-full">
      <UiLink href={sampleHref(s)} className="sp-cart lib-cart group h-full">
        <span className="lib-pair">
          <PairArt song={s.song} artist={s.artist} />
          {first && (
            <>
              <span className="lib-cable" aria-hidden="true">
                <span />
              </span>
              <PairArt song={first.title} artist={first.artist} />
            </>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="lib-cart-title group-hover:underline">{s.song}</span>
          <span className="lib-cart-line">{s.artist}</span>
          <span className="lib-sub truncate">{line(s.year, s.album)}</span>
          {s.producers.length > 0 && <span className="lib-sub truncate">{`prod. ${s.producers.join(", ")}`}</span>}
        </span>
        <ul className="mt-auto flex flex-col gap-2">
          {s.samples.slice(0, 3).map((u) => (
            <li key={`${u.title}|${u.artist}`} className="sp-lcd lib-strip">
              <span className="lib-strip-part">{u.type === "sample" ? "Sample" : "Replay"}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="sp-lcd-small truncate">{line(u.artist, u.year, known(u.genre) && u.genre)}</span>
                <span className="sp-lcd-text truncate">{u.title}</span>
              </span>
            </li>
          ))}
          {s.samples.length > 3 && <li className="lib-sub">and more</li>}
          {sampledIn > 0 && <li className="lib-label-dark">Sampled in other songs here</li>}
        </ul>
      </UiLink>
    </li>
  );
}

/**
 * The Samples page's hero: today's flip, big. The song's cover patched by a cable to the record it
 * samples, with what was taken from it on the screen underneath.
 */
function FlipHero() {
  const s = daily(
    ORDERED.filter((x) => x.samples[0] && coverFor(x.song, x.artist) && coverFor(x.samples[0].title, x.samples[0].artist)),
    9,
  );
  const u = s?.samples[0];
  if (!s || !u) return null;
  return (
    <UiLink href={sampleHref(s)} className="sp-cart sp-hero-flip group">
      <span className="sp-label sp-label-dark">Flip of the day</span>
      <span className="lib-pair sp-hero-flip-pair">
        <PairArt song={s.song} artist={s.artist} />
        <span className="lib-cable" aria-hidden="true">
          <span />
        </span>
        <PairArt song={u.title} artist={u.artist} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="sp-hero-name group-hover:underline">{s.song}</span>
        <span className="truncate text-small text-text-muted">{s.artist}</span>
      </span>
      <span className="sp-lcd lib-strip">
        <span className="lib-strip-part">{u.type === "sample" ? "Sample" : "Replay"}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="sp-lcd-small truncate">{line(u.artist, u.year)}</span>
          <span className="sp-lcd-text truncate">{u.title}</span>
        </span>
      </span>
    </UiLink>
  );
}

/** A cover in its bezel; a record with no art yet shows its title on a small screen instead. */
function PairArt({ song, artist }: { song: string; artist: string }) {
  return (
    <span className="sp-cover lib-cover-pair">
      {coverFor(song, artist) ? (
        <Cover song={song} artist={artist} size="fill" />
      ) : (
        <span aria-hidden="true" className="lib-cover-blank">
          <span>{song}</span>
        </span>
      )}
    </span>
  );
}

function RankRow({
  href,
  n,
  title,
  sub,
  detail,
}: {
  href: string;
  n: number;
  title: string;
  sub: string;
  detail?: string;
}) {
  return (
    <li>
      <UiLink
        href={href}
        className="lib-row group flex items-center gap-4 p-3"
      >
        <span className="lib-chip-lcd hidden shrink-0 tablet:inline-flex">
          {String(n).padStart(2, "0")}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-strong text-text uppercase tracking-wide group-hover:underline">
            {title}
          </span>
          <span className="truncate text-small text-text-muted">{sub}</span>
          {detail && (
            <span className="truncate text-small text-text-muted">
              {detail}
            </span>
          )}
        </span>
      </UiLink>
    </li>
  );
}

function RecordRow({ o, n }: { o: Original; n: number }) {
  return (
    <RankRow
      href={originalHref(o)}
      n={n}
      title={o.title}
      sub={line(o.artist, o.year, known(o.genre) && o.genre)}
      detail={`In ${o.uses.map((x) => x.song.song).join(", ")}`}
    />
  );
}

function Missing({ what }: { what: string }) {
  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-5 px-3 py-8 tablet:px-4 desktop:px-6">
      <EmptyState
        title={`That ${what} isn't in the samples yet`}
        action={
          <ButtonLink href="/samples" variant="secondary">
            All samples
          </ButtonLink>
        }
      >
        Search the Samples tab by song, artist, producer or the record it
        samples.
      </EmptyState>
    </main>
  );
}

function Facts({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
      {facts.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-label text-label-caps text-text-muted">{k}</dt>
          <dd className="text-body-strong text-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An artist's name that links to their page when they have one. */
export function ArtistLink({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  const a = artistOf(name);
  return a ? (
    <UiLink href={artistHref(a)} className={`ui-hover:underline ${className}`}>
      {name}
    </UiLink>
  ) : (
    <span className={className}>{name}</span>
  );
}

export function ProducerList({ names }: { names: string[] }) {
  if (!names.length) return <>Not credited</>;
  return (
    <>
      {names.map((n, i) => {
        const p = producerOf(n);
        return (
          <span key={n}>
            {i > 0 && ", "}
            {p ? (
              <UiLink href={producerHref(p)} className="ui-hover:underline">
                {n}
              </UiLink>
            ) : (
              n
            )}
          </span>
        );
      })}
    </>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 id={id} className="text-title text-text">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** One song: the cover over a blurred copy, the facts, each record it samples side by side with it, and who sampled it. */
/**
 * The song and one record it samples, side by side, each with a way to hear it: play one, then the
 * other, and listen for the part that carried over. YouTube can't be framed inside the demo's host page,
 * so each side opens the recording on YouTube (its own video when Wikidata names one, otherwise a
 * search); the credits name no timestamps, so neither side jumps.
 */
export function Pair({ u, song }: { u: SampleUse; song: SampleSong }) {
  const o = originalOf(u);
  const others = o.uses.filter((x) => x.song !== song);
  const deeper = asSong(o);
  return (
    <li className="flex flex-col rounded-panel border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <UseBadge u={u} />
        <span className="text-small text-text-muted">
          {u.type === "sample"
            ? "The recording itself is used"
            : "Re-played or re-sung, not the recording"}
        </span>
      </div>
      <div className="grid grid-cols-1 tablet:grid-cols-[1fr_auto_1fr]">
        <Side
          label="This song"
          cover={
            <Cover
              song={song.song}
              artist={song.artist}
              size="sm"
              placeholder
            />
          }
          title={song.song}
          meta={line(song.artist, song.year)}
          listen={listenHref(song.song, song.artist, song.video)}
          listenText={listenLabel(song.video)}
        />
        <span
          aria-hidden="true"
          className="flex items-center justify-center px-4 py-1 font-mono text-title text-accent tablet:py-0"
        >
          <span className="tablet:hidden">↓</span>
          <span className="hidden tablet:inline">←</span>
        </span>
        <Side
          label="The original"
          cover={
            <Cover song={o.title} artist={o.artist} size="sm" placeholder />
          }
          title={u.title}
          href={originalHref(o)}
          meta={line(u.artist, u.year, known(u.genre) && u.genre)}
          listen={listenHref(u.title, u.artist, u.video ?? o.video)}
          listenText={listenLabel(u.video ?? o.video)}
          extra={u.page ? { href: u.page, label: "About it" } : undefined}
        />
      </div>
      {(others.length > 0 || deeper) && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          {deeper && (
            <UiLink
              href={sampleHref(deeper)}
              className="self-start text-small text-accent ui-hover:underline"
            >
              {"See what the original samples →"}
            </UiLink>
          )}
          {others.length > 0 && (
            <>
              <span className="text-label text-label-caps text-text-muted">
                Also sampled in
              </span>
              <ul className="flex flex-wrap gap-2">
                {others.slice(0, 12).map((x) => (
                  <li key={x.song.key}>
                    <UiLink
                      href={sampleHref(x.song)}
                      className="inline-flex items-center rounded-control border border-border px-2 py-1 text-small text-text ui-hover:border-border-strong"
                    >
                      {`${x.song.song} · ${x.song.artist}`}
                    </UiLink>
                  </li>
                ))}
                {others.length > 12 && (
                  <li>
                    <UiLink
                      href={originalHref(o)}
                      className="inline-flex items-center px-2 py-1 text-small text-text-muted ui-hover:text-text"
                    >
                      {`all ${others.length + 1}`}
                    </UiLink>
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Side({
  label,
  cover,
  title,
  href,
  meta,
  listen,
  listenText,
  extra,
}: {
  label: string;
  cover: ReactNode;
  title: string;
  href?: string;
  meta: string;
  listen: string;
  listenText: string;
  extra?: { href: string; label: string };
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <span className="text-label text-label-caps text-text-muted">
        {label}
      </span>
      <span className="flex items-center gap-3">
        {cover}
        <span className="flex min-w-0 flex-col">
          {href ? (
            <UiLink
              href={href}
              className="st-hero-title text-title break-words text-accent ui-hover:underline"
            >
              {title}
            </UiLink>
          ) : (
            <span className="st-hero-title text-title break-words text-text">
              {title}
            </span>
          )}
          <span className="text-small text-text-muted">{meta}</span>
        </span>
      </span>
      <span className="flex flex-wrap gap-2">
        <ExtLink href={listen} variant="secondary">
          {listenText}
        </ExtLink>
        {extra && (
          <ExtLink href={extra.href} variant="ghost">
            {extra.label}
          </ExtLink>
        )}
      </span>
    </div>
  );
}

export function Sources({ sources }: { sources: { label: string; url: string }[] }) {
  return (
    <section aria-label="Source" className="flex flex-col gap-1">
      <span className="text-label text-label-caps text-text-muted">Source</span>
      {sources.map((src) => (
        <a
          key={src.url}
          href={src.url}
          target="_blank"
          rel="noreferrer"
          className="self-start text-small break-words text-text-muted underline underline-offset-2 ui-hover:text-text"
        >
          {src.label}
        </a>
      ))}
    </section>
  );
}

function PlainHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-3 pt-6 pb-8 tablet:px-4 tablet:pt-8 desktop:px-6">
        <UiLink
          href="/samples"
          className="self-start text-small text-text-muted ui-hover:text-text"
        >
          ← Samples
        </UiLink>
        <span className="text-label text-label-caps text-text-muted">
          {eyebrow}
        </span>
        <h1 className="st-hero-title st-song-title text-balance break-words text-text">
          {title}
        </h1>
        {children}
      </div>
    </header>
  );
}

/** One sampled record: what it is, what it samples itself, and every song here that used it. */
export function OriginalPage({ slug }: { slug: string }) {
  const o = originalBySlug(slug);
  if (!o) return <Missing what="record" />;
  const page = o.uses.find((x) => x.use.page)?.use.page;
  const deeper = asSong(o);
  return (
    <main className="flex w-full flex-col">
      <PlainHero eyebrow="Sampled record" title={o.title}>
        <Facts
          facts={[
            ["Artist", <ArtistLink key="a" name={o.artist} />],
            ["Year", o.year ? String(o.year) : "Not listed"],
            ["Genre", known(o.genre) ? o.genre : "Not listed"],
          ]}
        />
        <span className="flex flex-wrap gap-2">
          <ExtLink
            href={listenHref(o.title, o.artist, o.video)}
            variant="primary"
          >
            {listenLabel(o.video)}
          </ExtLink>
          {page && (
            <ExtLink href={page} variant="secondary">
              About it
            </ExtLink>
          )}
          {deeper && (
            <ButtonLink href={sampleHref(deeper)} variant="secondary" size="sm">
              What it samples
            </ButtonLink>
          )}
          <CrateMenu
            itemId={`sample:original:${o.slug}`}
            title={o.title}
            kind="Sampled record"
            href={originalHref(o)}
            by={o.artist}
            size="sm"
          />
        </span>
      </PlainHero>
      <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-3 py-8 tablet:px-4 desktop:px-6">
        <Section id="used-in" title="Was sampled in">
          <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
            {o.uses.map((x) => (
              <SongCard key={x.song.key} s={x.song} />
            ))}
          </ul>
        </Section>
        <Comments
          itemId={`sample:original:${o.slug}`}
          title={`${o.title} by ${o.artist}`}
        />
      </div>
    </main>
  );
}

/** One artist on both sides: their records that were sampled, and their songs here that sample. */
export function SampleArtistPage({ slug }: { slug: string }) {
  const a = artistBySlug(slug);
  if (!a) return <Missing what="artist" />;
  return <ArtistBody a={a} />;
}

function ArtistBody({ a }: { a: SampleArtist }) {
  const flipped = new Set(
    a.songs.flatMap((s) => s.samples.map((u) => u.artist)),
  ).size;
  return (
    <main className="flex w-full flex-col">
      <PlainHero eyebrow="Artist" title={a.name}>
        <Facts
          facts={[
            ["Sampled", `${plural(a.sampledTimes, "time")}`],
            ["Records sampled", String(a.records.length)],
            ["Their songs here", String(a.songs.length)],
            ["Artists they sampled", String(flipped)],
          ]}
        />
      </PlainHero>
      <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-3 py-8 tablet:px-4 desktop:px-6">
        {a.records.length > 0 && (
          <Section id="records" title="Their records that were sampled">
            <ol className="flex flex-col gap-2">
              {a.records.slice(0, 60).map((o, i) => (
                <RecordRow key={o.key} o={o} n={i + 1} />
              ))}
            </ol>
          </Section>
        )}
        {a.songs.length > 0 && (
          <Section id="songs" title="Their songs and what they sample">
            <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
              {a.songs.slice(0, 60).map((s) => (
                <SongCard key={s.key} s={s} />
              ))}
            </ul>
          </Section>
        )}
      </div>
    </main>
  );
}

/** One producer: the songs they made from samples, and the artists they flip most. */
export function SampleProducerPage({ slug }: { slug: string }) {
  const p = producerBySlug(slug);
  if (!p) return <Missing what="producer" />;
  return <ProducerBody p={p} />;
}

function ProducerBody({ p }: { p: SampleProducer }) {
  const counts = new Map<string, number>();
  for (const s of p.songs)
    for (const u of s.samples)
      counts.set(u.artist, (counts.get(u.artist) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const genres = new Map<string, number>();
  for (const s of p.songs)
    for (const u of s.samples)
      if (known(u.genre)) genres.set(u.genre, (genres.get(u.genre) ?? 0) + 1);
  const topGenre = [...genres.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return (
    <main className="flex w-full flex-col">
      <PlainHero eyebrow="Producer" title={p.name}>
        <Facts
          facts={[
            ["Songs with samples", String(p.songs.length)],
            [
              "Records flipped",
              String(p.songs.reduce((n, s) => n + s.samples.length, 0)),
            ],
            ["Digs mostly in", topGenre ?? "Not listed"],
          ]}
        />
        {top.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-label text-label-caps text-text-muted">
              Flips most
            </span>
            <ul className="flex flex-wrap gap-2">
              {top.map(([name]) => (
                <li
                  key={name}
                  className="inline-flex items-center rounded-control border border-border px-2 py-1 text-small text-text"
                >
                  <ArtistLink name={name} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </PlainHero>
      <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-3 py-8 tablet:px-4 desktop:px-6">
        <Section id="produced" title="Songs and what they sample">
          <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
            {p.songs.map((s) => (
              <SongCard key={s.key} s={s} />
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}

