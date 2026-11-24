"use client";

import { ErrorState } from "@stash/ui";

/** The item page could not load (not a missing item: that is the 404). Retry fetches it again. */
export default function ItemErrorView({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-content flex-col px-3 pt-6 tablet:px-4 desktop:px-6 desktop:pt-8">
      <ErrorState title="This sound did not load" onRetry={retry}>
        Your connection or our server had a moment. Try again; nothing you did was lost.
      </ErrorState>
    </main>
  );
}
