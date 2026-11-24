import type { Metadata } from "next";
import { ItemView } from "../../_item/item-view";
import { loadItemView } from "../../_item/load";
import { itemMetadata } from "../../_item/meta";

type Params = { params: Promise<{ type: string; item: string }> };

/**
 * The item page, /[type]/[slug]-[id] (build spec, Routes). `item` is the slug-publicId segment.
 * Rendered on the server so search engines and link previews see the title, waveform and metadata;
 * the player is a client island bound to the one engine in the root layout. A wrong slug or type
 * redirects to the canonical address and an unknown item is the not-found page (the loader).
 * Dynamic per request, because like, follow and download depend on who is looking.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { type, item } = await params;
  const view = await loadItemView(type, decodeURIComponent(item));
  return itemMetadata(view.page, process.env.NEXT_PUBLIC_SITE_URL);
}

export default async function ItemPage({ params }: Params) {
  const { type, item } = await params;
  const view = await loadItemView(type, decodeURIComponent(item));
  return <ItemView view={view} />;
}
