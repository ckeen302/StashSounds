#!/usr/bin/env python3
"""
Generates synthetic test fixtures for the worker and end-to-end tests (ticket 006).

These are stand-ins with known, exact metadata. The build spec asks for the owner's own loops,
kits, MIDI and presets as well; those go in fixtures/own/ (see fixtures/README.md) and are added
to fixtures/manifest.json by hand.

    python3 scripts/gen-fixtures.py          # needs ffmpeg on PATH for the MP3 and AIFF/FLAC files

Output is deterministic, so re-running produces identical bytes apart from the encoders' own
metadata. Writes fixtures/generated/ and fixtures/manifest.json.
"""
from __future__ import annotations

import io
import json
import math
import random
import shutil
import struct
import subprocess
import wave
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fixtures" / "generated"
SR = 44100
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

manifest: list[dict] = []


def hz(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def write_wav(path: Path, frames: list[tuple[float, float]] | list[float], channels: int = 2, rate: int = SR) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        buf = bytearray()
        for f in frames:
            vals = f if isinstance(f, tuple) else (f,)
            for v in vals:
                buf += struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32000))
        w.writeframes(bytes(buf))



def fixed_entry(name: str, z: zipfile.ZipFile) -> zipfile.ZipInfo:
    """A zip entry with a fixed date and the archive's compression, so regenerating is byte-identical."""
    info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
    info.compress_type = z.compression
    return info

def chord_loop(bpm: float, bars: int, root_midi: int, minor: bool, seed: int) -> list[tuple[float, float]]:
    """A loop whose length is exactly `bars` bars of 4/4 at `bpm`, with a kick on every beat and a
    triad of the key, so BPM comes out of onsets and duration, and key out of chroma."""
    rng = random.Random(seed)
    beat = 60.0 / bpm
    n = round(bars * 4 * beat * SR)
    # i - VI - iv - v style movement inside the key, one chord per bar.
    degrees = [0, 8, 5, 7] if minor else [0, 9, 5, 7]
    out: list[tuple[float, float]] = []
    for i in range(n):
        t = i / SR
        bar = int(t / (4 * beat)) % len(degrees)
        r = root_midi + degrees[bar] - (12 if degrees[bar] > 7 else 0)
        # Diatonic triads: in major the vi chord is minor; in natural minor the VI chord is major.
        if minor:
            scale_third = 4 if degrees[bar] == 8 else 3
        else:
            scale_third = 3 if degrees[bar] == 9 else 4
        chord = [r, r + scale_third, r + 7]
        tone = sum(math.sin(2 * math.pi * hz(m) * t) for m in chord) / 3 * 0.25
        # kick on each beat: decaying 55 Hz sine
        tb = t % beat
        kick = math.sin(2 * math.pi * 55 * tb) * math.exp(-tb * 18) * 0.6
        # hat on off-beats
        th = (t + beat / 2) % beat
        hat = (rng.random() * 2 - 1) * math.exp(-th * 90) * 0.08
        s = tone + kick + hat
        out.append((s, s * 0.98))
    return out


def ffmpeg(src: Path, dst: Path, *args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), *args, str(dst)], check=True)


def add(path: Path, kind: str, expect: dict, hostile: bool = False) -> None:
    manifest.append({"path": str(path.relative_to(ROOT / "fixtures")), "type": kind, "hostile": hostile, "expect": expect})


# ---------------------------------------------------------------------------
# Loops: five, across formats. File names carry BPM and key the way producers write them.

