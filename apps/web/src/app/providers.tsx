"use client";

import Link from "next/link";
import { LinkProvider, ToastProvider, TooltipProvider } from "@stash/ui";
import type { ReactNode } from "react";

/** Client providers for packages/ui: router links, one tooltip group, the toast stack (placed by the shell). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <LinkProvider component={Link}>
      <TooltipProvider>
        <ToastProvider viewport={false}>{children}</ToastProvider>
      </TooltipProvider>
    </LinkProvider>
  );
}
