"""The runner against the real worker functions (claim_job, worker_complete, worker_fail,
requeue_stale_jobs) in a database built from the migrations. Skipped without Postgres; see conftest.py."""

from __future__ import annotations

import base64
import threading
import uuid
from pathlib import Path
from typing import Any

import pytest

from stash_worker.contracts import is_valid, limits
from stash_worker.db import PgJobQueue, QueueRejected
from stash_worker.runner import Runner

WORKER = limits()["worker"]


def jobs_dir(tmp_path: Path) -> Path:
    d = tmp_path / "jobs"
    d.mkdir(exist_ok=True)
    return d


def make_runner(db, tmp_path: Path, handler: str, queue: PgJobQueue | None = None) -> Runner:
    return Runner(
        queue or PgJobQueue(db.url),
        storage=db.storage,
        handlers={"process_loop": handler if ":" in handler else f"handlers:{handler}"},
        temp_root=jobs_dir(tmp_path),
        timeouts={"process_loop": 20},
        memory_bytes=1 << 30,
        sleep=lambda s: None,
    )


def test_a_good_result_makes_the_item_ready(db, tmp_path: Path):
    it = db.queued_item()
    assert make_runner(db, tmp_path, "ok").run_once() is True
    assert db.job(it["job_id"])["status"] == "done"
    item = db.item(it["item_id"])
    assert item["status"] == "ready"
    assert item["details"]["bars"] == 4
    assert list(jobs_dir(tmp_path).iterdir()) == []


def test_retry_backs_off_30s_then_2min_and_the_final_failure_returns_the_item_to_draft(db, tmp_path: Path):
    it = db.queued_item()
    r = make_runner(db, tmp_path, "crash")
    waits = []
    for attempt in range(1, WORKER["maxAttempts"]):
        assert r.run_once() is True
        j = db.job(it["job_id"])
        assert (j["status"], j["attempts"], j["error"]) == ("queued", attempt, "internal")
        waits.append(float(j["wait_s"]))
        assert db.item(it["item_id"])["status"] == "processing"
        # Not claimable until the backoff has passed.
        assert r.run_once() is False
        db.make_due(it["job_id"])
    assert [round(w) for w in waits] == [30, 120]
    assert WORKER["backoffSeconds"][:2] == [30, 120]

    assert r.run_once() is True
    j = db.job(it["job_id"])
    assert (j["status"], j["attempts"], j["error"]) == ("failed", WORKER["maxAttempts"], "internal")
    item = db.item(it["item_id"])
    assert (item["status"], item["flagged_reason"]) == ("draft", "internal")
    assert list(jobs_dir(tmp_path).iterdir()) == []


def test_a_timeout_is_retried(db, tmp_path: Path):
    it = db.queued_item()
    r = make_runner(db, tmp_path, "sleep_with_grandchild")
    r.timeouts["process_loop"] = 1
    r.run_once()
    j = db.job(it["job_id"])
    assert (j["status"], j["error"]) == ("queued", "timeout")
    assert round(float(j["wait_s"])) == 30


def test_a_corrupt_file_fails_once_and_returns_to_draft_with_the_reason(db, tmp_path: Path):
    it = db.queued_item()
    make_runner(db, tmp_path, "reject_corrupt").run_once()
    j = db.job(it["job_id"])
    assert (j["status"], j["attempts"], j["error"]) == ("failed", 1, "corrupt_file")
    item = db.item(it["item_id"])
    assert (item["status"], item["flagged_reason"]) == ("draft", "corrupt_file")


def test_a_result_with_a_path_outside_the_item_is_retried(db, tmp_path: Path):
    # Passes the JSON Schema, but the parent refuses to publish it (worker_complete would refuse it too).
    it = db.queued_item()
    make_runner(db, tmp_path, "outside_folder").run_once()
    j = db.job(it["job_id"])
    assert (j["status"], j["error"]) == ("queued", "internal")


