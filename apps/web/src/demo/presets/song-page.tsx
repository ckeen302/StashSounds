import { ButtonLink, EmptyState, UiLink } from "@stash/ui";
import { songChordItems } from "../midi/catalog";
import { Cover, coverFor } from "./cover";
import { CONFIDENCE, type Confidence } from "./data";
import { ConfidenceKey, familyOf, Meter, PatchStrip } from "./page";
import {
  ALL_SONGS,
  madeBy,
  producersOf,
  songBySlug,
  songHref,
  type Song,
} from "./songs";

/**
 * One song's page: the cover, every sound we know of on it as a synth display, where each claim
 * came from, and the ways out: the song's chords in the MIDI library, more songs by the same
 * producer, and more songs made on the same plugin.
 */

const BY_LEVEL: Confidence[] = ["community", "press", "engineer", "producer"];

function lead(artist: string): string {
  return (artist.split(/ feat\.? | ft\.? |,| & | x /i)[0] ?? artist)
    .trim()
    .toLowerCase();
}

export function PresetSongPage({ slug }: { slug: string }) {
  const s = songBySlug(slug);
  if (!s) {
    return (
      <main className="mx-auto flex w-full max-w-content flex-col gap-5 px-3 py-8 tablet:px-4 desktop:px-6">
        <EmptyState
          title="That song isn't in the presets yet"
          action={
            <ButtonLink href="/presets" variant="secondary">
              All presets
            </ButtonLink>
          }
        >
          Search the presets tab for it by song, artist or producer.
        </EmptyState>
      </main>
    );
  }
  const cover = coverFor(s.song, s.artist);
  const best = BY_LEVEL[s.best - 1] ?? "community";
  const chords = songChordItems().find(
    (m) =>
      m.song &&
      m.song.song.toLowerCase() === s.song.toLowerCase() &&
      lead(m.song.artist) === lead(s.artist),
  );
  const who = producersOf(s.producer);
  const plugins = [...new Set(s.entries.map((e) => familyOf(e.plugin)))].filter(
    (f) => f !== "Other",
  );

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-8 px-3 py-8 tablet:px-4 desktop:px-6">
      <UiLink
        href="/presets"
        className="self-start text-small text-text-muted ui-hover:text-text"
      >
        ← All presets
      </UiLink>

      <header className="flex flex-col gap-5 tablet:flex-row tablet:items-end">
        <Cover song={s.song} artist={s.artist} size="lg" />
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-label text-label-caps text-text-muted">
            The presets behind
          </span>
          <h1 className="text-display text-balance break-words">{s.song}</h1>
          <p className="text-body text-text">
            {s.artist}
            {cover && (
              <span className="text-text-muted">{` · ${cover.album}`}</span>
            )}
          </p>
          {who.length > 0 && (
            <p className="text-small text-text-muted">{`Produced by ${who.join(", ")}`}</p>
          )}
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
            <div className="flex items-baseline gap-2">
              <dd className="font-mono text-title tabular text-accent">
                {s.entries.length}
              </dd>
              <dt className="text-small text-text-muted">
                {s.entries.length === 1 ? "sound" : "sounds"}
              </dt>
            </div>
            <div className="flex items-baseline gap-2">
              <dd className="font-mono text-title tabular text-accent">
                {s.named}
              </dd>
              <dt className="text-small text-text-muted">
                {s.named === 1 ? "exact preset" : "exact presets"}
              </dt>
            </div>
            <div className="flex items-center gap-2">
              <Meter c={best} />
              <dt className="text-small text-text-muted">{`Best source: ${CONFIDENCE[best].label.toLowerCase()}`}</dt>
            </div>
          </dl>
          {chords && (
            <div className="flex flex-wrap gap-2 pt-2">
              {
                <ButtonLink href={chords.href} variant="primary" size="sm">
                  Play the chords
                </ButtonLink>
              }
            </div>
          )}
        </div>
      </header>

      <section aria-label="Sounds on this song" className="flex flex-col gap-3">
        <h2 className="text-title">Sounds on the record</h2>
        <ul className="grid grid-cols-1 items-start gap-x-6 gap-y-6 rounded-panel border border-border bg-surface p-4 desktop:grid-cols-2">
          {s.entries.map((e, i) => (
            <PatchStrip key={`${e.plugin}-${e.preset}-${e.role}-${i}`} e={e} />
          ))}
        </ul>
      </section>

      {who.slice(0, 2).map((p) => (
        <Shelf
          key={p}
          title={`More from ${p}`}
          songs={ALL_SONGS.filter((x) => x !== s && madeBy(x, p))}
        />
      ))}
      {plugins.slice(0, 2).map((f) => (
        <Shelf
          key={f}
          title={`More made on ${f}`}
          songs={ALL_SONGS.filter(
            (x) => x !== s && x.entries.some((e) => familyOf(e.plugin) === f),
          )}
        />
      ))}

      <ConfidenceKey />
    </main>
  );
}

/** A sideways row of other songs, best-sourced first. */
function Shelf({ title, songs }: { title: string; songs: Song[] }) {
  if (!songs.length) return null;
  const top = [...songs]
    .sort((a, b) => b.best - a.best || b.named - a.named)
    .slice(0, 12);
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-body-strong">{title}</h2>
        <span className="font-mono text-numeric tabular text-text-muted">
          {songs.length}
        </span>
      </div>
      <ul className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:px-0">
        {top.map((x) => (
          <li key={x.key} className="w-36 shrink-0">
            <UiLink
              href={songHref(x.song, x.artist)}
              className="group flex flex-col gap-2"
            >
              <Cover song={x.song} artist={x.artist} size="fill" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-small text-text group-hover:underline">
                  {x.song}
                </span>
                <span className="truncate text-small text-text-muted">
                  {x.artist}
                </span>
                <span className="flex items-center gap-2 pt-1">
                  <Meter c={BY_LEVEL[x.best - 1] ?? "community"} />
                  <span className="font-mono text-numeric tabular text-text-muted">{`${x.entries.length} ${x.entries.length === 1 ? "sound" : "sounds"}`}</span>
                </span>
              </span>
            </UiLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
