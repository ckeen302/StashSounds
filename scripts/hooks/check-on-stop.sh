#!/usr/bin/env bash
# Claude Code Stop hook: runs `pnpm check` when a builder finishes a turn, so type and lint errors
# are caught before a handoff is written. Exit 2 hands the failure back to the session.
# Skips when the hook already fired this stop (stop_hook_active) to avoid a loop.
input="$(cat)"
if printf '%s' "$input" | grep -q '"stop_hook_active":[[:space:]]*true'; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0
# Only when this checkout has changes.
if git diff --quiet HEAD -- . 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard)" ]; then exit 0; fi
if ! out="$(pnpm check 2>&1)"; then
  printf 'pnpm check failed. Fix these before writing a handoff:\n%s\n' "$(printf '%s' "$out" | tail -40)" >&2
  exit 2
fi
exit 0
