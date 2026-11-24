import type { Metadata } from "next";
import { LICENSES, licenseKindSchema } from "@stash/contracts";

export const metadata: Metadata = {
  title: "Licenses",
  description: "The three licenses on Stash in plain language, with their version numbers.",
};

/**
 * /licenses (build spec, Routes): the three licenses in plain language, with version numbers. Each
 * has an anchor (#royalty_free and so on), which the license badge links to. The summaries are the
 * contract's LICENSES; the full legal text arrives with the lawyer's review.
 */
export default function LicensesPage() {
  return (
    <main className="mx-auto flex max-w-content flex-col gap-8 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-display text-text">Licenses</h1>
        <p className="max-w-160 text-body text-text-muted">
          Every sound on Stash is shared under one of three licenses. The version you download under is recorded with your download and
          kept in your library.
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-4 desktop:grid-cols-3">
        {licenseKindSchema.options.map((kind) => {
          const { label, summary, version } = LICENSES[kind];
          return (
            <li key={kind} id={kind} className="flex scroll-mt-6 flex-col gap-3 rounded-panel border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-title text-text">{label}</h2>
                <span className="font-mono text-numeric tabular text-text-muted">v{version}</span>
              </div>
              <p className="text-body text-text">{summary}</p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
