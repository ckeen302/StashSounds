"use client";

import Link from "next/link";
import { LinkProvider, ToastProvider, TooltipProvider } from "@stash/ui";
import type { ReactNode } from "react";

/** Client providers for packages/ui: router links, one tooltip group, the toast stack. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <LinkProvider component={Link}>
      <TooltipProvider>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </LinkProvider>
  );
}
