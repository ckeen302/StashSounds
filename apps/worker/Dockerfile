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

# The parent runs as root because only a privileged process can start the job child as another uid
# (ticket 112). It holds the credentials; each job runs as stash-job, which owns nothing here and can
# read the app and the venv only because they are world-readable. Compose drops every capability
# but the few the parent needs (docs/requests/112-worker-isolation-ci.md).
RUN useradd --system --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin stash-job \
 && chmod -R a+rX /app
ENV STASH_JOB_USER=stash-job
CMD ["/app/apps/worker/.venv/bin/python", "-m", "stash_worker"]
