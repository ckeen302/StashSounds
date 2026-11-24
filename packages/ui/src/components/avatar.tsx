"use client";

import { useState } from "react";
import { cx } from "./cx.ts";

export type AvatarSize = 24 | 32 | 64 | 96;

const sizes: Record<AvatarSize, string> = {
  24: "size-6 text-label",
  32: "size-8 text-label",
  64: "size-16 text-title",
  96: "size-24 text-display",
};

/** Up to two initials from a display name: "Kilo Beats" is KB, "nova" is N. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A producer's picture, or their initials while it loads or when there is none. Decorative next to
 * a visible name (pass name for the fallback only); set labelled when the avatar stands alone.
 */
export function Avatar({
  name,
  src,
  size = 32,
  loading = false,
  labelled = false,
  className,
}: {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  /** The profile itself is still loading: a blank disc, no initials yet. */
  loading?: boolean;
  labelled?: boolean;
  className?: string;
}) {
  const a11y = labelled ? { role: "img", "aria-label": name } : { "aria-hidden": true as const };
  // The src that failed to load, so a new src gets its own try. No Radix here: its image waits for
  // script before it shows, and this is on every page that names a producer (script budget, 135).
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !loading && src && failed !== src;
  return (
    <span
      {...a11y}
      aria-busy={loading || undefined}
      className={cx("relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-raised", sizes[size], className)}
    >
      {/* The initials sit under the picture: they show while it loads, and stay if it fails. */}
      {!loading && <span className="font-semibold text-text-muted">{initials(name)}</span>}
      {/* eslint-disable-next-line @next/next/no-img-element -- packages/ui does not depend on Next; Radix rendered the same plain img. */}
      {showImage && <img src={src} alt="" onError={() => setFailed(src)} className="absolute inset-0 size-full object-cover" />}
    </span>
  );
}
