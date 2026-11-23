import { LogoMark } from "./logo-mark";

/** Placeholder home. Ticket 332 builds the following feed and trending rows. */
export default function Home() {
  return (
    <main className="mx-auto flex max-w-content flex-col gap-6 px-3 py-12 tablet:px-4 desktop:px-6">
      <div className="flex items-center gap-3">
        <LogoMark size={32} />
        <span className="text-title font-extrabold tracking-tight">stash</span>
      </div>
      <p className="text-small text-text-muted">
        Phase 0. The foundations are in place; screens arrive with the phase 1 tickets.
      </p>
    </main>
  );
}
