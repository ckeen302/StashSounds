import { healthResponse } from "@stash/contracts";

/** Liveness for the local stack and CI. Returns the shape in contracts. */
export function health() {
  return healthResponse.parse({ ok: true, version: process.env.STASH_VERSION ?? "dev" });
}
