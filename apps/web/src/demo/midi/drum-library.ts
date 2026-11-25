import type { MidiNotesFile } from "@stash/contracts";
import { drums, file, humanize, type N } from "./library";

/**
 * Drum MIDI written for the demo: hi-hat lines, kick and snare grooves, full kits and percussion
 * in the trap, drill, rage and plugg styles. Original patterns, on General MIDI drum notes (36
 * kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 37 rim), so they land on any GM kit.
 */

const HAT = 42;
const OPEN = 46;

/** A hat roll: `count` hits evenly across `span` beats from `at`, velocity ramping from v0 to v1. */
function roll(at: number, span: number, count: number, v0: number, v1: number, pitch = HAT): N[] {
  return Array.from({ length: count }, (_, i): N => [at + (i * span) / count, span / count, pitch, Math.round(v0 + ((v1 - v0) * i) / Math.max(1, count - 1))]);
}

/** Removes the hats a roll replaces, from `at` for `span` beats. */
function clear(notes: N[], at: number, span: number, pitch = HAT): N[] {
  return notes.filter(([s, , p]) => !(p === pitch && s >= at - 1e-6 && s < at + span - 1e-6));
}

function withRolls(base: N[], rolls: N[][]): N[] {
  let out = base;
  for (const r of rolls) {
    const at = r[0]![0];
    const end = r[r.length - 1]![0] + r[r.length - 1]![1];
    out = clear(out, at, end - at);
    out.push(...r);
  }
  return out;
}

/** Trap hi-hats, 140: steady sixteenths with 32nd rolls, a sixteenth-triplet run and a 64th flick. */
export function trapHats(): MidiNotesFile {
  const sixteen = drums(Array.from({ length: 4 }, () => ({ [HAT]: "XxxxXxxxXxxxXxxx" })));
  return file(
    humanize(withRolls(sixteen, [roll(3.5, 0.5, 4, 70, 110), roll(6, 1, 6, 74, 104), roll(11, 0.5, 4, 66, 100), roll(11.5, 0.5, 8, 60, 116), roll(14, 1, 6, 80, 110), roll(15.5, 0.5, 4, 62, 112)]), 41, 0.004),
    140,
    4,
    true,
  );
}

/** Triplet hats, 150: eighth-note triplets the whole way, with sixteenth-triplet doubles. */
export function tripletHats(): MidiNotesFile {
  const bars = drums(Array.from({ length: 4 }, () => ({ [HAT]: "XxxXxxXxxXxx" })));
  return file(humanize(withRolls(bars, [roll(2 + 2 / 3, 1 / 3, 2, 80, 96), roll(7, 1, 6, 70, 108), roll(10 + 2 / 3, 1 / 3, 2, 80, 96), roll(15, 1, 9, 60, 116)]), 43, 0.004), 150, 4, true);
}

/** UK drill hats, 142: the skippy pattern, with triplet flicks into the snare. */
export function ukDrillHats(): MidiNotesFile {
  const a = { [HAT]: "X..x..x.X..x..x." };
  const b = { [HAT]: "X..x..x.X..x.xx." };
  const notes = drums([a, b, a, b]);
  return file(humanize(withRolls(notes, [roll(6.5, 0.5, 3, 72, 100), roll(14.5, 0.5, 3, 72, 100), roll(15, 1, 6, 64, 108)]), 47, 0.005), 142, 4, true);
}

/** NY drill hats, 144: bouncing triplet groups that skip the downbeat of beat three. */
export function nyDrillHats(): MidiNotesFile {
  const out: N[] = [];
  for (let b = 0; b < 4; b++) {
    const t = b * 4;
    out.push([t, 0.25, HAT, 118], [t + 0.75, 0.25, HAT, 90], [t + 1.5, 0.25, HAT, 100]);
    out.push(...roll(t + 2 + 1 / 3, 2 / 3, 2, 84, 96));
    out.push([t + 3, 0.25, HAT, 108], [t + 3.5, 0.25, HAT, 80]);
    if (b % 2 === 1) out.push(...roll(t + 3.5, 0.5, 4, 70, 112));
    else out.push([t + 3.75, 0.25, HAT, 92]);
  }
  return file(humanize(out, 53, 0.005), 144, 4, true);
}

/** Pluggnb hats, 150: relaxed eighths, a sixteenth double each bar and an open hat on the four-and. */
export function pluggHats(): MidiNotesFile {
  const a = { [HAT]: "X.x.x.x.X.x.xx..", [OPEN]: "..............x." };
  const b = { [HAT]: "X.x.x.xxX.x.x.x.", [OPEN]: "..............x." };
  return file(humanize(drums([a, b, a, { [HAT]: "X.x.x.x.X.x.x...", [OPEN]: "" }]).concat(roll(15, 1, 6, 66, 104)), 59, 0.006), 150, 4, true);
}

