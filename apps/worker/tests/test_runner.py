"""The runner's decisions, against an in-memory queue. test_runner_db.py repeats the important ones
against the real SQL functions."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import pytest

import stash_worker.runner as runner_module
from stash_worker.contracts import CONTRACTS, limits, worker_reasons
from stash_worker.db import QueueRejected, QueueUnavailable
from stash_worker.jobs import FLAG_REASONS, ITEM_TYPE_FOR_KIND, RUNNER_REASONS, TIMEOUT_KEYS, timeout_for
from stash_worker.runner import Runner
from stash_worker.sandbox import Outcome
from stash_worker.storage import IMMUTABLE, LocalStorage, StorageError

JOB_KINDS = json.loads((CONTRACTS / "generated" / "job-payload.schema.json").read_text())["properties"]["kind"]["enum"]


ORIGINAL = b"0123456789"


def job_input(row: dict[str, Any], storage: LocalStorage | None = None) -> dict[str, Any]:
    owner = str(uuid.uuid4())
    path = f"{owner}/{row['item_id']}/original.wav"
    if storage is not None:
        src = storage.root / ".src"
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_bytes(ORIGINAL)
        storage.upload("originals", path, src, "audio/wav", None)
        src.unlink()
        storage.uploads.clear()
    return {
        "jobId": str(row["id"]),
        "attempt": row["attempts"],
        "itemId": str(row["item_id"]),
        "ownerId": owner,
        "type": ITEM_TYPE_FOR_KIND[row["kind"]] if row["kind"] in ITEM_TYPE_FOR_KIND else "loop",
        "title": "Dusty keys",
        "files": [
            {
                "id": str(uuid.uuid4()),
                "role": "original",
                "bucket": "originals",
                "path": path,
                "bytes": len(ORIGINAL),
                "mime": "audio/wav",
                "fileName": "dusty keys 90bpm Amin.wav",
            }
        ],
    }


class FakeQueue:
    def __init__(self, jobs: list[dict[str, Any]] | None = None, storage: LocalStorage | None = None):
        self.jobs = list(jobs or [])
        self.storage = storage
        self.calls: list[tuple[Any, ...]] = []
        self.complete_error: Exception | None = None
        self.fail_error: Exception | None = None
        self.claim_error: Exception | None = None
        self.input_error: Exception | None = None
        self.input_override: dict[str, Any] | None = None
        self.claimed: dict[str, dict[str, Any]] = {}
        self.last_input: dict[str, Any] | None = None

    def claim(self) -> dict[str, Any] | None:
        self.calls.append(("claim",))
        if self.claim_error:
            raise self.claim_error
        if not self.jobs:
            return None
        row = self.jobs.pop(0)
        self.claimed[str(row["id"])] = row
        return row

    def job_input(self, job_id: str, attempt: int) -> dict[str, Any]:
        self.calls.append(("job_input", job_id, attempt))
        if self.input_error:
            raise self.input_error
        self.last_input = self.input_override or job_input(self.claimed[job_id], self.storage)
        return self.last_input

    def complete(self, job_id: str, attempt: int, result: dict[str, Any]) -> None:
        self.calls.append(("complete", job_id, attempt, result))
        if self.complete_error:
            raise self.complete_error

    def fail(self, job_id: str, attempt: int, reason: str, retryable: bool) -> None:
        self.calls.append(("fail", job_id, attempt, reason, retryable))
        if self.fail_error:
            raise self.fail_error

    def requeue_stale(self, older_than_s: float) -> int:
        self.calls.append(("requeue_stale", older_than_s))
        return 0

    def outcomes(self) -> list[tuple[Any, ...]]:
        return [c for c in self.calls if c[0] in ("complete", "fail")]


def job(kind: str = "process_loop", attempts: int = 1) -> dict[str, Any]:
    return {"id": uuid.uuid4(), "item_id": uuid.uuid4(), "kind": kind, "attempts": attempts, "status": "running"}


def store(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path / "store")


def jobs_dir(tmp_path: Path) -> Path:
    d = tmp_path / "jobs"
    d.mkdir(exist_ok=True)
    return d


def runner(queue: FakeQueue, tmp_path: Path, handler: str, **kw: Any) -> Runner:
    if queue.storage is None:
        queue.storage = store(tmp_path)
    return Runner(
        queue,
        storage=queue.storage,
        handlers={"process_loop": f"handlers:{handler}"},
        temp_root=jobs_dir(tmp_path),
        timeouts={"process_loop": kw.pop("timeout", 20)},
        memory_bytes=kw.pop("memory_bytes", 1 << 30),
        sleep=kw.pop("sleep", lambda s: None),
        **kw,
    )


def fail(j: dict[str, Any], reason: str, retryable: bool) -> tuple[Any, ...]:
    return ("fail", str(j["id"]), j["attempts"], reason, retryable)


def test_valid_result_is_completed_with_the_attempt_and_the_folder_removed(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    assert runner(q, tmp_path, "ok").run_once() is True
    [(call, job_id, attempt, result)] = q.outcomes()
    assert (call, job_id, attempt) == ("complete", str(j["id"]), 1)
    assert result["type"] == "loop" and result["details"]["loopSamples"] == 302400
    assert list(jobs_dir(tmp_path).iterdir()) == []


def test_the_handler_receives_the_job_input(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    runner(q, tmp_path, "echo_input").run_once()
    [(_, _, _, result)] = q.outcomes()
    assert q.last_input is not None and q.last_input["jobId"] == str(j["id"])
    assert result["files"][0]["meta"]["input"] == q.last_input
    assert ("job_input", str(j["id"]), 1) in q.calls


@pytest.mark.parametrize(
    ("handler", "reason", "retryable"),
    [
        ("reject_corrupt", "corrupt_file", False),
        ("reject_unsupported", "unsupported_format", False),
        ("crash", "internal", True),
        ("raise_error", "internal", True),
        ("invalid_result", "internal", True),
        ("wrong_type_result", "internal", True),
        ("forge_runner_reason", "internal", True),
        ("forge_flag_reason", "internal", True),
        ("forge_garbage", "internal", True),
        ("forge_huge_outcome", "internal", True),
        ("forge_list_result", "internal", True),
    ],
)
def test_failures_map_to_worker_fail(tmp_path: Path, handler: str, reason: str, retryable: bool):
    j = job()
    q = FakeQueue([j])
    runner(q, tmp_path, handler).run_once()
    assert q.outcomes() == [fail(j, reason, retryable)]
    assert list(jobs_dir(tmp_path).iterdir()) == []


def test_timeout_is_retryable(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    runner(q, tmp_path, "sleep_with_grandchild", timeout=1).run_once()
    assert q.outcomes() == [fail(j, "timeout", True)]
    assert list(jobs_dir(tmp_path).iterdir()) == []


def test_the_memory_cap_from_limits_applies_without_an_override(tmp_path: Path):
    j = job()
    q = FakeQueue([j], store(tmp_path))
    r = Runner(
        q,
        storage=q.storage,
        handlers={"process_loop": "handlers:hog_memory"},
        temp_root=jobs_dir(tmp_path),
        sleep=lambda s: None,
    )
    assert r.memory_bytes == limits()["worker"]["memoryMb"] << 20
    r.run_once()
    assert q.outcomes() == [fail(j, "internal", True)]


def test_a_runner_without_overrides_uses_the_limits_for_every_kind(tmp_path: Path, monkeypatch):
    seen: dict[str, tuple[float, int]] = {}

    def fake_run(handler, payload, job_input, job_dir, *, timeout_s, memory_bytes, **kw):
        seen[payload["kind"]] = (timeout_s, memory_bytes)
        return Outcome("crashed", detail="fake")

    monkeypatch.setattr(runner_module, "run_isolated", fake_run)
    q = FakeQueue([job(k) for k in JOB_KINDS], store(tmp_path))
    r = Runner(
        q,
        storage=q.storage,
        handlers={k: "handlers:ok" for k in JOB_KINDS},
        temp_root=jobs_dir(tmp_path),
        sleep=lambda s: None,
    )
    for _ in JOB_KINDS:
        r.run_once()
    memory = limits()["worker"]["memoryMb"] << 20
    assert seen == {k: (timeout_for(k), memory) for k in JOB_KINDS}


def test_timeout_keys_cover_exactly_the_job_kinds():
    assert set(TIMEOUT_KEYS) == set(JOB_KINDS)
    assert set(TIMEOUT_KEYS.values()) <= set(limits()["worker"]["timeoutsSeconds"])


def test_the_runner_and_flag_reasons_are_contract_reasons():
    assert RUNNER_REASONS == {"timeout", "internal"}
    assert RUNNER_REASONS <= worker_reasons()
    assert FLAG_REASONS == {"duplicate_exact", "duplicate_fingerprint", "commercial_match", "pack_name_blocklist"}
    assert FLAG_REASONS <= worker_reasons()


def test_a_kind_with_no_handler_fails_retryably(tmp_path: Path):
    j = job("process_midi")
    q = FakeQueue([j])
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [fail(j, "internal", True)]


def test_a_job_past_its_attempts_fails_for_good_without_running(tmp_path: Path):
    # A job requeued as stale is claimed again with attempts beyond the limit.
    j = job(attempts=limits()["worker"]["maxAttempts"] + 1)
    q = FakeQueue([j])
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [fail(j, "internal", False)]


def test_a_payload_that_breaks_the_contract_is_not_run(tmp_path: Path):
    j = {**job(), "kind": "process_everything"}
    q = FakeQueue([j])
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [fail(j, "internal", False)]


def test_a_job_input_that_breaks_the_contract_is_not_run(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    q.input_override = {"jobId": str(j["id"])}
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [fail(j, "internal", False)]


def test_a_conflict_on_job_input_leaves_the_job_alone(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    q.input_error = QueueRejected("conflict", "This job is not running for this attempt.")
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == []


def test_a_failing_complete_falls_back_to_a_retryable_fail(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    q.complete_error = QueueUnavailable("connection reset")
    runner(q, tmp_path, "ok").run_once()
    assert [c[0] for c in q.outcomes()] == ["complete", "fail"]
    assert q.outcomes()[1] == fail(j, "internal", True)


def test_a_conflict_on_complete_leaves_the_job_alone(tmp_path: Path):
    # Another worker owns the run now, so the runner must not fail it.
    j = job()
    q = FakeQueue([j])
    q.complete_error = QueueRejected("conflict", "This job is not running for this attempt.")
    runner(q, tmp_path, "ok").run_once()
    assert [c[0] for c in q.outcomes()] == ["complete"]


def test_a_conflict_on_fail_is_logged_and_the_loop_moves_on(tmp_path: Path):
    q = FakeQueue([job(), job()])
    q.fail_error = QueueRejected("conflict", "This job is not running for this attempt.")
    r = runner(q, tmp_path, "crash")
    assert r.run_once() is True
    assert r.run_once() is True
    assert [c[0] for c in q.outcomes()] == ["fail", "fail"]


def test_an_unexpected_error_never_escapes_the_loop(tmp_path: Path, monkeypatch):
    def broken(*a, **kw):
        raise RuntimeError("sandbox bug")

    monkeypatch.setattr(runner_module, "run_isolated", broken)
    j = job()
    q = FakeQueue([j])
    ticks = iter(range(100))
    runner(q, tmp_path, "ok").run(lambda: next(ticks) >= 2)
    assert q.outcomes() == [fail(j, "internal", True)]
    assert list(jobs_dir(tmp_path).iterdir()) == []


def test_two_jobs_get_different_folders(tmp_path: Path, monkeypatch):
    dirs: list[Path] = []
    real = runner_module.run_isolated

    def spy(handler, payload, job_input, job_dir, **kw):
        dirs.append(job_dir)
        assert job_dir.is_dir() and list(job_dir.iterdir()) == []
        return real(handler, payload, job_input, job_dir, **kw)

    monkeypatch.setattr(runner_module, "run_isolated", spy)
    q = FakeQueue([job(), job()])
    r = runner(q, tmp_path, "ok")
    r.run_once()
    r.run_once()
    assert len(dirs) == 2 and dirs[0] != dirs[1]
    assert all(d.parent == jobs_dir(tmp_path) for d in dirs)
    assert list(jobs_dir(tmp_path).iterdir()) == []


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


# -- ticket 112: inputs in, outputs out, all in the parent -------------------------------------


def test_the_original_is_staged_for_the_handler(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    runner(q, tmp_path, "read_original").run_once()
    [(call, _, _, result)] = q.outcomes()
    assert call == "complete"
    assert result["files"][0]["meta"]["original"] == ORIGINAL.decode()


def test_derived_files_are_uploaded_before_complete(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    r = runner(q, tmp_path, "writes_preview")
    r.run_once()
    [(call, _, _, result)] = q.outcomes()
    assert call == "complete"
    [f] = result["files"]
    assert q.storage.uploads == [("previews", f["path"], "audio/mpeg", IMMUTABLE)]
    assert (q.storage.root / "previews" / f["path"]).read_bytes() == b"ID3 fake preview"


def test_an_output_that_does_not_match_the_result_is_not_completed(tmp_path: Path):
    j = job()
    q = FakeQueue([j])
    runner(q, tmp_path, "writes_preview_wrong_hash").run_once()
    assert q.outcomes() == [fail(j, "internal", True)]
    assert q.storage.uploads == []


def test_an_input_over_its_limit_fails_as_too_large_for_good(tmp_path: Path):
    j = job()
    q = FakeQueue([j], store(tmp_path))
    big = job_input(j, q.storage)
    big["files"][0]["bytes"] = limits()["loop"]["maxBytes"] + 1
    q.input_override = big
    q.claimed[str(j["id"])] = j
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [fail(j, "too_large", False)]


def test_a_missing_original_is_a_retryable_storage_failure(tmp_path: Path):
    j = job()
    q = FakeQueue([j], store(tmp_path))
    q.input_override = job_input(j)  # never uploaded
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [fail(j, "internal", True)]
    assert list(jobs_dir(tmp_path).iterdir()) == []


def test_a_failing_upload_is_retried_and_not_completed(tmp_path: Path):
    class BrokenUploads(LocalStorage):
        def upload(self, *a, **kw):
            raise StorageError("bucket unavailable")

    j = job()
    q = FakeQueue([j], BrokenUploads(tmp_path / "store"))
    runner(q, tmp_path, "writes_preview").run_once()
    assert q.outcomes() == [fail(j, "internal", True)]


def test_a_job_input_for_another_type_is_not_run(tmp_path: Path):
    j = job()
    q = FakeQueue([j], store(tmp_path))
    q.input_override = {**job_input(j, q.storage), "type": "kit"}
    runner(q, tmp_path, "ok").run_once()
    assert q.outcomes() == [fail(j, "internal", False)]


def test_item_types_for_kinds_cover_every_kind():
    assert set(ITEM_TYPE_FOR_KIND) == set(JOB_KINDS)


def test_the_loop_processor_is_registered():
    from stash_worker.jobs import HANDLERS

    assert HANDLERS["process_loop"] == "stash_worker.audio.loop:process_loop"
