import type { ItemRow } from "@stash/contracts";
import { formatKey } from "@stash/contracts/format";
import { ORIGINALS } from "./data";
import { wav } from "./save";
import type { DragSource } from "./daw-drag";
import type { MidiItem } from "./midi/catalog";
import { writeMidi } from "./midi/write";
import { fileName as shotName, fileOf as shotFile, type OneShot } from "./oneshots/store";
import { fileName as melodicName, fileOf as melodicFile, type MelodicShot } from "./oneshots/melodic";
import { fileName as sfxName, wavOf, type Sfx } from "./sfx/library";
import type { Kit, KitSound } from "./kits/store";

/** What each kind of row drags out as. Names match what Download saves. */

/**
 * A loop drags out as a wav cut to exactly its bars, so it lines up on the DAW's grid with no gap at
 * the end (an mp3 pads its last frame). A producer's own upload drags out as that file, untouched.
 */
export function loopSource(row: ItemRow): DragSource {
  return {
    key: `loop:${row.id}`,
    meta: { title: row.title, by: row.owner.displayName, kind: "Loop", license: row.license },
    downloadId: row.id,
    make: async () => {
      const own = ORIGINALS.get(row.id);
      if (own) {
        const res = await fetch(own.url);
        return res.ok ? { name: own.name, data: await res.blob() } : null;
      }
      const p = row.playable;
      if (!("previewUrl" in p)) return null;
      const res = await fetch(p.previewUrl);
      if (!res.ok) return null;
      const rate = "sampleRate" in p && p.sampleRate ? p.sampleRate : 44_100;
      const decoded = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await res.arrayBuffer());
      const frames = "loopSamples" in p && p.loopSamples ? Math.max(1, Math.min(decoded.length, Math.round((p.loopSamples * decoded.sampleRate) / rate))) : decoded.length;
      const cut = new AudioBuffer({ length: frames, numberOfChannels: decoded.numberOfChannels, sampleRate: decoded.sampleRate });
      for (let c = 0; c < decoded.numberOfChannels; c++) cut.copyToChannel(decoded.getChannelData(c).subarray(0, frames), c);
      const name = `${row.title}${row.bpm ? ` ${row.bpm}bpm` : ""}${row.key ? ` ${formatKey(row.key)}` : ""}.wav`;
      return { name, data: wav(cut) };
    },
  };
}

/** A MIDI row drags out as its .mid, named like Download names it. */
export function midiSource(item: MidiItem): DragSource {
  return {
    key: `midi:${item.id}`,
    meta: { title: item.title, by: item.owner.displayName, kind: "MIDI", license: item.license },
    downloadId: item.id,
    make: async () => ({
      name: `${item.title}${item.key ? ` ${formatKey(item.key)}` : ""} ${Math.round(item.notes.bpm)}bpm.mid`,
      data: new Blob([writeMidi(item.notes, item.title)], { type: "audio/midi" }),
    }),
  };
}

/** A drum hit from a kit, or a posted one-shot. */
export function shotSource(s: OneShot): DragSource {
  return {
    key: `shot:${s.kit?.id ?? "mine"}:${s.id}`,
    meta: { title: s.name, by: s.owner.displayName, kind: "Drum sound" },
    make: async () => {
      const data = await shotFile(s);
      return data ? { name: shotName(s), data } : null;
    },
  };
}

/** A sound on a kit's page, as the one-shot it is. */
export function kitSoundSource(k: Kit, s: KitSound): DragSource {
  return shotSource({ ...s, owner: k.owner, genre: k.genre, kit: { id: k.id, name: k.name }, mine: k.mine, postedAt: k.publishedAt } as OneShot);
}

export function melodicSource(s: MelodicShot): DragSource {
  return {
    key: `melodic:${s.id}`,
    meta: { title: s.name, by: "Stash", kind: "One-shot" },
    make: async () => {
      const data = await melodicFile(s);
      return data ? { name: melodicName(s), data } : null;
    },
  };
}

export function sfxSource(s: Sfx): DragSource {
  return {
    key: `sfx:${s.id}`,
    meta: { title: s.name, by: "Stash", kind: "Sound effect" },
    make: async () => ({ name: sfxName(s), data: await wavOf(s) }),
  };
}
