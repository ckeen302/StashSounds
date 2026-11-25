import {
  Button,
  ButtonLink,
  EmptyState,
  FilterChip,
  SearchInput,
  UiLink,
} from "@stash/ui";
import { useState } from "react";
import { songChordItems } from "../midi/catalog";
import { albumOf, Cover, coverFor, tileStyle } from "../presets/cover";
import { ALL_SONGS, songHref } from "../presets/songs";
import {
  decadeOf,
  GENRES,
  listenHref,
  ORIGINALS,
  originalBySlug,
  originalHref,
  originalOf,
  SAMPLE_SONGS,
  sampleHref,
  sampleSongBySlug,
  type Original,
  type SampleSong,
  type SampleUse,
} from "./data";

/**
 * The Samples tab: which songs sample which records, and where each record came from. Two ways in:
 * by song (newest first) or by sampled record (most sampled first). A song's page lists every record
 * it samples with a way to hear the original; a record's page lists every song here that used it.
 */

const PAGE = 48;
const DECADES = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s"];
type View = "songs" | "records";

// Songs with their album cover first, then newest, so the tab opens on art.
const ORDERED = [...SAMPLE_SONGS].sort(
  (a, b) =>
    Number(!!coverFor(b.song, b.artist)) -
      Number(!!coverFor(a.song, a.artist)) || (b.year ?? 0) - (a.year ?? 0),
);

const flat = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const known = (g: string) => g !== "Other";

function useFilters() {
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState<string | null>(null);
  const [decade, setDecade] = useState<string | null>(null);
  const [view, setView] = useState<View>("songs");
  const [limit, setLimit] = useState(PAGE);
  const reset = (f: () => void) => {
    f();
    setLimit(PAGE);
  };
  return {
    q,
    setQ,
    genre,
    setGenre,
    decade,
    setDecade,
    view,
    setView,
    limit,
    setLimit,
    reset,
  };
}

