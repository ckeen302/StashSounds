"""The runner's decisions, against an in-memory queue. test_runner_db.py repeats the important ones
against the real SQL functions."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest

from stash_worker.contracts import limits
from stash_worker.db import QueueRejected, QueueUnavailable
from stash_worker.jobs import timeout_for
from stash_worker.runner import Runner


class FakeQueue:
    def __init__(self, jobs: list[dict[str, Any]] | None = None):
        self.jobs = list(jobs or [])
        self.calls: list[tuple[Any, ...]] = []
        self.complete_error: Exception | None = None
        self.claim_error: Exception | None = None

    def claim(self) -> dict[str, Any] | None:
        self.calls.append(("claim",))
        if self.claim_error:
            raise self.claim_error
        return self.jobs.pop(0) if self.jobs else None

    def complete(self, job_id: str, result: dict[str, Any]) -> None:
        self.calls.append(("complete", job_id, result))
        if self.complete_error:
            raise self.complete_error

    def fail(self, job_id: str, reason: str, retryable: bool) -> None:
        self.calls.append(("fail", job_id, reason, retryable))

    def requeue_stale(self, older_than_s: float) -> int:
        self.calls.append(("requeue_stale", older_than_s))
        return 0

    def outcomes(self) -> list[tuple[Any, ...]]:
        return [c for c in self.calls if c[0] in ("complete", "fail")]


def job(kind: str = "process_loop", attempts: int = 1) -> dict[str, Any]:
    return {"id": uuid.uuid4(), "item_id": uuid.uuid4(), "kind": kind, "attempts": attempts, "status": "running"}


def runner(queue: FakeQueue, tmp_path: Path, handler: str, **kw: Any) -> Runner:
    return Runner(
        queue,
        handlers={"process_loop": f"handlers:{handler}"},
        temp_root=tmp_path,
        timeouts={"process_loop": kw.pop("timeout", 20)},
        memory_bytes=1 << 30,
        sleep=kw.pop("sleep", lambda s: None),
        **kw,
    )


def test_valid_result_is_completed_and_the_folder_removed(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    assert runner(q, tmp_path, "ok").run_once() is True
    [(call, job_id, result)] = q.outcomes()
    assert (call, job_id) == ("complete", str(j["id"]))
    assert result["files"][0]["path"] == f"{j['item_id']}/abc.mp3"
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    ("handler", "reason", "retryable"),
    [
        ("reject_corrupt", "corrupt_file", False),
        ("reject_unsupported", "unsupported_format", False),
        ("crash", "internal", True),
        ("raise_error", "internal", True),
        ("invalid_result", "internal", True),
        ("wrong_type_result", "internal", True),
    ],
)
def test_failures_map_to_worker_fail(tmp_path: Path, handler: str, reason: str, retryable: bool):
    j = job()
    q = FakeQueue([j])
    runner(q, tmp_path, handler).run_once()
    assert q.outcomes() == [("fail", str(j["id"]), reason, retryable)]
    assert list(tmp_path.iterdir()) == []


def test_timeout_is_retryable(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    runner(q, tmp_path, "sleep_with_grandchild", timeout=1).run_once()
    assert q.outcomes() == [("fail", str(j["id"]), "timeout", True)]
    assert list(tmp_path.iterdir()) == []


def test_a_kind_with_no_handler_fails_retryably(tmp_path: Path):
    j = job("process_midi")
    q = FakeQueue([j])
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [("fail", str(j["id"]), "internal", True)]


def test_a_job_past_its_attempts_fails_for_good_without_running(tmp_path: Path):
    # A job requeued as stale is claimed again with attempts beyond the limit.
    j = job(attempts=limits()["worker"]["maxAttempts"] + 1)
    q = FakeQueue([j])
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [("fail", str(j["id"]), "internal", False)]


def test_a_payload_that_breaks_the_contract_is_not_run(tmp_path: Path):
    j = {**job(), "kind": "process_everything"}
    q = FakeQueue([j])
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [("fail", str(j["id"]), "internal", False)]


def test_a_failing_complete_falls_back_to_a_retryable_fail(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    q.complete_error = QueueUnavailable("connection reset")
    runner(q, tmp_path, "ok").run_once()
    assert [c[0] for c in q.outcomes()] == ["complete", "fail"]
    assert q.outcomes()[1] == ("fail", str(j["id"]), "internal", True)


def test_a_conflict_on_complete_leaves_the_job_alone(tmp_path: Path):
    # "This job is not running": another worker may own it now, so the runner must not fail it.
    j = job()
    q = FakeQueue([j])
    q.complete_error = QueueRejected("conflict", "This job is not running.")
    runner(q, tmp_path, "ok").run_once()
    assert [c[0] for c in q.outcomes()] == ["complete"]


def test_empty_queue_backs_off_up_to_the_cap_and_resets_after_a_job(tmp_path: Path):
    slept: list[float] = []
    q = FakeQueue()
    r = runner(q, tmp_path, "ok", sleep=slept.append, idle_min_s=1, idle_max_s=8)
    ticks = iter(range(100))

    def stop_after(n: int):
        return lambda: next(ticks) >= n

    r.run(stop_after(6))
    assert slept == [1, 2, 4, 8, 8, 8]
    q.jobs.append(job())
    slept.clear()
    ticks = iter(range(100))
    r.run(stop_after(3))
    assert slept == [1, 2]  # the job ran without a sleep, then the backoff starts over


def test_database_outage_backs_off_and_keeps_running(tmp_path: Path):
    slept: list[float] = []
    q = FakeQueue()
    q.claim_error = QueueUnavailable("refused")
    r = runner(q, tmp_path, "ok", sleep=slept.append, idle_min_s=1, idle_max_s=4)
    ticks = iter(range(100))
    r.run(lambda: next(ticks) >= 4)
    assert slept == [1, 2, 4, 4]


def test_stale_jobs_are_requeued_on_a_schedule(tmp_path: Path):
    now = [0.0]
    q = FakeQueue()
    r = runner(q, tmp_path, "ok", clock=lambda: now[0], stale_every_s=60)
    for t in (0, 30, 61, 90, 125):
        now[0] = t
        r.run_once()
    stale = [c for c in q.calls if c[0] == "requeue_stale"]
    assert len(stale) == 3  # at 0, 61 and 125
    # Longer than any job may run, so a live job is never requeued under its worker.
    longest = max(limits()["worker"]["timeoutsSeconds"].values())
    assert all(c[1] > longest for c in stale)


def test_timeouts_come_from_limits():
    t = limits()["worker"]["timeoutsSeconds"]
    assert timeout_for("process_loop") == t["audio"]
    assert timeout_for("process_oneshot") == t["audio"]
    assert timeout_for("process_kit") == t["kit"]
    assert timeout_for("process_midi") == t["midi"]
    assert timeout_for("process_preset") == t["audio"]
    assert timeout_for("render_vital") == t["presetRender"]

