"""The loop processor (build spec: Worker jobs, Loop; tickets 112 and 113): decode, exact loop length,
loudness-matched MP3 preview, 800 waveform peaks, BPM and key. Fingerprints are ticket 114.

Runs in the job's child process. Reads the original from `ctx.input_path`, writes derived files to
`ctx.output_path`, and returns a worker result (contracts: workerResultSchema, details.loop).
"""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path
from typing import Any

import numpy as np

from stash_worker.audio.ffmpeg import SAMPLE_RATE, SILENCE_PEAK, decode, encode_preview, measure, mono_peaks, sniff
from stash_worker.audio.key import detect_key
from stash_worker.audio.tempo import detect_bpm
from stash_worker.contracts import limits
from stash_worker.jobs import JobContext, Rejected

HASH_CHARS = 32  # of the SHA-256, in derived file names


def preview_kbps(duration_ms: int) -> int:
    p = limits()["preview"]
    return int(p["loopBitrateKbpsShort"] if duration_ms <= p["loopShortMaxMs"] else p["loopBitrateKbpsLong"])


def _publish(ctx: JobContext, local: Path, role: str, ext: str, mime: str, meta: dict[str, Any]) -> dict[str, Any]:
    """Moves a finished file to its content-hashed name under the item's previews folder."""
    data = local.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    path = f"{ctx.input['itemId']}/{digest[:HASH_CHARS]}.{ext}"
    local.replace(ctx.output_path("previews", path))
    return {
        "role": role,
        "bucket": "previews",
        "path": path,
        "bytes": len(data),
        "mime": mime,
        "sha256": digest,
        "meta": meta,
    }


def process_loop(ctx: JobContext) -> dict[str, Any]:
    lim = limits()
    [original] = [f for f in ctx.input["files"] if f["role"] == "original"]
    src = ctx.input_path(original)

    fmt = sniff(src)
    if fmt is None or fmt not in lim["loop"]["formats"]:
        raise Rejected("unsupported_format", "not WAV, AIFF, FLAC or MP3 by its contents")

    max_ms = int(lim["loop"]["maxDurationMs"])
    decoded = decode(src, fmt, ctx.workdir / "decoded.f32", max_ms)
    duration_ms = round(decoded.frames * 1000 / SAMPLE_RATE)
    if decoded.frames * 1000 > max_ms * SAMPLE_RATE:
        raise Rejected("too_long", f"longer than {max_ms // 1000} s")
    if decoded.peak < SILENCE_PEAK:
        raise Rejected("silent", "peak below -60 dBFS")

    target = lim["loudness"]
    loudness = measure(decoded, target["targetLufs"], target["truePeakDb"])
    scratch = ctx.workdir / "scratch"
    scratch.mkdir(exist_ok=True)
    kbps = preview_kbps(duration_ms)
    preview_local = scratch / "preview.mp3"
    encode_preview(decoded, loudness, preview_local, target["targetLufs"], target["truePeakDb"], kbps)

    peaks = mono_peaks(preview_local, int(lim["waveform"]["peakPoints"]))
    peaks_local = scratch / "peaks.bin"
    peaks_local.write_bytes(peaks)

    # BPM and key from the original's decode, not the loudness-matched preview (ticket 113).
    stereo = np.fromfile(decoded.path, dtype="<f4", count=decoded.frames * 2).reshape(-1, 2)
    mono = stereo.mean(axis=1, dtype=np.float32)
    del stereo
    file_name = original.get("fileName")
    tempo = detect_bpm(mono, SAMPLE_RATE, file_name)
    key, key_source, key_confidence = detect_key(mono, SAMPLE_RATE, file_name)
    del mono
    decoded.path.unlink()

    preview = _publish(
        ctx,
        preview_local,
        "preview",
        "mp3",
        "audio/mpeg",
        {"bitrateKbps": kbps, "sampleRate": SAMPLE_RATE, "loudnessLufs": target["targetLufs"]},
    )
    peaks_file = _publish(
        ctx,
        peaks_local,
        "peaks",
        "peaks",
        "application/octet-stream",
        {"points": len(peaks), "peaks": base64.b64encode(peaks).decode()},
    )

    return {
        "type": "loop",
        "bpm": tempo.bpm,
        "key": key,
        "durationMs": duration_ms,
        "files": [preview, peaks_file],
        "fingerprints": [],
        "flag": None,
        "details": {
            "sampleRate": SAMPLE_RATE,
            "channels": decoded.channels,
            "loudnessLufs": round(loudness.integrated, 2),
            "truePeakDb": round(loudness.true_peak, 2),
            "loopSamples": decoded.frames,
            "bars": tempo.bars,
            "detection": {
                "bpmSource": tempo.source,
                "bpmAgreed": tempo.agreed,
                "bpmCandidates": tempo.candidates,
                "keySource": key_source,
                "keyConfidence": key_confidence,
            },
        },
    }
