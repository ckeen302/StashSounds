import type { ItemPage } from "@stash/contracts";
import type { ItemActions, ItemSource } from "../app/_item/actions";
import { localActions } from "../app/_item/local-actions";
import { set } from "./store";

/**
 * Stand-in for app/_item/actions-source in the demo bundle: the local actions (no server), with
 * likes and follows remembered in this browser. The demo never reaches a server action.
 */
export function actionsFor(_source: ItemSource, page: ItemPage): ItemActions {
  const local = localActions(page);
  return {
    ...local,
    like: async (itemId, liked) => {
      const r = await local.like!(itemId, liked);
      if (r.ok) set("likes", itemId, liked);
      return r;
    },
    follow: async (profileId, follow) => {
      const r = await local.follow!(profileId, follow);
      if (r.ok) set("follows", profileId, follow);
      return r;
    },
  };
}
