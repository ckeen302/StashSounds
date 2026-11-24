import { Compass, House, Library, Upload, User, type IconComponent } from "@stash/ui";
import type { Viewer } from "../_auth/viewer";

export type NavItem = { href: string; label: string; icon: IconComponent; /** Path prefix that marks it current. */ match: string };

/**
 * The five destinations: the rail on tablet and desktop, the tab bar on phone (design spec, Frame
 * by width). Profile goes to sign-in for a visitor; navFor points it at a member's own page.
 */
export const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: House, match: "/" },
  { href: "/browse/loops", label: "Browse", icon: Compass, match: "/browse" },
  { href: "/upload", label: "Upload", icon: Upload, match: "/upload" },
  { href: "/library", label: "Library", icon: Library, match: "/library" },
  { href: "/login", label: "Profile", icon: User, match: "/u/" },
];

/** Home is current only on "/"; the others own their whole path below them. */
export function isCurrent(pathname: string, item: Pick<NavItem, "match">): boolean {
  if (item.match === "/") return pathname === "/";
  const m = item.match.endsWith("/") ? item.match.slice(0, -1) : item.match;
  return pathname === m || pathname.startsWith(`${m}/`);
}

/** The destinations for this viewer: a member's Profile is /u/<handle> and current on it. */
export function navFor(viewer: Viewer): NavItem[] {
  if (viewer.status !== "member") return navItems;
  return navItems.map((item) => (item.label === "Profile" ? { ...item, href: `/u/${viewer.handle}`, match: `/u/${viewer.handle}` } : item));
}
