/**
 * Dev-only pages (/dev/player) exist only where STASH_DEV_PAGES=1: local runs and the test servers.
 * A production deployment never sets it, so the page answers 404 there. Read per request, not
 * inlined at build, so one build can serve both.
 */
export function devPagesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STASH_DEV_PAGES === "1";
}
