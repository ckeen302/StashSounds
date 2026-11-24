/**
 * An offline time stretch and pitch shift for "download as heard": WSOLA (overlap-add of windowed
 * frames, each placed where it lines up best with the last) to change the length, then a resample to
 * move the pitch. Slower and rougher than the player's real-time stretch, fine for a demo file.
 */

const N = 2048;
const HS = N / 4;
const TOL = 384;

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** Channels stretched to `scale` times their length, pitch kept. */
function wsola(chs: Float32Array<ArrayBuffer>[], scale: number): Float32Array<ArrayBuffer>[] {
  const len = chs[0]!.length;
  const outLen = Math.max(1, Math.round(len * scale));
  const out = chs.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const w = hann(N);
  const mono = new Float32Array(len);
  for (const c of chs) for (let i = 0; i < len; i++) mono[i]! += c[i]! / chs.length;
  const ha = HS / scale;
  let prev = 0;
  for (let k = 0; k * HS < outLen; k++) {
    const nominal = Math.round(k * ha);
    let pos = Math.min(Math.max(0, nominal), Math.max(0, len - N));
    if (k > 0) {
      // The natural continuation of the last frame, and the offset near nominal that matches it best.
      const want = prev + HS;
      let best = -Infinity;
      for (let d = -TOL; d <= TOL; d += 4) {
        const p = nominal + d;
        if (p < 0 || p + N > len || want + N > len) continue;
        let sum = 0;
        for (let i = 0; i < N / 2; i += 4) sum += mono[p + i]! * mono[want + i]!;
        if (sum > best) {
          best = sum;
          pos = p;
        }
      }
    }
    prev = pos;
    const at = k * HS;
    for (let i = 0; i < N && pos + i < len; i++) {
      norm[at + i]! += w[i]!;
      for (let c = 0; c < chs.length; c++) out[c]![at + i]! += chs[c]![pos + i]! * w[i]!;
    }
  }
  return out.map((o) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i]! > 1e-3 ? o[i]! / norm[i]! : 0;
    return r;
  });
}

/** Linear-interpolated resample: `factor` > 1 is shorter and higher. */
function resample(ch: Float32Array<ArrayBuffer>, factor: number): Float32Array<ArrayBuffer> {
  const outLen = Math.max(1, Math.floor(ch.length / factor));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * factor;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (ch[j] ?? 0) * (1 - f) + (ch[j + 1] ?? 0) * f;
  }
  return out;
}

/** The buffer reversed, then at `tempoRatio` times the speed and `semitones` higher. */
export function renderAsHeard(buf: AudioBuffer, o: { tempoRatio: number; semitones: number; reverse: boolean; seconds?: number }): AudioBuffer {
  const sr = buf.sampleRate;
  const n = Math.min(buf.length, o.seconds ? Math.round(o.seconds * sr) : buf.length);
  let chs: Float32Array<ArrayBuffer>[] = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice(0, n));
  if (o.reverse) chs = chs.map((c) => c.reverse());
  const pitch = 2 ** (o.semitones / 12);
  // Stretch to (pitch / tempo) times the length, then resample by pitch: length / tempo, pitch moved.
  const scale = pitch / o.tempoRatio;
  if (Math.abs(scale - 1) > 1e-3) chs = wsola(chs, scale);
  if (Math.abs(pitch - 1) > 1e-3) chs = chs.map((c) => resample(c, pitch));
  const out = new AudioBuffer({ length: chs[0]!.length, numberOfChannels: chs.length, sampleRate: sr });
  chs.forEach((c, i) => out.copyToChannel(c, i));
  return out;
}

/** Reversed copy. */
export function reversedBuffer(buf: AudioBuffer): AudioBuffer {
  return renderAsHeard(buf, { tempoRatio: 1, semitones: 0, reverse: true });
}
