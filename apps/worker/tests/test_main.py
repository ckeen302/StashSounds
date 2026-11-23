"""`python -m stash_worker`: settings, and the real process polling a real queue."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

from stash_worker.config import connect_params, load_settings


def test_settings_fall_back_to_env_local_and_the_environment_wins(tmp_path: Path):
    dotenv = tmp_path / ".env.local"
    dotenv.write_text("# comment\nDATABASE_URL=postgresql://a:b@h:1/d\nSTASH_WORKER_MEMORY_MB=512\n")
    s = load_settings(env={}, dotenv=dotenv)
    assert (s.database_url, s.memory_bytes) == ("postgresql://a:b@h:1/d", 512 << 20)
    s = load_settings(env={"DATABASE_URL": "postgres://x@y/z"}, dotenv=dotenv)
    assert s.database_url == "postgres://x@y/z"


def test_settings_require_a_database_url(tmp_path: Path):
    with pytest.raises(SystemExit, match="DATABASE_URL"):
        load_settings(env={}, dotenv=tmp_path / "missing")


def test_connect_params_parse_a_supabase_url():
    assert connect_params("postgresql://postgres:p%40ss@127.0.0.1:54322/postgres") == {
        "user": "postgres",
        "password": "p@ss",
        "host": "127.0.0.1",
        "port": 54322,
        "database": "postgres",
    }
    with pytest.raises(ValueError):
        connect_params("mysql://x@y/z")


def test_the_worker_process_polls_claims_and_stops_on_sigterm(db):
    it = db.queued_item()
    env = {**os.environ, "DATABASE_URL": db.url, "STASH_WORKER_IDLE_MAX_S": "0.2"}
    proc = subprocess.Popen(  # noqa: S603
        [sys.executable, "-m", "stash_worker"], env=env, stderr=subprocess.PIPE, text=True
    )
    try:
        deadline = time.monotonic() + 20
        while db.job(it["job_id"])["error"] is None and time.monotonic() < deadline:
            time.sleep(0.1)
        job = db.job(it["job_id"])
        # No processor is registered for loops until ticket 112, so the claim ends in a retryable failure.
        assert (job["status"], job["attempts"], job["error"]) == ("queued", 1, "internal")
    finally:
        proc.send_signal(signal.SIGTERM)
        _, err = proc.communicate(timeout=10)
    assert proc.returncode == 0, err
    assert "polling for jobs" in err and "stopped" in err
