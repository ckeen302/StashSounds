import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devPagesEnabled } from "../../_shell/dev-pages";
import { FixturePlayer } from "./fixture-player";

export const metadata: Metadata = { title: "Player", robots: { index: false, follow: false } };

// The flag is read per request, so the same build answers 404 in production.
export const dynamic = "force-dynamic";

/**
 * The player bar against the real engine before the screens with data land (ticket 132). Not
 * linked, not indexed, and not served at all unless STASH_DEV_PAGES=1 (never in production). The
 * rows are the gallery's fixture loops; their preview URLs point at media.stash.local, which the
 * end-to-end tests answer with fixture audio.
 */
export default function PlayerPage() {
  if (!devPagesEnabled()) notFound();
  return (
    <main className="mx-auto flex max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">Dev</span>
        <h1 className="text-title">Player</h1>
      </header>
      <FixturePlayer />
    </main>
  );
}
