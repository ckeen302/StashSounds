import type { Metadata } from "next";
import { formatKey, LICENSES, type ItemPage } from "@stash/contracts";
import { TYPE_LABEL } from "@stash/ui";

function lengthPhrase(length: ItemPage["item"]["length"]): string | null {
  if (!length) return null;
  const { unit, value } = length;
  if (unit === "bars") return `${value} ${value === 1 ? "bar" : "bars"}`;
  if (unit === "samples") return `${value} ${value === 1 ? "sample" : "samples"}`;
  return `${value.toFixed(1)} seconds`;
}

/** "Loop, 2 bars, 90 BPM, Dm by Kilo Beats. Royalty-free. Hear it instantly and download it on Stash." */
export function itemDescription({ item, owner }: ItemPage): string {
  const facts = [TYPE_LABEL[item.type], lengthPhrase(item.length), item.bpm ? `${item.bpm} BPM` : null, item.key ? formatKey(item.key) : null].filter(Boolean).join(", ");
  return `${facts} by ${owner.displayName || owner.handle}. ${LICENSES[item.license].label}. Hear it instantly and download it on Stash.`;
}

/**
 * The page's metadata and the card a shared link shows. The share image route (/og/[id]) is not
 * built yet; when it is, the card becomes summary_large_image with that image.
 */
export function itemMetadata(page: ItemPage, siteUrl: string | undefined): Metadata {
  const { item, owner } = page;
  const description = itemDescription(page);
  const base = siteUrl && URL.canParse(siteUrl) ? new URL(siteUrl) : undefined;
  return {
    title: `${item.title} by ${owner.displayName || owner.handle}`,
    description,
    ...(base ? { metadataBase: base } : {}),
    alternates: { canonical: item.href },
    openGraph: { type: "music.song", title: item.title, description, url: item.href, siteName: "Stash" },
    twitter: { card: "summary", title: item.title, description },
  };
}
