"use client";

import { Dialog } from "@stash/ui";

export type SignInIntent = "download" | "like" | "follow";

/**
 * "Sign in to download" and friends. Its own module so the dialog (Radix Dialog) loads only when a
 * signed-out visitor asks for something, keeping the loop page inside the script budget.
 */
export default function SignInDialog({ intent, ownerName, onClose, onSignIn }: { intent: SignInIntent; ownerName: string; onClose: () => void; onSignIn: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={intent === "download" ? "Sign in to download" : intent === "follow" ? `Sign in to follow ${ownerName}` : "Sign in to like"}
      description={
        intent === "download"
          ? "Downloads come with a license record, kept in your library. You will come back here and the download starts."
          : "It takes one email link. You will come back here and it is done."
      }
      confirmLabel="Sign in"
      cancelLabel="Not now"
      onConfirm={onSignIn}
    />
  );
}
