"use client";

import { PanelDialog } from "@stash/ui";
import { SignInPanel } from "./sign-in-panel";

/**
 * The sign-in dialog's face. Loaded the first time a signed-out action asks (sign-in-dialog.tsx),
 * so the dialog and the sign-in panel stay out of every page's first load.
 */
export default function SignInDialogView({
  open,
  onOpenChange,
  title,
  description,
  next,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  next: string;
}) {
  return (
    <PanelDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {/* A fresh panel per ask, so a sent state never carries over to another action. */}
      <SignInPanel key={next} next={next} />
    </PanelDialog>
  );
}
