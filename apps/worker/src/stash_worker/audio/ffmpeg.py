"""Audio through ffmpeg, run in the job's child process (build spec: Worker jobs, Loop).

Every call names its input demuxer (from `sniff`, never the extension or ffmpeg's own probing) and
allows only the file protocol, so a hostile file cannot steer ffmpeg to another demuxer, a playlist or
the network.
"""

from __future__ import annotations

import json
import re
import subprocess
from array import array
from dataclasses import dataclass
from pathlib import Path

from stash_worker.jobs import Rejected

SAMPLE_RATE = 44100
SILENCE_PEAK = 10 ** (-60 / 20)  # -60 dBFS
# The demuxer ffmpeg must use for each format sniff() names.
DEMUXERS = {"wav": "wav", "aiff": "aiff", "flac": "flac", "mp3": "mp3"}
# One thread per step: ffmpeg otherwise starts threads per core (12 for a FLAC decode on 4 cores), and
# every thread counts toward the job uid's RLIMIT_NPROC allowance. Results do not depend on it.
ONE_THREAD = ["-threads", "1"]
FFMPEG = ["ffmpeg", "-nostdin", "-hide_banner", "-filter_threads", "1", "-protocol_whitelist", "file"]


def sniff(path: Path) -> str | None:
    """The audio format from the file's leading bytes: wav, aiff, flac, mp3, or None."""
    with path.open("rb") as f:
        head = f.read(12)
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if len(head) >= 12 and head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
        return "aiff"
    if head[:4] == b"fLaC":
        return "flac"
    if head[:3] == b"ID3" and len(head) >= 10:
        return "mp3"
    # A bare MPEG audio frame: 11 sync bits, a valid version and layer III, a valid bitrate and rate.
    if len(head) >= 4 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        version, layer = (head[1] >> 3) & 0b11, (head[1] >> 1) & 0b11
        bitrate, rate = head[2] >> 4, (head[2] >> 2) & 0b11
        if version != 0b01 and layer == 0b01 and bitrate not in (0, 0b1111) and rate != 0b11:
            return "mp3"
    return None


class FfmpegFailed(Exception):
    pass


def _run(args: list[str], capture_stdout: bool = False) -> subprocess.CompletedProcess[bytes]:
    r = subprocess.run(  # noqa: S603 - fixed program, arguments built here
        FFMPEG + args, capture_output=True, check=False
    )
    if r.returncode != 0:
        raise FfmpegFailed(r.stderr.decode(errors="replace")[-500:])
    return r


def _input(path: Path, fmt: str) -> list[str]:
    return [*ONE_THREAD, "-f", DEMUXERS[fmt], "-i", f"file:{path}"]


def _raw_input(path: Path) -> list[str]:
    return [*ONE_THREAD, "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", f"file:{path}"]


@dataclass(frozen=True)
class Decoded:
    path: Path  # interleaved stereo float32 at SAMPLE_RATE
    frames: int
    channels: int  # of the original
    peak: float  # absolute sample peak, 0..1+


def channels_of(path: Path, fmt: str) -> int:
    r = subprocess.run(  # noqa: S603
        [  # noqa: S607
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-f",
            DEMUXERS[fmt],
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=channels",
            "-of",
            "json",
            f"file:{path}",
        ],
        capture_output=True,
        check=False,
    )
    if r.returncode != 0:
        raise Rejected("corrupt_file", "no audio stream")
    try:
        return int(json.loads(r.stdout)["streams"][0]["channels"])
    except (ValueError, KeyError, IndexError) as e:
        raise Rejected("corrupt_file", "no audio stream") from e


def decode(path: Path, fmt: str, dest: Path, max_ms: int) -> Decoded:
    """Decodes to 44.1 kHz stereo float, at most max_ms plus one second, so a long file costs little."""
    channels = channels_of(path, fmt)
    if not 1 <= channels <= 8:
        raise Rejected("unsupported_format", f"{channels} channels")
    try:
        _run(
            _input(path, fmt)
            + ["-map", "0:a:0", "-t", f"{(max_ms + 1000) / 1000:.3f}", "-ac", "2", "-ar", str(SAMPLE_RATE)]
            + [*ONE_THREAD, "-f", "f32le", "-c:a", "pcm_f32le", "-y", str(dest)]
        )
    except FfmpegFailed as e:
        raise Rejected("corrupt_file", "could not decode") from e
    size = dest.stat().st_size
    frames = size // 8
    if frames == 0:
        raise Rejected("corrupt_file", "no samples")
    peak = 0.0
    with dest.open("rb") as f:
        while chunk := f.read(1 << 22):
            a = array("f")
            a.frombytes(chunk[: len(chunk) // 4 * 4])
            if a:
                peak = max(peak, max(a), -min(a))
    return Decoded(dest, frames, channels, peak)


@dataclass(frozen=True)
class Loudness:
    integrated: float
    true_peak: float
    lra: float
    threshold: float
    offset: float


def _loudnorm_json(stderr: str) -> dict[str, str]:
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr)
    if not m:
        raise FfmpegFailed("no loudnorm measurement")
    return json.loads(m.group(0))


def measure(decoded: Decoded, target_lufs: float, true_peak_db: float) -> Loudness:
    """loudnorm's first pass over the decoded audio: the original's loudness, and the numbers the
    second pass needs."""
    r = _run(
        _raw_input(decoded.path)
        + ["-af", f"loudnorm=I={target_lufs}:TP={true_peak_db}:LRA=50:print_format=json"]
        + [*ONE_THREAD, "-f", "null", "-"]
    )
    d = _loudnorm_json(r.stderr.decode(errors="replace"))
    return Loudness(
        float(d["input_i"]),
        float(d["input_tp"]),
        float(d["input_lra"]),
        float(d["input_thresh"]),
        float(d["target_offset"]),
    )


def encode_preview(
    decoded: Decoded, loudness: Loudness, dest: Path, target_lufs: float, true_peak_db: float, kbps: int
) -> None:
    """Loudness-matched MP3: loudnorm's second pass (linear where the true-peak ceiling allows it),
    back to 44.1 kHz, then LAME at a constant bitrate."""
    ln = (
        f"loudnorm=I={target_lufs}:TP={true_peak_db}:LRA=50"
        f":measured_I={loudness.integrated}:measured_TP={loudness.true_peak}"
        f":measured_LRA={loudness.lra}:measured_thresh={loudness.threshold}:offset={loudness.offset}"
        ":linear=true"
    )
    _run(
        _raw_input(decoded.path)
        + ["-af", f"{ln},aresample={SAMPLE_RATE}", "-ar", str(SAMPLE_RATE), "-ac", "2"]
        + ["-map_metadata", "-1", *ONE_THREAD, "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-f", "mp3", "-y", str(dest)]
    )


def mono_peaks(path: Path, points: int) -> bytes:
    """`points` bytes: the absolute peak of each equal slice of the file's mono mix, 0..255."""
    r = _run(_input(path, "mp3") + ["-ac", "1", "-ar", str(SAMPLE_RATE), *ONE_THREAD, "-f", "f32le", "-"])
    samples = array("f")
    samples.frombytes(r.stdout[: len(r.stdout) // 4 * 4])
    n = len(samples)
    out = bytearray(points)
    for i in range(points):
        lo, hi = i * n // points, (i + 1) * n // points
        if hi > lo:
            s = samples[lo:hi]
            out[i] = min(255, round(max(max(s), -min(s)) * 255))
    return bytes(out)