LOOPS = [
    ("loops/midnight_keys_140bpm_Am.wav", 140, 4, 57, True, None, "filename"),
    ("loops/dusty_soul_90_Dmin.wav", 90, 2, 50, True, None, "filename"),
    ("loops/trap_bells_150_F#m.wav", 150, 4, 54, True, "mp3", "filename"),
    ("loops/rnb_pad_72bpm_Ebmaj.wav", 72, 2, 51, False, "aiff", "filename"),
    ("loops/drill_lead_142.wav", 142, 2, 55, True, "flac", "chroma"),   # no key in name: chroma has to find G minor
]
for rel, bpm, bars, root, minor, fmt, key_source in LOOPS:
    wav = OUT / rel
    write_wav(wav, chord_loop(bpm, bars, root, minor, seed=bpm))
    final = wav
    if fmt:
        final = wav.with_suffix({"mp3": ".mp3", "aiff": ".aiff", "flac": ".flac"}[fmt])
        codec = {"mp3": ["-codec:a", "libmp3lame", "-b:a", "256k"], "aiff": [], "flac": []}[fmt]
        ffmpeg(wav, final, *codec)
        wav.unlink()
    loop_samples = round(bars * 4 * 60 / bpm * SR)
    add(final, "loop", {
        "bpm": bpm, "bars": bars,
        "key": {"root": root % 12, "mode": "minor" if minor else "major"},
        "keySource": key_source,
        "loopSamples": loop_samples, "sampleRate": SR,
        "status": "ready",
    })

# Exact re-upload, trimmed copy and re-encoded copy of loop 1, for the duplicate checks.
src = OUT / "loops/midnight_keys_140bpm_Am.wav"
dup = OUT / "duplicates/midnight_keys_copy.wav"
dup.parent.mkdir(parents=True, exist_ok=True)
shutil.copy(src, dup)
add(dup, "loop", {"status": "flagged", "reason": "duplicate_exact", "duplicateOf": "generated/loops/midnight_keys_140bpm_Am.wav"})
ffmpeg(src, OUT / "duplicates/midnight_keys_trimmed.wav", "-ss", "0.25")
add(OUT / "duplicates/midnight_keys_trimmed.wav", "loop", {"status": "flagged", "reason": "duplicate_fingerprint", "duplicateOf": "generated/loops/midnight_keys_140bpm_Am.wav"})
ffmpeg(src, OUT / "duplicates/midnight_keys_reencoded.mp3", "-codec:a", "libmp3lame", "-b:a", "128k")
add(OUT / "duplicates/midnight_keys_reencoded.mp3", "loop", {"status": "flagged", "reason": "duplicate_fingerprint", "duplicateOf": "generated/loops/midnight_keys_140bpm_Am.wav"})

# ---------------------------------------------------------------------------
# One-shots: three.

def oneshot(kind: str, seconds: float, midi: int | None) -> list[float]:
    n = int(seconds * SR)
    rng = random.Random(midi or 7)
    out = []
    for i in range(n):
        t = i / SR
        if kind == "808":
            f = hz(midi) * (1 + 2 * math.exp(-t * 40))   # pitch drop into the note
            out.append(math.sin(2 * math.pi * f * t) * math.exp(-t * 1.2) * 0.9)
        elif kind == "snare":
            out.append(((rng.random() * 2 - 1) * 0.6 + math.sin(2 * math.pi * 190 * t) * 0.4) * math.exp(-t * 22))
        else:  # vocal-ish chop: vowel formants on a pitched buzz
            f0 = hz(midi)
            s = sum(math.sin(2 * math.pi * f0 * k * t) / k for k in range(1, 12))
            out.append(s * 0.15 * min(1, t * 40) * math.exp(-t * 3))
    return out

for rel, kind, secs, midi in [
    ("oneshots/808_long_F.wav", "808", 2.5, 29),
    ("oneshots/snare_crack.wav", "snare", 0.4, None),
    ("oneshots/vox_chop_A4.wav", "vocal", 0.8, 69),
]:
    write_wav(OUT / rel, oneshot(kind, secs, midi), channels=1)
    add(OUT / rel, "oneshot", {"rootNote": midi, "category": {"808": "808", "snare": "snare", "vocal": "vocal"}[kind], "status": "ready"})

# ---------------------------------------------------------------------------
# Drum kits: two ZIPs with folders, junk files and names to categorize.

def wav_bytes(frames: list[float]) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32000)) for v in frames))
    return b.getvalue()

def hit(freq: float, decay: float, noise: float, seconds: float, seed: int) -> list[float]:
    rng = random.Random(seed)
    return [((rng.random() * 2 - 1) * noise + math.sin(2 * math.pi * freq * i / SR) * (1 - noise)) * math.exp(-i / SR * decay)
            for i in range(int(seconds * SR))]

