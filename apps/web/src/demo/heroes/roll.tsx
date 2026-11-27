import { formatKey } from "@stash/contracts/format";
import { UiLink } from "@stash/ui";
import type { MidiItem } from "../midi/catalog";
import { useMidiPlayer } from "../midi/pages";
import { PianoRoll } from "../midi/piano-roll";
import { midiPlayer } from "../midi/synth";
import { daily } from "./daily";

/**
 * The MIDI page's hero: today's song chords as a full piano roll on the screen, with the playhead
 * running across it while it plays. Tap a key on the roll's side to hear a note, or anywhere on the
 * roll to start from there.
 */
export function RollHero({ items }: { items: MidiItem[] }) {
  const songs = items.filter((m) => m.song);
  const item = daily(songs.length ? songs : items, 11);
  const s = useMidiPlayer();
  if (!item) return null;
  const player = midiPlayer();
  const current = s.currentId === item.id;
  const playing = current && s.status === "playing";
  const state = current ? (playing ? "playing" : "paused") : "idle";
  return (
    <div className="sp-panel-dark sp-hero-deck flex flex-col gap-3 p-3 tablet:p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="sp-key sp-key-hot sp-hero-play"
          data-play-state={state}
          aria-label={playing ? `Pause ${item.title}` : `Play ${item.title}`}
          onClick={() => player.toggle(item.id, item.notes, item.sound)}
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="sp-label sp-label-dark">Chords of the day</span>
          <UiLink href={item.href} className="sp-hero-name truncate">
            {item.title}
          </UiLink>
          <span className="truncate text-small text-text-muted">
            {[item.key ? formatKey(item.key) : null, `${Math.round(item.notes.bpm)} BPM`, `${item.notes.bars} bars`].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      <div className="sp-hero-roll">
        <PianoRoll
          notes={item.notes}
          getBeat={current ? player.getBeat : undefined}
          playing={playing}
          transpose={current ? s.transpose : 0}
          label={`${item.title}, piano roll`}
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
      </div>
    </div>
  );
}
