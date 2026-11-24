"use client";

import type { LicenseKind } from "@stash/contracts";
import { LICENSE_LABELS as LICENSES } from "@stash/contracts/format";
import { cx, transition, type PreviewState } from "./cx.ts";
import { UiLink } from "./link.tsx";
import { Tooltip } from "./tooltip.tsx";

/**
 * The license, as a small engraved plate. Hovering or focusing it shows the plain-language summary;
 * it links to the full text on /licenses.
 */
export function LicenseBadge({
  kind,
  splitPercent,
  href = `/licenses#${kind}`,
  summaryTooltip = true,
  className,
  ...preview
}: PreviewState & {
  kind: LicenseKind;
  /** Split on placement only: the publishing share owed to the creator. */
  splitPercent?: number | null;
  href?: string;
  /** False where the summary is already on screen beside the badge (the item page's license panel). */
  summaryTooltip?: boolean;
  className?: string;
}) {
  const { label, summary } = LICENSES[kind];
  const badge = (
    <UiLink
      href={href}
      className={cx(
        "relative inline-flex h-6 shrink-0 items-center gap-2 rounded-control border border-border-strong px-2 text-label text-label-caps text-text",
        transition,
        "ui-hover:border-text-muted ui-hover:bg-raised",
        // A 40 px touch target around the 24 px plate.
        "after:absolute after:inset-x-0 after:-inset-y-2",
        className,
      )}
      {...preview}
    >
      {label}
      {kind === "split_on_placement" && splitPercent != null && <span className="font-mono tabular text-text-muted">{splitPercent}%</span>}
    </UiLink>
  );
  return summaryTooltip ? <Tooltip content={summary}>{badge}</Tooltip> : badge;
}
