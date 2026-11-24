import type { ItemPage } from "@stash/contracts";
import type { ItemActions, ItemSource } from "./actions";
import { lazyLocalActions } from "./lazy-local-actions";
import { serverActions } from "./server-actions";

/** Who answers the page's actions: the server actions, or the local ones (fixtures and the demo). */
export function actionsFor(source: ItemSource, page: ItemPage): ItemActions {
  return source === "local" ? lazyLocalActions(page) : serverActions;
}
