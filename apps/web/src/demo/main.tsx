import { StrictMode, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { getEngine, usePlayerState } from "@stash/audio";
import type { ItemPage, ItemRow } from "@stash/contracts";
import {
  Bell,
  ButtonLink,
  EmptyState,
  LinkProvider,
  ResultList,
  ResultRow,
  Search,
  ToastProvider,
  TooltipProvider,
  Upload,
  User,
  useToast,
  type IconComponent,
  type PlayState,
  type ResultRowProps,
} from "@stash/ui";
import { AppShell } from "../app/_shell/app-shell";
import { nowPlaying } from "../app/_shell/now-playing";
import { ItemView } from "../app/_item/item-view";
import { LogoMark } from "../app/logo-mark";
import { buildCatalog, type Catalog } from "./data";
import { HashLink } from "./hash-link";
import { navigate, startRouter, usePath } from "./router";
import { has, set } from "./store";
import { LookPicker, startLooks, useLook } from "./looks";
import { midiItem } from "./midi/catalog";
import { MidiList, MidiPage, UploadPage, useMidiItems } from "./midi/pages";
import { PresetsPage } from "./presets/page";
import { SoundDesign } from "./sound-design";
import { BrowsePage, LibraryPage, NewCrateHost, ProfilePage, useCrateEntries, type RenderLoops } from "./explore";
import { KitsPage } from "./kits";
import { StackPage } from "./stack/page";
import type { MidiKind } from "@stash/contracts";
import { FilterChip, UiLink } from "@stash/ui";

/**
 * The browser-only demo (ticket 137): the real shell, player bar, result rows, loop page and audio
 * engine, fed by the demo catalog instead of the database, on a hash router. No server, no account.
 */

const catalog: Catalog = buildCatalog(document.baseURI);

/** A row as this browser's viewer sees it: their like, counted once. */
function withViewer(row: ItemRow): ItemRow {
  const liked = has("likes", row.id);
  return { ...row, likesCount: row.likesCount + (liked ? 1 : 0), viewer: { liked } };
}

function pageForViewer(page: ItemPage): ItemPage {
  const follows = has("follows", page.owner.id);
  const item = withViewer(page.item);
  return {
    ...page,
    item: { ...page.item, likesCount: item.likesCount, viewer: item.viewer },
    owner: { ...page.owner, viewerFollows: follows, followersCount: page.owner.followersCount + (follows ? 1 : 0) },
    moreFromOwner: page.moreFromOwner.map(withViewer),
    similar: page.similar.map(withViewer),
  };
}

let searchQuery = "";
const searchListeners = new Set<() => void>();
function useSearchQuery(): string {
  return useSyncExternalStore(
    (l) => {
      searchListeners.add(l);
      return () => searchListeners.delete(l);
    },
    () => searchQuery,
    () => "",
  );
}

function useRows(): [ItemRow[], () => void] {
  const [version, setVersion] = useState(0);
  const rows = useMemo(() => catalog.rows.map(withViewer), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  return [rows, () => setVersion((v) => v + 1)];
}

/** The loops as result rows: the list is the player's queue, arrows move the selection. */
function LoopList({ label, rows, onChange }: { label: string; rows: ItemRow[]; onChange: () => void }) {
  const engine = getEngine();
  const status = usePlayerState((s) => s.status);
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  const toast = useToast();
  const [selected, setSelected] = useState(-1);
  const stateOf = (id: string): PlayState => (id !== currentId || status === "idle" ? "paused" : status);
  const play = (i: number) => void nowPlaying().playFrom(engine, rows, i);
  // Five small previews: fetch and decode them all up front, so every row plays at once.
  useEffect(() => {
    for (const r of rows) engine.preload(r.playable);
  }, [engine, rows]);

  return (
    <div
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = Math.max(0, Math.min(rows.length - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
          setSelected(next);
          if (currentId) play(next);
        } else if (e.key === "Enter" && selected >= 0) {
          navigate(rows[selected]!.href);
        }
      }}
    >
      <ResultList label={label}>
        {rows.map((r, i) => (
          <LoopRow
            key={r.id}
            row={r}
            selected={i === selected}
            playState={stateOf(r.playable.id)}
            onPlay={() => {
              setSelected(i);
              play(i);
            }}
            onLike={(liked) => {
              set("likes", r.id, liked);
              onChange();
              if (liked) toast({ tone: "success", title: "Liked", description: "Saved in this browser. This is the demo." });
            }}
            onDownload={() => navigate(r.href)}
          />
        ))}
      </ResultList>
    </div>
  );
}

/** A loop row with the crate menu: its entries are a hook, so each row is its own component. */
function LoopRow(props: Omit<ResultRowProps, "menu">) {
  const entries = useCrateEntries(props.row.id, props.row.title);
  return <ResultRow {...props} menu={entries} />;
}

/** Loop lists for the discovery pages, each one its own play queue. */
function LoopsFor({ label, rows }: { label: string; rows: ItemRow[] }) {
  // Re-read each row as this viewer sees it, so a like made here shows here, in the order given.
  const [fresh, refresh] = useRows();
  const byId = new Map(fresh.map((r) => [r.id, r]));
  const shown = rows.map((r) => byId.get(r.id) ?? r);
  return <LoopList label={label} rows={shown} onChange={refresh} />;
}
const renderLoops: RenderLoops = (label, rows) => <LoopsFor label={label} rows={rows} />;

function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex max-w-content flex-col gap-8 px-3 py-8 tablet:px-4 desktop:px-6">{children}</main>;
}

