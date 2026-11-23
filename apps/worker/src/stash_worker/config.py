"""Worker settings from the environment and limits.json.

`pnpm dev` writes the repo's .env.local but does not export it to the processes it starts, so values
missing from the environment are read from that file. The environment always wins.
"""

from __future__ import annotations

import os
import ssl
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from stash_worker.contracts import REPO_ROOT, limits
from stash_worker.sandbox import JobUser

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
SSLMODES = ("disable", "allow", "prefer", "require", "verify-ca", "verify-full")


def _dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        text = path.read_text()
    except OSError:
        return out
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def _ssl_context(host: str, sslmode: str | None, rootcert: str | None) -> ssl.SSLContext | bool | None:
    """pg8000's ssl_context for libpq's sslmode. pg8000 reads None as "try TLS, fall back to plain"
    (prefer), False as no TLS, and a context as TLS required.

    A host other than this machine always gets TLS: no sslmode, allow and prefer mean verify-full,
    and disable is refused, so credentials never cross a network in the clear."""
    if sslmode is not None and sslmode not in SSLMODES:
        raise ValueError(f"DATABASE_URL has an unknown sslmode {sslmode!r}")
    local = host in LOCAL_HOSTS
    if local and sslmode in (None, "allow", "prefer"):
        return None
    if sslmode == "disable":
        if not local:
            raise ValueError(f"DATABASE_URL turns TLS off for {host}; TLS is required off this machine")
        return False
    mode = "verify-full" if sslmode in (None, "allow", "prefer") else sslmode
    ctx = ssl.create_default_context(cafile=rootcert)
    if mode == "require":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    elif mode == "verify-ca":
        ctx.check_hostname = False
    return ctx


def connect_params(url: str) -> dict[str, Any]:
    """pg8000 connection arguments from a postgres:// URL, honoring sslmode and sslrootcert."""
    u = urlsplit(url)
    if u.scheme not in ("postgres", "postgresql"):
        raise ValueError("DATABASE_URL must be a postgres:// URL")
    query = {k: v[-1] for k, v in parse_qs(u.query).items()}
    host = u.hostname or "localhost"
    return {
        "user": unquote(u.username or "postgres"),
        "password": unquote(u.password) if u.password is not None else None,
        "host": host,
        "port": u.port or 5432,
        "database": unquote(u.path.lstrip("/")) or "postgres",
        "ssl_context": _ssl_context(host, query.get("sslmode"), query.get("sslrootcert")),
    }


STORAGE_KEYS = (
    "STASH_S3_ENDPOINT",
    "STASH_S3_REGION",
    "STASH_S3_ACCESS_KEY_ID",
    "STASH_S3_SECRET_ACCESS_KEY",
    "STASH_BUCKET_ORIGINALS",
    "STASH_BUCKET_PREVIEWS",
)


@dataclass(frozen=True)
class Settings:
    database_url: str
    memory_bytes: int
    idle_min_s: float
    idle_max_s: float
    storage_env: dict[str, str]
    job_user: JobUser | None  # the uid every job's child runs as (STASH_JOB_USER)
    allow_same_uid: bool  # STASH_WORKER_ALLOW_SAME_UID=1: run children as the worker's own uid (dev only)


def _job_user(values: Mapping[str, str]) -> tuple[JobUser | None, bool]:
    name = values.get("STASH_JOB_USER")
    allow_same = values.get("STASH_WORKER_ALLOW_SAME_UID") == "1"
    if not name:
        if not allow_same:
            raise SystemExit(
                "stash-worker: set STASH_JOB_USER to the unprivileged user jobs run as (the worker image has "
                "stash-job), or STASH_WORKER_ALLOW_SAME_UID=1 on a development machine."
            )
        return None, True
    try:
        user = JobUser.lookup(name)
    except (KeyError, ValueError) as e:
        raise SystemExit(f"stash-worker: STASH_JOB_USER {name!r} is not a usable user: {e}") from e
    if os.geteuid() != 0:
        raise SystemExit("stash-worker: STASH_JOB_USER needs the worker to run as root, which may switch to it.")
    return user, allow_same


def load_settings(env: Mapping[str, str] | None = None, dotenv: Path | None = None) -> Settings:
    values = {**_dotenv(dotenv or REPO_ROOT / ".env.local"), **(os.environ if env is None else env)}
    url = values.get("DATABASE_URL")
    if not url:
        raise SystemExit("stash-worker: DATABASE_URL is not set (see .env.example).")
    job_user, allow_same_uid = _job_user(values)
    return Settings(
        database_url=url,
        memory_bytes=int(limits()["worker"]["memoryMb"]) << 20,
        idle_min_s=float(values.get("STASH_WORKER_IDLE_MIN_S", 1)),
        idle_max_s=float(values.get("STASH_WORKER_IDLE_MAX_S", 15)),
        storage_env={k: values[k] for k in STORAGE_KEYS if values.get(k)},
        job_user=job_user,
        allow_same_uid=allow_same_uid,
    )
