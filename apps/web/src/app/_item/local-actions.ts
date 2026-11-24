import type { ErrorResult, ItemPage, ItemRow, OkResult } from "@stash/contracts";
import { LICENSE_LABELS as LICENSES } from "@stash/contracts/format";
import limits from "@stash/contracts/limits.json" with { type: "json" };
import type { ItemActions } from "./actions";

// Client code: no value import from "@stash/contracts" (it would ship zod, about 55 KB).
const ok = <T>(data: T): OkResult<T> => ({ ok: true, data });
const notFound: ErrorResult = { ok: false, code: "not_found", message: "Not found." };

/** A file name the way requestDownload builds one: the title plus the file's own extension. */
function fileNameFor(title: string, url: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? "wav";
  return `${title.replace(/[\\/"*:?<>|;]/g, " ").trim() || "download"}.${ext}`;
}

const previewOf = (row: ItemRow): string => ("previewUrl" in row.playable ? row.playable.previewUrl : "demoUrl" in row.playable ? row.playable.demoUrl : "https://media.stash.local/downloads/file.wav");

/**
 * Item actions answered in the browser: the dev fixtures (e2e) and the browser-only demo (137).
 * Like and follow toggle in memory; download hands back a file with the item's license and its
 * current version, the same shape as requestDownload, so the page draws the same license record.
 */
export function localActions(page: ItemPage, opts: { downloadUrl?: (row: ItemRow) => string; now?: () => Date } = {}): ItemActions {
  const now = opts.now ?? (() => new Date());
  const rows = new Map<string, ItemRow>([page.item, ...page.moreFromOwner].map((r) => [r.id, r]));
  // Counts without the viewer's own like or follow, so toggling adds or removes exactly one.
  const likesBase = new Map([...rows.values()].map((r) => [r.id, r.likesCount - (r.viewer?.liked ? 1 : 0)]));
  const followersBase = page.owner.followersCount - (page.owner.viewerFollows ? 1 : 0);
  return {
    save: "blob",
    async download(itemId) {
      const row = rows.get(itemId);
      if (!row) return notFound;
      const url = (opts.downloadUrl ?? previewOf)(row);
      return ok({
        downloadId: crypto.randomUUID(),
        url,
        expiresAt: new Date(now().getTime() + limits.urls.downloadTtlSeconds * 1000).toISOString(),
        fileName: fileNameFor(row.title, url),
        license: row.license,
        licenseVersion: LICENSES[row.license].version,
      });
    },
    async like(itemId, liked) {
      const base = likesBase.get(itemId);
      if (base === undefined) return notFound;
      return ok({ liked, likesCount: base + (liked ? 1 : 0) });
    },
    async follow(profileId, following) {
      if (profileId !== page.owner.id) return notFound;
      return ok({ following, followersCount: followersBase + (following ? 1 : 0) });
    },
  };
}