const FEATURES = [
  { href: "/browse", name: "Browse by key and tempo", blurb: "Genre, a BPM range, a key and the keys that mix with it. Sort by trending or downloads." },
  { href: "/stack", name: "Stack sounds", blurb: "Layer up to four MIDI parts. They lock to one tempo and move into one key while they play." },
  { href: "/kits", name: "Drum kits", blurb: "Sixteen pads on your keyboard and a step sequencer. Post the bar as MIDI." },
  { href: "/sound-design", name: "Sound design", blurb: "Shape a synth patch with knobs and a scope, play it from your keyboard, save it." },
  { href: "/presets", name: "Presets behind the songs", blurb: "Which synth and preset are on famous rap records, each with a source and how sure it is." },
  { href: "/library", name: "Your library", blurb: "Likes, crates of sounds for one beat, who you follow and what you posted." },
];

function Home() {
  const [rows, refresh] = useRows();
  const midi = useMidiItems();
  return (
    <Page>
      <section className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-6">
        <div className="flex items-center gap-3">
          <LogoMark size={32} />
          <span className="text-title font-extrabold tracking-tight">stash</span>
          <span className="rounded-control border border-border-strong px-2 py-1 text-label text-label-caps text-text-muted">Demo</span>
        </div>
        <h1 className="text-display text-balance">Find a sound, hear it instantly, grab it.</h1>
        <p className="max-w-prose text-body text-text-muted">
          Press play on any loop. Open one to change its tempo and key while it plays, scrub the waveform and grab it with its license. MIDI plays
          live in a piano roll, and you can post your own .mid file. Space plays and pauses; the arrow keys move through the list. Everything here
          runs in your browser: the producers are made up, and what you like, follow and post stays on this device.
        </p>
        <div className="flex flex-col gap-4 tablet:flex-row tablet:items-end tablet:justify-between">
          <LookPicker />
          <ButtonLink href="/upload" variant="primary" icon={Upload}>
            Post a MIDI file
          </ButtonLink>
        </div>
      </section>
      <section aria-label="What you can do" className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
        {FEATURES.map((f) => (
          <UiLink key={f.href} href={f.href} className="flex flex-col gap-1 rounded-panel border border-border bg-surface p-4 ui-hover:border-border-strong">
            <span className="text-body-strong text-text">{f.name}</span>
            <span className="text-small text-text-muted">{f.blurb}</span>
          </UiLink>
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Fresh loops</h2>
        <LoopList label="Fresh loops" rows={rows} onChange={refresh} />
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-title">MIDI, live in the piano roll</h2>
          <ButtonLink href="/midi" variant="ghost" size="sm">
            {`All ${midi.length} MIDI`}
          </ButtonLink>
        </div>
        <MidiList label="MIDI" items={midi.slice(0, 6)} />
      </section>
    </Page>
  );
}

function BrowseRoute() {
  const [rows] = useRows();
  return <BrowsePage catalog={catalog} rows={rows} renderLoops={renderLoops} />;
}

function ProfileRoute({ handle }: { handle: string }) {
  const [rows] = useRows();
  return <ProfilePage key={handle} handle={handle} catalog={catalog} rows={rows} renderLoops={renderLoops} />;
}

function LibraryRoute() {
  const [rows] = useRows();
  return <LibraryPage catalog={catalog} rows={rows} renderLoops={renderLoops} />;
}

function SearchResults() {
  const [rows, refresh] = useRows();
  const query = useSearchQuery();
  const q = query.trim().toLowerCase();
  const hits = q
    ? rows.filter((r) => [r.title, r.owner.handle, r.owner.displayName, ...r.tags].some((s) => s.toLowerCase().includes(q)))
    : rows;
  const midi = useMidiItems();
  const midiHits = q ? midi.filter((m) => [m.title, m.owner.handle, m.owner.displayName, m.kind, ...m.tags].some((s) => s.toLowerCase().includes(q))) : midi;
  return (
    <Page>
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">Search</span>
        <h1 className="text-title">{q ? `Results for “${query.trim()}”` : "All loops"}</h1>
      </header>
      {hits.length > 0 || midiHits.length > 0 ? (
        <>
          {hits.length > 0 && <LoopList label="Search results" rows={hits} onChange={refresh} />}
          {midiHits.length > 0 && <MidiList label="MIDI results" items={midiHits} />}
        </>
      ) : (
        <EmptyState icon={Search} title="No loops match" action={<ButtonLink href="/" variant="secondary">See every loop</ButtonLink>}>
          The demo has five loops and a few MIDI patterns. Try “trap”, “soul”, “drums” or “nova”.
        </EmptyState>
      )}
    </Page>
  );
}

function NotInDemo({ title, icon, children }: { title: string; icon: IconComponent; children: string }) {
  return (
    <Page>
      <h1 className="text-title">{title}</h1>
      <EmptyState icon={icon} title="Not in the demo" action={<ButtonLink href="/" variant="secondary">Back to the loops</ButtonLink>}>
        {children}
      </EmptyState>
    </Page>
  );
}

function LoopPage({ publicId }: { publicId: string }) {
  const page = catalog.page(publicId);
  // Read once per visit to the page, so the viewer's like and follow show as left.
  const view = useMemo(() => (page ? { page: pageForViewer(page), viewer: { signedIn: true }, source: "local" as const } : null), [page]);
  if (!view) return <NotFound />;
  return <ItemView key={publicId} view={view} />;
}

function NotFound() {
  return (
    <Page>
      <EmptyState icon={Search} title="That loop isn't here" action={<ButtonLink href="/" variant="secondary">Back to the loops</ButtonLink>}>
        The demo has five loops. This link points at something else.
      </EmptyState>
    </Page>
  );
}

const KINDS: (MidiKind | "all")[] = ["all", "chords", "melody", "bass", "drums"];
const KIND_NAME: Record<MidiKind | "all", string> = { all: "All", chords: "Chords", melody: "Melody", bass: "Bass", drums: "Drums" };

function AllMidi() {
  const midi = useMidiItems();
  const [kind, setKind] = useState<MidiKind | "all">("all");
  const shown = kind === "all" ? midi : midi.filter((m) => m.kind === kind);
  return (
    <Page>
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">MIDI</span>
        <h1 className="text-title">Every MIDI pattern</h1>
        <p className="max-w-prose text-body text-text-muted">Original patterns across trap, boom bap, plugg, rage, drill, phonk, R&B, lo-fi, Jersey club and West Coast. Press play to hear them in the piano roll.</p>
      </header>
      <div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <FilterChip key={k} selected={kind === k} onToggle={() => setKind(k)}>
            {`${KIND_NAME[k]} ${k === "all" ? midi.length : midi.filter((m) => m.kind === k).length}`}
          </FilterChip>
        ))}
      </div>
      <MidiList label="MIDI" items={shown} />
    </Page>
  );
}

