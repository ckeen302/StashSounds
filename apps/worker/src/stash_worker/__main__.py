"""Entry point: `uv run python -m stash_worker`. Polls claim_job until stopped.

The first SIGINT or SIGTERM stops the loop after the current job (each job is bounded by its
timeout). A second one exits at once: the job's process group is killed, and the job, still marked
running, is returned to the queue by requeue_stale_jobs.
"""

from __future__ import annotations

import logging
import signal
import sys
import threading
from types import FrameType

from stash_worker.config import load_settings
from stash_worker.db import PgJobQueue
from stash_worker.runner import Runner

log = logging.getLogger("stash_worker")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s", stream=sys.stderr)
    settings = load_settings()
    stop = threading.Event()

    def on_signal(signum: int, _frame: FrameType | None) -> None:
        if stop.is_set():
            raise SystemExit(128 + signum)
        log.info("stopping after the current job (signal %d again to stop now)", signum)
        stop.set()

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    queue = PgJobQueue(settings.database_url)
    runner = Runner(
        queue,
        memory_bytes=settings.memory_bytes,
        sleep=lambda s: stop.wait(s),
        idle_min_s=settings.idle_min_s,
        idle_max_s=settings.idle_max_s,
    )
    log.info("polling for jobs")
    try:
        runner.run(stop.is_set)
    finally:
        queue.close()
    log.info("stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
