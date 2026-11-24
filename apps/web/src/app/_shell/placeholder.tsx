import type { Metadata } from "next";
import { ButtonLink, EmptyState, type IconComponent } from "@stash/ui";

/**
 * A screen the navigation points at before its ticket builds it. Without a page the router serves a
 * 404 document, which is a full page load: the player would stop, and the router's prefetch of the
 * missing route never settles. Each placeholder is replaced by its screen's ticket.
 */
export function placeholderMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}

export function Placeholder({ title, icon, children }: { title: string; icon: IconComponent; children: string }) {
  return (
    <main className="mx-auto flex max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <h1 className="text-title">{title}</h1>
      <EmptyState
        icon={icon}
        title="This screen is on the way"
        action={
          <ButtonLink href="/" variant="secondary">
            Go home
          </ButtonLink>
        }
      >
        {children}
      </EmptyState>
    </main>
  );
}
