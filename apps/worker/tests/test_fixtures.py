"""The fixture set itself: every file is listed, and every hostile file is hostile in the way its
manifest entry says, checked with the standard library so the check does not depend on the worker
code it will later test."""

import json
import struct
import wave
import zipfile
from pathlib import Path

import pytest

from stash_worker.contracts import REPO_ROOT, limits

FIXTURES = REPO_ROOT / "fixtures"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text())["fixtures"]
BY_PATH = {f["path"]: f for f in MANIFEST}


def test_every_file_is_in_the_manifest():
    on_disk = {
        p.relative_to(FIXTURES).as_posix()
        for p in FIXTURES.rglob("*")
        if p.is_file() and p.name not in {".gitkeep", "manifest.json", "README.md"}
    }
    demos = {f["expect"]["demo"] for f in MANIFEST if "demo" in f["expect"]}
    assert sorted(on_disk - set(BY_PATH) - demos) == []
    assert sorted(d for d in demos if not (FIXTURES / d).exists()) == []


def _midi_note_ons(data: bytes) -> int:
    """Counts note-on events with velocity > 0 in a format 0/1 SMF. Raises on a malformed file."""
    if data[:4] != b"MThd":
        raise ValueError("not a midi file")
    pos, count = 14, 0
    while pos < len(data):
        if data[pos : pos + 4] != b"MTrk":
            raise ValueError("bad track")
        length = struct.unpack(">I", data[pos + 4 : pos + 8])[0]
        track, i, status = data[pos + 8 : pos + 8 + length], 0, 0
        while i < len(track):
            while track[i] & 0x80:  # delta time
                i += 1
            i += 1
            b = track[i]
            if b == 0xFF:
                i += 2
                n = 0
                while True:
                    c = track[i]
                    i += 1
                    n = (n << 7) | (c & 0x7F)
                    if not c & 0x80:
                        break
                i += n
                continue
            if b & 0x80:
                status, i = b, i + 1
            kind = status & 0xF0
            if kind == 0x90 and track[i + 1] > 0:
                count += 1
            i += 1 if kind in (0xC0, 0xD0) else 2
        pos += 8 + length
    return count


def _wav_duration_ms(path: Path) -> int:
    with wave.open(str(path)) as w:
        return int(w.getnframes() * 1000 / w.getframerate())


def _wav_peak(path: Path) -> int:
    with wave.open(str(path)) as w:
        frames = w.readframes(w.getnframes())
        width = w.getsampwidth()
    assert width == 2
    samples = struct.unpack(f"<{len(frames) // 2}h", frames)
    return max(abs(s) for s in samples)


def _zip_problem(path: Path) -> str | None:
    kit = limits()["kit"]
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        names = [i.filename for i in infos]
        if any(n.startswith("/") or ".." in Path(n).parts for n in names):
            return "traversal"
        if any(n.lower().endswith((".zip", ".rar", ".7z")) for n in names):
            return "nested"
        if any(len(Path(n).parts) > kit["maxFolderDepth"] + 1 for n in names):
            return "depth"
        packed = sum(i.compress_size for i in infos) or 1
        unpacked = sum(i.file_size for i in infos)
        if unpacked / packed > kit["maxCompressionRatio"] or unpacked > kit["maxUnpackedBytes"]:
            return "bomb"
        if not any(n.lower().endswith((".wav", ".aiff", ".aif", ".flac")) for n in names):
            return "no_audio"
    return None


HOSTILE = sorted(p for p, f in BY_PATH.items() if f["hostile"])


@pytest.mark.parametrize("rel", HOSTILE)
def test_hostile_fixture_is_hostile(rel: str):
    path = FIXTURES / rel
    reason = BY_PATH[rel]["expect"]["reason"]
    data = path.read_bytes()
    if reason == "unsupported_format":
        assert data[:4] != b"RIFF" and data[:2] == b"MZ"
    elif reason == "corrupt_file" and rel.endswith(".wav"):
        with pytest.raises((wave.Error, EOFError, struct.error)):
            _wav_peak(path)
    elif reason == "corrupt_file" and rel.endswith(".mid"):
        with pytest.raises((ValueError, IndexError, struct.error)):
            _midi_note_ons(data)
    elif reason == "corrupt_file" and rel.endswith(".vital"):
        with pytest.raises(ValueError):
            json.loads(data)
    elif reason == "no_notes":
        assert _midi_note_ons(data) == 0
    elif reason == "too_many_notes":
        assert _midi_note_ons(data) > limits()["midi"]["maxNotes"]
    elif reason == "too_long":
        assert _wav_duration_ms(path) > limits()["loop"]["maxDurationMs"]
    elif reason == "silent":
        assert _wav_peak(path) < 33  # below -60 dBFS
    elif reason == "unsafe_archive":
        assert _zip_problem(path) in {"traversal", "nested", "depth", "bomb"}
    elif reason == "no_audio_in_kit":
        assert _zip_problem(path) == "no_audio"
    else:
        pytest.fail(f"no check for reason {reason}")
