import type { ItemPage } from "@stash/contracts";
import type { ItemActions } from "./actions";
import type * as Local from "./local-actions";

type LocalModule = typeof Local;

/**
 * The local actions, fetched the first time one is used. Nothing on the item page needs them
 * before a click, so their code stays out of the script that runs before audio (ticket 135 budget).
 */
export function lazyLocalActions(page: ItemPage, load: () => Promise<LocalModule> = () => import("./local-actions")): ItemActions {
  let actions: Promise<ItemActions> | null = null;
  const get = () => (actions ??= load().then((m) => m.localActions(page)));
  return {
    save: "blob",
    download: async (itemId) => (await get()).download(itemId),
    like: async (itemId, liked) => (await get()).like!(itemId, liked),
    follow: async (profileId, follow) => (await get()).follow!(profileId, follow),
  };
}