def test_two_workers_never_claim_the_same_job(db):
    jobs = {db.queued_item()["job_id"] for _ in range(6)}
    queues = [PgJobQueue(db.url) for _ in range(4)]
    barrier = threading.Barrier(len(queues))
    claimed: list[str] = []
    lock = threading.Lock()

    def worker(q: PgJobQueue) -> None:
        barrier.wait()
        while (row := q.claim()) is not None:
            with lock:
                claimed.append(str(row["id"]))

    threads = [threading.Thread(target=worker, args=(q,)) for q in queues]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert sorted(claimed) == sorted(jobs)
    assert len(claimed) == len(set(claimed))


def test_stale_running_jobs_are_requeued(db):
    it = db.queued_item()
    fresh = db.queued_item()
    q = PgJobQueue(db.url)
    claimed = {str(q.claim()["id"]), str(q.claim()["id"])}
    assert claimed == {it["job_id"], fresh["job_id"]}
    # The first worker died 20 minutes ago; the second is still within its time.
    db.q(
        "update public.processing_jobs set locked_at = now() - interval '20 minutes' where id = :i",
        i=uuid.UUID(it["job_id"]),
    )
    assert q.requeue_stale(660) == 1
    assert db.job(it["job_id"])["status"] == "queued"
    assert db.job(fresh["job_id"])["status"] == "running"
    again = q.claim()
    assert str(again["id"]) == it["job_id"] and again["attempts"] == 2


def test_the_runner_requeues_stale_jobs_before_claiming(db, tmp_path: Path):
    it = db.queued_item()
    PgJobQueue(db.url).claim()
    db.q(
        "update public.processing_jobs set locked_at = now() - interval '1 hour' where id = :i",
        i=uuid.UUID(it["job_id"]),
    )
    assert make_runner(db, tmp_path, "ok").run_once() is True
    assert db.job(it["job_id"])["status"] == "done"


def test_the_queue_reports_function_errors_with_their_code(db):
    q = PgJobQueue(db.url)
    with pytest.raises(QueueRejected) as e:
        q.fail(str(uuid.uuid4()), 1, "internal", True)
    assert e.value.code == "not_found"


def test_the_queue_acts_as_the_service_role(db):
    q = PgJobQueue(db.url)
    assert q._run("select current_user as u")[0]["u"] == "service_role"


def test_job_input_describes_the_claimed_job(db):
    it = db.queued_item(file_name="dusty keys 90bpm Amin.wav")
    q = PgJobQueue(db.url)
    row = q.claim()
    got = q.job_input(str(row["id"]), row["attempts"])
    assert is_valid("worker-job-input", got)
    assert (got["jobId"], got["attempt"], got["itemId"], got["ownerId"], got["type"]) == (
        it["job_id"],
        1,
        it["item_id"],
        it["owner"],
        "loop",
    )
    [f] = got["files"]
    assert (f["id"], f["role"], f["path"], f["fileName"]) == (
        it["file_id"],
        "original",
        it["path"],
        "dusty keys 90bpm Amin.wav",
    )


def test_the_handler_gets_the_job_input_through_the_runner(db, tmp_path: Path):
    it = db.queued_item(file_name="loop.wav")
    make_runner(db, tmp_path, "echo_input").run_once()
    item_file = db.q(
        "select meta from public.item_files where item_id = :i and role = 'preview'", i=uuid.UUID(it["item_id"])
    )[0]
    assert item_file["meta"]["input"]["files"][0]["fileName"] == "loop.wav"


def test_a_worker_that_lost_its_job_cannot_finish_it(db, tmp_path: Path):
    it = db.queued_item()
    old, new = PgJobQueue(db.url), PgJobQueue(db.url)
    first = old.claim()
    db.q(
        "update public.processing_jobs set locked_at = now() - interval '1 hour' where id = :i",
        i=uuid.UUID(it["job_id"]),
    )
    assert new.requeue_stale(660) == 1
    second = new.claim()
    assert (first["attempts"], second["attempts"]) == (1, 2)
    for call in (
        lambda: old.fail(it["job_id"], 1, "internal", True),
        lambda: old.job_input(it["job_id"], 1),
        lambda: old.complete(it["job_id"], 1, {"type": "loop"}),
    ):
        with pytest.raises(QueueRejected) as e:
            call()
        assert e.value.code == "conflict"
    assert db.job(it["job_id"])["status"] == "running"
    new.fail(it["job_id"], 2, "internal", True)
    assert db.job(it["job_id"])["status"] == "queued"


