import json

import pytest
from jsonschema import ValidationError

from stash_worker.contracts import REPO_ROOT, is_valid, limits, validate

FIXTURES = REPO_ROOT / "fixtures"


def test_limits_load_with_build_spec_values():
    lim = limits()
    assert lim["loop"]["maxDurationMs"] == 60_000
    assert lim["kit"]["maxFiles"] == 300
    assert lim["worker"]["backoffSeconds"] == [30, 120, 600]


def test_loop_details_contract():
    good = {
        "sampleRate": 44100,
        "channels": 2,
        "loudnessLufs": -14.0,
        "truePeakDb": -1.0,
        "loopSamples": 302400,
        "bars": 4,
        "detection": {
            "bpmSource": "onset",
            "bpmAgreed": True,
            "bpmCandidates": [140],
            "keySource": "chroma",
            "keyConfidence": 0.3,
        },
    }
    validate("details.loop", good)
    bad = {**good, "loopSamples": 0}
    with pytest.raises(ValidationError):
        validate("details.loop", bad)


def test_worker_result_contract_requires_kit_samples_for_kits():
    base = {"bpm": None, "key": None, "durationMs": None, "files": [], "fingerprints": [], "flag": None}
    details = {"sampleCount": 1, "categoryCounts": {"kick": 1}, "ignoredCount": 0, "hasCover": False}
    kit = {**base, "type": "kit", "details": details}
    assert not is_valid("worker-result", kit)
    kit["kitSamples"] = [
        {
            "position": 0,
            "name": "Kick",
            "category": "kick",
            "durationMs": 400,
            "rootNote": None,
            "originalPath": "u/i/kit/kick.wav",
            "previewPath": "p/abc.mp3",
        }
    ]
    assert is_valid("worker-result", kit)


def test_every_manifest_fixture_exists():
    manifest = json.loads((FIXTURES / "manifest.json").read_text())
    missing = [f["path"] for f in manifest["fixtures"] if not (FIXTURES / f["path"]).exists()]
    assert missing == []


def test_fixture_set_covers_every_type_and_hostile_case():
    manifest = json.loads((FIXTURES / "manifest.json").read_text())["fixtures"]
    clean = [f for f in manifest if not f["hostile"] and "duplicateOf" not in f["expect"]]
    counts = {t: sum(1 for f in clean if f["type"] == t) for t in ("loop", "oneshot", "kit", "midi", "preset")}
    assert counts == {"loop": 5, "oneshot": 3, "kit": 2, "midi": 5, "preset": 5}
    reasons = {f["expect"]["reason"] for f in manifest if f["hostile"]}
    assert {"corrupt_file", "unsupported_format", "unsafe_archive", "no_notes", "too_long", "silent"} <= reasons


@pytest.mark.parametrize("path", sorted(p.name for p in (FIXTURES / "own").glob("*") if p.name != ".gitkeep"))
def test_own_fixtures_are_listed(path: str):
    manifest = json.loads((FIXTURES / "manifest.json").read_text())["fixtures"]
    assert any(f["path"].endswith(path) for f in manifest), f"fixtures/own/{path} is not in manifest.json"
