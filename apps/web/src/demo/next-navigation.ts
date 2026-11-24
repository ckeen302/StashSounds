/**
 * Stand-in for "next/navigation" in the demo bundle (scripts/build-demo-app.mjs aliases it). The
 * real shell and item page call usePathname and useRouter; here both run on the demo's hash router.
 */
import { navigate, usePath } from "./router";

export function usePathname(): string {
  return usePath();
}

export function useRouter() {
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => {},
    prefetch: () => {},
  };
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function notFound(): never {
  throw new Error("not found");
}

export function redirect(href: string): never {
  navigate(href, { replace: true });
  throw new Error(`redirect ${href}`);
}