def test_a_loop_fixture_goes_from_queued_to_ready_with_its_preview_and_peaks(db, tmp_path: Path):
    from stash_worker.contracts import REPO_ROOT

    fixture = REPO_ROOT / "fixtures/generated/loops/midnight_keys_140bpm_Am.wav"
    it = db.queued_item(file_name=fixture.name, content=fixture.read_bytes())
    r = make_runner(db, tmp_path, "stash_worker.audio.loop:process_loop")
    r.timeouts.clear()
    assert r.run_once() is True
    assert db.job(it["job_id"])["status"] == "done"
    item = db.item(it["item_id"])
    assert item["status"] == "ready"
    assert (item["details"]["loopSamples"], item["details"]["sampleRate"]) == (302400, 44100)
    assert item["duration_ms"] == 6857
    # Ticket 113: BPM and key reach the row; the detection record stays in details.
    assert (float(item["bpm"]), item["key_root"], item["key_mode"]) == (140.0, 9, "minor")
    detection = item["details"]["detection"]
    assert (detection["bpmSource"], detection["bpmAgreed"], detection["keySource"]) == ("filename", True, "filename")
    files = db.q(
        "select role, bucket, path, bytes, sha256, meta from public.item_files where item_id = :i order by role",
        i=uuid.UUID(it["item_id"]),
    )
    assert [f["role"] for f in files] == ["original", "peaks", "preview"]
    for f in files[1:]:
        stored = db.storage.root / f["bucket"] / f["path"]
        assert stored.stat().st_size == f["bytes"]
        assert f["path"].startswith(it["item_id"] + "/") and f["sha256"][:32] in f["path"]
    peaks = files[1]
    assert peaks["meta"]["points"] == 800
    assert base64.b64decode(peaks["meta"]["peaks"]) == (db.storage.root / peaks["bucket"] / peaks["path"]).read_bytes()
    assert list(jobs_dir(tmp_path).iterdir()) == []


def test_a_hostile_loop_fixture_returns_the_item_to_draft_with_its_reason(db, tmp_path: Path):
    from stash_worker.contracts import REPO_ROOT

    fixture = REPO_ROOT / "fixtures/generated/hostile/actually_an_exe.wav"
    it = db.queued_item(content=fixture.read_bytes())
    make_runner(db, tmp_path, "stash_worker.audio.loop:process_loop").run_once()
    item = db.item(it["item_id"])
    assert (item["status"], item["flagged_reason"]) == ("draft", "unsupported_format")
    assert db.storage.uploads == []


# -- duplicate screening (ticket 114) ---------------------------------------------------------------

LOOP = "stash_worker.audio.loop:process_loop"


def process(db, tmp_path: Path, relative: str, owner: str | None = None) -> dict[str, Any]:
    from stash_worker.contracts import REPO_ROOT

    fixture = REPO_ROOT / "fixtures" / relative
    it = db.queued_item(
        ext=fixture.suffix.lstrip("."), file_name=fixture.name, content=fixture.read_bytes(), owner=owner
    )
    r = make_runner(db, tmp_path, LOOP)
    r.timeouts.clear()
    assert r.run_once() is True
    assert db.job(it["job_id"])["status"] == "done", db.job(it["job_id"])
    return {**it, **db.item(it["item_id"])}


def _manifest_duplicates() -> list[dict[str, Any]]:
    import json

    from stash_worker.contracts import REPO_ROOT

    manifest = json.loads((REPO_ROOT / "fixtures" / "manifest.json").read_text())["fixtures"]
    return [f for f in manifest if f["path"].startswith("generated/duplicates/")]


