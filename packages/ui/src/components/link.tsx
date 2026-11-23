"use client";

import { createContext, createElement, useContext, type ComponentType, type ReactNode, type Ref } from "react";

export type LinkLikeProps = {
  href: string;
  className?: string;
  children?: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
  "aria-label"?: string;
  [data: `data-${string}`]: unknown;
};
export type LinkLike = ComponentType<LinkLikeProps>;

function PlainAnchor({ ref, ...props }: LinkLikeProps) {
  return <a ref={ref} {...props} />;
}

const LinkContext = createContext<LinkLike>(PlainAnchor);

/**
 * Lets the app hand packages/ui its router link (next/link) so in-app links navigate on the client
 * and the player keeps playing. Without a provider, links are plain anchors.
 */
export function LinkProvider({ component, children }: { component: LinkLike; children: ReactNode }) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>;
}

export function UiLink(props: LinkLikeProps) {
  // The component comes from context and is stable for the app's lifetime.
  return createElement(useContext(LinkContext), props);
}
