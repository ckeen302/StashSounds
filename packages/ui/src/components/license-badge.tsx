"use client";

import { LICENSES, type LicenseKind } from "@stash/contracts";
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
  className,
  ...preview
}: PreviewState & {
  kind: LicenseKind;
  /** Split on placement only: the publishing share owed to the creator. */
  splitPercent?: number | null;
  href?: string;
  className?: string;
}) {
  const { label, summary } = LICENSES[kind];
  return (
    <Tooltip content={summary}>
      <UiLink
        href={href}
        className={cx(
          "inline-flex h-6 shrink-0 items-center gap-2 rounded-control border border-border-strong px-2 text-label text-label-caps text-text",
          transition,
          "ui-hover:border-text-muted ui-hover:bg-raised",
          className,
        )}
        {...preview}
      >
        {label}
        {kind === "split_on_placement" && splitPercent != null && <span className="font-mono tabular text-text-muted">{splitPercent}%</span>}
      </UiLink>
    </Tooltip>
  );
}
