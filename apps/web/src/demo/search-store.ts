import { useSyncExternalStore } from "react";

/** What the viewer searched for: the top bar writes it, the results page reads it. */
let searchQuery = "";
const searchListeners = new Set<() => void>();

export function setSearchQuery(q: string) {
  searchQuery = q;
  for (const l of searchListeners) l();
}

export function useSearchQuery(): string {
  return useSyncExternalStore(
    (l) => {
      searchListeners.add(l);
      return () => searchListeners.delete(l);
    },
    () => searchQuery,
    () => "",
  );
}
