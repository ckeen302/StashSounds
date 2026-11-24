import { requestDownload } from "@/server/downloads/actions";
import type { ItemActions } from "./actions";

/**
 * The item page's actions in production. Download is the Platform lane's requestDownload, which
 * writes the license record before it signs the URL; the URL answers with Content-Disposition
 * attachment, so following it saves the file without leaving the page. toggleLike and toggleFollow
 * arrive with ticket 301: until then like and follow are absent and the page says so.
 */
export const serverActions: ItemActions = {
  save: "navigate",
  download: (itemId) => requestDownload({ itemId }),
};
