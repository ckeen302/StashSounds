"""`python -m stash_worker`: settings, and the real process polling a real queue."""

from __future__ import annotations

import os
import signal
import ssl
import subprocess
import sys
import time
from pathlib import Path

import pytest

import stash_worker.__main__ as main_module
from stash_worker.config import Settings, connect_params, load_settings
from stash_worker.contracts import limits
from stash_worker.sandbox import JobUser


def test_settings_fall_back_to_env_local_and_the_environment_wins(tmp_path: Path):
    dotenv = tmp_path / ".env.local"
    dotenv.write_text("# comment\nDATABASE_URL=postgresql://a:b@h:1/d\nSTASH_WORKER_ALLOW_SAME_UID=1\n")
    s = load_settings(env={}, dotenv=dotenv)
    assert s.database_url == "postgresql://a:b@h:1/d"
    s = load_settings(env={"DATABASE_URL": "postgres://x@y/z"}, dotenv=dotenv)
    assert s.database_url == "postgres://x@y/z"


def test_the_memory_cap_comes_from_limits(tmp_path: Path):
    env = {"DATABASE_URL": "postgres://x@localhost/z", "STASH_WORKER_ALLOW_SAME_UID": "1"}
    s = load_settings(env=env, dotenv=tmp_path / "missing")
    assert s.memory_bytes == limits()["worker"]["memoryMb"] << 20


def test_settings_require_a_database_url(tmp_path: Path):
    with pytest.raises(SystemExit, match="DATABASE_URL"):
        load_settings(env={}, dotenv=tmp_path / "missing")


def test_main_passes_the_configured_memory_cap_to_the_runner(monkeypatch):
    settings = Settings(
        database_url="postgres://x@localhost/z",
        memory_bytes=321 << 20,
        idle_min_s=1,
        idle_max_s=2,
        storage_env=STORAGE_ENV,
        job_user=JobUser(65534, 65534),
        allow_same_uid=False,
    )
    seen: dict[str, object] = {}

    class FakeRunner:
        def __init__(self, queue, **kw):
            seen.update(kw)

        def run(self, should_stop):
            seen["ran"] = True

    monkeypatch.setattr(main_module, "load_settings", lambda: settings)
    monkeypatch.setattr(main_module, "Runner", FakeRunner)
    monkeypatch.setattr(main_module.signal, "signal", lambda *a: None)
    assert main_module.main() == 0
    assert seen["memory_bytes"] == 321 << 20 and seen["ran"] is True
    assert seen["job_user"] == JobUser(65534, 65534)
    assert seen["storage"].buckets == {"originals": "o", "previews": "p"}


STORAGE_ENV = {
    "STASH_S3_ENDPOINT": "http://127.0.0.1:9",
    "STASH_S3_REGION": "auto",
    "STASH_S3_ACCESS_KEY_ID": "a",
    "STASH_S3_SECRET_ACCESS_KEY": "b",
    "STASH_BUCKET_ORIGINALS": "o",
    "STASH_BUCKET_PREVIEWS": "p",
}


def test_settings_require_a_job_user_unless_same_uid_is_allowed(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(os, "geteuid", lambda: 0)  # as in the worker image
    base = {"DATABASE_URL": "postgres://x@localhost/z", **STORAGE_ENV}
    with pytest.raises(SystemExit, match="STASH_JOB_USER"):
        load_settings(env=base, dotenv=tmp_path / "missing")
    s = load_settings(env={**base, "STASH_WORKER_ALLOW_SAME_UID": "1"}, dotenv=tmp_path / "missing")
    assert (s.job_user, s.allow_same_uid) == (None, True)
    s = load_settings(env={**base, "STASH_JOB_USER": "nobody"}, dotenv=tmp_path / "missing")
    assert s.job_user == JobUser.lookup("nobody") and s.storage_env == STORAGE_ENV
    with pytest.raises(SystemExit, match="no-such-user"):
        load_settings(env={**base, "STASH_JOB_USER": "no-such-user"}, dotenv=tmp_path / "missing")


def test_a_job_user_needs_a_worker_that_can_switch_to_it(tmp_path: Path, monkeypatch):
    base = {"DATABASE_URL": "postgres://x@localhost/z", "STASH_JOB_USER": "nobody", **STORAGE_ENV}
    monkeypatch.setattr(os, "geteuid", lambda: 1000)
    with pytest.raises(SystemExit, match="root"):
        load_settings(env=base, dotenv=tmp_path / "missing")


def test_connect_params_parse_a_supabase_url():
    assert connect_params("postgresql://postgres:p%40ss@127.0.0.1:54322/postgres") == {
        "user": "postgres",
        "password": "p@ss",
        "host": "127.0.0.1",
        "port": 54322,
        "database": "postgres",
        "ssl_context": None,
    }
    with pytest.raises(ValueError):
        connect_params("mysql://x@y/z")


def test_local_hosts_use_tls_only_when_asked():
    assert connect_params("postgres://u@localhost/d")["ssl_context"] is None  # prefer, as libpq does
    assert connect_params("postgres://u@localhost/d?sslmode=disable")["ssl_context"] is False
    ctx = connect_params("postgres://u@127.0.0.1/d?sslmode=verify-full")["ssl_context"]
    assert isinstance(ctx, ssl.SSLContext) and ctx.check_hostname


def test_remote_hosts_require_verified_tls():
    ctx = connect_params("postgres://u@db.example.com/d")["ssl_context"]
    assert isinstance(ctx, ssl.SSLContext)
    assert (ctx.verify_mode, ctx.check_hostname) == (ssl.CERT_REQUIRED, True)
    for mode in ("prefer", "allow"):
        assert connect_params(f"postgres://u@db.example.com/d?sslmode={mode}")["ssl_context"].check_hostname
    req = connect_params("postgres://u@db.example.com/d?sslmode=require")["ssl_context"]
    assert (req.verify_mode, req.check_hostname) == (ssl.CERT_NONE, False)
    ca = connect_params("postgres://u@db.example.com/d?sslmode=verify-ca")["ssl_context"]
    assert (ca.verify_mode, ca.check_hostname) == (ssl.CERT_REQUIRED, False)
    with pytest.raises(ValueError, match="TLS"):
        connect_params("postgres://u@db.example.com/d?sslmode=disable")
    with pytest.raises(ValueError, match="sslmode"):
        connect_params("postgres://u@localhost/d?sslmode=sometimes")


def test_the_worker_process_polls_claims_and_stops_on_sigterm(db):
    it = db.queued_item()
    env = {
        **os.environ,
        **STORAGE_ENV,
        "DATABASE_URL": db.url,
        "STASH_WORKER_IDLE_MAX_S": "0.2",
        "STASH_WORKER_ALLOW_SAME_UID": "1",
    }
    proc = subprocess.Popen(  # noqa: S603
        [sys.executable, "-m", "stash_worker"], env=env, stderr=subprocess.PIPE, text=True
    )
    try:
        deadline = time.monotonic() + 20
        while db.job(it["job_id"])["error"] is None and time.monotonic() < deadline:
            time.sleep(0.1)
        job = db.job(it["job_id"])
        # Storage at STASH_S3_ENDPOINT refuses connections, so staging the original fails retryably.
        assert (job["status"], job["attempts"], job["error"]) == ("queued", 1, "internal")
    finally:
        proc.send_signal(signal.SIGTERM)
        _, err = proc.communicate(timeout=10)
    assert proc.returncode == 0, err
    assert "polling for jobs" in err and "stopped" in err
