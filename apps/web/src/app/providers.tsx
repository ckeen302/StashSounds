"use client";

import Link from "next/link";
import { LinkProvider, ToastProvider, TooltipProvider } from "@stash/ui";
import type { ReactNode } from "react";
import { SignInDialogProvider } from "./_auth/sign-in-dialog";
import type { Viewer } from "./_auth/viewer";
import { ViewerProvider } from "./_auth/viewer-context";

/** Client providers for packages/ui: router links, one tooltip group, the toast stack (placed by the shell), who is signed in and the sign-in dialog. */
export function Providers({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  return (
    <LinkProvider component={Link}>
      <TooltipProvider>
        <ToastProvider viewport={false}>
          <ViewerProvider viewer={viewer}>
            <SignInDialogProvider>{children}</SignInDialogProvider>
          </ViewerProvider>
        </ToastProvider>
      </TooltipProvider>
    </LinkProvider>
  );
}
