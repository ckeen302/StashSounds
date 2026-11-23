"""The runner against the real worker functions (claim_job, worker_complete, worker_fail,
requeue_stale_jobs) in a database built from the migrations. Skipped without Postgres; see conftest.py."""

from __future__ import annotations

import threading
import uuid
from pathlib import Path

import pytest

from stash_worker.contracts import is_valid, limits
from stash_worker.db import PgJobQueue, QueueRejected
from stash_worker.runner import Runner

WORKER = limits()["worker"]


def make_runner(db, tmp_path: Path, handler: str, queue: PgJobQueue | None = None) -> Runner:
    return Runner(
        queue or PgJobQueue(db.url),
        handlers={"process_loop": f"handlers:{handler}"},
        temp_root=tmp_path,
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
    assert list(tmp_path.iterdir()) == []


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
    assert list(tmp_path.iterdir()) == []


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


def test_a_result_the_database_refuses_is_retried(db, tmp_path: Path):
    # Passes the JSON Schema but worker_complete refuses it (a path outside the item's folder).
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
