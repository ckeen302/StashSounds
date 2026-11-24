import { limits } from "@stash/contracts";
import { decode } from "../kits/store";

/**
 * The checks an audio upload goes through before it can be posted, using the same limits the app
 * and the worker share (packages/contracts/limits.json). A "fail" rejects the file with its reason;
 * a "warn" lets it through but tells the producer what to fix.
 */

export type Verdict = "pass" | "warn" | "fail";
export type Check = { label: string; verdict: Verdict; detail: string };
export type AudioKind = "loop" | "oneshot";

export type AudioReport = {
  id: string;
  fileName: string;
  ext: string;
  bytes: number;
  durationMs: number;
  bpm: number | null;
  key: string | null;
  checks: Check[];
  accepted: boolean;
  data: ArrayBuffer | null;
};

const ALIAS: Record<string, string> = { wave: "wav", aif: "aiff" };

export function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/** "320 KB", "4.2 MB". */
export function sizeText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function secondsText(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.round(ms)} ms`;
}

/** "Dark_Piano_140bpm_Cm.wav" -> 140. Only values in the range a file name plausibly means. */
export function bpmFromName(name: string): number | null {
  const words = name.replace(/\.[a-z0-9]+$/i, "").split(/[\s_\-.()[\]]+/);
  for (const w of words) {
    const m = /^(\d{2,3})(?:bpm)?$/i.exec(w);
    if (m) {
      const n = Number(m[1]);
      if (n >= limits.bpm.fileNameMin && n <= limits.bpm.fileNameMax) return n;
    }
  }
  return null;
}

/** "piano_Cm_140.wav" -> "C minor", "F#maj" -> "F# major". */
export function keyFromName(name: string): string | null {
  const words = name.replace(/\.[a-z0-9]+$/i, "").split(/[\s_\-.()[\]]+/);
  for (const w of words) {
    const m = /^([A-G][#b]?)(m|min|minor|maj|major)$/.exec(w);
    if (m) return `${m[1]} ${m[2]!.startsWith("maj") ? "major" : "minor"}`;
  }
  return null;
}

function level(buf: AudioBuffer): { peak: number; rms: number; leadMs: number } {
  let peak = 0;
  let sum = 0;
  let first = -1;
  const n = buf.length;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const a = Math.abs(d[i]!);
      if (a > peak) peak = a;
      sum += a * a;
      if (first < 0 && a > 0.01) first = i;
      else if (a > 0.01 && i < first) first = i;
    }
  }
  return { peak, rms: Math.sqrt(sum / (n * buf.numberOfChannels || 1)), leadMs: first < 0 ? 0 : (first / buf.sampleRate) * 1000 };
}

let seq = 0;

export async function checkAudio(file: File, kind: AudioKind): Promise<AudioReport> {
  const spec = limits[kind];
  const rawExt = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? "").toLowerCase();
  const ext = ALIAS[rawExt] ?? rawExt;
  const checks: Check[] = [];
  const report: AudioReport = { id: `u${Date.now().toString(36)}${seq++}`, fileName: file.name, ext, bytes: file.size, durationMs: 0, bpm: null, key: null, checks, accepted: false, data: null };
  const done = () => {
    report.accepted = !checks.some((c) => c.verdict === "fail");
    return report;
  };

  const formats = spec.formats.join(", ");
  if (!spec.formats.includes(ext)) {
    checks.push({
      label: "Format",
      verdict: "fail",
      detail:
        kind === "oneshot" && ext === "mp3"
          ? "MP3 isn't taken for one-shots: hits are posted lossless. Export it as wav, aiff or flac."
          : `.${rawExt || "?"} isn't taken here. Use ${formats}.`,
    });
    return done();
  }
  checks.push({ label: "Format", verdict: "pass", detail: `.${rawExt}` });

  if (file.size > spec.maxBytes) {
    checks.push({ label: "Size", verdict: "fail", detail: `${mb(file.size)} is over the ${mb(spec.maxBytes)} limit.` });
    return done();
  }
  checks.push({ label: "Size", verdict: "pass", detail: `${sizeText(file.size)} of ${mb(spec.maxBytes)}` });

  let buf: AudioBuffer;
  try {
    const data = await file.arrayBuffer();
    buf = await decode(data);
    report.data = data;
  } catch {
    checks.push({ label: "Readable", verdict: "fail", detail: "The audio couldn't be read. The file may be damaged or in a codec browsers don't play; re-export it." });
    return done();
  }
  const ms = Math.round(buf.duration * 1000);
  report.durationMs = ms;

  const minMs = kind === "loop" ? 1000 : 20;
  if (ms > spec.maxDurationMs) {
    checks.push({
      label: "Length",
      verdict: "fail",
      detail: kind === "oneshot" ? `${secondsText(ms)} is too long for a one-shot (up to ${secondsText(spec.maxDurationMs)}). Post it as a loop.` : `${secondsText(ms)} is over the ${secondsText(spec.maxDurationMs)} limit. Trim it to the loop.`,
    });
  } else if (ms < minMs) {
    checks.push({ label: "Length", verdict: "fail", detail: kind === "loop" ? `${secondsText(ms)} is too short for a loop. Post it as a one-shot.` : "It's empty." });
  } else checks.push({ label: "Length", verdict: "pass", detail: secondsText(ms) });

  const lv = level(buf);
  if (lv.rms < 0.0015) {
    checks.push({ label: "Signal", verdict: "fail", detail: "It's silent or almost silent." });
    return done();
  }
  if (lv.peak >= 0.999) checks.push({ label: "Headroom", verdict: "warn", detail: `It peaks at 0 dB and may clip. Leave about ${Math.abs(limits.loudness.truePeakDb)} dB of headroom.` });
  else checks.push({ label: "Headroom", verdict: "pass", detail: `Peaks at ${(20 * Math.log10(lv.peak)).toFixed(1)} dB` });

  const leadLimit = kind === "oneshot" ? 15 : 30;
  if (lv.leadMs > leadLimit)
    checks.push({ label: "Start", verdict: "warn", detail: `Starts with ${Math.round(lv.leadMs)} ms of silence, so it will hit late. Trim the front.` });
  else checks.push({ label: "Start", verdict: "pass", detail: "Starts on the hit" });

  if (kind === "loop") {
    report.bpm = bpmFromName(file.name);
    report.key = keyFromName(file.name);
    if (report.bpm) {
      const bars = (buf.duration * report.bpm) / 240;
      const whole = Math.max(1, Math.round(bars));
      if (Math.abs(bars - whole) / whole <= 0.02) checks.push({ label: "Bars", verdict: "pass", detail: `${whole} bars at ${report.bpm} BPM` });
      else checks.push({ label: "Bars", verdict: "warn", detail: `${bars.toFixed(2)} bars at ${report.bpm} BPM, so it won't loop cleanly. Cut it to whole bars, or fix the BPM below.` });
    } else checks.push({ label: "BPM", verdict: "warn", detail: "No BPM in the file name. Enter it below; a loop can't post without one." });
    if (!report.key) checks.push({ label: "Key", verdict: "warn", detail: "No key in the file name. Add it below if it has one (drums don't)." });
    else checks.push({ label: "Key", verdict: "pass", detail: report.key });
  }
  return done();
}

/** Tags as typed ("dark, piano, 140") checked against the shared limits; returns the clean list or the problem. */
export function readTags(text: string): { tags: string[]; error?: string } {
  const tags = [...new Set(text.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (tags.length === 0) return { tags, error: "Add at least one tag, so people can find it." };
  if (tags.length > limits.tags.perItem) return { tags, error: `Up to ${limits.tags.perItem} tags.` };
  const bad = tags.find((t) => t.length < limits.tags.minLength || t.length > limits.tags.maxLength);
  if (bad) return { tags, error: `“${bad}” must be ${limits.tags.minLength} to ${limits.tags.maxLength} characters.` };
  return { tags };
}
