import { useEffect, type ReactNode } from "react";
import { Button, ButtonLink, Download, EmptyState, PlayButton, UiLink, useToast } from "@stash/ui";
import { CrateMenu } from "../explore";
import { Comments } from "../social";
import { hrefForProducer } from "../producers/data";
import { albumOf, Cover, coverFor, tileStyle } from "../presets/cover";
import { ConfidenceKey } from "../presets/page";
import { SoundRow } from "../presets/song-page";
import { ExtLink, Pair, Sources } from "../samples/page";
import { listenHref, listenLabel, sampleHref } from "../samples/data";
import { MidiList } from "../midi/pages";
import { progressionOf } from "../midi/songs";
import { preview, saveKit } from "../kits/pages";
import { labelOf, play, warmSounds, type Category, type KitSound } from "../kits/store";
import { kitFor, partsOf, songAllHref, type SongAll } from "./data";

/**
 * One song, everything for it on one page: the records it samples (and who sampled it), the presets
 * on it, its chords as MIDI, and a drum kit to start from. Each part plays where it sits, so nothing
 * here needs another tab. A jump row under the title goes straight to each part the song has.
 */

const PART_LABEL = { samples: "Samples", presets: "Presets", chords: "Chords", drums: "Drum kit" } as const;

export function SongPage({ song: s, back }: { song: SongAll | null; back?: { href: string; label: string } }) {
  if (!s) {
    return (
      <main className="mx-auto flex w-full max-w-content flex-col gap-5 px-3 py-8 tablet:px-4 desktop:px-6">
        <EmptyState
          title="That song isn't on Stash yet"
          action={
            <ButtonLink href="/search" variant="secondary">
              Search songs
            </ButtonLink>
          }
        >
          Search by song, artist or producer to find it.
        </EmptyState>
      </main>
    );
  }
  const cover = coverFor(s.song, s.artist);
  const parts = partsOf(s);
  const credits: ReactNode = s.producers.length
    ? s.producers.map((n, i) => {
        const href = hrefForProducer(n);
        return (
          <span key={n}>
            {i > 0 && ", "}
            {href ? (
              <UiLink href={href} className="ui-hover:underline">
                {n}
              </UiLink>
            ) : (
              n
            )}
          </span>
        );
      })
    : "Not credited";
  const facts: [string, ReactNode][] = [
    ["Album", s.album ?? albumOf(s.song, s.artist) ?? "Not listed"],
    ...(s.year ? ([["Year", String(s.year)]] as [string, ReactNode][]) : []),
    ["Produced by", credits],
  ];

  return (
    <main className="flex w-full flex-col">
      <header className="st-song-hero relative overflow-hidden border-b border-border">
        {cover && <span aria-hidden="true" className="st-song-backdrop" style={tileStyle(cover.file)} />}
        <div className="relative mx-auto flex w-full max-w-content flex-col gap-6 px-3 pt-6 pb-8 tablet:px-4 tablet:pt-8 desktop:px-6 desktop:pb-10">
          {back && (
            <UiLink href={back.href} className="self-start text-small text-text-muted ui-hover:text-text">
              {`← ${back.label}`}
            </UiLink>
          )}
          <div className="flex flex-col gap-6 tablet:flex-row tablet:items-end tablet:gap-8">
            <span className="st-song-cover block w-40 shrink-0 tablet:w-56 desktop:w-64">
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
              <div className="mt-2 flex flex-wrap gap-2">
                <ExtLink href={listenHref(s.song, s.artist, s.video)} variant="primary">
                  {listenLabel(s.video)}
                </ExtLink>
                <CrateMenu itemId={`song:${s.slug}`} title={`${s.song} · ${s.artist}`} kind="Song" href={songAllHref(s)} by={s.artist} size="sm" />
              </div>
            </div>
          </div>
          <nav aria-label="On this page" className="flex flex-wrap gap-2">
            {parts.map((p) => (
              <a
                key={p}
                href={`#${p}`}
                onClick={(e) => {
                  // The router owns the hash: scroll to the part without changing the address.
                  e.preventDefault();
                  document.getElementById(p)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-small text-text ui-hover:bg-raised pointer-coarse:h-10"
              >
                {PART_LABEL[p]}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-3 py-8 tablet:px-4 desktop:px-6">
        {parts.includes("samples") && <SamplesPart s={s} />}
        {s.preset && <PresetsPart s={s} />}
        {s.chords.length > 0 && <ChordsPart s={s} />}
        <DrumsPart s={s} />
        <Comments itemId={`song:${s.slug}`} title={`${s.song} by ${s.artist}`} />
        {s.sample && <Sources sources={s.sample.sources} />}
      </div>
    </main>
  );
}

function Part({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-title text-text">
          {title}
        </h2>
        {note && <p className="text-small text-text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function SamplesPart({ s }: { s: SongAll }) {
  return (
    <Part id="samples" title="Samples" note={s.sample ? "The records this song is built on. Play this song, then the original, and listen for what carried over." : undefined}>
      {s.sample && (
        <ol className="flex flex-col gap-4">
          {s.sample.samples.map((u) => (
            <Pair key={`${u.title}|${u.artist}`} u={u} song={s.sample!} />
          ))}
        </ol>
      )}
      {s.sampledIn.length > 0 && (
        <div className="flex flex-col gap-2 pt-2">
          <h3 className="text-body-strong text-text">Sampled in</h3>
          <ul className="flex flex-wrap gap-2">
            {s.sampledIn.slice(0, 24).map((x) => (
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
    </Part>
  );
}

function PresetsPart({ s }: { s: SongAll }) {
  const p = s.preset!;
  return (
    <Part id="presets" title="Presets" note="The synths and patches on the record, surest first. Each one says who named it.">
      <ol className="flex flex-col gap-3">
        {p.entries.map((e, i) => (
          <SoundRow key={`${e.plugin}-${e.preset}-${e.role}-${i}`} e={e} n={i + 1} song={p} />
        ))}
      </ol>
      <details className="st-details group rounded-panel border border-border bg-surface px-4 py-3">
        <summary className="flex cursor-pointer items-center text-small text-text-muted ui-hover:text-text">How sure is each source?</summary>
        <div className="pt-3">
          <ConfidenceKey />
        </div>
      </details>
    </Part>
  );
}

function ChordsPart({ s }: { s: SongAll }) {
  const first = s.chords[0]!.song!;
  const prog = progressionOf(first);
  return (
    <Part id="chords" title="Chords" note={`${first.key} · ${first.bpm} BPM${prog ? ` · ${prog.label}` : ""}. Play it here or drag the MIDI into your DAW.`}>
      <ul aria-label="The chords in order" className="flex flex-wrap gap-2">
        {first.chords.map(([c, beats], i) => (
          <li key={`${c}-${i}`} className="inline-flex items-baseline gap-1 rounded-control border border-border-strong bg-surface px-3 py-1">
            <span className="font-mono text-body-strong text-text">{c}</span>
            {beats !== 4 && <span className="font-mono text-small text-text-muted">{`${beats}b`}</span>}
          </li>
        ))}
      </ul>
      <MidiList label={`${s.song} chords`} items={s.chords} />
      <a href={first.chordSource.url} target="_blank" rel="noreferrer" className="self-start text-small break-words text-text-muted underline underline-offset-2 ui-hover:text-text">
        {first.chordSource.label}
      </a>
    </Part>
  );
}

const PADS: Category[] = ["kick", "808", "snare", "clap", "hat", "open hat"];

function DrumsPart({ s }: { s: SongAll }) {
  const pick = kitFor(s);
  const toast = useToast();
  useEffect(() => {
    if (pick) warmSounds(pick.kit.sounds);
  }, [pick?.kit.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pick) return null;
  const k = pick.kit;
  const pads = PADS.map((c) => k.sounds.find((x) => x.category === c)).filter((x): x is KitSound => !!x);
  return (
    <Part id="drums" title="Drum kit" note={pick.why}>
      <div className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <PlayButton title={`a groove on ${k.name}`} state="paused" onClick={() => preview(k)} />
          <span className="flex min-w-0 flex-1 flex-col">
            <UiLink href={`/kit/${k.id}`} className="truncate text-body-strong text-text ui-hover:underline">
              {k.name}
            </UiLink>
            <span className="truncate text-small text-text-muted">{k.genre}</span>
          </span>
          <Button size="sm" variant="secondary" icon={Download} aria-label={`Download ${k.name}`} onClick={() => void saveKit(k, toast)}>
            Download
          </Button>
        </div>
        <ul aria-label="Tap a sound" className="grid grid-cols-3 gap-2 tablet:grid-cols-6">
          {pads.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onPointerDown={(e) => e.button === 0 && void play(x)}
                onClick={(e) => e.detail === 0 && void play(x)}
                className="flex h-14 w-full flex-col items-center justify-center rounded-control border border-border-strong bg-raised px-2 text-small text-text ui-hover:border-accent active:bg-accent active:text-bg"
              >
                <span className="text-label text-label-caps">{labelOf(x.category)}</span>
                <span className="w-full truncate text-center text-small text-text-muted">{x.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <UiLink href={`/kit/${k.id}`} className="self-start text-small text-accent ui-hover:underline">
          {"Every sound in the kit →"}
        </UiLink>
      </div>
    </Part>
  );
}
