# Stash worker container. Python 3.12 with ffmpeg and Chromaprint (fpcalc).
# The Vital renderer (ticket 215) runs as its own isolated process; see docs/spec/overview.md.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
WORKDIR /app/apps/worker
COPY apps/worker/pyproject.toml apps/worker/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY packages/contracts/limits.json /app/packages/contracts/limits.json
COPY packages/contracts/generated /app/packages/contracts/generated
COPY apps/worker/src ./src
RUN uv sync --frozen --no-dev

RUN useradd --create-home worker
USER worker
CMD ["uv", "run", "--frozen", "--no-dev", "python", "-m", "stash_worker"]
