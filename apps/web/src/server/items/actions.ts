"use server";

/**
 * Server actions for an owner's items (tickets 134 upload flow, 135 item page, library):
 * - getOwnItem({ itemId }) → ownItemSchema: any status but removed, with the latest job and the
 *   detected fields to double-check. Poll it on the upload screen while processing.
 * - updateItem(updateItemInput) → itemSchema. Tags and reference tags each replace their own set.
 * - publishItem({ itemId, rightsConfirmed: true, wavetablesConfirmed? }) → { itemId, publishedAt, href }.
 *   Only from ready; flagged or still processing is `conflict`. Presets need wavetablesConfirmed.
 * - unpublishItem({ itemId }) → { status: "ready" }; deleteItem({ itemId }) → { status: "removed" }.
 * Every result is { ok: true, data } or { ok: false, code, message, fields? }.
 */
import type {
  Result,
  deleteItemOutput,
  ownItemSchema,
  publishItemOutput,
  unpublishItemOutput,
  updateItemOutput,
} from "@stash/contracts";
import type { z } from "zod";
import { requestDeps } from "../request-deps.ts";
import { getOwnItem as ownItemAction } from "./get-own-item.ts";
import { deleteItem as deleteAction, publishItem as publishAction, unpublishItem as unpublishAction, updateItem as updateAction } from "./item-actions.ts";

export async function getOwnItem(input: unknown): Promise<Result<z.output<typeof ownItemSchema>>> {
  return ownItemAction.run(input, requestDeps);
}

export async function updateItem(input: unknown): Promise<Result<z.output<typeof updateItemOutput>>> {
  return updateAction.run(input, requestDeps);
}

export async function publishItem(input: unknown): Promise<Result<z.output<typeof publishItemOutput>>> {
  return publishAction.run(input, requestDeps);
}

export async function unpublishItem(input: unknown): Promise<Result<z.output<typeof unpublishItemOutput>>> {
  return unpublishAction.run(input, requestDeps);
}

export async function deleteItem(input: unknown): Promise<Result<z.output<typeof deleteItemOutput>>> {
  return deleteAction.run(input, requestDeps);
}
