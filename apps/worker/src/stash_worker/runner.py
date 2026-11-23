"""The job loop: claim one job, run it isolated, record the outcome (build spec: Worker jobs,
Failure handling; ticket 111).

- Result valid against worker-result.schema.json: worker_complete.
- Handler raised Rejected(reason) (corrupt, unsupported, hostile): worker_fail(reason, retryable=false).
- Timeout: worker_fail('timeout', retryable=true).
- Crash, memory cap, invalid result, no handler, worker_complete error: worker_fail('internal', true).
- Payload breaks job-payload.schema.json, or claimed past the attempt limit: worker_fail('internal', false).
- worker_complete answers conflict (job no longer running): nothing; the job may be another worker's now.

worker_fail applies the backoff and returns the item to draft on the final failure.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from jsonschema import ValidationError

from stash_worker.contracts import limits, validate
from stash_worker.db import JobQueue, QueueError, QueueRejected
from stash_worker.jobs import HANDLERS, TIMEOUT_KEYS, timeout_for
from stash_worker.sandbox import Outcome, run_isolated

log = logging.getLogger(__name__)

# A running job is stale once it has been locked longer than any job may run, plus this margin.
STALE_MARGIN_S = 60


class Runner:
    def __init__(
        self,
        queue: JobQueue,
        *,
        handlers: Mapping[str, str] = HANDLERS,
        timeouts: Mapping[str, float] | None = None,
        memory_bytes: int | None,
        temp_root: Path | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        idle_min_s: float = 1,
        idle_max_s: float = 15,
        stale_every_s: float = 60,
    ):
        self.queue = queue
        self.handlers = dict(handlers)
        self.timeouts = dict(timeouts) if timeouts is not None else {k: timeout_for(k) for k in TIMEOUT_KEYS}
        self.memory_bytes = memory_bytes
        self.temp_root = temp_root
        self.sleep = sleep
        self.clock = clock
        self.idle_min_s = idle_min_s
        self.idle_max_s = idle_max_s
        self.stale_every_s = stale_every_s
        self.stale_after_s = max(timeout_for(k) for k in TIMEOUT_KEYS) + STALE_MARGIN_S
        self.max_attempts = int(limits()["worker"]["maxAttempts"])
        self._last_stale: float | None = None
        self._idle = idle_min_s

    # -- the loop ---------------------------------------------------------------------------

    def run(self, should_stop: Callable[[], bool]) -> None:
        """Runs jobs until should_stop() is true, checked between jobs. Sleeps with doubling
        backoff while the queue is empty or the database is unreachable."""
        while not should_stop():
            try:
                ran = self.run_once()
            except QueueError as e:
                log.warning("queue unavailable: %s", e)
                ran = False
            if ran:
                self._idle = self.idle_min_s
            else:
                self.sleep(self._idle)
                self._idle = min(self._idle * 2, self.idle_max_s)

    def run_once(self) -> bool:
        """Claims and runs at most one job. Returns whether a job was claimed."""
        self._requeue_stale_if_due()
        row = self.queue.claim()
        if row is None:
            return False
        self._handle(row)
        return True

    def _requeue_stale_if_due(self) -> None:
        now = self.clock()
        if self._last_stale is not None and now - self._last_stale < self.stale_every_s:
            return
        self._last_stale = now
        n = self.queue.requeue_stale(self.stale_after_s)
        if n:
            log.warning("requeued %d stale job(s)", n)

    # -- one job ----------------------------------------------------------------------------

    def _handle(self, row: dict[str, Any]) -> None:
        job_id = str(row["id"])
        payload = {"id": job_id, "itemId": str(row["item_id"]), "kind": row["kind"], "attempts": row["attempts"]}
        try:
            validate("job-payload", payload)
        except ValidationError as e:
            log.error("job %s: payload breaks the contract: %s", job_id, e.message)
            return self._fail(job_id, "internal", retryable=False)
        if payload["attempts"] > self.max_attempts:
            # Only a job requeued as stale gets here: its worker died on every attempt.
            log.error("job %s: claimed for attempt %d of %d", job_id, payload["attempts"], self.max_attempts)
            return self._fail(job_id, "internal", retryable=False)
        handler = self.handlers.get(payload["kind"])
        if handler is None:
            log.error("job %s: no handler for %s", job_id, payload["kind"])
            return self._fail(job_id, "internal", retryable=True)

        job_dir = Path(tempfile.mkdtemp(prefix=f"stash-job-{job_id}-", dir=self.temp_root))
        try:
            started = time.monotonic()
            outcome = run_isolated(
                handler,
                payload,
                job_dir,
                timeout_s=self.timeouts.get(payload["kind"], timeout_for(payload["kind"])),
                memory_bytes=self.memory_bytes,
            )
            log.info(
                "job %s %s attempt %d: %s in %.1fs %s",
                job_id,
                payload["kind"],
                payload["attempts"],
                outcome.status,
                time.monotonic() - started,
                outcome.reason or outcome.detail,
            )
            self._record(job_id, outcome)
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)

    def _record(self, job_id: str, outcome: Outcome) -> None:
        if outcome.status == "rejected":
            return self._fail(job_id, outcome.reason or "internal", retryable=False)
        if outcome.status == "timeout":
            return self._fail(job_id, "timeout", retryable=True)
        if outcome.status != "ok" or outcome.result is None:
            return self._fail(job_id, "internal", retryable=True)
        try:
            result = self._validate_result(outcome.result)
        except ValidationError as e:
            log.error("job %s: result breaks worker-result.schema.json: %s", job_id, e.message)
            return self._fail(job_id, "internal", retryable=True)
        try:
            self.queue.complete(job_id, result)
        except QueueRejected as e:
            if e.code == "conflict":
                # The job is no longer running (requeued as stale, maybe claimed by another worker)
                # or its item left processing. Failing it here could undo another worker's run.
                log.warning("job %s: worker_complete refused: %s", job_id, e)
                return None
            log.error("job %s: worker_complete refused: %s", job_id, e)
            return self._fail(job_id, "internal", retryable=True)
        except QueueError as e:
            log.error("job %s: worker_complete failed: %s", job_id, e)
            return self._fail(job_id, "internal", retryable=True)
        return None

    @staticmethod
    def _validate_result(result: dict[str, Any]) -> dict[str, Any]:
        validate("worker-result", result)
        return result

    def _fail(self, job_id: str, reason: str, *, retryable: bool) -> None:
        try:
            self.queue.fail(job_id, reason, retryable)
        except QueueError as e:
            # The job stays running; requeue_stale_jobs returns it to the queue later.
            log.error("job %s: worker_fail(%s) failed: %s", job_id, reason, e)
