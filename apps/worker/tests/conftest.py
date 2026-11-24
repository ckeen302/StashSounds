"""Shared fixtures.

Database tests build a throwaway database from supabase/tests/shim.sql plus every migration in order
(the same recipe as supabase/tests/db.ts), so the runner is tested against the real worker functions.
They skip when no Postgres is reachable at DATABASE_ADMIN_URL (default postgres://postgres:postgres@
localhost:5432/postgres), unless STASH_REQUIRE_DB=1, which turns the skip into a failure for CI.
"""

from __future__ import annotations

import os
import secrets
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pg8000.native
import pytest

from stash_worker.config import connect_params
from stash_worker.contracts import REPO_ROOT
from stash_worker.storage import LocalStorage

TESTS = Path(__file__).resolve().parent
ADMIN_URL = os.environ.get("DATABASE_ADMIN_URL", "postgres://postgres:postgres@localhost:5432/postgres")

# The sandbox imports "handlers:<name>" in a child process.
os.environ["PYTHONPATH"] = os.pathsep.join(p for p in (str(TESTS), os.environ.get("PYTHONPATH")) if p)


def _admin(database: str | None = None) -> pg8000.native.Connection:
    params = connect_params(ADMIN_URL)
    if database:
        params["database"] = database
    return pg8000.native.Connection(**params, timeout=10)


def schema_sql() -> list[str]:
    migrations = REPO_ROOT / "supabase" / "migrations"
    return [(REPO_ROOT / "supabase" / "tests" / "shim.sql").read_text()] + [
        p.read_text() for p in sorted(migrations.glob("*.sql"))
    ]


class TestDb:
    """A database built for one test session, with arrangement helpers that act as the superuser,
    a signed-in user or the service role. Only tests arrange rows this way; the worker never does."""

    __test__ = False

    def __init__(self, name: str, storage: LocalStorage):
        self.name = name
        self.storage = storage
        self.url = ADMIN_URL.rsplit("/", 1)[0] + "/" + name
        self.conn = _admin(name)

    def q(self, sql: str, **params: Any) -> list[dict[str, Any]]:
        rows = self.conn.run(sql, **params)
        cols = [c["name"] for c in self.conn.columns or []]
        return [dict(zip(cols, r, strict=True)) for r in rows or []]

    def as_role(self, role: str, sql: str, sub: str | None = None, **params: Any) -> list[dict[str, Any]]:
        import json

        claims = {"role": role} if sub is None else {"role": role, "sub": sub}
        self.conn.run("begin")
        try:
            self.conn.run("select set_config('request.jwt.claims', :c, true)", c=json.dumps(claims))
            self.conn.run(f"set local role {role}")
            rows = self.q(sql, **params)
            self.conn.run("commit")
            return rows
        except Exception:
            self.conn.run("rollback")
            raise

    def make_user(self) -> str:
        handle = "u" + secrets.token_hex(6)
        uid = self.q(
            "insert into auth.users (email, email_confirmed_at) values (:e, now()) returning id",
            e=f"{handle}@example.test",
        )[0]["id"]
        self.as_role("authenticated", "select public.claim_handle(:h)", sub=str(uid), h=handle)
        return str(uid)

    def queued_item(
        self, type_: str = "loop", ext: str = "wav", file_name: str | None = None, content: bytes = b"0123456789"
    ) -> dict[str, str]:
        """A draft uploaded and enqueued through the real functions, as the web app does it. The
        original's bytes are put in self.storage at the path the database gave it."""
        owner = self.make_user()
        row = self.as_role(
            "authenticated",
            "select * from public.create_upload_draft(cast(:t as public.item_type), :title, :n, :ext, :fn)",
            sub=owner,
            t=type_,
            title="Test " + secrets.token_hex(3),
            ext=ext,
            fn=file_name,
            n=len(content),
        )[0]
        src = self.storage.root / ".upload"
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_bytes(content)
        self.storage.upload("originals", str(row["path"]), src, "application/octet-stream", None)
        src.unlink()
        self.storage.uploads.clear()
        item_id, file_id = str(row["item_id"]), str(row["file_id"])
        # As completeUpload does: claim the file's completion with a token, then enqueue with it.
        token = str(uuid.uuid4())
        claimed = self.as_role(
            "service_role",
            "select public.claim_file_completion(cast(:o as uuid), cast(:i as uuid), cast(:f as uuid),"
            " cast(:t as uuid)) as ok",
            o=owner,
            i=item_id,
            f=file_id,
            t=token,
        )[0]["ok"]
        assert claimed is True
        job = self.as_role(
            "service_role",
            "select public.enqueue_processing(cast(:o as uuid), cast(:i as uuid), cast(:f as uuid), :n,"
            " cast(:t as uuid)) as id",
            o=owner,
            i=item_id,
            f=file_id,
            n=len(content),
            t=token,
        )[0]["id"]
        return {"owner": owner, "item_id": item_id, "job_id": str(job), "file_id": file_id, "path": str(row["path"])}

    def job(self, job_id: str) -> dict[str, Any]:
        return self.q(
            "select *, extract(epoch from run_after - now()) as wait_s from public.processing_jobs where id = :i",
            i=uuid.UUID(job_id),
        )[0]

    def item(self, item_id: str) -> dict[str, Any]:
        return self.q("select * from public.items where id = :i", i=uuid.UUID(item_id))[0]

    def make_due(self, job_id: str) -> None:
        """Moves a queued job's backoff into the past, standing in for waiting it out."""
        self.q("update public.processing_jobs set run_after = now() where id = :i", i=uuid.UUID(job_id))


@pytest.fixture(scope="session")
def _database() -> Iterator[str]:
    try:
        admin = _admin()
    except Exception as e:  # noqa: BLE001 - any connection failure means no database here
        if os.environ.get("STASH_REQUIRE_DB") == "1":
            pytest.fail(f"STASH_REQUIRE_DB=1 but no Postgres at {ADMIN_URL}: {e}")
        pytest.skip(f"no Postgres at {ADMIN_URL}: {e}")
    name = f"stash_worker_test_{os.getpid()}_{secrets.token_hex(3)}"
    admin.run(f"create database {name}")
    admin.close()
    try:
        build = _admin(name)
        for sql in schema_sql():
            build.run(sql)
        build.close()
        yield name
    finally:
        admin = _admin()
        admin.run(f"drop database if exists {name} with (force)")
        admin.close()


@pytest.fixture
def db(_database: str, tmp_path: Path) -> Iterator[TestDb]:
    t = TestDb(_database, LocalStorage(tmp_path / "store"))
    t.q("delete from public.processing_jobs")
    yield t
    t.conn.close()