KITS = {
    "kits/nova_drum_kit_vol1.zip": {
        "Nova Kit Vol 1/Kicks/Kick Punchy.wav": ("kick", hit(60, 14, 0.05, 0.4, 1)),
        "Nova Kit Vol 1/Kicks/Kick Sub.wav": ("kick", hit(48, 8, 0.02, 0.6, 2)),
        "Nova Kit Vol 1/Snares/Snare Tight.wav": ("snare", hit(200, 25, 0.6, 0.3, 3)),
        "Nova Kit Vol 1/Claps/Clap Room.wav": ("clap", hit(900, 18, 0.9, 0.3, 4)),
        "Nova Kit Vol 1/Hats/HH Closed 01.wav": ("hat", hit(8000, 70, 0.95, 0.1, 5)),
        "Nova Kit Vol 1/Hats/OH Open.wav": ("open_hat", hit(8000, 12, 0.95, 0.5, 6)),
        "Nova Kit Vol 1/808s/808 Long C.wav": ("808", hit(32.7, 1.5, 0.0, 1.5, 7)),
        "Nova Kit Vol 1/Perc/Rim.wav": ("perc", hit(1700, 40, 0.3, 0.15, 8)),
        "Nova Kit Vol 1/FX/Riser.wav": ("fx", hit(400, 1, 0.5, 1.0, 9)),
        "Nova Kit Vol 1/readme.txt": (None, b"Thanks for downloading"),
        "Nova Kit Vol 1/.DS_Store": (None, b"\x00\x00\x00\x01Bud1"),
        "__MACOSX/Nova Kit Vol 1/._Kick Punchy.wav": (None, b"\x00\x05\x16\x07"),
    },
    "kits/kilo_808_pack.zip": {
        "808 Mafia Style Glide.wav": ("808", hit(36.7, 1.2, 0.0, 1.8, 10)),
        "808 Distorted.wav": ("808", hit(41.2, 1.8, 0.1, 1.2, 11)),
        "Bass 808 Short.wav": ("808", hit(43.7, 4, 0.0, 0.6, 12)),
        "kick hard.wav": ("kick", hit(58, 16, 0.08, 0.35, 13)),
        "Tom Low.wav": ("tom", hit(110, 9, 0.1, 0.5, 14)),
        "Crash.wav": ("cymbal", hit(6000, 3, 0.97, 1.2, 15)),
        "Vox Hey.wav": ("vocal", hit(330, 6, 0.3, 0.4, 16)),
        "Mystery thing.wav": ("other", hit(700, 6, 0.4, 0.3, 17)),
    },
}
for rel, files in KITS.items():
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, (cat, data) in files.items():
            z.writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), data if isinstance(data, bytes) else wav_bytes(data))
    samples = {n: c for n, (c, _) in files.items() if c}
    add(path, "kit", {"sampleCount": len(samples), "ignoredCount": len(files) - len(samples), "categories": samples, "status": "ready"})

# ---------------------------------------------------------------------------
# MIDI: five, written by hand so the generator needs no libraries.

def vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))

def midi_file(notes: list[tuple[float, float, int, int]], bpm: float | None, channel: int = 0, ppq: int = 480) -> bytes:
    events: list[tuple[int, bytes]] = []
    if bpm:
        us = round(60_000_000 / bpm)
        events.append((0, b"\xff\x51\x03" + us.to_bytes(3, "big")))
    events.append((0, b"\xff\x58\x04\x04\x02\x18\x08"))
    for start, length, pitch, vel in notes:
        events.append((round(start * ppq), bytes([0x90 | channel, pitch, vel])))
        events.append((round((start + length) * ppq), bytes([0x80 | channel, pitch, 0])))
    events.sort(key=lambda e: (e[0], e[1][0] & 0xF0 == 0x90))
    track = bytearray()
    last = 0
    for tick, data in events:
        track += vlq(tick - last) + data
        last = tick
    track += b"\x00\xff\x2f\x00"
    return b"MThd" + struct.pack(">IHHH", 6, 0, 1, ppq) + b"MTrk" + struct.pack(">I", len(track)) + bytes(track)

