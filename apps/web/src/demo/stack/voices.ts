import type { SoundId } from "@stash/contracts";

/**
 * The stack's voices: one oscillator patch per SoundId and General MIDI drums from a noise buffer.
 * Adapted from the MIDI player's synth (midi/synth.ts) so the stack sounds like the item pages, but
 * each note goes to the bus of the layer that played it, so mute, solo and volume never reschedule.
 */

export type Voice = { start: number; end: number; stop: (at: number) => void };

export type Rig = {
  ctx: AudioContext;
  noise: AudioBuffer;
  /** A short generated room every melodic voice can send to. */
  reverb: AudioNode;
};

export function createRig(ctx: AudioContext, out: AudioNode): Rig {
  const conv = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 1.6);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  conv.buffer = ir;
  const reverb = ctx.createGain();
  reverb.gain.value = 0.22;
  reverb.connect(conv).connect(out);
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const n = noise.getChannelData(0);
  for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  return { ctx, noise, reverb };
}

let saturation: Float32Array<ArrayBuffer> | null = null;
function satCurve(): Float32Array<ArrayBuffer> {
  if (saturation) return saturation;
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) curve[i] = Math.tanh((i / 128 - 1) * 2.2);
  saturation = curve;
  return curve;
}

function handle(rig: Rig, g: GainNode, nodes: AudioScheduledSourceNode[], start: number, end: number): Voice {
  return {
    start,
    end,
    stop: (t: number) => {
      const at = Math.max(t, rig.ctx.currentTime);
      g.gain.cancelScheduledValues(at);
      g.gain.setTargetAtTime(0, at, 0.01);
      for (const n of nodes) {
        try {
          n.stop(at + 0.06);
        } catch {
          // Already stopped.
        }
      }
    },
  };
}

/** One melodic note on `sound`, into `dest`. `dur` is in seconds. */
export function playNote(rig: Rig, dest: AudioNode, sound: SoundId, pitch: number, vel: number, at: number, dur: number): Voice {
  if (sound === "drums") return playDrum(rig, dest, pitch, vel, at);
  const ctx = rig.ctx;
  const amp = 0.3 * (vel / 127) ** 1.4;
  const f = 440 * 2 ** ((pitch - 69) / 12);
  const g = ctx.createGain();
  g.gain.value = 0;
  g.connect(dest);
  const nodes: AudioScheduledSourceNode[] = [];
  const osc = (type: OscillatorType, freq: number, detune = 0, to: AudioNode = g) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(to);
    nodes.push(o);
    return o;
  };
  const lowpass = (freq: number, q = 0.7) => {
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
      osc("sine", f);
      const tine = ctx.createGain();
      tine.connect(g);
      tine.gain.setValueAtTime(0.35, at);
      tine.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
      osc("sine", f * 3, 0, tine);
      osc("triangle", f, 4);
      env.setValueAtTime(0, at);
      env.linearRampToValueAtTime(amp, at + 0.005);
      env.setTargetAtTime(amp * 0.35, at + 0.01, 0.6);
      release = 0.35;
      send = 0.3;
      break;
    }
    case "pluck": {
      const fl = lowpass(f * 8, 2);
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
      const fl = lowpass(1400, 0.5);
      for (const d of [-9, 0, 9]) osc("sawtooth", f, d, fl);
      env.setValueAtTime(0, at);
      env.linearRampToValueAtTime(amp * 0.42, at + 0.3);
      release = 0.8;
      send = 0.55;
      break;
    }
    case "strings": {
      const fl = lowpass(2600, 0.6);
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
      const fl = lowpass(Math.min(f * 6, 1400), 4);
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
      shaper.curve = satCurve();
      shaper.connect(g);
      const fr = f < 30 ? f * 2 : f;
      const o = osc("sine", fr, 0, shaper);
      o.frequency.setValueAtTime(fr * 2.2, at);
      o.frequency.exponentialRampToValueAtTime(fr, at + 0.045);
      env.setValueAtTime(0, at);
      env.linearRampToValueAtTime(amp * 1.5, at + 0.003);
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
    g.connect(s).connect(rig.reverb);
  }
  const end = at + hold + release;
  env.setTargetAtTime(0, at + hold, release / 4);
  for (const n of nodes) {
    n.start(at);
    n.stop(end + 0.1);
  }
  return handle(rig, g, nodes, at, end);
}

/** General MIDI drums from a sine, the noise buffer and filters. */
export function playDrum(rig: Rig, dest: AudioNode, pitch: number, vel: number, at: number): Voice {
  const ctx = rig.ctx;
  const amp = 0.3 * (vel / 127) ** 1.4;
  const g = ctx.createGain();
  g.connect(dest);
  const nodes: AudioScheduledSourceNode[] = [];
  const noise = (type: BiquadFilterType, freq: number, decay: number, level: number, q = 0.8, offset = 0) => {
    const src = ctx.createBufferSource();
    src.buffer = rig.noise;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = freq;
    fl.Q.value = q;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(level, at + offset);
    ng.gain.exponentialRampToValueAtTime(0.0008, at + offset + decay);
    src.connect(fl).connect(ng).connect(g);
    nodes.push(src);
    return offset + decay;
  };
  const tone = (from: number, to: number, drop: number, decay: number, level: number) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + drop);
    const og = ctx.createGain();
    og.gain.setValueAtTime(level, at);
    og.gain.exponentialRampToValueAtTime(0.0008, at + decay);
    o.connect(og).connect(g);
    nodes.push(o);
    return decay;
  };
  g.gain.value = amp * 2.2;
  let len: number;
  if (pitch === 35 || pitch === 36) len = Math.max(tone(160, 42, 0.07, 0.5, 1.2), noise("lowpass", 900, 0.02, 0.3));
  else if (pitch === 38 || pitch === 40) len = Math.max(tone(220, 170, 0.05, 0.12, 0.5), noise("bandpass", 2600, 0.2, 0.9, 0.6));
  else if (pitch === 39) len = Math.max(noise("bandpass", 1400, 0.01, 0.9, 0.8, 0), noise("bandpass", 1400, 0.01, 0.9, 0.8, 0.011), noise("bandpass", 1400, 0.18, 0.9, 0.8, 0.022));
  else if (pitch === 37) len = Math.max(tone(1700, 1600, 0.01, 0.04, 0.5), noise("highpass", 4000, 0.03, 0.4));
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
  return handle(rig, g, nodes, at, at + len);
}
