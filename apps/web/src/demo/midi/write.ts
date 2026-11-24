import type { MidiNotesFile } from "@stash/contracts";

/** A Standard MIDI File (format 0, 480 PPQ) from the demo's note list: tempo, time signature, notes. */
export function writeMidi(file: MidiNotesFile, name: string): Uint8Array<ArrayBuffer> {
  const PPQ = 480;
  const ch = file.drums ? 9 : 0;
  const events: { tick: number; order: number; bytes: number[] }[] = [];
  for (const [start, len, pitch, vel] of file.notes) {
    const on = Math.round(start * PPQ);
    const off = Math.max(on + 1, Math.round((start + len) * PPQ));
    events.push({ tick: on, order: 1, bytes: [0x90 | ch, pitch, Math.min(127, Math.max(1, Math.round(vel)))] });
    events.push({ tick: off, order: 0, bytes: [0x80 | ch, pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const vlq = (n: number) => {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  const text = [...new TextEncoder().encode(name.slice(0, 120))];
  const mpqn = Math.round(60_000_000 / file.bpm);
  const [num, den] = file.timeSignature;
  const track: number[] = [
    0, 0xff, 0x03, ...vlq(text.length), ...text,
    0, 0xff, 0x51, 3, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff,
    0, 0xff, 0x58, 4, num, Math.round(Math.log2(den)), 24, 8,
  ];
  let at = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - at), ...e.bytes);
    at = e.tick;
  }
  const end = Math.max(at, file.bars * ((num * 4) / den) * PPQ);
  track.push(...vlq(end - at), 0xff, 0x2f, 0);

  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff];
  const len = track.length;
  const trk = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
  return new Uint8Array([...head, ...trk, ...track]);
}
