import type { LicenseKind } from "./enums.ts";
import { limits } from "./limits.ts";

/** Plain-language license summaries. The full text lives on /licenses. Lawyer review pending. */
export const LICENSES: Record<LicenseKind, { label: string; summary: string; version: string }> = {
  royalty_free: {
    label: "Royalty-free",
    summary: "Use it in your own music, including commercial releases. Do not redistribute the raw file.",
    version: limits.licenses.royalty_free.version,
  },
  credit_required: {
    label: "Credit required",
    summary: "Same as royalty-free, and you credit the creator wherever the track is released.",
    version: limits.licenses.credit_required.version,
  },
  split_on_placement: {
    label: "Split on placement",
    summary: "Free to use. If the track is commercially released, the stated publishing share is owed to the creator.",
    version: limits.licenses.split_on_placement.version,
  },
};