export function SamplesPage() {
  const f = useFilters();
  const needle = flat(f.q.trim());
  const fits = (u: { genre: string; year: number | null }) =>
    (!f.genre || u.genre === f.genre) &&
    (!f.decade || decadeOf(u.year) === f.decade);

  const songs = ORDERED.filter(
    (s) =>
      s.samples.some(fits) &&
      (!needle ||
        [
          s.song,
          s.artist,
          s.album ?? "",
          ...s.producers,
          ...s.samples.flatMap((u) => [u.title, u.artist]),
        ].some((x) => flat(x).includes(needle))),
  );
  const records = ORIGINALS.filter(
    (o) =>
      fits(o) &&
      (!needle ||
        [
          o.title,
          o.artist,
          ...o.uses.flatMap((x) => [x.song.song, x.song.artist]),
        ].some((x) => flat(x).includes(needle))),
  );
  const shown = f.view === "songs" ? songs.length : records.length;
  const touched = !!(needle || f.genre || f.decade);

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-4 px-3 py-5 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title">Samples</h1>
          <p className="text-body text-text-muted">
            {`What ${SAMPLE_SONGS.length} hip-hop songs sample, and the ${ORIGINALS.length} records they came from. Credits from each album's liner notes.`}
          </p>
        </div>
        <SearchInput
          label="Search songs, artists, producers and sampled records"
          hideLabel
          placeholder="Song, artist, producer or the record it samples"
          shortcut=""
          value={f.q}
          onChange={(e) => f.reset(() => f.setQ(e.target.value))}
          onClear={() => f.reset(() => f.setQ(""))}
        />
      </header>

      <div
        role="tablist"
        aria-label="Browse by"
        className="flex gap-1 border-b border-border"
      >
        {(
          [
            ["songs", "By song"],
            ["records", "Most sampled"],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={f.view === v}
            onClick={() => f.reset(() => f.setView(v))}
            className={`-mb-px flex h-11 items-center border-b-2 px-3 text-body-strong ${f.view === v ? "border-accent text-text" : "border-transparent text-text-muted ui-hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <section aria-label="Filters" className="flex flex-col gap-2">
        <span className="text-label text-label-caps text-text-muted">
          Sampled from
        </span>
        <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:flex-wrap tablet:px-0">
          {GENRES.filter(([g]) => known(g)).map(([g, n]) => (
            <li key={g} className="shrink-0">
              <FilterChip
                selected={f.genre === g}
                onToggle={() =>
                  f.reset(() => f.setGenre(f.genre === g ? null : g))
                }
              >
                {`${g} · ${n}`}
              </FilterChip>
            </li>
          ))}
        </ul>
        <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:px-0">
          {DECADES.map((d) => (
            <li key={d} className="shrink-0">
              <FilterChip
                selected={f.decade === d}
                onToggle={() =>
                  f.reset(() => f.setDecade(f.decade === d ? null : d))
                }
              >
                {d}
              </FilterChip>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center gap-2">
        <span
          aria-live="polite"
          className="font-mono text-numeric tabular text-text-muted"
        >
          {f.view === "songs"
            ? `${shown} ${shown === 1 ? "song" : "songs"}`
            : `${shown} ${shown === 1 ? "record" : "records"}`}
        </span>
        {touched && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              f.reset(() => {
                f.setQ("");
                f.setGenre(null);
                f.setDecade(null);
              })
            }
          >
            Clear
          </Button>
        )}
      </div>

      {f.view === "songs" ? (
        <ul
          aria-label="Songs and what they sample"
          className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3"
        >
          {songs.slice(0, f.limit).map((s) => (
            <SongCard key={s.key} s={s} />
          ))}
        </ul>
      ) : (
        <ol aria-label="Most sampled records" className="flex flex-col gap-2">
          {records.slice(0, f.limit).map((o, i) => (
            <RecordRow key={o.key} o={o} n={i + 1} />
          ))}
        </ol>
      )}
      {shown > f.limit && (
        <Button
          variant="secondary"
          className="self-center"
          onClick={() => f.setLimit(f.limit + PAGE)}
        >
          {`Show ${Math.min(PAGE, shown - f.limit)} more of ${shown - f.limit}`}
        </Button>
      )}
      {shown === 0 && (
        <p className="text-body text-text-muted">
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

/** A link that leaves the demo (a search for the original, its article): opens in a new tab, styled as a small button. */
function ExtLink({
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

function UseBadge({ u }: { u: SampleUse }) {
  return (
    <span className="shrink-0 rounded-control border border-border-strong px-2 py-0.5 text-label text-label-caps text-text">
      {u.type === "sample" ? "Sample" : "Replayed"}
    </span>
  );
}

function SongCard({ s }: { s: SampleSong }) {
  const meta = [s.year ? String(s.year) : null, s.album]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="h-full">
      <UiLink
        href={sampleHref(s)}
        className="group flex h-full flex-col gap-4 rounded-panel border border-border bg-surface p-4 ui-hover:border-border-strong"
      >
        <span className="flex items-start gap-4">
          <Cover song={s.song} artist={s.artist} placeholder />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-title text-text group-hover:underline">
              {s.song}
            </span>
            <span className="truncate text-body-strong text-text">
              {s.artist}
            </span>
            <span className="truncate text-small text-text-muted">{meta}</span>
            {s.producers.length > 0 && (
              <span className="truncate text-small text-text-muted">{`prod. ${s.producers.join(", ")}`}</span>
            )}
          </span>
        </span>
        <ul className="flex flex-col gap-2 border-t border-border pt-3">
          {s.samples.slice(0, 3).map((u) => (
            <li
              key={`${u.title}|${u.artist}`}
              className="flex items-start gap-2"
            >
              <span
                aria-hidden="true"
                className="pt-0.5 text-small text-accent"
              >
                ↳
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-strong text-text">
                  {u.title}
                </span>
                <span className="truncate text-small text-text-muted">
                  {[u.artist, u.year, known(u.genre) ? u.genre : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <UseBadge u={u} />
            </li>
          ))}
          {s.samples.length > 3 && (
            <li className="text-small text-text-muted">{`and ${s.samples.length - 3} more`}</li>
          )}
        </ul>
      </UiLink>
    </li>
  );
}

function RecordRow({ o, n }: { o: Original; n: number }) {
  return (
    <li>
      <UiLink
        href={originalHref(o)}
        className="group flex items-center gap-4 rounded-panel border border-border bg-surface p-4 ui-hover:border-border-strong"
      >
        <span className="hidden w-8 shrink-0 font-mono text-numeric tabular text-text-muted tablet:block">
          {String(n).padStart(2, "0")}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-title text-text group-hover:underline">
            {o.title}
          </span>
          <span className="truncate text-small text-text-muted">
            {[o.artist, o.year, known(o.genre) ? o.genre : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="truncate text-small text-text-muted">{`In ${o.uses.map((x) => x.song.song).join(", ")}`}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-mono text-title tabular text-accent">
            {o.uses.length}
          </span>
          <span className="text-label text-label-caps text-text-muted">
            {o.uses.length === 1 ? "song" : "songs"}
          </span>
        </span>
      </UiLink>
    </li>
  );
}

function lead(artist: string): string {
  return (artist.split(/ feat\.? | ft\.? |,| & | and | x /i)[0] ?? artist)
    .trim()
    .toLowerCase();
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
        Search the Samples tab by song, artist or the record it samples.
      </EmptyState>
    </main>
  );
}

/** One song: the cover over a blurred copy, the facts, and every record it samples. */
export function SampleSongPage({ slug }: { slug: string }) {
  const s = sampleSongBySlug(slug);
  if (!s) return <Missing what="song" />;
  const cover = coverFor(s.song, s.artist);
  const preset = ALL_SONGS.find((x) => x.key === s.key);
  const chords = songChordItems().find(
    (m) =>
      m.song &&
      m.song.song.toLowerCase() === s.song.toLowerCase() &&
      lead(m.song.artist) === lead(s.artist),
  );
  const facts: [string, string][] = [
    ["Album", s.album ?? albumOf(s.song, s.artist) ?? "Not listed"],
    ["Year", s.year ? String(s.year) : "Not listed"],
    [
      "Produced by",
      s.producers.length ? s.producers.join(", ") : "Not credited",
    ],
  ];
  const more = SAMPLE_SONGS.filter(
    (x) => x !== s && x.album === s.album && x.artist === s.artist,
  );

  return (
    <main className="flex w-full flex-col">
      <header className="st-song-hero relative overflow-hidden border-b border-border">
        {cover && (
          <span
            aria-hidden="true"
            className="st-song-backdrop"
            style={tileStyle(cover.file)}
          />
        )}
        <div className="relative mx-auto flex w-full max-w-content flex-col gap-6 px-3 pt-6 pb-8 tablet:px-4 tablet:pt-8 desktop:px-6 desktop:pb-10">
          <UiLink
            href="/samples"
            className="self-start text-small text-text-muted ui-hover:text-text"
          >
            ← Samples
          </UiLink>
          <div className="flex flex-col gap-6 tablet:flex-row tablet:items-end tablet:gap-8">
            <span className="st-song-cover block w-48 shrink-0 tablet:w-56 desktop:w-64">
              <Cover song={s.song} artist={s.artist} size="fill" placeholder />
            </span>
            <div className="flex min-w-0 flex-col gap-3">
              <h1 className="st-hero-title st-song-title text-balance break-words text-text">
                {s.song}
              </h1>
              <p className="text-title text-text">{s.artist}</p>
              <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-label text-label-caps text-text-muted">
                      {k}
                    </dt>
                    <dd className="text-body-strong text-text">{v}</dd>
                  </div>
                ))}
              </dl>
              {(preset || chords) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {preset && (
                    <ButtonLink
                      href={songHref(preset.song, preset.artist)}
                      variant="primary"
                      size="sm"
                    >
                      The presets
                    </ButtonLink>
                  )}
                  {chords && (
                    <ButtonLink
                      href={chords.href}
                      variant="secondary"
                      size="sm"
                    >
                      Play the chords
                    </ButtonLink>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-3 py-8 tablet:px-4 desktop:px-6">
        <section aria-labelledby="samples" className="flex flex-col gap-3">
          <h2 id="samples" className="text-title text-text">
            {s.samples.length === 1
              ? "What it samples"
              : `What it samples · ${s.samples.length}`}
          </h2>
          <ol className="flex flex-col gap-3">
            {s.samples.map((u, i) => (
              <UseRow key={`${u.title}|${u.artist}`} u={u} n={i + 1} song={s} />
            ))}
          </ol>
        </section>

        {more.length > 0 && (
          <SongShelf title={`More samples on ${s.album}`} songs={more} />
        )}

        <section aria-label="Source" className="flex flex-col gap-1">
          <span className="text-label text-label-caps text-text-muted">
            Source
          </span>
          {s.sources.map((src) => (
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
      </div>
    </main>
  );
}

/** One sampled record on a song's page: what it is, a way to hear it, and the other songs that used it. */
function UseRow({ u, n, song }: { u: SampleUse; n: number; song: SampleSong }) {
  const o = originalOf(u);
  const others = o.uses.filter((x) => x.song !== song);
  return (
    <li className="flex flex-col rounded-panel border border-border bg-surface">
      <div className="flex items-start gap-4 p-4">
        <span className="hidden w-6 shrink-0 pt-1 font-mono text-numeric tabular text-text-muted tablet:block">
          {String(n).padStart(2, "0")}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <UseBadge u={u} />
            {known(u.genre) && (
              <span className="text-small text-text-muted">{u.genre}</span>
            )}
          </span>
          <UiLink
            href={originalHref(o)}
            className="st-hero-title text-title break-words text-accent ui-hover:underline"
          >
            {u.title}
          </UiLink>
          <span className="text-body-strong text-text">
            {[u.artist, u.year].filter(Boolean).join(" · ")}
          </span>
          <span className="flex flex-wrap gap-2 pt-2">
            <ExtLink href={listenHref(u.title, u.artist)} variant="secondary">
              Hear the original
            </ExtLink>
            {u.page && (
              <ExtLink href={u.page} variant="ghost">
                About the record
              </ExtLink>
            )}
          </span>
        </span>
      </div>
      {others.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <span className="text-label text-label-caps text-text-muted">{`Also sampled in ${others.length} ${others.length === 1 ? "song" : "songs"}`}</span>
          <ul className="flex flex-wrap gap-2">
            {others.map((x) => (
              <li key={x.song.key}>
                <UiLink
                  href={sampleHref(x.song)}
                  className="inline-flex items-center rounded-control border border-border px-2 py-1 text-small text-text ui-hover:border-border-strong"
                >
                  {`${x.song.song} · ${x.song.artist}`}
                </UiLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** One sampled record: what it is, and every song here that used it, oldest first. */
export function OriginalPage({ slug }: { slug: string }) {
  const o = originalBySlug(slug);
  if (!o) return <Missing what="record" />;
  const page = o.uses.find((x) => x.use.page)?.use.page;
  const facts: [string, string][] = [
    ["Artist", o.artist],
    ["Year", o.year ? String(o.year) : "Not listed"],
    ["Genre", known(o.genre) ? o.genre : "Not listed"],
  ];
  return (
    <main className="flex w-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-3 pt-6 pb-8 tablet:px-4 tablet:pt-8 desktop:px-6">
          <UiLink
            href="/samples"
            className="self-start text-small text-text-muted ui-hover:text-text"
          >
            ← Samples
          </UiLink>
          <span className="text-label text-label-caps text-text-muted">
            The original
          </span>
          <h1 className="st-hero-title st-song-title text-balance break-words text-text">
            {o.title}
          </h1>
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            {facts.map(([k, v]) => (
              <div key={k} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-label text-label-caps text-text-muted">
                  {k}
                </dt>
                <dd className="text-body-strong text-text">{v}</dd>
              </div>
            ))}
          </dl>
          <span className="flex flex-wrap gap-2">
            <ExtLink href={listenHref(o.title, o.artist)} variant="primary">
              Hear the original
            </ExtLink>
            {page && (
              <ExtLink href={page} variant="secondary">
                About the record
              </ExtLink>
            )}
          </span>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-3 py-8 tablet:px-4 desktop:px-6">
        <h2 className="text-title text-text">{`Sampled in ${o.uses.length} ${o.uses.length === 1 ? "song" : "songs"}`}</h2>
        <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
          {o.uses.map((x) => (
            <SongCard key={x.song.key} s={x.song} />
          ))}
        </ul>
      </div>
    </main>
  );
}

function SongShelf({ title, songs }: { title: string; songs: SampleSong[] }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-title text-text">{title}</h2>
        <span className="font-mono text-numeric tabular text-text-muted">
          {songs.length}
        </span>
      </div>
      <ul className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:px-0">
        {songs.slice(0, 12).map((x) => (
          <li key={x.key} className="w-36 shrink-0 tablet:w-40">
            <UiLink
              href={sampleHref(x)}
              className="group flex h-full flex-col gap-2 rounded-panel border border-border bg-surface p-2 ui-hover:border-border-strong"
            >
              <Cover song={x.song} artist={x.artist} size="fill" placeholder />
              <span className="flex min-w-0 flex-col px-1 pb-1">
                <span className="truncate text-small text-text group-hover:underline">
                  {x.song}
                </span>
                <span className="truncate text-small text-text-muted">
                  {x.samples[0]?.title}
                </span>
              </span>
            </UiLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
