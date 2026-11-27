"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { Bell, ButtonLink, Icon, IconButton, IconLink, PanelLeftClose, PanelLeftOpen, Search, SearchInput, ToastViewport, Tooltip, UiLink } from "@stash/ui";
import { LogoMark } from "../logo-mark";
import { isCurrent, itemsFor, type ShellViewer } from "./nav";

export type { ShellViewer };
import { PlayerDock } from "./player-dock";

const RAIL_KEY = "stash.rail";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** Fallback when storage is blocked: the rail stays as set for this visit. */
let memory: boolean | null = null;
const listeners = new Set<() => void>();

function writeCollapsed(collapsed: boolean) {
  memory = collapsed;
  try {
    window.localStorage.setItem(RAIL_KEY, collapsed ? "collapsed" : "open");
  } catch {
    // Kept in memory above.
  }
  for (const l of listeners) l();
}

/** The rail's collapsed setting: remembered per browser, expanded on the server and by default. */
function useCollapsed(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => memory ?? readCollapsed(),
    () => false,
  );
}

/** Desktop width, where the rail shows its labels unless collapsed. */
const DESKTOP = "(min-width: 1024px)";

/** Whether the rail is icons only: always on tablet, and on desktop when collapsed. */
function useIconOnly(collapsed: boolean): boolean {
  const desktop = useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia(DESKTOP);
      mq.addEventListener("change", l);
      return () => mq.removeEventListener("change", l);
    },
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  );
  return collapsed || !desktop;
}

/**
 * The current destination is marked three ways, never by color alone: the raised fill, a 2 px bar on
 * the rail's inner edge and, with labels shown, a heavier label (PR #12 review).
 */
const railLink = [
  "relative flex h-10 items-center justify-center gap-3 rounded-control px-2 text-body-strong text-text-muted transition-colors duration-control",
  "desktop:justify-start desktop:group-data-collapsed:justify-center",
  "ui-hover:bg-raised ui-hover:text-text data-current:bg-raised data-current:font-semibold data-current:text-text",
  "before:absolute before:inset-y-2 before:-left-3 before:w-0.5 before:rounded-full before:bg-transparent data-current:before:bg-text",
].join(" ");

function Wordmark() {
  return <span className="text-title font-extrabold tracking-tight text-text">stash</span>;
}

/** Tablet and desktop: the left rail. 232 px with labels on desktop, collapsible to 64; icons only on tablet. */
function Rail({ pathname, viewer }: { pathname: string; viewer: ShellViewer | null }) {
  const collapsed = useCollapsed();
  const iconOnly = useIconOnly(collapsed);
  const toggle = () => writeCollapsed(!collapsed);
  return (
    <nav
      aria-label="Main"
      data-collapsed={collapsed || undefined}
      className="group hidden shrink-0 flex-col border-r border-border bg-bg tablet:flex tablet:w-16 desktop:w-58 desktop:data-collapsed:w-16"
    >
      <div className="flex h-14 shrink-0 items-center px-3">
        <UiLink href="/" aria-label="Stash" className="flex h-10 items-center gap-3 rounded-control px-2">
          <LogoMark size={24} />
          <span className="hidden desktop:inline desktop:group-data-collapsed:hidden">
            <Wordmark />
          </span>
        </UiLink>
      </div>
      <ul className="flex flex-1 flex-col gap-1 px-3 py-2">
        {itemsFor(viewer).map((item) => {
          const current = isCurrent(pathname, item);
          const link = (
            <UiLink href={item.href} aria-current={current ? "page" : undefined} data-current={current || undefined} className={railLink}>
              <Icon icon={item.icon} size={20} />
              <span className="sr-only desktop:not-sr-only desktop:group-data-collapsed:sr-only">{item.label}</span>
            </UiLink>
          );
          // Icons only: the tooltip names the destination for sighted pointer users too.
          return (
            <li key={item.href}>
              {iconOnly ? (
                <Tooltip content={item.label} side="right">
                  {link}
                </Tooltip>
              ) : (
                link
              )}
            </li>
          );
        })}
      </ul>
      <div className="hidden px-3 py-3 desktop:flex desktop:group-data-collapsed:justify-center">
        <IconButton
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? "Expand navigation" : "Collapse navigation"}
          size="md"
          onClick={toggle}
        />
      </div>
    </nav>
  );
}