/** Rage hats, 160: hard sixteenths with 32nd stutters and a 64th buzz at the turnaround. */
export function rageHats(): MidiNotesFile {
  const notes = drums(Array.from({ length: 4 }, () => ({ [HAT]: "XxXxXxXxXxXxXxXx" })));
  return file(humanize(withRolls(notes, [roll(1.5, 0.5, 4, 90, 120), roll(5.5, 0.5, 4, 90, 120), roll(9, 0.5, 4, 90, 120), roll(13.5, 0.5, 4, 90, 120), roll(15, 1, 16, 50, 124)]), 61, 0.003), 160, 4, true);
}

/** Open hat accents, 140: closed eighths with an open hat on every off-beat of beats two and four. */
export function openHatAccents(): MidiNotesFile {
  const a = { [HAT]: "X.x.x...X.x.x...", [OPEN]: "......x.......x." };
  return file(humanize(drums([a, a, a, { [HAT]: "X.x.x...X.xxx.xx", [OPEN]: "......x......." }]), 67, 0.005), 140, 4, true);
}

/** Trap kick and clap, 140: half-time clap on three, kicks that bounce around it. */
export function trapKickClap(): MidiNotesFile {
  const bars = [
    { 36: "X......x..X.....", 39: "........X......." },
    { 36: "X.....x...X..x..", 39: "........X......." },
    { 36: "X......x..X.....", 39: "........X......." },
    { 36: "X..x...x..X...x.", 39: "........X.....x." },
  ];
  return file(humanize(drums(bars), 71, 0.004), 140, 4, true);
}

/** Bouncy trap kicks, 140: a kick line to lay an 808 on, with pickups into each bar. */
export function trapKicks(): MidiNotesFile {
  const bars = [{ 36: "X......x..X....." }, { 36: "X.....x...X..x.." }, { 36: "X......x..x.X..." }, { 36: "X..x...x..X...xx" }];
  return file(drums(bars), 140, 4, true);
}

/** UK drill drums, 142: snare on three with a late ghost, sliding kicks, skippy hats. */
export function ukDrillKit(): MidiNotesFile {
  const a = { 36: "X.....x...x.....", 38: "........X.......", [HAT]: "X..x..x.X..x..x." };
  const b = { 36: "X..x......X..x..", 38: "........X.....o.", [HAT]: "X..x..x.X..x.xx." };
  const notes = drums([a, b, a, b]);
  return file(humanize(withRolls(notes, [roll(15, 1, 6, 64, 108)]), 73, 0.005), 142, 4, true);
}

/** NY drill drums, 144: kick and snare swapped late, bouncing triplet hats. */
export function nyDrillKit(): MidiNotesFile {
  const hats = nyDrillHats().notes as N[];
  const kicks = drums([{ 36: "X.....x....x...." }, { 36: "X..x......X....." }, { 36: "X.....x....x...." }, { 36: "X..x.......x..x." }]);
  const snares = drums(Array.from({ length: 4 }, (_, i) => ({ 38: i % 2 ? "........X.....x." : "........X......." })));
  return file(humanize([...hats, ...kicks, ...snares], 79, 0.004), 144, 4, true);
}

/** Rage drums, 160: hard kicks on every beat of the first bar, then the switch-up. */
export function rageKit(): MidiNotesFile {
  const hats = rageHats().notes as N[];
  const bars = [
    { 36: "X...X...X...X...", 38: "....X.......X..." },
    { 36: "X.....X...X.....", 38: "....X.......X..." },
    { 36: "X...X...X...X...", 38: "....X.......X..." },
    { 36: "X.....X...X..X.X", 38: "....X.......X.XX" },
  ];
  return file(humanize([...hats, ...drums(bars)], 83, 0.003), 160, 4, true);
}

/** Trap percussion, 140: a rim line and a shaker on sixteenths, to sit under any trap hats. */
export function trapPerc(): MidiNotesFile {
  const bars = Array.from({ length: 4 }, (_, i) => ({ 37: i % 2 ? "...x..x....x..x." : "...x..x......x..", 70: "oxoxoxoxoxoxoxox" }));
  return file(humanize(drums(bars), 89, 0.006), 140, 4, true);
}

/** Snare and clap fills, 140: four one-bar fills to drop at the end of a section. */
export function snareFills(): MidiNotesFile {
  const notes = [
    ...drums([{ 38: "........X...X.X.", 39: "........X......." }]),
    ...roll(4 + 2, 2, 8, 70, 120, 38),
    ...drums([{}, {}, { 39: "X...X...X.X.XXXX" }]),
    ...roll(12, 2, 6, 80, 110, 38),
    ...roll(14, 2, 16, 50, 127, 38),
  ];
  return file(notes, 140, 4, true);
}
