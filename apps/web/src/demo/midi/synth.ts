import type { MidiNotesFile, SoundId } from "@stash/contracts";
import type { Patch } from "./patch";

/**
 * The demo's MIDI player: a small Web Audio synth with a lookahead scheduler on the audio clock.
 * The real engine's MIDI path (a SoundFont, ticket 223) is not built yet, so the demo plays the
 * notes file through oscillators and noise instead. One sound per SoundId; drums follow the
 * General MIDI map. Tempo and key shift apply live: the timeline re-anchors on every change, so
 * the playhead never jumps.
 */

export type MidiStatus = "idle" | "playing" | "paused";

export type MidiPlayerState = {
  status: MidiStatus;
  currentId: string | null;
  tempoRatio: number;
  transpose: number;
  loop: boolean;
  sound: SoundId;
  volume: number;
};

type Track = { id: string; notes: MidiNotesFile; sound: SoundId; lengthBeats: number };

const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;

export class MidiPlayer {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private reverb!: GainNode;
  private noise!: AudioBuffer;
  private track: Track | null = null;
  private state: MidiPlayerState = { status: "idle", currentId: null, tempoRatio: 1, transpose: 0, loop: true, sound: "keys", volume: 0.8 };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The timeline: beat `anchorBeat` sounds at context time `anchorTime`. */
  private anchorTime = 0;
  private anchorBeat = 0;
  /** Absolute (unwrapped) beat up to which notes are scheduled. */
  private scheduledTo = 0;
  /** Beat where playback stopped, for resume. */
  private pausedBeat = 0;
  private voices = new Set<{ stop: (at: number) => void; start: number; end: number }>();
  /** A sound design patch: when set, melodic notes play through it instead of the sound. */
  private patch: Patch | null = null;
  /** The output, for the sound design page's scope. */
  analyser: AnalyserNode | null = null;
  private held = new Map<number, { release: (at: number) => void }>();
  /** Called when the player starts, so the loop engine can pause. */
  onStart: (() => void) | null = null;

