import { ButtonLink, EmptyState, UiLink } from "@stash/ui";
import { songChordItems } from "../midi/catalog";
import { albumOf, Cover, coverFor } from "./cover";
import { CONFIDENCE, presetParts, type PresetEntry } from "./data";
import { ConfidenceKey, familyOf, Meter, partOf, TONE_TEXT } from "./page";
import {
  ALL_SONGS,
  madeBy,
  producersOf,
  songBySlug,
  songHref,
  type Song,
} from "./songs";

/**
 * One song's page: the cover big over a blurred copy of itself, the facts (album, producer, sound
 * count), every sound as one uniform row with its source behind a tap, and the ways out: the song's chords in the MIDI library, more songs by the same
 * producer, and more songs made on the same plugin.
 */


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

  const facts: [string, string][] = [
    ["Album", albumOf(s.song, s.artist) ?? "Not listed"],
    ["Produced by", who.length ? who.join(", ") : "Not credited"],
    ["Sounds", `${s.entries.length}`],
  ];

  return (
    <main className="flex w-full flex-col">
      <header className="st-song-hero relative overflow-hidden border-b border-border">
        {cover && <span aria-hidden="true" className="st-song-backdrop" style={{ backgroundImage: `url("${cover.file}")` }} />}
        <div className="relative mx-auto flex w-full max-w-content flex-col gap-6 px-3 pt-6 pb-8 tablet:px-4 tablet:pt-8 desktop:px-6 desktop:pb-10">
          <UiLink href="/presets" className="self-start text-small text-text-muted ui-hover:text-text">
            ← Presets
          </UiLink>
          <div className="flex flex-col gap-6 tablet:flex-row tablet:items-end tablet:gap-8">
            <span className="st-song-cover block w-48 shrink-0 tablet:w-56 desktop:w-64">
              <Cover song={s.song} artist={s.artist} size="fill" placeholder />
            </span>
            <div className="flex min-w-0 flex-col gap-3">
              <h1 className="st-hero-title st-song-title text-balance break-words text-text">{s.song}</h1>
              <p className="text-title text-text">{s.artist}</p>
              <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-label text-label-caps text-text-muted">{k}</dt>
                    <dd className="text-body-strong text-text">{v}</dd>
                  </div>
                ))}
              </dl>
              {chords && (
                <ButtonLink href={chords.href} variant="primary" size="sm" className="mt-2 self-start">
                  Play the chords
                </ButtonLink>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-3 py-8 tablet:px-4 desktop:px-6">
        <section aria-labelledby="sounds" className="flex flex-col gap-3">
          <h2 id="sounds" className="text-title text-text">The sounds</h2>
          <ol className="flex flex-col gap-3">
            {s.entries.map((e, i) => (
              <SoundRow key={`${e.plugin}-${e.preset}-${e.role}-${i}`} e={e} n={i + 1} />
            ))}
          </ol>
        </section>

        {who.slice(0, 2).map((p) => (
          <Shelf key={p} title={`More from ${p}`} songs={ALL_SONGS.filter((x) => x !== s && madeBy(x, p))} />
        ))}
        {plugins.slice(0, 1).map((f) => (
          <Shelf key={f} title={`More on ${f}`} songs={ALL_SONGS.filter((x) => x !== s && x.entries.some((e) => familyOf(e.plugin) === f))} />
        ))}

        <details className="st-details group rounded-panel border border-border bg-surface px-4 py-3">
          <summary className="flex cursor-pointer items-center text-small text-text-muted ui-hover:text-text">How sure is each source?</summary>
          <div className="pt-3">
            <ConfidenceKey />
          </div>
        </details>
      </div>
    </main>
  );
}

/** One sound: what part it plays, the plugin, the preset in big type, how sure, and the source behind a tap. */
function SoundRow({ e, n }: { e: PresetEntry; n: number }) {
  const { name, note } = presetParts(e.preset);
  const short = CONFIDENCE[e.confidence].label.split(" · ")[1] ?? CONFIDENCE[e.confidence].label;
  return (
    <li className="flex flex-col rounded-panel border border-border bg-surface">
      <div className="flex items-center gap-4 p-4">
        <span className="hidden w-6 shrink-0 font-mono text-numeric tabular text-text-muted tablet:block">{String(n).padStart(2, "0")}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-control border border-border-strong px-2 py-0.5 text-label text-label-caps text-text">{partOf(e.role)}</span>
            <span className="min-w-0 truncate text-small text-text-muted">{e.plugin}</span>
          </span>
          <span className="st-hero-title text-title break-words text-accent">{name}</span>
          {note && <span className="text-small text-text-muted">{note}</span>}
        </span>
        <span className="hidden shrink-0 items-center gap-2 tablet:flex" title={CONFIDENCE[e.confidence].blurb}>
          <Meter c={e.confidence} />
          <span className={`text-small ${TONE_TEXT[e.confidence]}`}>{short}</span>
        </span>
      </div>
      <details className="st-details border-t border-border px-4 py-2">
        <summary className="flex cursor-pointer items-center gap-2 text-small text-text-muted ui-hover:text-text">
          <span className="tablet:hidden">
            <Meter c={e.confidence} />
          </span>
          <span className={`tablet:hidden ${TONE_TEXT[e.confidence]}`}>{short}</span>
          <span className="tablet:hidden" aria-hidden="true">·</span>
          <span>{e.source.label ? "Source" : "Details"}</span>
        </summary>
        <div className="flex flex-col gap-2 pt-2 pb-2">
          {e.path && <span className="text-small text-text-muted">{`Find it in: ${e.path.split(/\s*›\s*|\s*>\s*/).join(" › ")}`}</span>}
          {e.quote && (
            <blockquote className="border-l-2 border-accent pl-3 text-body text-text">
              “{e.quote}”{e.quoteBy && <span className="text-text-muted"> — {e.quoteBy}</span>}
            </blockquote>
          )}
          {!e.source.label ? null : e.source.url ? (
            <a href={e.source.url} target="_blank" rel="noreferrer" className="self-start text-small break-words text-text-muted underline underline-offset-2 ui-hover:text-text">
              {e.source.label}
            </a>
          ) : (
            <span className="text-small break-words text-text-muted">{e.source.label}</span>
          )}
          <span className="text-small text-text-muted">{CONFIDENCE[e.confidence].blurb}</span>
        </div>
      </details>
    </li>
  );
}

/** A sideways row of other songs, best-sourced first. */
function Shelf({ title, songs }: { title: string; songs: Song[] }) {
  if (!songs.length) return null;
  const top = [...songs]
    .sort((a, b) => Number(!!coverFor(b.song, b.artist)) - Number(!!coverFor(a.song, a.artist)) || b.best - a.best || b.named - a.named)
    .slice(0, 12);
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-title text-text">{title}</h2>
        <span className="font-mono text-numeric tabular text-text-muted">
          {songs.length}
        </span>
      </div>
      <ul className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 tablet:mx-0 tablet:px-0">
        {top.map((x) => (
          <li key={x.key} className="w-36 shrink-0 tablet:w-40">
            <UiLink
              href={songHref(x.song, x.artist)}
              className="group flex h-full flex-col gap-2 rounded-panel border border-border bg-surface p-2 ui-hover:border-border-strong"
            >
              <Cover song={x.song} artist={x.artist} size="fill" placeholder />
              <span className="flex min-w-0 flex-col px-1 pb-1">
                <span className="truncate text-small text-text group-hover:underline">
                  {x.song}
                </span>
                <span className="truncate text-small text-text-muted">
                  {x.artist}
                </span>
              </span>
            </UiLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
