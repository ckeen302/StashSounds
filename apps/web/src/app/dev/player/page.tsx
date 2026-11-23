import type { Metadata } from "next";
import { FixturePlayer } from "./fixture-player";

export const metadata: Metadata = { title: "Player", robots: { index: false, follow: false } };

/**
 * The player bar against the real engine before the screens with data land (ticket 132). Not
 * linked, not indexed. The rows are the gallery's fixture loops; their preview URLs point at
 * media.stash.local, which the end-to-end tests answer with fixture audio.
 */
export default function PlayerPage() {
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