/** Phone: the bottom tab bar, 56 px, five destinations. */
function TabBar({ pathname, viewer }: { pathname: string; viewer: ShellViewer | null }) {
  return (
    <nav aria-label="Tabs" className="h-14 shrink-0 border-t border-border bg-bg tablet:hidden">
      <ul className="flex h-full">
        {itemsFor(viewer).map((item) => {
          const current = isCurrent(pathname, item);
          return (
            <li key={item.href} className="flex flex-1">
              <UiLink
                href={item.href}
                aria-current={current ? "page" : undefined}
                data-current={current || undefined}
                className={[
                  "relative flex flex-1 flex-col items-center justify-center gap-1 rounded-control text-small text-text-muted",
                  // The current tab: brighter, heavier, and a 2 px bar along the top, not color alone.
                  "data-current:font-semibold data-current:text-text",
                  "before:absolute before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full before:bg-transparent data-current:before:bg-text",
                ].join(" ")}
              >
                <Icon icon={item.icon} size={20} />
                <span>{item.label}</span>
              </UiLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * 56 px: search centred up to 560 px, notifications, then sign in or, once signed in, the viewer's
 * avatar linking to their profile. Phone, 48 px: logo, search, notifications.
 */
function TopBar({ account, searchHint, searchKey }: { account: ReactNode; searchHint: string; searchKey: string }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg px-3 tablet:h-14 tablet:gap-4 tablet:px-4 desktop:px-6">
      <UiLink href="/" aria-label="Stash" className="flex h-10 items-center gap-2 rounded-control tablet:hidden">
        <LogoMark size={20} />
        <Wordmark />
      </UiLink>
      <div className="flex-1 tablet:hidden" />
      <form role="search" action="/search" className="hidden min-w-0 flex-1 justify-center tablet:flex">
        <SearchInput name="q" size="sm" shortcut={searchKey} aria-keyshortcuts={searchKey || undefined} hideLabel placeholder={searchHint} className="w-full max-w-140" />
      </form>
      <IconLink href="/search" icon={Search} label="Search" className="tablet:hidden" />
      <IconLink href="/notifications" icon={Bell} label="Notifications" />
      {/* Phone: signing in, and the viewer's profile, are the Profile tab. */}
      <span className="hidden tablet:contents">
        {account ?? (
          <ButtonLink href="/login" size="sm">
            Sign in
          </ButtonLink>
        )}
      </span>
    </header>
  );
}

/**
 * The frame every screen sits in (design spec, Layout and grid): rail, top bar, one scrolling
 * content area, then the player and, on phone, the tab bar. It lives in the root layout, so a client
 * navigation swaps only the content and the player keeps playing.
 */
/**
 * `viewer` points Profile at the signed-in person's page; `account` is what the top bar shows in
 * place of "Sign in" for them (their avatar link), passed in so pages without a viewer don't load it.
 */
export function AppShell({
  children,
  viewer = null,
  account,
  searchHint = "Search loops, kits, producers",
  searchKey = "",
}: {
  children: ReactNode;
  viewer?: ShellViewer | null;
  account?: ReactNode;
  searchHint?: string;
  /** The key that jumps to search, shown in the box ("/"), when the page installs one. */
  searchKey?: string;
}) {
  const pathname = usePathname();
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a
        href="#content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("content")?.focus();
        }}
        className="sr-only rounded-control border border-border-strong bg-raised text-body-strong text-text focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <div className="flex min-h-0 flex-1">
        <Rail pathname={pathname} viewer={viewer} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar account={viewer ? account : undefined} searchHint={searchHint} searchKey={searchKey} />
          <div className="relative min-h-0 flex-1">
            {/* After the skip link the content area shows the focus ring, drawn inside so nothing clips it. */}
            <div id="content" tabIndex={-1} className="h-full overflow-y-auto focus-visible:-outline-offset-2">
              {children}
            </div>
            <ToastViewport />
          </div>
        </div>
      </div>
      <PlayerDock />
      <TabBar pathname={pathname} viewer={viewer} />
    </div>
  );
}
