import type { ItemPage } from "@stash/contracts";
import type { ItemSource } from "./actions";
import { fixtureItemPage, FIXTURE_VIEWER_COOKIE, isFixtureParam } from "./fixtures";
import { devPagesEnabled } from "../_shell/dev-pages";

/** Everything the item page renders from: the data, who is looking, and who answers its actions. */
export type ItemView = { page: ItemPage; viewer: { signedIn: boolean }; source: ItemSource };

export type LoadDeps = {
  env: Record<string, string | undefined>;
  cookie: (name: string) => Promise<string | undefined>;
  /** The Platform query: redirects and not-found are its own (it throws Next's control errors). */
  itemPage: (type: string, param: string) => Promise<ItemPage>;
  signedIn: () => Promise<boolean>;
  redirect: (href: string) => never;
  notFound: () => never;
};

/**
 * The thin loader the item page reads through. In production it is the Platform query and nothing
 * else. With STASH_DEV_PAGES=1, a fixture loop's address is answered from the fixtures (the e2e
 * tests' stub). Ticket 137 adds its static demo data here, so no component forks.
 */
export async function loadItemViewWith(deps: LoadDeps, type: string, param: string): Promise<ItemView> {
  // A production deployment never serves fixtures, even if the flag were set there by mistake.
  const fixturesAllowed = devPagesEnabled(deps.env) && deps.env.VERCEL_ENV !== "production";
  if (fixturesAllowed && isFixtureParam(param)) {
    const signedIn = (await deps.cookie(FIXTURE_VIEWER_COOKIE)) === "member";
    const r = fixtureItemPage(type, param, { signedIn });
    if (r.kind === "redirect") deps.redirect(r.href);
    if (r.kind === "not_found") deps.notFound();
    return { page: r.page, viewer: { signedIn }, source: "local" };
  }
  const [page, signedIn] = await Promise.all([deps.itemPage(type, param), deps.signedIn()]);
  return { page, viewer: { signedIn }, source: "server" };
}