const TABS = [
  { href: "/", name: "Home" },
  { href: "/browse", name: "Browse" },
  { href: "/midi", name: "MIDI" },
  { href: "/stack", name: "Stack" },
  { href: "/kits", name: "Drum kits" },
  { href: "/sound-design", name: "Sound design" },
  { href: "/presets", name: "Presets" },
  { href: "/library", name: "Library" },
  { href: "/upload", name: "Upload" },
];

/** The demo's own tabs across the top of every page, for the screens the app's rail does not list yet. */
function DemoTabs() {
  const path = usePath();
  const current = (href: string) => (href === "/" ? path === "/" : path === href || (href === "/midi" && path.startsWith("/midi")));
  return (
    <nav aria-label="Demo sections" className="border-b border-border bg-bg">
      <ul className="mx-auto flex max-w-content gap-1 overflow-x-auto px-3 tablet:px-4 desktop:px-6">
        {TABS.map((t) => (
          <li key={t.href} className="shrink-0">
            <UiLink
              href={t.href}
              aria-current={current(t.href) ? "page" : undefined}
              className={`flex h-11 items-center border-b-2 px-3 text-body-strong ${current(t.href) ? "border-accent text-text" : "border-transparent text-text-muted ui-hover:text-text"}`}
            >
              {t.name}
            </UiLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Route() {
  const path = usePath();
  useEffect(() => {
    const page = /^\/loop\/(?:.*-)?([a-z0-9]+)$/.exec(path);
    const midiPage = /^\/midi\/(?:.*-)?([a-z0-9]+)$/.exec(path);
    const title = page ? catalog.page(page[1]!)?.item.title : midiPage ? midiItem(midiPage[1]!)?.title : null;
    document.title = title ? `${title} · Stash demo` : "Stash demo";
  }, [path]);
  const loop = /^\/loop\/(?:.*-)?([a-z0-9]+)$/.exec(path);
  if (loop) return <LoopPage publicId={loop[1]!} />;
  const midi = /^\/midi\/(?:.*-)?([a-z0-9]+)$/.exec(path);
  if (midi) return <MidiPage key={midi[1]} publicId={midi[1]!} />;
  if (path === "/") return <Home />;
  if (path.startsWith("/browse")) return <BrowseRoute />;
  if (path === "/search") return <SearchResults />;
  if (path === "/upload") return <UploadPage />;
  if (path === "/midi") return <AllMidi />;
  if (path === "/sound-design") return <SoundDesign />;
  if (path === "/presets") return <PresetsPage />;
  if (path === "/library") return <LibraryRoute />;
  if (path === "/kits") return <KitsPage />;
  if (path === "/stack") return <StackPage />;
  if (path === "/notifications")
    return <NotInDemo title="Notifications" icon={Bell}>Notifications arrive when producers you follow post. The demo has no account to send them to.</NotInDemo>;
  const profile = /^\/u\/([a-z0-9_]+)$/.exec(path);
  if (profile) return <ProfileRoute handle={profile[1]!} />;
  if (path === "/login")
    return <NotInDemo title="Profile" icon={User}>Sign-in and profiles need an account. In the demo you are already treated as signed in.</NotInDemo>;
  return <NotFound />;
}

function App() {
  // Canvases (waveforms, the piano roll) read the theme when they mount: a new look remounts the page.
  const look = useLook();
  return (
    <LinkProvider component={HashLink}>
      <TooltipProvider>
        <ToastProvider viewport={false}>
          <AppShell>
            <DemoTabs />
            <Route key={look} />
            <NewCrateHost />
          </AppShell>
        </ToastProvider>
      </TooltipProvider>
    </LinkProvider>
  );
}

startLooks();
startRouter(catalog.hrefOf, (id) => midiItem(id)?.href ?? null);

// Any app link that is not a packages/ui link (plain anchors) stays in the page.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  const href = a?.getAttribute("href");
  if (a && href?.startsWith("/")) {
    e.preventDefault();
    navigate(href);
  }
});
// The top bar's search form searches the demo's loops instead of leaving the page.
document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (form.getAttribute("role") === "search") {
    searchQuery = String(new FormData(form).get("q") ?? "");
    for (const l of searchListeners) l();
    navigate("/search");
  }
});

document.body.className = "h-dvh overflow-hidden bg-bg text-text";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
