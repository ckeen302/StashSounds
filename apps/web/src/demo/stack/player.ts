import { getEngine } from "@stash/audio";
import type { MidiNotesFile, SoundId } from "@stash/contracts";
import { midiPlayer } from "../midi/synth";
import { getResolved, keyShort, subscribeStack, type ResolvedLayer, type ResolvedStack } from "./store";
import { createRig, playNote, type Rig, type Voice } from "./voices";

/**
 * The stack player: every layer on one lookahead scheduler on the audio clock, so they cannot
 * drift. Time is counted in beats on one shared tempo; the loop is the longest layer and shorter
 * layers repeat inside it. Each layer has its own gain bus, so mute, solo and volume are a gain
 * move and never a reschedule. Tempo, key and sound changes re-anchor the timeline: notes already
 * sounding ring on, notes queued ahead are dropped and queued again.
 */

export type StackStatus = "idle" | "playing" | "paused";

export type StackPlayerLayer = { uid: string; itemId: string; title: string; sound: SoundId; transpose: number; volume: number; muted: boolean; solo: boolean; audible: boolean };

export type StackPlayerState = { status: StackStatus; layers: StackPlayerLayer[]; bpm: number; key: string | null; lengthBeats: number };

const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;

/** One note to play: layer index, absolute beat, length in beats, pitch (already shifted), velocity. */
export type StackEvent = { layer: number; beat: number; len: number; pitch: number; vel: number };

type Lane = { notes: MidiNotesFile["notes"]; lengthBeats: number; transpose: number; drums: boolean };

function lowerBound(notes: MidiNotesFile["notes"], beat: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]![0] < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Every note starting in [from, to) absolute beats, for a loop of `loop` beats where each lane
 * repeats every `lengthBeats` and is cut at the loop end. Pure, so it is unit tested.
 */
export function eventsInRange(lanes: Lane[], loop: number, from: number, to: number): StackEvent[] {
  const out: StackEvent[] = [];
  if (loop <= 0 || to <= from) return out;
  let a = from;
  while (a < to - 1e-9) {
    const cycle = Math.floor(a / loop + 1e-9);
    const base = cycle * loop;
    const lo = a - base;
    const hi = Math.min(to - base, loop);
    lanes.forEach((lane, li) => {
      const L = lane.lengthBeats;
      if (L <= 0) return;
      for (let k = Math.floor(lo / L + 1e-9); k * L < hi; k++) {
        const off = k * L;
        const start = Math.max(lo - off, 0);
        const end = Math.min(hi - off, L, loop - off);
        for (let i = lowerBound(lane.notes, start - 1e-9); i < lane.notes.length && lane.notes[i]![0] < end - 1e-9; i++) {
          const [s, len, pitch, vel] = lane.notes[i]!;
          if (s < start - 1e-9) continue;
          out.push({ layer: li, beat: base + off + s, len, pitch: lane.drums ? pitch : pitch + lane.transpose, vel });
        }
      }
    });
    a = base + hi;
  }
  return out;
}

type Bus = { uid: string; gain: GainNode };

export class StackPlayer {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private rig!: Rig;
  private buses = new Map<string, Bus>();
  private voices = new Map<string, Set<Voice>>();
  private stack: ResolvedStack = getResolved();
  private state: StackPlayerState = toState("idle", this.stack);
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private anchorTime = 0;
  private anchorBeat = 0;
  private scheduledTo = 0;
  private pausedBeat = 0;

  constructor() {
    subscribeStack(() => this.sync());
    // One thing plays at a time: the MIDI player or the loop engine starting pauses the stack.
    midiPlayer().subscribe(() => {
      if (midiPlayer().getState().status === "playing") this.pause();
    });
    getEngine().subscribe((s) => {
      if (s.status === "playing" || s.status === "loading") this.pause();
    });
  }

  getState = (): StackPlayerState => this.state;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  private emit(status: StackStatus = this.state.status) {
    this.state = toState(status, this.stack);
    for (const l of this.listeners) l();
  }

