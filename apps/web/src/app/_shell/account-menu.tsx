"use client";

import { useRouter } from "next/navigation";
import { Avatar, LogOut, Menu, User, useToast } from "@stash/ui";
import { signOut } from "@/server/auth/actions";
import type { Viewer } from "../_auth/viewer";

/** A member's avatar opens their menu: profile and sign out. */
export default function AccountMenu({ viewer }: { viewer: Extract<Viewer, { status: "member" }> }) {
  const router = useRouter();
  const toast = useToast();
  const name = viewer.displayName || viewer.handle;
  return (
    <Menu
      entries={[
        { label: "Your profile", icon: User, onSelect: () => router.push(`/u/${viewer.handle}`) },
        { separator: true },
        {
          label: "Sign out",
          icon: LogOut,
          onSelect: () =>
            void signOut().then((r) => {
              if (!r.ok) return toast({ tone: "error", title: "Could not sign out", description: r.message });
              router.refresh();
            }),
        },
      ]}
      trigger={
        <button
          type="button"
          aria-label={`Account, @${viewer.handle}`}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-control ui-hover:bg-raised"
        >
          <Avatar name={name} src={viewer.avatarUrl} size={32} />
        </button>
      }
    />
  );
}
