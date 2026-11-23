# Request 113 librosa cannot pass the licenses gate; onset tempo and chroma are written on numpy
From lane: pipeline
For: lead (docs/spec/build-spec.md wording, or scripts/licenses.mjs exceptions)
Blocking ticket: none (113 is built on numpy and meets its acceptance criteria)

## What I need changed
One of the two:
1. **Recommended:** change build-spec.md (Worker jobs, Loop) and ticket 113 from "onset-based tempo from
   librosa" and "librosa provides chroma" to "onset-based tempo and chroma, computed with numpy" (or
   without naming a library). Nothing else changes.
2. Or add licence exceptions with a decision record, then I swap the two numpy functions for librosa's.
   The exceptions needed are `soxr` (LGPL-2.1-or-later), `soundfile` (BSD, but its wheel bundles
   `libsndfile`, LGPL-2.1) and `certifi` (MPL-2.0, at runtime via pooch and requests).

## Why
librosa 1.0.1 lists these as required dependencies:
`numba, numpy, scipy, scikit-learn, joblib, decorator, soundfile, pooch, soxr, lazy_loader, msgpack`.
It imports `soundfile` and `soxr` at the top of `librosa/core/audio.py`, so they cannot be left out.
CLAUDE.md and scripts/licenses.mjs never allow LGPL (psycopg was refused for this in ticket 111),
and MPL-2.0 is allowed only for development tools.

The numpy version does what the spec describes:
- Spectral-flux onset envelope with autocorrelation, to choose among the whole-bar candidates.
- Averaged chroma against the 24 Krumhansl-Kessler profiles, with the margin as confidence.

It also adds only one dependency (numpy, BSD-3-Clause, bundling OpenBLAS, BSD-3-Clause) instead of
about twenty, among them numba and llvmlite, which are large in the worker image.

## Workaround in the meantime
None needed: `apps/worker/src/stash_worker/audio/tempo.py` and `key.py` use numpy, and the fixture
tests pass (handoff 113).
