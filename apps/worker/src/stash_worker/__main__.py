"""Entry point: `uv run python -m stash_worker`. The job loop arrives in ticket 111."""

import sys


def main() -> int:
    print("stash-worker: no job runner yet (ticket 111).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
