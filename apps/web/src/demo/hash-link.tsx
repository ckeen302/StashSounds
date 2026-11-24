import type { LinkLikeProps } from "@stash/ui";
import { nameFor, navigate } from "./router";

/** The demo's router link for packages/ui: an app path becomes a hash link that never reloads. */
export function HashLink({ href, ref, ...props }: LinkLikeProps) {
  const internal = href.startsWith("/");
  return (
    <a
      ref={ref}
      {...props}
      href={internal ? `#${nameFor(href)}` : href}
      onClick={(e) => {
        if (!internal || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    />
  );
}
