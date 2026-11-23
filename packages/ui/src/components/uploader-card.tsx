"use client";

import type { OwnerSummary } from "@stash/contracts";
import { Avatar } from "./avatar.tsx";
import { Button } from "./button.tsx";
import { cx } from "./cx.ts";
import { Check, UserPlus } from "./icon.tsx";
import { UiLink } from "./link.tsx";
import { Stat } from "./stat.tsx";

export type UploaderCardProps = {
  owner: Pick<OwnerSummary, "handle" | "displayName" | "avatarUrl">;
  variant?: "compact" | "full";
  /** Profile link, e.g. /u/kilo. */
  href: string;
  following?: boolean;
  /** The viewer is this uploader: no follow button, an edit link instead. */
  own?: boolean;
  /** The follow change is in flight. */
  pending?: boolean;
  onFollowChange?: (follow: boolean) => void;
  /** Full card only. */
  followersCount?: number;
  itemsCount?: number;
  /** Full card only: where "Edit profile" goes for the viewer's own card. */
  editHref?: string;
  className?: string;
};

function FollowControl({ following, own, pending, onFollowChange, size, editHref, name }: Pick<UploaderCardProps, "following" | "own" | "pending" | "onFollowChange" | "editHref"> & { size: "sm" | "md"; name: string }) {
  if (own) {
    return editHref ? (
      <UiLink
        href={editHref}
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-control border border-border-strong bg-surface text-body-strong text-text transition-colors duration-control ui-hover:bg-raised",
          size === "sm" ? "h-8 px-3" : "h-10 px-4",
        )}
      >
        Edit profile
      </UiLink>
    ) : null;
  }
  return (
    <Button
      size={size}
      variant={following ? "ghost" : "secondary"}
      icon={following ? Check : UserPlus}
      loading={pending}
      aria-label={following ? `Following ${name}` : `Follow ${name}`}
      onClick={() => onFollowChange?.(!following)}
    >
      {following ? "Following" : "Follow"}
    </Button>
  );
}

/** Who made it, with follow. Compact beside a player; full on the item page's right column. */
export function UploaderCard({
  owner,
  variant = "compact",
  href,
  following = false,
  own = false,
  pending = false,
  onFollowChange,
  followersCount,
  itemsCount,
  editHref,
  className,
}: UploaderCardProps) {
  const name = owner.displayName || owner.handle;
  const identity = (
    <UiLink href={href} className="flex min-w-0 items-center gap-3 rounded-control">
      <Avatar name={name} src={owner.avatarUrl} size={variant === "full" ? 64 : 32} />
      <span className="flex min-w-0 flex-col">
        <span className={cx("truncate text-text", variant === "full" ? "text-title" : "text-body-strong")}>{name}</span>
        <span className="truncate text-small text-text-muted">@{owner.handle}</span>
      </span>
    </UiLink>
  );
  const control = <FollowControl following={following} own={own} pending={pending} onFollowChange={onFollowChange} editHref={editHref} size={variant === "full" ? "md" : "sm"} name={name} />;

  if (variant === "compact") {
    return <div className={cx("flex min-w-0 items-center justify-between gap-3", className)}>{identity}{control}</div>;
  }
  return (
    <section aria-label={`Uploader ${name}`} className={cx("flex flex-col gap-4 rounded-panel border border-border bg-surface p-4", className)}>
      {identity}
      {(followersCount !== undefined || itemsCount !== undefined) && (
        <div className="flex gap-6">
          {followersCount !== undefined && <Stat label="Followers" value={followersCount} />}
          {itemsCount !== undefined && <Stat label="Sounds" value={itemsCount} />}
        </div>
      )}
      <div className="flex flex-col">{control}</div>
    </section>
  );
}
