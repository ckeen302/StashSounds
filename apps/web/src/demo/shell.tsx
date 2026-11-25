import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AudioLines,
  Bell,
  ButtonLink,
  Compass,
  Disc3,
  Drum,
  Flame,
  House,
  Icon,
  IconLink,
  KeyboardMusic,
  Library,
  MenuIcon,
  Piano,
  Search,
  SearchInput,
  Sparkles,
  ToastViewport,
  UiLink,
  Upload,
  X,
  type IconComponent,
} from "@stash/ui";
import { PlayerDock } from "../app/_shell/player-dock";
import { LogoMark } from "../app/logo-mark";
import { BRAND } from "./brand";
import { navigate, usePath } from "./router";
import { setSearchQuery, useSearchQuery } from "./search-store";

/**
 * The demo's frame. Desktop: a sidebar with the sections in three groups, one glass top bar with
 * the only global search, the content, and the player floating over the bottom edge. Phone: a
 * compact top bar, the player, and a bottom tab bar with the four most-used sections plus "More".
 */

type Section = { href: string; name: string; icon: IconComponent };
type Group = { label: string; items: Section[] };

export const GROUPS: Group[] = [
  {
    label: "Discover",
    items: [
      { href: "/", name: "Home", icon: House },
      { href: "/browse", name: "Browse", icon: Compass },
    ],
  },
  {
    label: "Sounds",
    items: [
      { href: "/loops", name: "Loops", icon: AudioLines },
      { href: "/kits", name: "Drums", icon: Drum },
      { href: "/one-shots", name: "One-shots", icon: Piano },
      { href: "/sfx", name: "SFX", icon: Flame },
    ],
  },
  {
    label: "Ideas",
    items: [
      { href: "/midi", name: "MIDI", icon: KeyboardMusic },
      { href: "/presets", name: "Presets", icon: Disc3 },
    ],
  },
  {
    label: "You",
    items: [
      { href: "/library", name: "Library", icon: Library },
      { href: "/upload", name: "Upload", icon: Upload },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.items);
/** Phone: the bottom bar's four; the rest sit behind More. */
const TABS = ["/", "/kits", "/midi", "/presets"];

/** Whether a section is where the viewer is: its own page, and the detail pages under it. */
export function isCurrent(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  if (path === href) return true;
  if (href === "/midi") return path.startsWith("/midi");
  if (href === "/presets") return path.startsWith("/presets/");
  if (href === "/kits") return path.startsWith("/kit/") || path === "/kit-upload";
  if (href === "/browse") return path.startsWith("/browse") || path.startsWith("/pack/");
  return false;
}

function Wordmark() {
  return (
    <span className="ds-wordmark" translate="no">
      {BRAND.wordmark}
    </span>
  );
}

function Sidebar({ path }: { path: string }) {
  return (
    <aside className="ds-side" aria-label="Sections">
      <UiLink href="/" aria-label={BRAND.name} className="ds-brand">
        <LogoMark size={22} />
        <Wordmark />
      </UiLink>
      <nav aria-label="Demo sections" className="ds-nav">
        {GROUPS.map((g) => (
          <div key={g.label} className="ds-nav-group">
            <span className="ds-nav-label">{g.label}</span>
            <ul>
              {g.items
                .filter((s) => s.href !== "/upload")
                .map((s) => {
                  const on = isCurrent(path, s.href);
                  return (
                    <li key={s.href}>
                      <UiLink href={s.href} aria-current={on ? "page" : undefined} className="ds-nav-link">
                        <Icon icon={s.icon} size={20} />
                        <span>{s.name}</span>
                      </UiLink>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="ds-side-cta">
        <span className="ds-side-cta-glow" aria-hidden="true" />
        <Icon icon={Sparkles} size={20} className="text-accent" />
        <p className="text-body-strong text-text">Post a sound. Get followed.</p>
        <p className="text-small text-text-muted">Every download credits you.</p>
        <ButtonLink href="/upload" variant="primary" size="sm" icon={Upload} className="mt-1 w-full">
          Upload
        </ButtonLink>
      </div>
    </aside>
  );
}

/** The one global search. "/" or ⌘K focuses it from anywhere. */
function TopSearch() {
  const ref = useRef<HTMLInputElement>(null);
  const path = usePath();
  const current = useSearchQuery();
  const [draft, setDraft] = useState("");
  // On the results page the bar edits the live query, so the results follow as you type.
  const onResults = path === "/search";
  const q = onResults ? current : draft;
  const setQ = onResults ? setSearchQuery : setDraft;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="ds-search"
      onSubmit={(e) => {
        e.preventDefault();
        setSearchQuery(q.trim());
        setDraft("");
        navigate("/search");
      }}
    >
      <SearchInput
        ref={ref}
        name="q"
        label="Search sounds, songs, producers"
        hideLabel
        shortcut="⌘K"
        placeholder="Search sounds, songs, producers"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onClear={() => setQ("")}
        className="w-full"
      />
    </form>
  );
}

function TopBar() {
  return (
    <header className="ds-top">
      <UiLink href="/" aria-label={BRAND.name} className="ds-brand ds-brand-compact">
        <LogoMark size={20} />
        <Wordmark />
      </UiLink>
      <TopSearch />
      <div className="ds-top-actions">
        <IconLink href="/search" icon={Search} label="Search" className="desktop:hidden tablet:hidden" />
        <IconLink href="/notifications" icon={Bell} label="Notifications" />
        <span className="hidden tablet:contents">
          <ButtonLink href="/login" variant="ghost" size="sm">
            Sign in
          </ButtonLink>
        </span>
      </div>
    </header>
  );
}

/** Phone: four sections and More, which opens every section as a sheet over the bar. */
function TabBar({ path }: { path: string }) {
  // The sheet belongs to the page it was opened on, so following a link in it closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const setOpen = (v: boolean) => setOpenOn(v ? path : null);
  const tabs = TABS.map((h) => ALL.find((s) => s.href === h)!);
  const moreOn = !tabs.some((t) => isCurrent(path, t.href)) && path !== "/search";
  return (
    <>
      {open && (
        <div className="ds-more" role="dialog" aria-label="All sections">
          <button type="button" className="ds-more-scrim" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="ds-more-sheet">
            {GROUPS.map((g) => (
              <div key={g.label} className="flex flex-col gap-2">
                <span className="ds-nav-label">{g.label}</span>
                <ul className="grid grid-cols-2 gap-2">
                  {g.items.map((s) => (
                    <li key={s.href}>
                      <UiLink href={s.href} aria-current={isCurrent(path, s.href) ? "page" : undefined} className="ds-more-link">
                        <Icon icon={s.icon} size={20} />
                        <span>{s.name}</span>
                      </UiLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      <nav aria-label="Tabs" className="ds-tabbar">
        <ul>
          {tabs.map((s) => {
            const on = isCurrent(path, s.href);
            return (
              <li key={s.href}>
                <UiLink href={s.href} aria-current={on ? "page" : undefined} className="ds-tab">
                  <Icon icon={s.icon} size={20} />
                  <span>{s.name}</span>
                </UiLink>
              </li>
            );
          })}
          <li>
            <button type="button" aria-expanded={open} data-on={moreOn || undefined} className="ds-tab" onClick={() => setOpen(!open)}>
              <Icon icon={open ? X : MenuIcon} size={20} />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

export function DemoShell({ children }: { children: ReactNode }) {
  const path = usePath();
  return (
    <div className="ds-app">
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
      <Sidebar path={path} />
      <div className="ds-main">
        <TopBar />
        <div className="relative min-h-0 flex-1">
          <div id="content" tabIndex={-1} className="ds-content">
            {children}
          </div>
          <ToastViewport />
        </div>
        <div className="ds-dock">
          <PlayerDock />
        </div>
        <TabBar path={path} />
      </div>
    </div>
  );
}
