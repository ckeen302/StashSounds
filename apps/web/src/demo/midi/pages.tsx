import { getEngine } from "@stash/audio";
import { LICENSES, midiKindSchema, soundIdSchema, type MidiKind, type SoundId } from "@stash/contracts";
import { formatKey } from "@stash/contracts/format";
import {
  Button,
  ButtonLink,
  Download,
  EmptyState,
  FilterChip,
  Heart,
  IconButton,
  LicenseBadge,
  PlayButton,
  Stat,
  TagChip,
  TextInput,
  Trash,
  Transport,
  TypeChip,
  Upload,
  UploaderCard,
  transposedKey,
  useToast,
  UiLink,
  type PlayState,
} from "@stash/ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CrateMenu } from "../explore";
import { navigate } from "../router";
import { has, set } from "../store";
import { midiItem, midiItems, midiVersion, postUpload, removeUpload, slugify, subscribeMidi, type MidiItem } from "./catalog";
import { MidiError, parseMidi, SOUND_FOR, type MidiAnalysis } from "./parse";
import { DRUM_PART_LABEL, guessDrumPart, setDrumPart, type DrumPart } from "./drum-parts";
import { PianoRoll } from "./piano-roll";
import { saveFiles } from "../save";
import { writeMidi } from "./write";
import { classicLabel, type Classic } from "./classics";
import { progressionOf } from "./songs";
import { Comments } from "../social";
import { midiPlayer, TIMBRES, type MidiPlayerState, type Timbre } from "./synth";

const player = midiPlayer();
// One thing plays at a time: a MIDI item pauses the loop engine, and a loop pauses the MIDI.
player.onStart = () => {
  const engine = getEngine();
  const s = engine.getState().status;
  if (s === "playing" || s === "loading") engine.pause();
};
getEngine().subscribe((s) => {
  if (s.status === "playing" || s.status === "loading") player.pause();
});

export function useMidiPlayer(): MidiPlayerState {
  return useSyncExternalStore(player.subscribe, player.getState, player.getState);
}

export function useMidiItems(): MidiItem[] {
  const v = useSyncExternalStore(subscribeMidi, midiVersion, midiVersion);
  return useMemo(() => midiItems(), [v]); // eslint-disable-line react-hooks/exhaustive-deps
}

const KIND_LABEL: Record<MidiKind, string> = { chords: "Chords", melody: "Melody", drums: "Drums", bass: "Bass" };
const SOUND_LABEL: Record<Timbre, string> = {
  keys: "Electric piano",
  piano: "Piano",
  guitar: "Guitar",
  acoustic: "Acoustic guitar",
  organ: "Organ",
  synth: "Synth",
  pad: "Pad",
  strings: "Strings",
  choir: "Choir",
  flute: "Flute",
  pluck: "Pluck",
  bass: "Bass",
  "808": "808",
  bell: "Bell",
  drums: "Drums",
};
const POSTED_SOUNDS = soundIdSchema.options.filter((o) => o !== "drums");

/** Saves the item as a .mid named "<title> <key> <bpm>bpm.mid". */
export async function saveMidi(item: MidiItem, toast: ReturnType<typeof useToast>) {
  const name = `${item.title}${item.key ? ` ${formatKey(item.key)}` : ""} ${Math.round(item.notes.bpm)}bpm.mid`;
  const out = await saveFiles(item.title, [{ name, data: new Blob([writeMidi(item.notes, item.title)]) }]).catch(() => "failed" as const);
  if (out === "saved") {
    set("downloads", item.id, true);
    toast({ tone: "success", title: "Saved the MIDI file", description: "Drop it on any instrument in your DAW." });
  } else if (out === "failed") toast({ tone: "error", title: "The MIDI file did not save", description: "Try again in a moment." });
}

function playStateOf(s: MidiPlayerState, id: string): PlayState {
  return s.currentId === id && s.status === "playing" ? "playing" : "paused";
}

function rollLabel(m: Pick<MidiItem, "kind" | "key" | "notes">): string {
  return [`Piano roll: ${KIND_LABEL[m.kind]}`, `${m.notes.bars} bars`, `${m.notes.notes.length} notes`, `${Math.round(m.notes.bpm)} BPM`, m.key ? formatKey(m.key) : ""]
    .filter(Boolean)
    .join(", ");
}

