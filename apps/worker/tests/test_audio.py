"""The loop processor (ticket 112), called in-process on the fixture files. The sandbox and runner
tests cover how it is run; these cover what it produces."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

import pytest

from stash_worker.audio.ffmpeg import sniff
from stash_worker.audio.loop import process_loop
from stash_worker.contracts import REPO_ROOT, is_valid, limits
from stash_worker.jobs import JobContext, Rejected

FIXTURES = REPO_ROOT / "fixtures"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text())["fixtures"]
LOOPS = [f for f in MANIFEST if f["type"] == "loop" and not f["hostile"] and "loopSamples" in f["expect"]]
HOSTILE_LOOPS = [f for f in MANIFEST if f["type"] == "loop" and f["hostile"]]


def make_ctx(tmp_path: Path, fixture: str) -> JobContext:
    item, owner, file_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    work = tmp_path / "work"
    (work / "in").mkdir(parents=True)
    shutil.copy(FIXTURES / fixture, work / "in" / file_id)
    job_input = {
        "jobId": str(uuid.uuid4()),
        "attempt": 1,
        "itemId": item,
        "ownerId": owner,
        "type": "loop",
        "title": "Test loop",
        "files": [
            {
                "id": file_id,
                "role": "original",
                "bucket": "originals",
                "path": f"{owner}/{item}/original.{fixture.rsplit('.', 1)[-1]}",
                "bytes": (FIXTURES / fixture).stat().st_size,
                "mime": "audio/wav",
                "fileName": Path(fixture).name,
            }
        ],
    }
    payload = {"id": job_input["jobId"], "itemId": item, "kind": "process_loop", "attempts": 1}
    return JobContext(payload=payload, input=job_input, workdir=work)


def measure(path: Path) -> tuple[float, float]:
    """Integrated loudness (LUFS) and true peak (dBTP) of an audio file, by ffmpeg's ebur128."""
    out = subprocess.run(  # noqa: S603
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
    ).stderr
    summary = out[out.rindex("Summary:") :]
    integrated = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1))
    peak = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))
    return integrated, peak