  getState = (): MidiPlayerState => this.state;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  private set(patch: Partial<MidiPlayerState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private bpm(): number {
    return (this.track?.notes.bpm ?? 120) * this.state.tempoRatio;
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    return this.wire(new AudioContext({ latencyHint: "interactive" }));
  }

  /**
   * Renders one drum hit to a buffer, through the same chain as the pads, for downloads. Runs on
   * its own offline context, so nothing plays and the live player is untouched.
   */
  static async renderHit(pitch: number, tune = 1, stretch = 1, seconds = 1): Promise<AudioBuffer> {
    const rate = 44100;
    const off = new OfflineAudioContext(2, Math.ceil(rate * Math.max(0.2, seconds)), rate);
    const p = new MidiPlayer();
    // The offline context offers every node the drum chain uses; the live-only calls are never reached.
    p.wire(off as unknown as AudioContext);
    p.reverb.gain.value = 0.12;
    p.drum(pitch, (112 / 127) * 0.8, 0, tune, stretch);
    return off.startRendering();
  }

  private wire(ctx: AudioContext): AudioContext {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    comp.connect(this.analyser).connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = this.state.volume;
    this.out.connect(comp);
    // A short generated room: decaying stereo noise.
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    conv.buffer = ir;
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.25;
    this.reverb.connect(conv).connect(this.out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    return ctx;
  }

  /** The beat now, inside the track (wrapped when looping). */
  getBeat = (): number => {
    const t = this.track;
    if (!t) return 0;
    if (this.state.status !== "playing" || !this.ctx) return this.pausedBeat;
    const b = this.anchorBeat + ((this.ctx.currentTime - this.anchorTime) * this.bpm()) / 60;
    return this.state.loop ? ((b % t.lengthBeats) + t.lengthBeats) % t.lengthBeats : Math.min(b, t.lengthBeats);
  };

  lengthBeats = (): number => this.track?.lengthBeats ?? 0;

  /** Load a track. Keeps playing state only if it is the same id. */
  load(id: string, notes: MidiNotesFile, sound: SoundId) {
    if (this.track?.id === id) return;
    this.stopAll();
    const bpb = (notes.timeSignature[0] * 4) / notes.timeSignature[1];
    this.track = { id, notes, sound, lengthBeats: notes.bars * bpb };
    this.pausedBeat = 0;
    this.set({ currentId: id, status: "paused", sound, tempoRatio: 1, transpose: 0 });
  }

  async play(id?: string, notes?: MidiNotesFile, sound?: SoundId) {
    if (id && notes && sound) this.load(id, notes, sound);
    if (!this.track) return;
    const ctx = this.ensure();
    if (ctx.state !== "running") await ctx.resume().catch(() => undefined);
    this.onStart?.();
    if (this.pausedBeat >= this.track.lengthBeats - 1e-6) this.pausedBeat = 0;
    this.anchorTime = ctx.currentTime + 0.04;
    this.anchorBeat = this.pausedBeat;
    this.scheduledTo = this.pausedBeat;
    this.set({ status: "playing" });
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  pause() {
    if (this.state.status !== "playing") return;
    this.pausedBeat = this.getBeat();
    this.stopAll();
    this.set({ status: "paused" });
  }

  toggle(id: string, notes: MidiNotesFile, sound: SoundId) {
    if (this.state.currentId === id && this.state.status === "playing") this.pause();
    else void this.play(id, notes, sound);
  }

  /** Jump to a beat inside the track. */
  seek(beat: number) {
    if (!this.track) return;
    const b = Math.max(0, Math.min(this.track.lengthBeats - 1e-3, beat));
    if (this.state.status !== "playing" || !this.ctx) {
      this.pausedBeat = b;
      this.set({});
      return;
    }
    this.silence();
    this.anchorTime = this.ctx.currentTime + 0.02;
    this.anchorBeat = b;
    this.scheduledTo = b;
    this.tick();
  }

  setTempoRatio(r: number) {
    this.reanchor(() => this.set({ tempoRatio: r }));
  }

  setTranspose(semitones: number) {
    this.set({ transpose: semitones });
  }

  setLoop(on: boolean) {
    this.reanchor(() => this.set({ loop: on }));
  }

  setSound(sound: SoundId) {
    if (this.track) this.track.sound = sound;
    this.set({ sound });
  }

  setVolume(v: number) {
    if (this.ctx) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    this.set({ volume: v });
  }

  setPatch(p: Patch | null) {
    this.patch = p;
  }

  /** Hold a note on the current patch (or sound) until noteOff: the sound design keyboard. */
  noteOn(pitch: number, velocity = 100) {
    const ctx = this.ensure();
    void ctx.resume();
    this.noteOff(pitch);
    const v = this.patch ? this.patchVoice(this.patch, pitch, velocity, ctx.currentTime + 0.005, null) : null;
    if (v) this.held.set(pitch, v);
    else this.audition(pitch, velocity);
  }

  noteOff(pitch: number) {
    const v = this.held.get(pitch);
    if (!v || !this.ctx) return;
    v.release(this.ctx.currentTime);
    this.held.delete(pitch);
  }

  /** Play one note now, for the keyboard strip and the upload preview. */
  /**
   * One drum hit now, for the pads: a GM drum pitch, tuned (1 = as written, 2 = an octave up) and
   * stretched (decay times this).
   */
  hit(pitch: number, velocity = 110, tune = 1, stretch = 1, at?: number) {
    const ctx = this.ensure();
    if (ctx.state === "suspended") void ctx.resume();
    this.drum(pitch, (velocity / 127) * this.state.volume, Math.max(at ?? 0, ctx.currentTime + 0.005), tune, stretch);
  }

  /** The audio clock, for anything that schedules hits ahead (the step sequencer). */
  now(): number {
    return this.ensure().currentTime;
  }

  audition(pitch: number, velocity = 100) {
    const ctx = this.ensure();
    void ctx.resume();
    this.voice(this.track?.sound ?? this.state.sound, pitch, velocity, ctx.currentTime + 0.01, 0.5, false);
  }

  private reanchor(change: () => void) {
    if (this.state.status === "playing" && this.ctx) {
      const now = this.ctx.currentTime;
      const beat = this.getBeat();
      change();
      // Notes sounding now ring on; notes queued ahead are dropped and queued again on the new timeline.
      for (const v of this.voices) {
        if (v.start > now) {
          v.stop(now);
          this.voices.delete(v);
        }
      }
      this.anchorTime = now;
      this.anchorBeat = beat;
      this.scheduledTo = beat;
      this.tick();
    } else change();
  }

  private tick() {
    const t = this.track;
    const ctx = this.ctx;
    if (!t || !ctx || this.state.status !== "playing") return;
    const spb = 60 / this.bpm();
    const horizon = this.anchorBeat + (ctx.currentTime + LOOKAHEAD_S - this.anchorTime) / spb;
    const L = t.lengthBeats;
    if (!this.state.loop && this.anchorBeat + (ctx.currentTime - this.anchorTime) / spb >= L) {
      this.pausedBeat = L;
      this.stopAll();
      this.pausedBeat = 0;
      this.set({ status: "paused" });
      return;
    }
    let a = this.scheduledTo;
    const b = this.state.loop ? horizon : Math.min(horizon, L);
    const notes = t.notes.notes;
    while (a < b) {
      const cycle = Math.floor(a / L + 1e-9);
      const base = cycle * L;
      const lo = a - base;
      const hi = Math.min(b - base, L);
      for (let i = lowerBound(notes, lo); i < notes.length && notes[i]![0] < hi; i++) {
        const [start, len, pitch, vel] = notes[i]!;
        const when = this.anchorTime + (base + start - this.anchorBeat) * spb;
        if (when < ctx.currentTime - 0.01) continue;
        this.voice(t.sound, t.notes.drums ? pitch : pitch + this.state.transpose, vel, Math.max(when, ctx.currentTime), len * spb, t.notes.drums);
      }
      a = base + hi;
      if (hi >= L - 1e-9 && !this.state.loop) break;
    }
    this.scheduledTo = b;
    for (const v of this.voices) if (v.end < ctx.currentTime) this.voices.delete(v);
  }

  private silence(at?: number) {
    const now = at ?? this.ctx?.currentTime ?? 0;
    for (const v of this.voices) v.stop(now);
    this.voices.clear();
  }

  private stopAll() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.silence();
  }

  // ---------------------------------------------------------------------------------------------
  // Voices

  private voice(sound: SoundId, pitch: number, vel: number, at: number, dur: number, drums: boolean) {
    const ctx = this.ctx!;
    const amp = 0.32 * (vel / 127) ** 1.4;
    if (drums || sound === "drums") return this.drum(pitch, amp, at);
    if (this.patch) {
      this.patchVoice(this.patch, pitch, vel, at, dur);
      return;
    }
    const f = 440 * 2 ** ((pitch - 69) / 12);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.out);
    const nodes: AudioScheduledSourceNode[] = [];
    const osc = (type: OscillatorType, freq: number, detune = 0, dest: AudioNode = g) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(dest);
      nodes.push(o);
      return o;
    };
    const filter = (freq: number, q = 0.7) => {
      const fl = ctx.createBiquadFilter();
      fl.type = "lowpass";
      fl.frequency.value = freq;
      fl.Q.value = q;
      fl.connect(g);
      return fl;
    };
    let release = 0.25;
    let send = 0.2;
    const env = g.gain;
    const hold = Math.max(dur, 0.05);
    switch (sound) {
      case "keys": {
        // Electric piano: a sine with a quick tine an octave and a fifth up.
        osc("sine", f);
        const tg = ctx.createGain();
        tg.connect(g);
        tg.gain.setValueAtTime(0.35, at);
        tg.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
        osc("sine", f * 3, 0, tg);
        osc("triangle", f, 4).connect(g);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(amp, at + 0.005);
        env.setTargetAtTime(amp * 0.35, at + 0.01, 0.6);
        release = 0.35;
        send = 0.3;
        break;
      }
      case "pluck": {
        const fl = filter(f * 8, 2);
        fl.frequency.setValueAtTime(Math.min(f * 12, 12000), at);
        fl.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 200), at + 0.25);
        osc("sawtooth", f, -6, fl);
        osc("square", f, 6, fl);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(amp * 0.7, at + 0.003);
        env.setTargetAtTime(0.0001, at + 0.01, 0.25);
        release = 0.15;
        send = 0.35;
        break;
      }
      case "pad": {
        const fl = filter(1400, 0.5);
        for (const d of [-9, 0, 9]) osc("sawtooth", f, d, fl);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(amp * 0.45, at + 0.35);
        release = 0.9;
        send = 0.6;
        break;
      }
      case "strings": {
        const fl = filter(2600, 0.6);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.2;
        const depth = ctx.createGain();
        depth.gain.value = 6;
        lfo.connect(depth);
        nodes.push(lfo);
        for (const d of [-7, 7]) depth.connect(osc("sawtooth", f, d, fl).detune);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(amp * 0.5, at + 0.18);
        release = 0.5;
        send = 0.5;
        break;
      }
      case "bass": {
        const fl = filter(Math.min(f * 6, 1400), 4);
        osc("sawtooth", f, 0, fl);
        osc("sine", f / 2, 0);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(amp * 0.9, at + 0.004);
        env.setTargetAtTime(amp * 0.6, at + 0.02, 0.3);
        release = 0.08;
        send = 0.02;
        break;
      }
      case "808": {
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) curve[i] = Math.tanh((i / 128 - 1) * 2.2);
        shaper.curve = curve;
        shaper.connect(g);
        const fr = f < 30 ? f * 2 : f;
        const o = osc("sine", fr, 0, shaper);
        o.frequency.setValueAtTime(fr * 2.2, at);
        o.frequency.exponentialRampToValueAtTime(fr, at + 0.045);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(amp * 1.6, at + 0.003);
        env.setTargetAtTime(amp * 0.9, at + 0.05, 0.6);
        release = 0.12;
        send = 0;
        break;
      }
      case "bell": {
        osc("sine", f);
        const p = ctx.createGain();
        p.connect(g);
        p.gain.setValueAtTime(0.5, at);
        p.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
        osc("sine", f * 2.76, 0, p);
        const q = ctx.createGain();
        q.connect(g);
        q.gain.setValueAtTime(0.25, at);
        q.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
        osc("sine", f * 5.4, 0, q);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(amp * 0.8, at + 0.002);
        env.setTargetAtTime(0.0001, at + 0.01, 0.7);
        release = 0.6;
        send = 0.45;
        break;
      }
      default:
        osc("triangle", f);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(amp, at + 0.01);
    }
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverb);
    }
    const end = at + hold + release;
    env.setTargetAtTime(0, at + hold, release / 4);
    for (const n of nodes) {
      n.start(at);
      n.stop(end + 0.1);
    }
    this.track_(g, nodes, at, end);
  }

  private track_(g: GainNode, nodes: AudioScheduledSourceNode[], start: number, end: number) {
    const ctx = this.ctx!;
    const v = {
      start,
      end,
      stop: (t: number) => {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, 0.01);
        for (const n of nodes) {
          try {
            n.stop(Math.max(t, ctx.currentTime) + 0.06);
          } catch {
            // already stopped
          }
        }
      },
    };
    this.voices.add(v);
  }

  /** One note through a sound design patch. With `dur` null it holds until released. */
  private patchVoice(pt: Patch, pitch: number, vel: number, at: number, dur: number | null): { release: (t: number) => void } {
    const ctx = this.ctx!;
    const f = 440 * 2 ** ((pitch - 69) / 12);
    const amp = pt.level * 0.3 * (vel / 127) ** 1.2;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.out);
    let tail: AudioNode = out;
    if (pt.drive > 0) {
      const sh = ctx.createWaveShaper();
      const k = 1 + pt.drive * 8;
      const curve = new Float32Array(512);
      for (let i = 0; i < 512; i++) curve[i] = Math.tanh((i / 256 - 1) * k) / Math.tanh(k);
      sh.curve = curve;
      sh.connect(out);
      tail = sh;
    }
    const fl = ctx.createBiquadFilter();
    fl.type = "lowpass";
    fl.Q.value = pt.filter.resonance;
    fl.connect(tail);
    const cut = Math.min(18000, pt.filter.cutoff);
    fl.frequency.setValueAtTime(Math.min(18000, cut + pt.filter.envAmount), at);
    fl.frequency.setTargetAtTime(cut, at + 0.002, Math.max(0.01, pt.filter.decay / 3));
    const nodes: AudioScheduledSourceNode[] = [];
    const vib = pt.vibrato.depth > 0 ? ctx.createOscillator() : null;
    let vibGain: GainNode | null = null;
    if (vib) {
      vib.frequency.value = pt.vibrato.rate;
      vibGain = ctx.createGain();
      vibGain.gain.value = 0;
      vibGain.gain.setValueAtTime(0, at);
      vibGain.gain.linearRampToValueAtTime(pt.vibrato.depth, at + 0.35);
      vib.connect(vibGain);
      nodes.push(vib);
    }
    const osc = (wave: OscillatorType, freq: number, detune: number, level: number) => {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = freq;
      o.detune.value = detune;
      if (pt.pitchDrop > 0) {
        o.frequency.setValueAtTime(freq * 2 ** (pt.pitchDrop / 12), at);
        o.frequency.exponentialRampToValueAtTime(freq, at + 0.06);
      }
      if (vibGain) vibGain.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(fl);
      nodes.push(o);
    };
    const n = Math.max(1, Math.round(pt.osc1.voices));
    for (let i = 0; i < n; i++) {
      const d = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * pt.osc1.spread;
      osc(pt.osc1.wave, f * 2 ** pt.osc1.octave, d, 1 / Math.sqrt(n));
    }
    if (pt.osc2.level > 0) osc(pt.osc2.wave, f * 2 ** (pt.osc2.octave + pt.osc2.semis / 12), 3, pt.osc2.level);
    if (pt.sub > 0) osc("sine", f / 2, 0, pt.sub);
    if (pt.noise > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = pt.noise;
      src.connect(g).connect(fl);
      nodes.push(src);
    }
    if (pt.reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = pt.reverb;
      out.connect(s).connect(this.reverb);
    }
    const { attack, decay, sustain, release } = pt.amp;
    const env = out.gain;
    env.setValueAtTime(0, at);
    env.linearRampToValueAtTime(amp, at + Math.max(0.002, attack));
    env.setTargetAtTime(amp * sustain, at + attack, Math.max(0.01, decay / 3));
    for (const nd of nodes) nd.start(at);
    let released = false;
    const doRelease = (t: number) => {
      if (released) return;
      released = true;
      const r = Math.max(t, at + 0.01);
      env.cancelScheduledValues(r);
      env.setTargetAtTime(0, r, Math.max(0.01, release / 4));
      for (const nd of nodes) {
        try {
          nd.stop(r + release + 0.2);
        } catch {
          // already stopped
        }
      }
    };
    if (dur !== null) {
      doRelease(at + Math.max(dur, 0.05));
      this.track_(out, nodes, at, at + dur + release);
    } else this.voices.add({ start: at, end: Infinity, stop: (t) => doRelease(t) });
    return { release: doRelease };
  }

  /** General MIDI drums from a sine, a noise buffer and filters. */
  private drum(pitch: number, amp: number, at: number, tune = 1, stretch = 1) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.out);
    const nodes: AudioScheduledSourceNode[] = [];
    const noise = (type: BiquadFilterType, freq: number, decay: number, level: number, q = 0.8) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const fl = ctx.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = freq * tune;
      fl.Q.value = q;
      decay *= stretch;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(level, at);
      ng.gain.exponentialRampToValueAtTime(0.0008, at + decay);
      src.connect(fl).connect(ng).connect(g);
      nodes.push(src);
      return decay;
    };
    const tone = (from: number, to: number, drop: number, decay: number, level: number) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(from * tune, at);
      o.frequency.exponentialRampToValueAtTime(to * tune, at + drop);
      decay *= stretch;
      const og = ctx.createGain();
      og.gain.setValueAtTime(level, at);
      og.gain.exponentialRampToValueAtTime(0.0008, at + decay);
      o.connect(og).connect(g);
      nodes.push(o);
      return decay;
    };
    g.gain.value = amp * 2.2;
    let len = 0.2;
    if (pitch === 35 || pitch === 36) len = Math.max(tone(160, 42, 0.07, 0.5, 1.2), noise("lowpass", 900, 0.02, 0.3));
    else if (pitch === 38 || pitch === 40) len = Math.max(tone(220, 170, 0.05, 0.12, 0.5), noise("bandpass", 2600, 0.2, 0.9, 0.6));
    else if (pitch === 39) {
      for (const d of [0, 0.011, 0.022]) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const fl = ctx.createBiquadFilter();
        fl.type = "bandpass";
        fl.frequency.value = 1400;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.9, at + d);
        ng.gain.exponentialRampToValueAtTime(0.001, at + d + (d === 0.022 ? 0.18 : 0.01));
        src.connect(fl).connect(ng).connect(g);
        nodes.push(src);
      }
      len = 0.22;
    } else if (pitch === 37) len = Math.max(tone(1700, 1600, 0.01, 0.04, 0.5), noise("highpass", 4000, 0.03, 0.4));
    else if (pitch === 42 || pitch === 44) len = noise("highpass", 7500, 0.045, 0.55);
    else if (pitch === 46) len = noise("highpass", 7000, 0.32, 0.5);
    else if (pitch === 49 || pitch === 57 || pitch === 55) len = noise("highpass", 5000, 1.4, 0.45);
    else if (pitch === 51 || pitch === 59) len = Math.max(noise("bandpass", 9000, 0.6, 0.3, 2), tone(3200, 3100, 0.1, 0.4, 0.06));
    else if (pitch >= 41 && pitch <= 50) {
      const f = 80 + (pitch - 41) * 22;
      len = tone(f * 1.6, f, 0.08, 0.4, 0.9);
    } else len = noise("bandpass", 3000, 0.05, 0.4);
    for (const n of nodes) {
      n.start(at);
      n.stop(at + len + 0.1);
    }
    this.track_(g, nodes, at, at + len);
  }
}

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

let player: MidiPlayer | null = null;
export function midiPlayer(): MidiPlayer {
  if (!player) {
    player = new MidiPlayer();
    // For the demo's browser checks, like the engine's own handle.
    (globalThis as Record<symbol, unknown>)[Symbol.for("stash.demo.midi")] = player;
  }
  return player;
}