/** MIDI as result rows: play pad, a strip of the roll with its playhead, title, kind, key, BPM, bars. */
export function MidiList({ label, items }: { label: string; items: MidiItem[] }) {
  const s = useMidiPlayer();
  const toast = useToast();
  const cell = "font-mono text-numeric tabular text-text";
  return (
    <div className="overflow-hidden rounded-panel border border-border bg-surface">
      <div aria-hidden="true" className="flex h-8 items-center gap-3 border-b border-border px-3">
        <span className="w-10 shrink-0" />
        <span className="hidden w-50 shrink-0 text-label text-label-caps text-text-muted tablet:block">Notes</span>
        <span className="min-w-24 flex-1 text-label text-label-caps text-text-muted">Title</span>
        <span className="hidden w-20 shrink-0 text-label text-label-caps text-text-muted tablet:block">Kind</span>
        <span className="hidden w-14 shrink-0 text-label text-label-caps text-text-muted tablet:block">Key</span>
        <span className="w-14 shrink-0 text-right text-label text-label-caps text-text-muted">BPM</span>
        <span className="hidden w-14 shrink-0 text-right text-label text-label-caps text-text-muted desktop:block">Bars</span>
        <span className="w-10 shrink-0" />
      </div>
      <ul aria-label={label}>
        {items.map((m) => {
          const playing = s.currentId === m.id && s.status === "playing";
          const current = s.currentId === m.id;
          return (
            <li key={m.id} data-playing={playing || undefined} className={`flex h-16 items-center gap-3 border-b border-border px-3 last:border-b-0 tablet:h-14 ${playing ? "bg-raised" : "bg-surface ui-hover:bg-raised"}`}>
              <div className="w-10 shrink-0">
                <PlayButton title={m.title} state={playStateOf(s, m.id)} onClick={() => player.toggle(m.id, m.notes, m.sound)} />
              </div>
              <div className="hidden w-50 shrink-0 tablet:block">
                <PianoRoll variant="mini" notes={m.notes} label={rollLabel(m)} getBeat={current ? player.getBeat : undefined} playing={playing} transpose={current ? s.transpose : 0} />
              </div>
              <div className="flex min-w-24 flex-1 flex-col">
                <UiLink href={m.href} className="-my-3 truncate rounded-control py-3 text-body-strong text-text ui-hover:underline">
                  {m.title}
                </UiLink>
                <span className="truncate text-small text-text-muted">@{m.owner.handle}{m.mine ? " · posted from this browser" : ""}</span>
              </div>
              <div className="hidden w-20 shrink-0 text-small text-text tablet:block">{m.part ? DRUM_PART_LABEL[m.part] : KIND_LABEL[m.kind]}</div>
              <div className={`hidden w-14 shrink-0 tablet:block ${cell}`}>{m.key ? formatKey(m.key) : "—"}</div>
              <div className={`w-14 shrink-0 text-right ${cell}`}>{Math.round(m.notes.bpm)}</div>
              <div className={`hidden w-14 shrink-0 text-right desktop:block ${cell}`}>{m.notes.bars}</div>
              <div className="w-10 shrink-0">
                <IconButton icon={Download} label={`Download ${m.title} as MIDI`} onClick={() => void saveMidi(m, toast)} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SoundPicker<T extends Timbre>({ value, onChange, drums, options }: { value: Timbre; onChange: (s: T) => void; drums: boolean; options: readonly T[] }) {
  const shown = drums ? options.filter((o) => o === "drums") : options.filter((o) => o !== "drums");
  return (
    <div role="group" aria-label="Sound" className="flex flex-wrap gap-2">
      {shown.map((o) => (
        <FilterChip key={o} selected={value === o} onToggle={() => onChange(o)}>
          {SOUND_LABEL[o]}
        </FilterChip>
      ))}
    </div>
  );
}

/** A classic progression: its numerals over the chords in the example key, the source, and songs on it. */
function ClassicChart({ c, items }: { c: Classic; items: MidiItem[] }) {
  const label = classicLabel(c);
  const onIt = label ? items.filter((m) => m.song && progressionOf(m.song)?.label === label) : [];
  return (
    <section aria-labelledby="classic-title" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="classic-title" className="text-label text-label-caps text-text-muted">
          The progression
        </h2>
        <span className="font-mono text-numeric tabular text-text-muted">{`Written in ${c.key}`}</span>
      </div>
      <ol aria-label="Chords" className="flex flex-wrap gap-2">
        {c.chords.map(([ch, beats], i) => (
          <li key={i} className="st-box flex flex-col rounded-control border border-border-strong bg-raised px-3 py-2">
            <span className="font-mono text-body-strong text-accent">{c.numerals[i]}</span>
            <span className="font-mono text-small text-text">{ch}</span>
            <span className="text-small text-text-muted">{beats === 4 ? "1 bar" : beats % 4 === 0 ? `${beats / 4} bars` : `${beats} beats`}</span>
          </li>
        ))}
      </ol>
      <blockquote className="border-l-2 border-border-strong pl-3 text-small text-text">
        “{c.quote}”{" "}
        <a href={c.source.url} target="_blank" rel="noreferrer" className="text-text-muted underline underline-offset-2">
          {c.source.label}
        </a>
      </blockquote>
      {c.examples.length > 0 && (
        <p className="text-small text-text-muted">
          <span className="text-text">Heard in: </span>
          {c.examples.map((e) => (e.artist ? `${e.song} (${e.artist})` : e.song)).join(", ")}
        </p>
      )}
      {onIt.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-label text-label-caps text-text-muted">Songs in the library on it</span>
          <ul className="flex flex-wrap gap-2">
            {onIt.slice(0, 12).map((m) => (
              <li key={m.id}>
                <UiLink href={m.href} className="text-small text-text underline underline-offset-2">
                  {`${m.song!.song} · ${m.song!.artist}`}
                </UiLink>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-small text-text-muted">Chord lengths are ours; the source gives the chords, not the timing. Shift the key above to put it in your track&apos;s key.</p>
    </section>
  );
}

/** A song's progression as written in the source: chord, beats, then where it came from. */
const RHYTHM_NAME: Record<NonNullable<MidiItem["pack"]>["rhythm"], string> = {
  held: "Held chords",
  roll: "Rolled chords",
  push: "Pushed an eighth early",
  stabs: "Syncopated stabs",
  pulse: "Eighth-note pulse",
  arp: "Arpeggiated",
  bounce: "Bounce",
};

/** A chord pack's progression: the chords as written, the pack it is in, and how it is played. */
function PackChart({ item }: { item: MidiItem }) {
  const p = item.pack!;
  return (
    <section aria-labelledby="pack-title" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pack-title" className="text-label text-label-caps text-text-muted">
          {`Chords · ${p.name}`}
        </h2>
        <span className="font-mono text-numeric tabular text-text-muted">{[item.key ? formatKey(item.key) : "", `${Math.round(item.notes.bpm)} BPM`, RHYTHM_NAME[p.rhythm]].filter(Boolean).join(" · ")}</span>
      </div>
      <ol aria-label="Chords" className="flex flex-wrap gap-2">
        {p.chords.map(([c, beats], i) => (
          <li key={i} className="st-box flex flex-col rounded-control border border-border-strong bg-raised px-3 py-2">
            <span className="font-mono text-body-strong text-text">{c}</span>
            <span className="text-small text-text-muted">{beats === 4 ? "1 bar" : beats % 4 === 0 ? `${beats / 4} bars` : `${beats} beats`}</span>
          </li>
        ))}
      </ol>
      {p.description && <p className="text-small text-text-muted">{p.description} Written for Stash; free to use in your beats.</p>}
    </section>
  );
}

function ChordChart({ song }: { song: NonNullable<MidiItem["song"]> }) {
  return (
    <section aria-labelledby="chart-title" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="chart-title" className="text-label text-label-caps text-text-muted">
          Chord chart{song.section ? ` · ${song.section}` : ""}
        </h2>
        <span className="font-mono text-numeric tabular text-text-muted">{`${song.key} · ${song.bpm} BPM`}</span>
      </div>
      <ol aria-label="Chords" className="flex flex-wrap gap-2">
        {song.chords.map(([c, beats], i) => (
          <li key={i} className="st-box flex flex-col rounded-control border border-border-strong bg-raised px-3 py-2">
            <span className="font-mono text-body-strong text-text">{c}</span>
            <span className="text-small text-text-muted">{beats === 4 ? "1 bar" : beats % 4 === 0 ? `${beats / 4} bars` : `${beats} beats`}</span>
          </li>
        ))}
      </ol>
      <ul className="flex flex-col gap-1 text-small text-text-muted">
        <li className="text-text">
          {song.rhythm === "verified"
            ? "Rhythm: each chord's length is from the song's chart."
            : "Rhythm not verified: the source gives the chords but not how long each lasts, so each plays for one bar. The chords are right; the timing may not match the record."}
        </li>
        <li>
          {song.instrument ? (
            <>
              {`On the record: ${song.instrument.name}. `}
              <a href={song.instrument.source.url} target="_blank" rel="noreferrer" className="text-text underline underline-offset-2">
                {song.instrument.source.label}
              </a>
            </>
          ) : (
            "The instrument on the record isn't sourced yet. Switch the sound above to try another."
          )}
        </li>
        <li>
          Chords:{" "}
          <a href={song.chordSource.url} target="_blank" rel="noreferrer" className="text-text underline underline-offset-2">
            {song.chordSource.label}
          </a>
        </li>
        {song.keyBpmSource && (
          <li>
            Key and tempo:{" "}
            <a href={song.keyBpmSource.url} target="_blank" rel="noreferrer" className="text-text underline underline-offset-2">
              {song.keyBpmSource.label}
            </a>
          </li>
        )}
        {song.notes && <li>{song.notes}</li>}
      </ul>
    </section>
  );
}

/** The MIDI item page: the roll as the hero, the transport and a sound picker under it. */
export function MidiPage({ publicId }: { publicId: string }) {
  const items = useMidiItems();
  const item = items.find((m) => m.publicId === publicId) ?? null;
  const s = useMidiPlayer();
  const toast = useToast();
  const [likeTick, setLikeTick] = useState(0);

  useEffect(() => {
    if (item) player.load(item.id, item.notes, item.sound);
  }, [item]);

  // Space plays and pauses; [ ] shift the key; - = nudge the tempo.
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const st = player.getState();
      if (e.key === " ") {
        e.preventDefault();
        player.toggle(item.id, item.notes, st.sound);
      } else if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        player.setTranspose(Math.max(-12, Math.min(12, st.transpose + (e.key === "]" ? 1 : -1))));
      } else if (e.key === "-" || e.key === "=") {
        e.preventDefault();
        const bpm = Math.round(item.notes.bpm * st.tempoRatio) + (e.key === "=" ? 1 : -1);
        player.setTempoRatio(Math.max(0.5, Math.min(2, bpm / item.notes.bpm)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item]);

  useEffect(() => () => player.pause(), []);

  if (!item) {
    return (
      <main className="mx-auto flex max-w-content flex-col gap-8 px-3 py-8 tablet:px-4 desktop:px-6">
        <EmptyState icon={Upload} title="That MIDI isn't here" action={<ButtonLink href="/" variant="secondary">Back to the sounds</ButtonLink>}>
          It may have been posted from another browser. Posts in the demo stay on the device that made them.
        </EmptyState>
      </main>
    );
  }

  const current = s.currentId === item.id;
  const playing = current && s.status === "playing";
  const liked = has("likes", item.id);
  void likeTick;
  const following = has("follows", item.owner.id);
  const liveBpm = Math.round(item.notes.bpm * (current ? s.tempoRatio : 1));
  const liveKey = transposedKey(item.key, current && !item.notes.drums ? s.transpose : 0);
  const bpb = (item.notes.timeSignature[0] * 4) / item.notes.timeSignature[1];
  const others = items.filter((m) => m.id !== item.id);
  const sameArtist = item.song ? others.filter((m) => m.song?.artist === item.song!.artist) : item.pack ? others.filter((m) => m.pack?.name === item.pack!.name) : [];
  const more = sameArtist.length > 0 ? sameArtist : others.filter((m) => m.owner.id === item.owner.id);

  return (
    <main aria-labelledby="item-title" className="@container mx-auto flex w-full max-w-content flex-col gap-8 px-3 pt-6 pb-8 tablet:px-4 desktop:px-6 desktop:pt-8">
      <div className="grid grid-cols-1 gap-6 cq-xl:grid-cols-3 cq-xl:gap-8">
        <div className="flex min-w-0 flex-col gap-6 cq-xl:col-span-2">
          <header className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-3">
              <TypeChip type="midi" />
              <span className="text-small text-text-muted">{item.part ? DRUM_PART_LABEL[item.part] : KIND_LABEL[item.kind]} · {item.mine ? "Posted from this browser" : `Published ${new Date(item.publishedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}`}</span>
            </div>
            <h1 id="item-title" className="text-display break-words text-text">
              {item.title}
            </h1>
            {item.song ? (
              <p className="text-small text-text-muted">
                From <span className="text-text">{item.song.song}</span> by <span className="text-text">{item.song.artist}</span>
                {item.song.producer ? ` · prod. ${item.song.producer}` : ""}
              </p>
            ) : (
              <p className="text-small text-text-muted">
                by <span className="text-text">{item.owner.displayName}</span> <span>@{item.owner.handle}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={Download} onClick={() => void saveMidi(item, toast)}>
                Download .mid
              </Button>
            </div>
          </header>

          <section aria-label="MIDI player" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              <PlayButton size="hero" title={item.title} state={playStateOf(s, item.id)} onClick={() => player.toggle(item.id, item.notes, current ? s.sound : item.sound)} />
              <span className="flex flex-col">
                <span data-hero-facts className="font-mono text-numeric tabular text-text">
                  {[`${liveBpm} BPM`, liveKey].filter(Boolean).join(" · ")}
                </span>
                <span className="font-mono text-numeric tabular text-text-muted">
                  {item.notes.bars} bars · {item.notes.notes.length} notes · {SOUND_LABEL[current ? s.sound : item.sound]}
                </span>
              </span>
            </div>
            <PianoRoll
              notes={item.notes}
              getBeat={current ? player.getBeat : undefined}
              playing={playing}
              transpose={current ? s.transpose : 0}
              label={rollLabel(item)}
              onSeek={(b) => {
                if (!current) player.load(item.id, item.notes, item.sound);
                player.seek(b);
                if (!playing) void player.play();
              }}
              onAudition={(p) => {
                if (!current) player.load(item.id, item.notes, item.sound);
                player.audition(p);
              }}
            />
            <p className="text-small text-text-muted">Click the roll to jump there, or a key on the left to hear one note.</p>
          </section>

          <Transport
            title={item.title}
            hints
            tempo={{ bpm: liveBpm, baseBpm: item.notes.bpm, onChange: (bpm) => player.setTempoRatio(bpm / item.notes.bpm) }}
            keyShift={item.notes.drums ? undefined : { semitones: current ? s.transpose : 0, baseKey: item.key, onChange: (n) => player.setTranspose(n) }}
            loop={{ on: s.loop, onChange: (on) => player.setLoop(on) }}
            volume={{ value: s.volume, muted: s.volume === 0, onChange: (v) => player.setVolume(v), onMuteChange: (m) => player.setVolume(m ? 0 : 0.8) }}
          />

          <section aria-labelledby="sound-title" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
            <h2 id="sound-title" className="text-label text-label-caps text-text-muted">
              Play it on
            </h2>
            <SoundPicker value={current ? s.sound : item.sound} drums={item.notes.drums} options={item.notes.drums ? (["drums"] as Timbre[]) : TIMBRES} onChange={(o) => {
              if (!current) player.load(item.id, item.notes, item.sound);
              player.setSound(o);
            }} />
            <p className="text-small text-text-muted">The download is the MIDI file itself, so it plays on whatever instrument you load in your DAW.</p>
          </section>

          {item.song && <ChordChart song={item.song} />}
          {item.pack && <PackChart item={item} />}
          {item.classic && <ClassicChart c={item.classic} items={items} />}
          <Comments itemId={item.id} title={item.title} />

          <section aria-label="About" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
            <p className="max-w-160 text-body text-text">{item.description}</p>
            {item.tags.length > 0 && (
              <ul aria-label="Tags" className="flex flex-wrap gap-2">
                {item.tags.map((t) => (
                  <li key={t}>
                    <TagChip>{t}</TagChip>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside aria-label="Uploader and license" className="grid min-w-0 grid-cols-1 content-start gap-4 cq-md:grid-cols-2 cq-xl:grid-cols-1">
          <UploaderCard
            variant="full"
            owner={{ handle: item.owner.handle, displayName: item.owner.displayName, avatarUrl: null }}
            href={`/u/${item.owner.handle}`}
            own={item.mine}
            following={following}
            onFollowChange={(f) => {
              set("follows", item.owner.id, f);
              setLikeTick((n) => n + 1);
            }}
            followersCount={item.owner.followers + (following ? 1 : 0)}
          />
          <section aria-labelledby="license-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="license-title" className="text-label text-label-caps text-text-muted">
                License
              </h2>
              {!item.song && <LicenseBadge kind={item.license} summaryTooltip={false} />}
            </div>
            <p className="text-small text-text">
              {item.song
                ? `A chord chart of a published song, for learning and reference. The song belongs to its writers: chords alone are common ground, but don't pass off the song itself as yours.`
                : LICENSES[item.license].summary}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={Download}
                className="flex-1"
                onClick={() => void saveMidi(item, toast)}
              >
                Download .mid
              </Button>
              <Button
                variant="secondary"
                icon={Heart}
                aria-pressed={liked}
                className="aria-pressed:*:fill-current"
                onClick={() => {
                  set("likes", item.id, !liked);
                  setLikeTick((n) => n + 1);
                }}
              >
                {liked ? "Liked" : "Like"}
              </Button>
              <CrateMenu itemId={item.id} title={item.title} />
            </div>
            {item.mine && (
              <Button
                variant="danger"
                icon={Trash}
                onClick={() => {
                  player.pause();
                  removeUpload(item.publicId);
                  navigate("/");
                  toast({ tone: "success", title: "Removed", description: `${item.title} is gone from this browser.` });
                }}
              >
                Remove this post
              </Button>
            )}
          </section>
          <section aria-label="Details" className="grid grid-cols-3 gap-4 rounded-panel border border-border bg-surface p-4 cq-md:col-span-2 cq-md:grid-cols-6 cq-xl:col-span-1 cq-xl:grid-cols-3">
            <Stat label="BPM" value={Math.round(item.notes.bpm)} />
            <Stat label="Key" value={item.key ? formatKey(item.key) : "—"} />
            <Stat label="Bars" value={item.notes.bars} />
            <Stat label="Notes" value={item.notes.notes.length} />
            <Stat label="Likes" value={item.likes + (liked ? 1 : 0)} />
            <Stat label="Time" value={`${item.notes.timeSignature[0]}/${item.notes.timeSignature[1]}`} />
            <Stat label="Range" value={item.notes.drums ? "Drums" : `${noteName(item.notes.pitchMin)}–${noteName(item.notes.pitchMax)}`} className="col-span-3 cq-md:col-span-2 cq-xl:col-span-3" />
          </section>
        </aside>
      </div>

      {(more.length > 0 ? more : others).length > 0 && (
        <section aria-labelledby="more-title" className="flex flex-col gap-3">
          <h2 id="more-title" className="text-title text-text">
            {more.length > 0 ? (sameArtist.length > 0 ? (item.song ? `More ${item.song.artist} chords` : `More from ${item.pack!.name}`) : `More MIDI from ${item.owner.displayName}`) : "More MIDI"}
          </h2>
          <MidiList label="More MIDI" items={(more.length > 0 ? more : others).slice(0, 4)} />
        </section>
      )}
      <span className="sr-only">{bpb} beats a bar</span>
    </main>
  );
}

function noteName(p: number): string {
  return `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][p % 12]}${Math.floor(p / 12) - 1}`;
}

// ---------------------------------------------------------------------------------------------
// Upload

const SAMPLES = [
  { file: "sad_piano_chords_72bpm_C#m.mid", label: "Sad piano chords" },
  { file: "bell_melody_150_F#m.mid", label: "Bell melody" },
  { file: "808_bassline_140_Am.mid", label: "808 bassline" },
  { file: "drill_drums_142.mid", label: "Drill drums" },
  { file: "not_midi.mid", label: "A broken file" },
];

type Draft = { analysis: MidiAnalysis; fileName: string; title: string; kind: MidiKind; sound: SoundId; bpm: string; tags: string; part?: DrumPart };

/** The demo's upload: pick or drop a .mid, check what was read from it, hear it, post it. */
export function UploadPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const s = useMidiPlayer();
  const toast = useToast();
  const previewId = `upload-preview-${draft?.kind ?? ""}-${draft?.part ?? ""}-${draft?.bpm ?? ""}`;

  useEffect(() => () => player.pause(), []);

  const read = (bytes: Uint8Array, fileName: string) => {
    player.pause();
    setError(null);
    if (!/\.midi?$/i.test(fileName)) {
      setDraft(null);
      setError("Pick a .mid or .midi file. Audio goes in as a loop or one-shot, which the demo does not take.");
      return;
    }
    try {
      const analysis = parseMidi(bytes, fileName);
      const base = fileName.replace(/\.midi?$/i, "");
      // The words of the file name, without the tempo and key it carries (those are read already).
      const title = base
        .split(/[\s_-]+/)
        .filter((t) => !/^\d{2,3}\s*bpm$/i.test(t) && !(/^\d{2,3}$/.test(t) && +t >= 60 && +t <= 200) && !/^[a-g][#b]?(m|min|maj|minor|major)?$/i.test(t))
        .join(" ")
        .trim();
      setDraft({
        analysis,
        fileName,
        title: title.charAt(0).toUpperCase() + title.slice(1) || "Untitled MIDI",
        kind: analysis.kind,
        sound: analysis.sound,
        bpm: String(Math.round(analysis.notes.bpm)),
        tags: analysis.part && analysis.part !== "kit" ? DRUM_PART_LABEL[analysis.part].toLowerCase() : analysis.kind,
        part: analysis.part,
      });
    } catch (e) {
      setDraft(null);
      setError(e instanceof MidiError ? e.message : "That file could not be read as MIDI.");
    }
  };

  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      read(new Uint8Array(await f.arrayBuffer()), f.name);
    } finally {
      setBusy(false);
    }
  };

  const fromSample = async (name: string) => {
    setBusy(true);
    try {
      const r = await fetch(new URL("demo/midi/samples.json", document.baseURI));
      if (!r.ok) throw new Error(String(r.status));
      const b64 = ((await r.json()) as Record<string, string>)[name];
      if (!b64) throw new Error("missing sample");
      read(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), name);
    } catch {
      setError("The sample file did not load. Try picking a file of your own.");
    } finally {
      setBusy(false);
    }
  };

  const bpmNum = draft ? Number(draft.bpm) : 0;
  const bpmOk = draft ? Number.isFinite(bpmNum) && bpmNum >= 40 && bpmNum <= 300 : false;
  const notes = useMemo(
    () => (draft ? { ...draft.analysis.notes, bpm: bpmOk ? bpmNum : draft.analysis.notes.bpm, drums: draft.kind === "drums" } : null),
    [draft, bpmOk, bpmNum],
  );
  if (notes && draft?.kind === "drums") setDrumPart(notes, draft.part ?? "kit");
  const titleOk = !!draft && draft.title.trim().length > 0 && draft.title.trim().length <= 80;
  const previewing = s.currentId === previewId;

  const Wrap = embedded ? "div" : "main";
  return (
    <Wrap className={embedded ? "flex w-full flex-col gap-6" : "mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6"}>
      <header className={embedded ? "sr-only" : "flex flex-col gap-1"}>
        <h1 className="text-title">Post a MIDI file</h1>
      </header>

      <section
        aria-label="Pick a MIDI file"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void fromFile(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center gap-4 rounded-panel border border-dashed p-8 text-center ${over ? "border-accent bg-raised" : "border-border-strong bg-surface"}`}
      >
        <Upload className="size-8 text-text-muted" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-body-strong text-text">Drop a .mid file here</p>
          <p className="text-small text-text-muted">Up to 1 MB, 20,000 notes and five minutes.</p>
        </div>
        <input
          ref={input}
          type="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          aria-label="MIDI file"
          className="sr-only"
          onChange={(e) => {
            void fromFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>
          Choose a file
        </Button>
        <div className="flex flex-col items-center gap-2">
          <span className="text-label text-label-caps text-text-muted">No file handy? Try one</span>
          <div className="flex flex-wrap justify-center gap-2">
            {SAMPLES.map((x) => (
              <FilterChip key={x.file} selected={draft?.fileName === x.file} onToggle={() => void fromSample(x.file)}>
                {x.label}
              </FilterChip>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-panel border border-type-kit bg-surface p-4 text-small text-type-kit">
          {error}
        </p>
      )}

      {draft && notes && (
        <section aria-label="Check and post" className="grid grid-cols-1 gap-6 desktop:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface p-4 desktop:col-span-2">
            <div className="flex items-center gap-3">
              <PlayButton
                size="hero"
                title={`Preview ${draft.title}`}
                state={previewing && s.status === "playing" ? "playing" : "paused"}
                onClick={() => {
                  if (!previewing) player.load(previewId, notes, draft.sound);
                  player.toggle(previewId, notes, draft.sound);
                }}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body-strong text-text">{draft.fileName}</span>
                <span className="font-mono text-numeric tabular text-text-muted">
                  {notes.bars} bars · {notes.notes.length} notes · {draft.analysis.key ? formatKey(draft.analysis.key) : "no key"} · {draft.analysis.bpmSource === "file" ? "tempo from the file" : draft.analysis.bpmSource === "name" ? "tempo from the name" : "no tempo in the file, 120 assumed"}
                </span>
              </span>
            </div>
            <PianoRoll
              key={draft.fileName}
              notes={notes}
              label={rollLabel({ kind: draft.kind, key: draft.analysis.key, notes })}
              getBeat={previewing ? player.getBeat : undefined}
              playing={previewing && s.status === "playing"}
              onSeek={(b) => {
                if (!previewing) player.load(previewId, notes, draft.sound);
                player.seek(b);
                if (s.status !== "playing" || !previewing) void player.play();
              }}
              onAudition={(p) => {
                if (!previewing) player.load(previewId, notes, draft.sound);
                player.audition(p);
              }}
            />
            {draft.analysis.tempoAssumed && <p className="text-small text-text-muted">The file has no tempo, so 120 BPM was assumed. Set the real tempo before you post.</p>}
          </div>

          <form
            aria-label="Post details"
            className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!titleOk || !bpmOk) return;
              player.pause();
              const tags = draft.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 5);
              const posted = postUpload({
                slug: slugify(draft.title),
                title: draft.title.trim(),
                kind: draft.kind,
                sound: draft.kind === "drums" ? "drums" : draft.sound,
                part: draft.kind === "drums" ? (draft.part ?? "kit") : undefined,
                key: draft.kind === "drums" ? null : draft.analysis.key,
                notes,
                tags,
                description: `Posted from the demo upload page. Read from ${draft.fileName}: ${notes.notes.length} notes over ${notes.bars} bars.`,
                license: "royalty_free",
                fileName: draft.fileName,
              });
              toast({ tone: "success", title: "Posted", description: `${posted.title} is up. It is on the home page too.` });
              navigate(posted.href);
            }}
          >
            <TextInput label="Title" value={draft.title} maxLength={80} error={titleOk ? undefined : "Give it a title."} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <TextInput
              label="BPM"
              inputMode="decimal"
              value={draft.bpm}
              error={bpmOk ? undefined : "A tempo from 40 to 300."}
              hint={draft.analysis.bpmSource === "file" ? "Read from the file's tempo." : undefined}
              onChange={(e) => {
                player.pause();
                setDraft({ ...draft, bpm: e.target.value });
              }}
            />
            <div className="flex flex-col gap-2">
              <span className="text-label text-label-caps text-text-muted">Kind</span>
              <div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
                {midiKindSchema.options.map((k) => (
                  <FilterChip key={k} selected={draft.kind === k} onToggle={() => {
                    player.pause();
                    setDraft({ ...draft, kind: k, sound: k === "drums" ? "drums" : draft.sound === "drums" ? SOUND_FOR[k] : draft.sound, part: k === "drums" ? (draft.part ?? guessDrumPart(draft.fileName, draft.analysis.notes.notes)) : undefined });
                  }}>
                    {KIND_LABEL[k]}
                  </FilterChip>
                ))}
              </div>
            </div>
            {draft.kind === "drums" && (
              <div className="flex flex-col gap-2">
                <span className="text-label text-label-caps text-text-muted">Drum part</span>
                <div role="group" aria-label="Drum part" className="flex flex-wrap gap-2">
                  {(Object.keys(DRUM_PART_LABEL) as DrumPart[]).map((k) => (
                    <FilterChip
                      key={k}
                      selected={(draft.part ?? "kit") === k}
                      onToggle={() => {
                        player.pause();
                        setDraft({ ...draft, part: k });
                      }}
                    >
                      {DRUM_PART_LABEL[k]}
                    </FilterChip>
                  ))}
                </div>
                <span className="text-small text-text-muted">A part plays on that drum whatever notes it was written on. A drum pattern on General MIDI notes plays as written.</span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <span className="text-label text-label-caps text-text-muted">Plays on</span>
              <SoundPicker
                value={draft.sound}
                drums={notes.drums}
                options={notes.drums ? soundIdSchema.options : POSTED_SOUNDS}
                onChange={(o) => {
                  setDraft({ ...draft, sound: o });
                  if (previewing) player.setSound(o);
                }}
              />
            </div>
            <TextInput label="Tags" value={draft.tags} hint="Up to five, separated by commas." onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
            <Button type="submit" variant="primary" icon={Upload} disabled={!titleOk || !bpmOk}>
              Post it
            </Button>
          </form>
        </section>
      )}
    </Wrap>
  );
}

export { midiItem };
