import type { ItemType } from "./enums.ts";

/** Canonical item URL: /loop/dark-keys-k3j9x0a2bq */
export function itemHref(item: { type: ItemType; slug: string; publicId: string }): string {
  return `/${item.type}/${item.slug}-${item.publicId}`;
}

/** Splits "dark-keys-k3j9x0a2bq" into slug and public id. The id is always the last 10 characters. */
export function parseItemParam(param: string): { slug: string; publicId: string } | null {
  const m = /^(?:(.*)-)?([0-9a-z]{10})$/.exec(param);
  if (!m || !m[2]) return null;
  return { slug: m[1] ?? "", publicId: m[2] };
}

/** URL-safe slug from a title. Mirrors public.slugify in the migration. */
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "untitled";
}