def chords(prog: list[list[int]], beats_each: float = 4) -> list[tuple[float, float, int, int]]:
    return [(i * beats_each, beats_each, p, 90) for i, ch in enumerate(prog) for p in ch]

MIDIS = [
    ("midi/sad_piano_chords_72bpm_C#m.mid", chords([[49, 52, 56], [57, 61, 64], [54, 57, 61], [56, 59, 63]]), 72, 0,
     {"kind": "chords", "bpm": 72, "bars": 4, "key": {"root": 1, "mode": "minor"}}),
    ("midi/bell_melody_150_F#m.mid", [(i * 0.5, 0.5, p, 80 + (i % 3) * 10) for i, p in enumerate([66, 69, 73, 71, 69, 66, 64, 66] * 4)], 150, 0,
     {"kind": "melody", "bpm": 150, "bars": 4, "key": {"root": 6, "mode": "minor"}}),
    ("midi/drill_drums_142.mid", [(i * 0.5, 0.25, 42, 90) for i in range(32)] + [(b * 4.0, 0.5, 36, 120) for b in range(4)] + [(b * 4.0 + 2, 0.5, 38, 110) for b in range(4)], 142, 9,
     {"kind": "drums", "bpm": 142, "bars": 4}),
    ("midi/808_bassline_140_Am.mid", [(i * 1.0, 0.9, p, 110) for i, p in enumerate([33, 33, 36, 31] * 4)], 140, 0,
     {"kind": "bass", "bpm": 140, "bars": 4, "key": {"root": 9, "mode": "minor"}}),
    ("midi/no_tempo_progression.mid", chords([[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]), None, 0,
     {"kind": "chords", "bpm": 120, "tempoAssumed": True, "bars": 4, "key": {"root": 0, "mode": "major"}}),
]
for rel, notes, bpm, ch, expect in MIDIS:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(midi_file(notes, bpm, channel=ch))
    add(p, "midi", {**expect, "noteCount": len(notes), "status": "ready"})

# ---------------------------------------------------------------------------
# Presets: three Vital (JSON) and two Serum (.fxp), each with a demo.

demo = OUT / "presets/demos/demo_glass_pad.wav"
write_wav(demo, chord_loop(90, 3, 57, True, seed=3))          # 8 s demo
for rel, name, category in [
    ("presets/vital/glass_pad.vital", "Glass Pad", "pad"),
    ("presets/vital/reese_bass.vital", "Reese Bass", "bass"),
    ("presets/vital/pluck_bell.vital", "Pluck Bell", "pluck"),
]:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"author": "Stash fixtures", "comments": "", "macro1": "MACRO 1", "preset_name": name,
                             "preset_style": category.capitalize(), "synth_version": "1.5.5",
                             "settings": {"osc_1_on": 1.0, "osc_1_level": 0.7, "filter_1_cutoff": 80.0, "wavetables": []}}, indent=2))
    add(p, "preset", {"synth": "vital", "synthVersion": "1.5.5", "category": category, "demo": "generated/presets/demos/demo_glass_pad.wav", "status": "ready"})

for rel, name in [("presets/serum/dark_lead.fxp", "Dark Lead"), ("presets/serum/sub_808.fxp", "Sub 808")]:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    body = name.encode().ljust(28, b"\x00") + bytes(random.Random(len(name)).getrandbits(8) for _ in range(512))
    header = b"CcnK" + struct.pack(">I", len(body) + 52) + b"FPCh" + struct.pack(">I", 1) + b"XfsX" + struct.pack(">II", 1, 1)
    p.write_bytes(header + body)
    add(p, "preset", {"synth": "serum", "category": "lead" if "lead" in rel else "bass", "demo": "generated/presets/demos/demo_glass_pad.wav", "status": "ready"})

# ---------------------------------------------------------------------------
# Hostile and broken files. Each must fail cleanly with the stated reason.

H = OUT / "hostile"
H.mkdir(parents=True, exist_ok=True)

(H / "corrupt.wav").write_bytes(b"RIFF\x24\x08\x00\x00WAVEfmt " + bytes(random.Random(1).getrandbits(8) for _ in range(4096)))
add(H / "corrupt.wav", "loop", {"status": "draft", "reason": "corrupt_file"}, hostile=True)