def test_a_processed_original_keeps_its_sha256_and_fingerprint(db, tmp_path: Path):
    import hashlib

    from stash_worker.contracts import REPO_ROOT

    original = "generated/loops/midnight_keys_140bpm_Am.wav"
    it = process(db, tmp_path, original)
    assert it["status"] == "ready"
    [f] = db.q(
        "select id, sha256, meta from public.item_files where item_id = :i and role = 'original'",
        i=uuid.UUID(it["item_id"]),
    )
    assert f["sha256"] == hashlib.sha256((REPO_ROOT / "fixtures" / original).read_bytes()).hexdigest()
    assert f["meta"]["fileName"] == "midnight_keys_140bpm_Am.wav"  # the original's meta is untouched
    [fp] = db.q(
        "select item_file_id, duration_ms, cardinality(chromaprint) as n from public.fingerprints where item_id = :i",
        i=uuid.UUID(it["item_id"]),
    )
    assert (fp["item_file_id"], fp["duration_ms"]) == (f["id"], 6857)
    assert fp["n"] >= 30


@pytest.mark.parametrize("dup", _manifest_duplicates(), ids=lambda f: Path(f["path"]).name)
def test_each_duplicate_fixture_is_flagged_after_its_original(db, tmp_path: Path, dup: dict[str, Any]):
    assert process(db, tmp_path, dup["expect"]["duplicateOf"])["status"] == "ready"
    it = process(db, tmp_path, dup["path"])
    assert (it["status"], it["flagged_reason"]) == (dup["expect"]["status"], dup["expect"]["reason"])
    assert it["details"]["loopSamples"] > 0  # still processed, for the owner and admins to review
    [n] = db.q("select count(*) as n from public.notifications where item_id = :i and kind = 'flag'", i=uuid.UUID(it["item_id"]))
    assert n["n"] == 1


def test_the_same_user_re_uploading_their_own_loop_is_flagged_too(db, tmp_path: Path):
    first = process(db, tmp_path, "generated/loops/midnight_keys_140bpm_Am.wav")
    again = process(db, tmp_path, "generated/duplicates/midnight_keys_copy.wav", owner=first["owner"])
    assert (again["status"], again["flagged_reason"]) == ("flagged", "duplicate_exact")
    trimmed = process(db, tmp_path, "generated/duplicates/midnight_keys_trimmed.wav", owner=first["owner"])
    assert (trimmed["status"], trimmed["flagged_reason"]) == ("flagged", "duplicate_fingerprint")


def test_different_loops_are_not_duplicates_of_each_other(db, tmp_path: Path):
    for loop in ("midnight_keys_140bpm_Am.wav", "dusty_soul_90_Dmin.wav", "rnb_pad_72bpm_Ebmaj.aiff", "trap_bells_150_F#m.mp3"):
        it = process(db, tmp_path, f"generated/loops/{loop}")
        assert (it["status"], it["flagged_reason"]) == ("ready", None), loop


def test_a_draft_is_not_screened_against(db, tmp_path: Path):
    # A hostile upload that failed back to draft does not make the next upload a duplicate; neither does
    # an original of an item that never finished.
    original = "generated/loops/midnight_keys_140bpm_Am.wav"
    first = process(db, tmp_path, original)
    db.q("update public.items set status = 'draft' where id = :i", i=uuid.UUID(first["item_id"]))
    assert process(db, tmp_path, original)["status"] == "ready"


def test_the_lookup_is_fenced_to_the_claimed_attempt_and_its_own_original(db):
    from stash_worker.db import PgJobQueue

    it = db.queued_item()
    q = PgJobQueue(db.url)
    job = q.claim()
    sha = "0" * 64
    with pytest.raises(QueueRejected) as e:
        q.duplicate_candidates(it["job_id"], job["attempts"] + 1, it["file_id"], sha, None, None)
    assert e.value.code == "conflict"
    other = db.queued_item()
    with pytest.raises(QueueRejected) as e:
        q.duplicate_candidates(it["job_id"], job["attempts"], other["file_id"], sha, None, None)
    assert e.value.code == "invalid"
    assert q.duplicate_candidates(it["job_id"], job["attempts"], it["file_id"], sha, None, None) == []
    q.close()
