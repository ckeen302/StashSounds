"""The job loop: claim one job, run it isolated, record the outcome (build spec: Worker jobs,
Failure handling; ticket 111).

- Result valid against worker-result.schema.json: worker_complete.
- Handler raised Rejected(reason) (corrupt, unsupported, hostile): worker_fail(reason, retryable=false).
- Timeout: worker_fail('timeout', retryable=true).
- Crash, memory cap, forged or malformed outcome, invalid result, no handler, worker_complete error,
  or a bug in the runner itself: worker_fail('internal', true).
- Payload or job input breaks its schema, the input is for another item type, or claimed past the
  attempt limit: worker_fail('internal', false).
- An input file over its type's size limit: worker_fail('too_large', false), before downloading it.
- Storage error staging inputs or publishing outputs, or outputs that do not match the result:
  worker_fail('internal', true). Nothing is completed until every output is uploaded.
- Any call answered with conflict: nothing. The run is no longer this worker's (decision 0012).

Every call after the claim names the claimed attempt. worker_fail applies the backoff and returns the
item to draft on the final failure.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from jsonschema import ValidationError

from stash_worker.contracts import limits, validate
from stash_worker.db import JobQueue, QueueContractError, QueueError, QueueRejected
from stash_worker.files import InputRejected, PublishError, publish_outputs, stage_inputs
from stash_worker.jobs import HANDLERS, ITEM_TYPE_FOR_KIND, TIMEOUT_KEYS, timeout_for
from stash_worker.sandbox import JobUser, Outcome, run_isolated
from stash_worker.storage import Storage, StorageError

log = logging.getLogger(__name__)

# A running job is stale once it has been locked longer than any job may run, plus this margin.
STALE_MARGIN_S = 60


class Runner:
    def __init__(
        self,
        queue: JobQueue,
        *,
        storage: Storage,
        job_user: JobUser | None = None,
        isolate_network: bool | None = None,
        handlers: Mapping[str, str] = HANDLERS,
        timeouts: Mapping[str, float] | None = None,
        memory_bytes: int | None = None,
        temp_root: Path | None = None,
        sleep: Callable[[float], object] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        idle_min_s: float = 1,
        idle_max_s: float = 15,
        stale_every_s: float = 60,
    ):
        """`timeouts` overrides limits.json per kind (tests only); every other kind uses timeout_for.
        `memory_bytes` defaults to limits.json worker.memoryMb; a job always runs with a cap."""
        self.queue = queue
        self.storage = storage
        self.job_user = job_user
        self.isolate_network = isolate_network
        self.handlers = dict(handlers)
        self.timeouts = dict(timeouts or {})
        self.memory_bytes = memory_bytes if memory_bytes is not None else int(limits()["worker"]["memoryMb"]) << 20
        self.temp_root = temp_root
        self.sleep = sleep
        self.clock = clock
        self.idle_min_s = idle_min_s
        self.idle_max_s = idle_max_s
        self.stale_every_s = stale_every_s
        self._last_stale: float | None = None
        self._idle = idle_min_s

    @property
    def stale_after_s(self) -> float:
        return max(timeout_for(k) for k in TIMEOUT_KEYS) + STALE_MARGIN_S

    @property
    def max_attempts(self) -> int:
        return int(limits()["worker"]["maxAttempts"])

    def timeout_for(self, kind: str) -> float:
        return self.timeouts[kind] if kind in self.timeouts else timeout_for(kind)

    # -- the loop ---------------------------------------------------------------------------

    def run(self, should_stop: Callable[[], bool]) -> None:
        """Runs jobs until should_stop() is true, checked between jobs. Sleeps with doubling
        backoff while the queue is empty or the database is unreachable. Never raises an Exception."""
        while not should_stop():
            try:
                ran = self.run_once()
            except QueueError as e:
                log.warning("queue unavailable: %s", e)
                ran = False
            except Exception:
                log.exception("unexpected error in the job loop")
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
        try:
            self._handle(row)
        except Exception:
            log.exception("job %s: unexpected error", row.get("id"))
            self._fail(str(row["id"]), int(row["attempts"]), "internal", retryable=True)
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
        job_id, attempt = str(row["id"]), row["attempts"]
        payload = {"id": job_id, "itemId": str(row["item_id"]), "kind": row["kind"], "attempts": attempt}
        try:
            validate("job-payload", payload)
        except ValidationError as e:
            log.error("job %s: payload breaks the contract: %s", job_id, e.message)
            return self._fail(job_id, attempt, "internal", retryable=False)
        if attempt > self.max_attempts:
            # Only a job requeued as stale gets here: its worker died on every attempt.
            log.error("job %s: claimed for attempt %d of %d", job_id, attempt, self.max_attempts)
            return self._fail(job_id, attempt, "internal", retryable=False)
        handler = self.handlers.get(payload["kind"])
        if handler is None:
            log.error("job %s: no handler for %s", job_id, payload["kind"])
            return self._fail(job_id, attempt, "internal", retryable=True)

        try:
            job_input = self.queue.job_input(job_id, attempt)
        except QueueRejected as e:
            if e.code == "conflict":
                log.warning("job %s attempt %d: another worker owns this run: %s", job_id, attempt, e)
                return None
            log.error("job %s: worker_job_input refused: %s", job_id, e)
            return self._fail(job_id, attempt, "internal", retryable=True)
        except QueueContractError as e:
            log.error("job %s: %s", job_id, e)
            return self._fail(job_id, attempt, "internal", retryable=False)
        except QueueError as e:
            log.error("job %s: worker_job_input failed: %s", job_id, e)
            return self._fail(job_id, attempt, "internal", retryable=True)
        try:
            validate("worker-job-input", job_input)
        except ValidationError as e:
            log.error("job %s: job input breaks the contract: %s", job_id, e.message)
            return self._fail(job_id, attempt, "internal", retryable=False)
        if job_input["type"] != ITEM_TYPE_FOR_KIND[payload["kind"]]:
            log.error("job %s: a %s job for a %s item", job_id, payload["kind"], job_input["type"])
            return self._fail(job_id, attempt, "internal", retryable=False)

        job_dir = Path(tempfile.mkdtemp(prefix=f"stash-job-{job_id}-", dir=self.temp_root))
        try:
            try:
                stage_inputs(self.storage, job_input, job_dir / "work" / "in")
            except InputRejected as e:
                log.warning("job %s: %s", job_id, e)
                return self._fail(job_id, attempt, e.reason, retryable=False)
            except StorageError as e:
                log.error("job %s: staging inputs failed: %s", job_id, e)
                return self._fail(job_id, attempt, "internal", retryable=True)
            started = time.monotonic()
            outcome = run_isolated(
                handler,
                payload,
                job_input,
                job_dir,
                timeout_s=self.timeout_for(payload["kind"]),
                memory_bytes=self.memory_bytes,
                job_user=self.job_user,
                isolate_network=self.isolate_network,
            )
            log.info(
                "job %s %s attempt %d: %s in %.1fs %r",
                job_id,
                payload["kind"],
                attempt,
                outcome.status,
                time.monotonic() - started,
                outcome.reason or outcome.detail,
            )
            self._record(job_id, attempt, outcome, job_dir, payload["itemId"], job_input["type"])
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)
        return None

    def _record(self, job_id: str, attempt: int, outcome: Outcome, job_dir: Path, item_id: str, item_type: str) -> None:
        if outcome.status == "rejected" and outcome.reason:
            return self._fail(job_id, attempt, outcome.reason, retryable=False)
        if outcome.status == "timeout":
            return self._fail(job_id, attempt, "timeout", retryable=True)
        if outcome.status != "ok" or outcome.result is None:
            return self._fail(job_id, attempt, "internal", retryable=True)
        try:
            validate("worker-result", outcome.result)
        except ValidationError as e:
            log.error("job %s: result breaks worker-result.schema.json: %r", job_id, e.message)
            return self._fail(job_id, attempt, "internal", retryable=True)
        try:
            owner = os.getuid() if self.job_user is None else self.job_user.uid
            publish_outputs(self.storage, outcome.result, job_dir / "work" / "out", item_id, item_type, owner)
        except (PublishError, StorageError) as e:
            log.error("job %s: publishing outputs failed: %r", job_id, str(e))
            return self._fail(job_id, attempt, "internal", retryable=True)
        try:
            self.queue.complete(job_id, attempt, outcome.result)
        except QueueRejected as e:
            if e.code == "conflict":
                # The run is no longer ours (requeued as stale, maybe claimed by another worker) or
                # its item left processing. Failing it here could undo another worker's run.
                log.warning("job %s: worker_complete refused: %s", job_id, e)
                return None
            log.error("job %s: worker_complete refused: %s", job_id, e)
            return self._fail(job_id, attempt, "internal", retryable=True)
        except QueueError as e:
            log.error("job %s: worker_complete failed: %s", job_id, e)
            return self._fail(job_id, attempt, "internal", retryable=True)
        return None

    def _fail(self, job_id: str, attempt: int, reason: str, *, retryable: bool) -> None:
        try:
            self.queue.fail(job_id, attempt, reason, retryable)
        except QueueRejected as e:
            if e.code == "conflict":
                log.warning("job %s attempt %d: another worker owns this run: %s", job_id, attempt, e)
            else:
                log.error("job %s: worker_fail(%s) refused: %s", job_id, reason, e)
        except QueueError as e:
            # The job stays running; requeue_stale_jobs returns it to the queue later.
            log.error("job %s: worker_fail(%s) failed: %s", job_id, reason, e)
