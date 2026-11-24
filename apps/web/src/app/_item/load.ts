import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSession, itemPage } from "@/server";
import { loadItemViewWith, type ItemView } from "./load-core";

/** The item page's data for one request. Cached, so generateMetadata and the page share one read. */
export const loadItemView = cache(
  (type: string, param: string): Promise<ItemView> =>
    loadItemViewWith(
      {
        env: process.env,
        cookie: async (name) => (await cookies()).get(name)?.value,
        itemPage,
        signedIn: async () => (await getSession()) !== null,
        redirect: (href) => redirect(href),
        notFound: () => notFound(),
      },
      type,
      param,
    ),
);