  /** The beat now inside the loop. */
  getBeat = (): number => {
    const L = this.stack.lengthBeats;
    if (L <= 0) return 0;
    if (this.state.status !== "playing" || !this.ctx) return this.pausedBeat % L;
    const b = this.anchorBeat + ((this.ctx.currentTime - this.anchorTime) * this.stack.bpm) / 60;
    return ((b % L) + L) % L;
  };

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp);
    this.rig = createRig(ctx, this.master);
    this.ctx = ctx;
    this.syncBuses();
    return ctx;
  }

  async play() {
    if (this.stack.layers.length === 0) return;
    const ctx = this.ensure();
    midiPlayer().pause();
    const engine = getEngine();
    const es = engine.getState().status;
    if (es === "playing" || es === "loading") engine.pause();
    if (ctx.state !== "running") await ctx.resume().catch(() => undefined);
    this.anchorTime = ctx.currentTime + 0.05;
    this.anchorBeat = this.pausedBeat;
    this.scheduledTo = this.pausedBeat;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit("playing");
    this.tick();
  }

  pause() {
    if (this.state.status !== "playing") return;
    this.pausedBeat = this.getBeat();
    this.stopTimer();
    this.silence();
    this.emit("paused");
  }

  /** Back to the top, stopped. */
  stop() {
    this.pause();
    this.pausedBeat = 0;
    this.emit(this.state.status === "idle" ? "idle" : "paused");
  }

  toggle() {
    if (this.state.status === "playing") this.pause();
    else void this.play();
  }

  seek(beat: number) {
    const L = this.stack.lengthBeats;
    if (L <= 0) return;
    const b = Math.max(0, Math.min(L - 1e-3, beat));
    if (this.state.status !== "playing" || !this.ctx) {
      this.pausedBeat = b;
      this.emit();
      return;
    }
    this.silence();
    this.anchorTime = this.ctx.currentTime + 0.02;
    this.anchorBeat = b;
    this.scheduledTo = b;
    this.tick();
  }

  /** The store changed: follow it without a glitch. */
  private sync() {
    const prev = this.stack;
    const next = getResolved();
    if (next === prev) return;
    const timing =
      prev.bpm !== next.bpm ||
      prev.lengthBeats !== next.lengthBeats ||
      prev.layers.length !== next.layers.length ||
      prev.layers.some((l, i) => {
        const n = next.layers[i];
        return !n || n.uid !== l.uid || n.transpose !== l.transpose || n.sound !== l.sound;
      });
    if (timing && this.state.status === "playing" && this.ctx) {
      const beat = this.getBeat();
      this.stack = next;
      const now = this.ctx.currentTime;
      // Queued notes are dropped and queued again on the new timeline; sounding ones ring on,
      // except those of layers that left the stack.
      const keep = new Set(next.layers.map((l) => l.uid));
      for (const [uid, set] of this.voices) {
        for (const v of set) {
          if (v.start > now || !keep.has(uid)) {
            v.stop(now);
            set.delete(v);
          }
        }
      }
      this.anchorTime = now;
      this.anchorBeat = next.lengthBeats > 0 ? beat % next.lengthBeats : 0;
      this.scheduledTo = this.anchorBeat;
    } else {
      this.stack = next;
      if (next.lengthBeats > 0) this.pausedBeat %= next.lengthBeats;
      else this.pausedBeat = 0;
    }
    this.syncBuses();
    if (next.layers.length === 0 && this.state.status === "playing") {
      this.stopTimer();
      this.silence();
      this.pausedBeat = 0;
      this.emit("paused");
      return;
    }
    this.emit();
    if (timing && this.state.status === "playing") this.tick();
  }

  private syncBuses() {
    const ctx = this.ctx;
    if (!ctx) return;
    const keep = new Set<string>();
    for (const l of this.stack.layers) {
      keep.add(l.uid);
      let bus = this.buses.get(l.uid);
      if (!bus) {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(this.master);
        bus = { uid: l.uid, gain };
        this.buses.set(l.uid, bus);
      }
      bus.gain.gain.setTargetAtTime(l.audible ? l.volume : 0, ctx.currentTime, 0.015);
    }
    for (const [uid, bus] of this.buses) {
      if (keep.has(uid)) continue;
      bus.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      const g = bus.gain;
      setTimeout(() => g.disconnect(), 400);
      this.buses.delete(uid);
      this.voices.delete(uid);
    }
  }

  private tick() {
    const ctx = this.ctx;
    const st = this.stack;
    if (!ctx || this.state.status !== "playing" || st.lengthBeats <= 0) return;
    const spb = 60 / st.bpm;
    const horizon = this.anchorBeat + (ctx.currentTime + LOOKAHEAD_S - this.anchorTime) / spb;
    if (horizon <= this.scheduledTo) return;
    const lanes = st.layers.map((l: ResolvedLayer): Lane => ({ notes: l.item.notes.notes, lengthBeats: l.lengthBeats, transpose: l.transpose, drums: l.drums }));
    for (const e of eventsInRange(lanes, st.lengthBeats, this.scheduledTo, horizon)) {
      const layer = st.layers[e.layer]!;
      const bus = this.buses.get(layer.uid);
      if (!bus) continue;
      const when = this.anchorTime + (e.beat - this.anchorBeat) * spb;
      if (when < ctx.currentTime - 0.01) continue;
      const v = playNote(this.rig, bus.gain, layer.drums ? "drums" : layer.sound, e.pitch, e.vel, Math.max(when, ctx.currentTime), e.len * spb);
      let set = this.voices.get(layer.uid);
      if (!set) this.voices.set(layer.uid, (set = new Set()));
      set.add(v);
    }
    this.scheduledTo = horizon;
    const now = ctx.currentTime;
    for (const set of this.voices.values()) for (const v of set) if (v.end < now) set.delete(v);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private silence() {
    const now = this.ctx?.currentTime ?? 0;
    for (const set of this.voices.values()) {
      for (const v of set) v.stop(now);
      set.clear();
    }
  }
}

function toState(status: StackStatus, s: ResolvedStack): StackPlayerState {
  return {
    status,
    bpm: s.bpm,
    key: s.key ? keyShort(s.key) : null,
    lengthBeats: s.lengthBeats,
    layers: s.layers.map((l) => ({ uid: l.uid, itemId: l.itemId, title: l.item.title, sound: l.drums ? "drums" : l.sound, transpose: l.transpose, volume: l.volume, muted: l.muted, solo: l.solo, audible: l.audible })),
  };
}

let player: StackPlayer | null = null;
export function stackPlayer(): StackPlayer {
  if (!player) {
    player = new StackPlayer();
    // For the demo's browser checks, like the MIDI player's handle.
    (globalThis as Record<symbol, unknown>)[Symbol.for("stash.demo.stack")] = player;
  }
  return player;
}
