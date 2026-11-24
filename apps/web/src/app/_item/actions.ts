import type { Result, requestDownloadOutput, toggleFollowOutput, toggleLikeOutput } from "@stash/contracts";
import type { z } from "zod";

export type DownloadResult = z.output<typeof requestDownloadOutput>;
export type LikeResult = z.output<typeof toggleLikeOutput>;
export type FollowResult = z.output<typeof toggleFollowOutput>;

/**
 * What the item page can ask for, whoever answers: the server actions in production, or the local
 * adapter for the dev fixtures and the browser-only demo (ticket 137). The page never knows which.
 * Like and follow are absent where they are not available yet (server: ticket 301).
 */
export type ItemActions = {
  /** The page's item or one of its rows (more from this uploader). */
  download: (itemId: string) => Promise<Result<DownloadResult>>;
  like?: (itemId: string, liked: boolean) => Promise<Result<LikeResult>>;
  follow?: (profileId: string, follow: boolean) => Promise<Result<FollowResult>>;
  /**
   * How the file reaches the disk. "navigate": the URL answers with Content-Disposition attachment
   * (signed downloads), so following it saves without leaving the page. "blob": fetch and save a
   * same-browser copy (local files with no such header).
   */
  save: "navigate" | "blob";
};

/** Where an item page's data and actions come from. */
export type ItemSource = "server" | "local";