def probe(path: Path) -> dict[str, Any]:
    out = subprocess.run(  # noqa: S603
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return json.loads(out)


def by_role(result: dict[str, Any], role: str) -> dict[str, Any]:
    [f] = [f for f in result["files"] if f["role"] == role]
    return f


def local(ctx: JobContext, f: dict[str, Any]) -> Path:
    return ctx.output_path(f["bucket"], f["path"])


@pytest.mark.parametrize(
    ("fixture", "fmt"),
    [
        ("generated/loops/midnight_keys_140bpm_Am.wav", "wav"),
        ("generated/loops/rnb_pad_72bpm_Ebmaj.aiff", "aiff"),
        ("generated/loops/drill_lead_142.flac", "flac"),
        ("generated/loops/trap_bells_150_F#m.mp3", "mp3"),
        ("generated/duplicates/midnight_keys_reencoded.mp3", "mp3"),
        ("generated/hostile/actually_an_exe.wav", None),
        ("generated/kits/kilo_808_pack.zip", None),
        ("generated/midi/808_bassline_140_Am.mid", None),
    ],
)
def test_the_type_comes_from_the_leading_bytes(fixture: str, fmt: str | None):
    assert sniff(FIXTURES / fixture) == fmt


def test_sniffing_ignores_the_extension_and_rejects_lookalikes(tmp_path: Path):
    flac_named_wav = tmp_path / "x.wav"
    flac_named_wav.write_bytes((FIXTURES / "generated/loops/drill_lead_142.flac").read_bytes())
    assert sniff(flac_named_wav) == "flac"
    for name, data in {
        "riff_avi": b"RIFF\x00\x00\x00\x00AVI LIST",
        "form_8svx": b"FORM\x00\x00\x00\x008SVX",
        "empty": b"",
        "short": b"fL",
        "text": b"hello world, not audio at all",
        "zip": b"PK\x03\x04" + b"\x00" * 26,
    }.items():
        p = tmp_path / name
        p.write_bytes(data)
        assert sniff(p) is None, name


@pytest.mark.parametrize("fixture", LOOPS, ids=lambda f: Path(f["path"]).name)
def test_every_loop_fixture_gives_the_expected_length_and_rate(tmp_path: Path, fixture: dict[str, Any]):
    ctx = make_ctx(tmp_path, fixture["path"])
    result = process_loop(ctx)
    assert is_valid("worker-result", result), result
    details = result["details"]
    assert details["loopSamples"] == fixture["expect"]["loopSamples"]
    assert details["sampleRate"] == fixture["expect"]["sampleRate"]
    assert result["durationMs"] == round(details["loopSamples"] * 1000 / details["sampleRate"])
    assert details["channels"] == probe(FIXTURES / fixture["path"])["streams"][0]["channels"]
    # Loudness of the original, as measured before normalizing.
    assert details["loudnessLufs"] is not None and -40 < details["loudnessLufs"] < 0
    assert details["truePeakDb"] is not None and details["truePeakDb"] <= 0.5
    # BPM and key (ticket 113) from the manifest; fingerprints are ticket 114.
    expect = fixture["expect"]
    assert (result["bpm"], result["key"], details["bars"]) == (expect["bpm"], expect["key"], expect["bars"])
    d = details["detection"]
    assert (d["bpmSource"], d["bpmAgreed"], d["keySource"]) == ("filename", True, expect["keySource"])
    assert d["bpmCandidates"][0] == expect["bpm"]
    assert (d["keyConfidence"] is None) == (expect["keySource"] == "filename")
    assert (result["fingerprints"], result["flag"]) == ([], None)


def test_the_file_name_comes_from_the_original_files_row(tmp_path: Path):
    # The stored path is "<owner>/<item>/original.wav"; the producer's name is on the row (fileName).
    ctx = make_ctx(tmp_path, "generated/loops/drill_lead_142.flac")
    ctx.input["files"][0]["fileName"] = "untitled.flac"
    result = process_loop(ctx)
    assert (result["bpm"], result["details"]["detection"]["bpmSource"]) == (142, "duration")
    ctx = make_ctx(tmp_path / "b", "generated/loops/drill_lead_142.flac")
    ctx.input["files"][0]["fileName"] = None
    assert process_loop(ctx)["details"]["detection"]["bpmSource"] == "duration"


@pytest.mark.parametrize("fixture", LOOPS, ids=lambda f: Path(f["path"]).name)
def test_the_preview_is_loudness_matched_mp3_under_500kb(tmp_path: Path, fixture: dict[str, Any]):
    ctx = make_ctx(tmp_path, fixture["path"])
    result = process_loop(ctx)
    preview = by_role(result, "preview")
    path = local(ctx, preview)
    assert preview["bucket"] == "previews" and preview["mime"] == "audio/mpeg"
    assert preview["bytes"] == path.stat().st_size < 500 * 1024
    info = probe(path)
    stream = info["streams"][0]
    assert (stream["codec_name"], int(stream["sample_rate"]), stream["channels"]) == ("mp3", 44100, 2)
    duration_ms = result["durationMs"]
    p = limits()["preview"]
    expected_kbps = p["loopBitrateKbpsShort"] if duration_ms <= p["loopShortMaxMs"] else p["loopBitrateKbpsLong"]
    assert int(stream["bit_rate"]) == expected_kbps * 1000
    integrated, true_peak = measure(path)
    target = limits()["loudness"]
    assert abs(integrated - target["targetLufs"]) <= 1.0
    assert true_peak <= target["truePeakDb"]


def test_peaks_are_800_bytes_from_the_mono_mix(tmp_path: Path):
    ctx = make_ctx(tmp_path, "generated/loops/midnight_keys_140bpm_Am.wav")
    result = process_loop(ctx)
    peaks = by_role(result, "peaks")
    data = local(ctx, peaks).read_bytes()
    assert len(data) == limits()["waveform"]["peakPoints"] == peaks["bytes"]
    assert base64.b64decode(peaks["meta"]["peaks"]) == data
    assert peaks["mime"] == "application/octet-stream" and peaks["bucket"] == "previews"
    assert max(data) > 200  # a -14 LUFS preview peaks near full scale
    assert len(set(data)) > 20  # a shape, not a flat line


def test_peaks_of_an_out_of_phase_stereo_file_are_flat(tmp_path: Path):
    # The mono mix of L and -L is silence, so the peaks are 0 even though each channel is loud.
    src = tmp_path / "phase.wav"
    subprocess.run(  # noqa: S603
        [  # noqa: S607
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:duration=2:sample_rate=44100",
            "-af",
            "pan=stereo|c0=c0|c1=-1*c0",
            "-c:a",
            "pcm_s16le",
            str(src),
        ],
        check=True,
    )
    fixture_copy = FIXTURES / "generated/loops/midnight_keys_140bpm_Am.wav"
    ctx = make_ctx(tmp_path, str(fixture_copy.relative_to(FIXTURES)))
    shutil.copy(src, ctx.workdir / "in" / ctx.input["files"][0]["id"])
    result = process_loop(ctx)
    assert max(local(ctx, by_role(result, "peaks")).read_bytes()) <= 2


def test_a_48khz_mono_loop_is_counted_at_44100_and_previewed_in_stereo(tmp_path: Path):
    # Two seconds at 48 kHz is 96000 frames; at 44.1 kHz it must be exactly 88200.
    src = tmp_path / "mono48k.wav"
    subprocess.run(  # noqa: S603
        [  # noqa: S607
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:duration=2:sample_rate=48000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(src),
        ],
        check=True,
    )
    assert probe(src)["streams"][0]["sample_rate"] == "48000"
    ctx = make_ctx(tmp_path, "generated/loops/midnight_keys_140bpm_Am.wav")
    shutil.copy(src, ctx.workdir / "in" / ctx.input["files"][0]["id"])
    result = process_loop(ctx)
    assert is_valid("worker-result", result), result
    details = result["details"]
    assert (details["loopSamples"], details["sampleRate"], details["channels"]) == (88200, 44100, 1)
    assert result["durationMs"] == 2000
    stream = probe(local(ctx, by_role(result, "preview")))["streams"][0]
    assert (int(stream["sample_rate"]), stream["channels"]) == (44100, 2)


def test_derived_files_have_content_hashed_names_under_the_item(tmp_path: Path):
    ctx = make_ctx(tmp_path, "generated/loops/dusty_soul_90_Dmin.wav")
    result = process_loop(ctx)
    item = ctx.input["itemId"]
    for f in result["files"]:
        data = local(ctx, f).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        assert f["sha256"] == digest
        assert f["path"].startswith(f"{item}/")
        assert digest[:32] in f["path"]
    assert {f["role"] for f in result["files"]} == {"preview", "peaks"}


def test_the_same_original_gives_the_same_outputs(tmp_path: Path):
    a = process_loop(make_ctx(tmp_path / "a", "generated/loops/midnight_keys_140bpm_Am.wav"))
    b = process_loop(make_ctx(tmp_path / "b", "generated/loops/midnight_keys_140bpm_Am.wav"))
    assert [f["sha256"] for f in a["files"]] == [f["sha256"] for f in b["files"]]
    assert a["details"] == b["details"]


@pytest.mark.parametrize("fixture", HOSTILE_LOOPS, ids=lambda f: Path(f["path"]).name)
def test_hostile_loop_fixtures_are_rejected_with_their_reason(tmp_path: Path, fixture: dict[str, Any]):
    ctx = make_ctx(tmp_path, fixture["path"])
    with pytest.raises(Rejected) as e:
        process_loop(ctx)
    assert e.value.reason == fixture["expect"]["reason"]
    assert not (ctx.workdir / "out").exists() or not any((ctx.workdir / "out").rglob("*.mp3"))


def test_a_format_allowed_for_other_types_but_not_loops_is_unsupported(tmp_path: Path, monkeypatch):
    monkeypatch.setitem(limits()["loop"], "formats", ["wav"])
    ctx = make_ctx(tmp_path, "generated/loops/drill_lead_142.flac")
    with pytest.raises(Rejected) as e:
        process_loop(ctx)
    assert e.value.reason == "unsupported_format"


def test_a_truncated_file_of_a_real_format_is_corrupt(tmp_path: Path):
    ctx = make_ctx(tmp_path, "generated/loops/drill_lead_142.flac")
    p = ctx.workdir / "in" / ctx.input["files"][0]["id"]
    p.write_bytes(p.read_bytes()[:64])
    with pytest.raises(Rejected) as e:
        process_loop(ctx)
    assert e.value.reason == "corrupt_file"
