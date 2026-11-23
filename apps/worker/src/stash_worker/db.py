"""The worker's only way into the database: the service role's worker functions.

Each call runs in its own transaction as `service_role` (data-model.md and decision 0012: claim_job,
worker_job_input, worker_complete, worker_fail, requeue_stale_jobs) and does nothing else: no table
reads, no table writes. Every call after the claim names the claimed attempt, and the database answers
`conflict` once that run is no longer this worker's.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol

import pg8000.native
from jsonschema import ValidationError
from pg8000.exceptions import DatabaseError, InterfaceError

from stash_worker.config import connect_params
from stash_worker.contracts import validate

log = logging.getLogger(__name__)

STATEMENT_TIMEOUT = "30s"
SOCKET_TIMEOUT_S = 60


class QueueError(Exception):
    pass


class QueueUnavailable(QueueError):  # noqa: N818
    """The database could not be reached or the connection broke. Safe to retry later."""


class QueueRejected(QueueError):  # noqa: N818
    """A worker function refused the call. `code` is the prefix public.fail() gives (not_found,
    conflict, invalid) or the SQLSTATE of any other error."""

    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class QueueContractError(QueueError):
    """A worker function answered with a shape that breaks the contract."""


class JobQueue(Protocol):
    def claim(self) -> dict[str, Any] | None: ...
    def job_input(self, job_id: str, attempt: int) -> dict[str, Any]: ...
    def complete(self, job_id: str, attempt: int, result: dict[str, Any]) -> None: ...
    def fail(self, job_id: str, attempt: int, reason: str, retryable: bool) -> None: ...
    def requeue_stale(self, older_than_s: float) -> int: ...


def _rejection(e: DatabaseError) -> QueueRejected:
    fields = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
    message = str(fields.get("M", e))
    if fields.get("C") == "P0001" and ": " in message:
        code, text = message.split(": ", 1)
        return QueueRejected(code, text)
    return QueueRejected(str(fields.get("C", "unknown")), message)


class PgJobQueue:
    """JobQueue over a direct Postgres connection (DATABASE_URL), acting as service_role."""

    def __init__(self, url: str):
        self._params = connect_params(url)
        self._conn: pg8000.native.Connection | None = None

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:  # noqa: BLE001, S110 - closing a broken connection
                pass
            self._conn = None

    def _connection(self) -> pg8000.native.Connection:
        if self._conn is None:
            try:
                self._conn = pg8000.native.Connection(
                    **self._params, timeout=SOCKET_TIMEOUT_S, application_name="stash-worker"
                )
            except (InterfaceError, DatabaseError, OSError) as e:
                raise QueueUnavailable(str(e)) from e
        return self._conn

    def _run(self, sql: str, **params: Any) -> list[dict[str, Any]]:
        conn = self._connection()
        try:
            conn.run("begin")
            conn.run("set local role service_role")
            conn.run(f"set local statement_timeout = '{STATEMENT_TIMEOUT}'")
            conn.run("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)")
            rows = conn.run(sql, **params)
            cols = [c["name"] for c in conn.columns or []]
            conn.run("commit")
        except DatabaseError as e:
            try:
                conn.run("rollback")
            except Exception:  # noqa: BLE001 - the connection is gone; reconnect next call
                self.close()
            raise _rejection(e) from e
        except (InterfaceError, OSError) as e:
            self.close()
            raise QueueUnavailable(str(e)) from e
        return [dict(zip(cols, r, strict=True)) for r in rows or []]

    def claim(self) -> dict[str, Any] | None:
        rows = self._run("select * from public.claim_job()")
        return rows[0] if rows else None

    def job_input(self, job_id: str, attempt: int) -> dict[str, Any]:
        """What the claimed job processes, validated against worker-job-input.schema.json."""
        rows = self._run(
            "select public.worker_job_input(cast(:j as uuid), cast(:a as int)) as input", j=job_id, a=attempt
        )
        value = rows[0]["input"]
        try:
            validate("worker-job-input", value)
        except ValidationError as e:
            raise QueueContractError(f"worker_job_input breaks the contract: {e.message}") from e
        return value

    def complete(self, job_id: str, attempt: int, result: dict[str, Any]) -> None:
        self._run(
            "select (public.worker_complete(cast(:j as uuid), cast(:a as int), cast(:r as jsonb))).id",
            j=job_id,
            a=attempt,
            r=json.dumps(result),
        )

    def fail(self, job_id: str, attempt: int, reason: str, retryable: bool) -> None:
        self._run(
            "select (public.worker_fail(cast(:j as uuid), cast(:a as int), :reason, :retryable)).id",
            j=job_id,
            a=attempt,
            reason=reason,
            retryable=retryable,
        )

    def requeue_stale(self, older_than_s: float) -> int:
        rows = self._run("select public.requeue_stale_jobs(make_interval(secs => :s)) as n", s=float(older_than_s))
        return int(rows[0]["n"])