(H / "actually_an_exe.wav").write_bytes(b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 2048)
add(H / "actually_an_exe.wav", "loop", {"status": "draft", "reason": "unsupported_format"}, hostile=True)

write_wav(H / "silent_loop_120.wav", [(0.0, 0.0)] * (SR * 4))
add(H / "silent_loop_120.wav", "loop", {"status": "draft", "reason": "silent"}, hostile=True)

write_wav(H / "too_long_70s.wav", [math.sin(2 * math.pi * 220 * i / 8000) * 0.3 for i in range(8000 * 70)], channels=1, rate=8000)
add(H / "too_long_70s.wav", "loop", {"status": "draft", "reason": "too_long"}, hostile=True)

with zipfile.ZipFile(H / "zip_bomb.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr(fixed_entry("kick.wav", z), b"\x00" * (200 * 1024 * 1024))     # ratio far above maxCompressionRatio
add(H / "zip_bomb.zip", "kit", {"status": "draft", "reason": "unsafe_archive"}, hostile=True)

with zipfile.ZipFile(H / "path_traversal.zip", "w") as z:
    z.writestr(fixed_entry("../../etc/evil.wav", z), wav_bytes(hit(60, 14, 0.05, 0.2, 1)))
    z.writestr(fixed_entry("ok/kick.wav", z), wav_bytes(hit(60, 14, 0.05, 0.2, 1)))
add(H / "path_traversal.zip", "kit", {"status": "draft", "reason": "unsafe_archive"}, hostile=True)

inner = io.BytesIO()
with zipfile.ZipFile(inner, "w") as z:
    z.writestr(fixed_entry("kick.wav", z), wav_bytes(hit(60, 14, 0.05, 0.2, 1)))
with zipfile.ZipFile(H / "nested_archive.zip", "w") as z:
    z.writestr(fixed_entry("more_drums.zip", z), inner.getvalue())
    z.writestr(fixed_entry("snare.wav", z), wav_bytes(hit(200, 25, 0.6, 0.2, 3)))
add(H / "nested_archive.zip", "kit", {"status": "draft", "reason": "unsafe_archive"}, hostile=True)

with zipfile.ZipFile(H / "too_deep.zip", "w") as z:
    z.writestr(fixed_entry("a/b/c/d/e/f/kick.wav", z), wav_bytes(hit(60, 14, 0.05, 0.2, 1)))
add(H / "too_deep.zip", "kit", {"status": "draft", "reason": "unsafe_archive"}, hostile=True)

with zipfile.ZipFile(H / "no_audio.zip", "w") as z:
    z.writestr(fixed_entry("readme.txt", z), "nothing here")
    z.writestr(fixed_entry("cover.jpg", z), b"\xff\xd8\xff\xe0" + b"\x00" * 64)
add(H / "no_audio.zip", "kit", {"status": "draft", "reason": "no_audio_in_kit"}, hostile=True)

(H / "empty_notes.mid").write_bytes(midi_file([], 120))
add(H / "empty_notes.mid", "midi", {"status": "draft", "reason": "no_notes"}, hostile=True)

(H / "not_midi.mid").write_text("this is not a midi file\n")
add(H / "not_midi.mid", "midi", {"status": "draft", "reason": "corrupt_file"}, hostile=True)

(H / "huge_notes.mid").write_bytes(midi_file([(i * 0.01, 0.01, 60 + i % 12, 90) for i in range(20_001)], 120))
add(H / "huge_notes.mid", "midi", {"status": "draft", "reason": "too_many_notes"}, hostile=True)

(H / "broken.vital").write_text('{"preset_name": "Broken", "settings": ')
add(H / "broken.vital", "preset", {"status": "draft", "reason": "corrupt_file"}, hostile=True)

manifest.sort(key=lambda m: m["path"])
(ROOT / "fixtures" / "manifest.json").write_text(json.dumps({
    "$comment": "Expected worker results per fixture. generated/ is synthetic (scripts/gen-fixtures.py); own/ is the owner's real files.",
    "fixtures": manifest,
}, indent=2) + "\n")
print(f"wrote {len(manifest)} fixtures to {OUT}")
