"""Worker settings from the environment.

`pnpm dev` writes the repo's .env.local but does not export it to the processes it starts, so values
missing from the environment are read from that file. The environment always wins.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from stash_worker.contracts import REPO_ROOT

# No memory limit is given in limits.json yet (request 111-worker-memory-limit).
DEFAULT_MEMORY_MB = 2048


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


def connect_params(url: str) -> dict[str, Any]:
    """pg8000 connection arguments from a postgres:// URL."""
    u = urlsplit(url)
    if u.scheme not in ("postgres", "postgresql"):
        raise ValueError("DATABASE_URL must be a postgres:// URL")
    return {
        "user": unquote(u.username or "postgres"),
        "password": unquote(u.password) if u.password is not None else None,
        "host": u.hostname or "localhost",
        "port": u.port or 5432,
        "database": unquote(u.path.lstrip("/")) or "postgres",
    }


@dataclass(frozen=True)
class Settings:
    database_url: str
    memory_bytes: int
    idle_min_s: float
    idle_max_s: float


def load_settings(env: Mapping[str, str] | None = None, dotenv: Path | None = None) -> Settings:
    values = {**_dotenv(dotenv or REPO_ROOT / ".env.local"), **(os.environ if env is None else env)}
    url = values.get("DATABASE_URL")
    if not url:
        raise SystemExit("stash-worker: DATABASE_URL is not set (see .env.example).")
    return Settings(
        database_url=url,
        memory_bytes=int(values.get("STASH_WORKER_MEMORY_MB", DEFAULT_MEMORY_MB)) << 20,
        idle_min_s=float(values.get("STASH_WORKER_IDLE_MIN_S", 1)),
        idle_max_s=float(values.get("STASH_WORKER_IDLE_MAX_S", 15)),
    )
