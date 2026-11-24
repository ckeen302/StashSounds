/**
 * A synth patch for the demo's sound design page: two oscillators with unison, a sub, noise, a
 * filter with its own envelope, an amp envelope, drive, vibrato and a reverb send. Small enough to
 * learn on, wide enough for the sounds producers reach for (supersaws, plucks, bells, organs, 808s).
 */
export type Wave = "sine" | "triangle" | "sawtooth" | "square";

export type Patch = {
  name: string;
  osc1: { wave: Wave; octave: number; voices: number; spread: number };
  osc2: { wave: Wave; octave: number; semis: number; level: number };
  sub: number;
  noise: number;
  filter: { cutoff: number; resonance: number; envAmount: number; decay: number };
  amp: { attack: number; decay: number; sustain: number; release: number };
  /** Pitch drop at the start, in semitones (808s, kicks, zaps). */
  pitchDrop: number;
  drive: number;
  vibrato: { rate: number; depth: number };
  reverb: number;
  level: number;
};

const base: Patch = {
  name: "Init",
  osc1: { wave: "sawtooth", octave: 0, voices: 1, spread: 0 },
  osc2: { wave: "square", octave: 0, semis: 0, level: 0 },
  sub: 0,
  noise: 0,
  filter: { cutoff: 6000, resonance: 0.7, envAmount: 0, decay: 0.3 },
  amp: { attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.25 },
  pitchDrop: 0,
  drive: 0,
  vibrato: { rate: 5, depth: 0 },
  reverb: 0.2,
  level: 0.8,
};

const make = (name: string, p: Partial<Omit<Patch, "name">>): Patch => ({
  ...base,
  ...p,
  name,
  osc1: { ...base.osc1, ...p.osc1 },
  osc2: { ...base.osc2, ...p.osc2 },
  filter: { ...base.filter, ...p.filter },
  amp: { ...base.amp, ...p.amp },
  vibrato: { ...base.vibrato, ...p.vibrato },
});

/** Factory patches. Named for what they sound like, not after anyone's preset. */
export const FACTORY: Patch[] = [
  make("Rage supersaw", { osc1: { wave: "sawtooth", octave: 0, voices: 7, spread: 28 }, osc2: { wave: "sawtooth", octave: 1, semis: 0, level: 0.35 }, filter: { cutoff: 5200, resonance: 1, envAmount: 2400, decay: 0.25 }, amp: { attack: 0.003, decay: 0.2, sustain: 0.85, release: 0.2 }, drive: 0.55, reverb: 0.3, level: 0.55 }),
  make("Plugg bell", { osc1: { wave: "sine", octave: 1, voices: 1, spread: 0 }, osc2: { wave: "triangle", octave: 2, semis: 7, level: 0.4 }, filter: { cutoff: 9000, resonance: 0.5, envAmount: 0, decay: 0.3 }, amp: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.6 }, reverb: 0.5 }),
  make("Dark keys", { osc1: { wave: "triangle", octave: 0, voices: 2, spread: 6 }, osc2: { wave: "sine", octave: 1, semis: 0, level: 0.3 }, filter: { cutoff: 1800, resonance: 0.6, envAmount: 1600, decay: 0.4 }, amp: { attack: 0.004, decay: 1.2, sustain: 0.3, release: 0.4 }, reverb: 0.35 }),
  make("Glide 808", { osc1: { wave: "sine", octave: -1, voices: 1, spread: 0 }, sub: 0.2, filter: { cutoff: 900, resonance: 0.5, envAmount: 0, decay: 0.2 }, amp: { attack: 0.002, decay: 1.8, sustain: 0.6, release: 0.15 }, pitchDrop: 12, drive: 0.5, reverb: 0, level: 0.95 }),
  make("Toy organ", { osc1: { wave: "square", octave: 0, voices: 1, spread: 0 }, osc2: { wave: "square", octave: 1, semis: 0, level: 0.5 }, filter: { cutoff: 2400, resonance: 0.8, envAmount: 0, decay: 0.2 }, amp: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.08 }, vibrato: { rate: 6.5, depth: 14 }, drive: 0.2, reverb: 0.25, level: 0.5 }),
  make("Choir pad", { osc1: { wave: "sawtooth", octave: 0, voices: 5, spread: 14 }, osc2: { wave: "triangle", octave: 1, semis: 0, level: 0.4 }, noise: 0.04, filter: { cutoff: 1400, resonance: 2, envAmount: 300, decay: 1.5 }, amp: { attack: 0.6, decay: 1, sustain: 0.8, release: 1.4 }, vibrato: { rate: 4.5, depth: 6 }, reverb: 0.7, level: 0.55 }),
  make("Pluck house", { osc1: { wave: "sawtooth", octave: 0, voices: 3, spread: 10 }, filter: { cutoff: 300, resonance: 3, envAmount: 6500, decay: 0.18 }, amp: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.2 }, reverb: 0.4 }),
  make("Whistle lead", { osc1: { wave: "sine", octave: 1, voices: 1, spread: 0 }, osc2: { wave: "triangle", octave: 1, semis: 0, level: 0.15 }, amp: { attack: 0.04, decay: 0.2, sustain: 0.9, release: 0.3 }, vibrato: { rate: 5.5, depth: 22 }, reverb: 0.35, level: 0.6 }),
  make("Reese bass", { osc1: { wave: "sawtooth", octave: -1, voices: 2, spread: 18 }, sub: 0.4, filter: { cutoff: 700, resonance: 1.5, envAmount: 300, decay: 0.4 }, amp: { attack: 0.005, decay: 0.3, sustain: 0.9, release: 0.15 }, drive: 0.3, reverb: 0.05, level: 0.7 }),
  make("Vapor brass", { osc1: { wave: "sawtooth", octave: 0, voices: 3, spread: 8 }, osc2: { wave: "square", octave: 0, semis: 0, level: 0.3 }, filter: { cutoff: 600, resonance: 1, envAmount: 2600, decay: 0.5 }, amp: { attack: 0.06, decay: 0.4, sustain: 0.75, release: 0.3 }, reverb: 0.3, level: 0.6 }),
];

export const INIT: Patch = base;
