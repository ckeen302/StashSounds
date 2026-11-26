import type { ItemRow, MusicalKey } from "@stash/contracts";
import { compatibleKeys, formatKey } from "@stash/contracts/format";
import {
  Avatar,
  Button,
  ButtonLink,
  Check,
  Copy,
  Dialog,
  Download,
  EmptyState,
  FilterChip,
  IconButton,
  Library as LibraryIcon,
  LicenseBadge,
  Menu,
  Plus,
  SearchInput,
  Slider,
  Stat,
  TextInput,
  Trash,
  UiLink,
  Upload,
  User,
  UserPlus,
  useToast,
  type MenuEntry,
} from "@stash/ui";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { CREATORS, producers, type Catalog, type Producer } from "./data";
import { createCrate, crateMeta, deleteCrate, rememberMeta, toggleInCrate, useCrates, type CrateMeta } from "./crates";
import { extra, VIEWER, type MidiItem } from "./midi/catalog";
import { MidiList, useMidiItems } from "./midi/pages";
import { CHORDS_OWNER } from "./midi/songs";
import { has, set } from "./store";
import { creditTag, deleteReceipt, receiptText, useReceipts, type Receipt } from "./receipts";

/**
 * The demo's discovery screens: one browse page over loops and MIDI with the filters producers
 * actually search by (genre, tempo range, key and the keys that mix with it), creator profiles,
 * crates, and the library. Everything is read from the demo catalog and this browser's storage.
 */

export type RenderLoops = (label: string, rows: ItemRow[]) => ReactNode;

export const ALL_PRODUCERS: Producer[] = [...new Set([...Object.values(producers), ...Object.values(extra), ...CREATORS, CHORDS_OWNER])];
export function producerByHandle(handle: string): Producer | null {
  if (handle === VIEWER.handle) return VIEWER;
  return ALL_PRODUCERS.find((p) => p.handle === handle) ?? null;
}

// ---------------------------------------------------------------------------------------------
// One shape for both kinds of sound, so filters and sorts read the same fields.

type Sound = {
  id: string;
  type: "loop" | "midi";
  title: string;
  handle: string;
  bpm: number | null;
  key: MusicalKey | null;
  words: string[];
  genres: string[];
  likes: number;
  downloads: number;
  publishedAt: string;
  row?: ItemRow;
  item?: MidiItem;
};

export const GENRES: { name: string; tags: string[] }[] = [
  { name: "Trap", tags: ["trap", "melodic trap"] },
  { name: "Drill", tags: ["drill", "uk drill"] },
  { name: "Boom bap", tags: ["boom bap"] },
  { name: "Plugg", tags: ["plugg", "pluggnb"] },
  { name: "R&B", tags: ["rnb", "r&b", "neo soul"] },
  { name: "Soul", tags: ["soul", "neo soul"] },
  { name: "Lo-fi", tags: ["lo-fi"] },
  { name: "Phonk", tags: ["phonk", "memphis"] },
  { name: "Rage", tags: ["rage"] },
  { name: "Jersey club", tags: ["jersey club"] },
  { name: "West Coast", tags: ["west coast", "g funk"] },
];

function genresOf(words: string[]): string[] {
  const w = words.map((s) => s.toLowerCase());
  return GENRES.filter((g) => g.tags.some((t) => w.includes(t))).map((g) => g.name);
}

function loopSound(row: ItemRow, catalog: Catalog): Sound {
  const genre = catalog.page(row.publicId)?.item.genre ?? "";
  const words = [...row.tags, genre];
  return {
    id: row.id,
    type: "loop",
    title: row.title,
    handle: row.owner.handle,
    bpm: row.bpm ?? null,
    key: row.key ?? null,
    words: [row.title, row.owner.handle, row.owner.displayName, ...words],
    genres: genresOf(words),
    likes: row.likesCount,
    downloads: row.downloadsCount,
    publishedAt: row.publishedAt,
    row,
  };
}

function midiSound(m: MidiItem): Sound {
  return {
    id: m.id,
    type: "midi",
    title: m.title,
    handle: m.owner.handle,
    bpm: Math.round(m.notes.bpm),
    key: m.key,
    words: [m.title, m.owner.handle, m.owner.displayName, m.kind, ...m.tags],
    genres: genresOf(m.tags),
    likes: m.likes + (has("likes", m.id) ? 1 : 0),
    downloads: m.downloads,
    publishedAt: m.publishedAt,
    item: m,
  };
}

/** Likes per day since it was posted, damped so a new sound with a few likes can still rise. */
function trending(s: Sound): number {
  const days = Math.max(0, (Date.now() - Date.parse(s.publishedAt)) / 86_400_000);
  return (s.likes + s.downloads / 4) / (days + 2) ** 1.4;
}

const SORTS = {
  new: { label: "Newest", by: (a: Sound, b: Sound) => b.publishedAt.localeCompare(a.publishedAt) },
  trending: { label: "Trending", by: (a: Sound, b: Sound) => trending(b) - trending(a) },
  downloads: { label: "Most downloaded", by: (a: Sound, b: Sound) => b.downloads - a.downloads },
  bpm: { label: "Tempo", by: (a: Sound, b: Sound) => (a.bpm ?? 0) - (b.bpm ?? 0) },
} as const;
type SortId = keyof typeof SORTS;

const sameKey = (a: MusicalKey, b: MusicalKey) => a.root === b.root && a.mode === b.mode;
const keyId = (k: MusicalKey) => `${k.root}${k.mode}`;

// Filters survive leaving the page and coming back, for this visit.
type Filters = { q: string; type: "all" | "loop" | "midi"; genre: string | null; key: string | null; mix: boolean; min: number; max: number; sort: SortId };
const DEFAULT: Filters = { q: "", type: "all", genre: null, key: null, mix: false, min: 60, max: 180, sort: "trending" };
const saved: Record<string, Filters> = {};

function useSounds(catalog: Catalog, loopRows: ItemRow[]): Sound[] {
  const midi = useMidiItems();
  return useMemo(() => [...loopRows.map((r) => loopSound(r, catalog)), ...midi.map(midiSound)], [catalog, loopRows, midi]);
}

export function BrowsePage({ catalog, rows, renderLoops, only }: { catalog: Catalog; rows: ItemRow[]; renderLoops: RenderLoops; only?: "loop" }) {
  const every = useSounds(catalog, rows);
  const all = only ? every.filter((s) => s.type === only) : every;
  const page = only ?? "all";
  const [f, setF] = useState<Filters>(saved[page] ?? DEFAULT);
  const update = (patch: Partial<Filters>) =>
    setF((cur) => {
      saved[page] = { ...cur, ...patch };
      return saved[page];
    });

  const keys = useMemo(() => {
    const seen = new Map<string, MusicalKey>();
    for (const s of all) if (s.key) seen.set(keyId(s.key), s.key);
    return [...seen.values()].sort((a, b) => a.mode.localeCompare(b.mode) || a.root - b.root);
  }, [all]);
  const picked = keys.find((k) => keyId(k) === f.key) ?? null;
  const mixes = picked ? compatibleKeys(picked) : [];

  const q = f.q.trim().toLowerCase();
  const shown = all
    .filter((s) => f.type === "all" || s.type === f.type)
    .filter((s) => !f.genre || s.genres.includes(f.genre))
    .filter((s) => s.bpm === null || (s.bpm >= f.min && s.bpm <= f.max))
    .filter((s) => !picked || (s.key !== null && (f.mix ? mixes.some((k) => sameKey(k, s.key!)) : sameKey(picked, s.key))))
    .filter((s) => !q || s.words.some((w) => w.toLowerCase().includes(q)))
    .sort(SORTS[f.sort].by);
  const loops = shown.filter((s) => s.row).map((s) => s.row!);
  const midi = shown.filter((s) => s.item).map((s) => s.item!);
  const genreCount = (g: string) => all.filter((s) => s.genres.includes(g)).length;
  const touched = JSON.stringify(f) !== JSON.stringify(DEFAULT);

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">{only ? "Loops" : "Browse"}</span>
        <h1 className="text-title">{only ? "Loops, filtered the way you search" : "Every sound, filtered the way you search"}</h1>
      </header>

      <section aria-label="Filters" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
        <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
          <SearchInput label="Search titles, producers, tags" shortcut="" value={f.q} onChange={(e) => update({ q: e.target.value })} onClear={() => update({ q: "" })} className="tablet:w-80" />
          <div role="group" aria-label="Type" className={`flex flex-wrap gap-2 ${only ? "hidden" : ""}`}>
            {(["all", "loop", "midi"] as const).map((t) => (
              <FilterChip key={t} selected={f.type === t} onToggle={() => update({ type: t })}>
                {`${t === "all" ? "All" : t === "loop" ? "Loops" : "MIDI"} ${t === "all" ? all.length : all.filter((s) => s.type === t).length}`}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-label text-label-caps text-text-muted">Genre</span>
          <div role="group" aria-label="Genre" className="flex flex-wrap gap-2">
            {GENRES.map((g) => (
              <FilterChip key={g.name} selected={f.genre === g.name} onToggle={() => update({ genre: f.genre === g.name ? null : g.name })}>
                {`${g.name} ${genreCount(g.name)}`}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-label text-label-caps text-text-muted">Slowest</span>
              <span className="font-mono text-numeric tabular text-text">{`${f.min} BPM`}</span>
            </div>
            <Slider label="Slowest BPM" value={f.min} min={60} max={180} step={1} valueText={(v) => `${v} BPM`} onValueChange={(v) => update({ min: Math.min(v, f.max) })} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-label text-label-caps text-text-muted">Fastest</span>
              <span className="font-mono text-numeric tabular text-text">{`${f.max} BPM`}</span>
            </div>
            <Slider label="Fastest BPM" value={f.max} min={60} max={180} step={1} valueText={(v) => `${v} BPM`} onValueChange={(v) => update({ max: Math.max(v, f.min) })} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-label text-label-caps text-text-muted">Key</span>
          <div role="group" aria-label="Key" className="flex flex-wrap gap-2">
            {keys.map((k) => (
              <FilterChip key={keyId(k)} selected={f.key === keyId(k)} onToggle={() => update({ key: f.key === keyId(k) ? null : keyId(k) })}>
                {formatKey(k)}
              </FilterChip>
            ))}
          </div>
          {picked && (
            <div className="flex flex-wrap items-center gap-3">
              <FilterChip selected={f.mix} onToggle={() => update({ mix: !f.mix })}>
                {`Mixes with ${formatKey(picked)}`}
              </FilterChip>
              <span className="text-small text-text-muted">{f.mix ? `Showing ${mixes.map(formatKey).join(", ")}` : `Only ${formatKey(picked)}`}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4 tablet:flex-row tablet:items-center tablet:justify-between">
          <div role="group" aria-label="Sort" className="flex flex-wrap gap-2">
            {(Object.keys(SORTS) as SortId[]).map((s) => (
              <FilterChip key={s} selected={f.sort === s} onToggle={() => update({ sort: s })}>
                {SORTS[s].label}
              </FilterChip>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span aria-live="polite" className="font-mono text-numeric tabular text-text">{`${shown.length} ${shown.length === 1 ? "sound" : "sounds"}`}</span>
            {touched && (
              <Button size="sm" variant="ghost" onClick={() => update(DEFAULT)}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </section>

      {loops.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title">{`Loops ${loops.length}`}</h2>
          {renderLoops("Loops", loops)}
        </section>
      )}
      {midi.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title">{`MIDI ${midi.length}`}</h2>
          <MidiList label="MIDI" items={midi} />
        </section>
      )}
      {shown.length === 0 && (
        <EmptyState icon={LibraryIcon} title="Nothing matches all of that" action={<Button variant="secondary" onClick={() => update(DEFAULT)}>Clear filters</Button>}>
          Widen the tempo range, turn on “Mixes with”, or drop the genre.
        </EmptyState>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Follows, read live so a follow on one screen shows on the next.

let followTick = 0;
const followListeners = new Set<() => void>();
export function setFollow(id: string, on: boolean) {
  set("follows", id, on);
  followTick++;
  for (const l of followListeners) l();
}
function useFollowTick(): number {
  return useSyncExternalStore(
    (l) => {
      followListeners.add(l);
      return () => followListeners.delete(l);
    },
    () => followTick,
    () => 0,
  );
}

export function ProfilePage({ handle, catalog, rows, renderLoops }: { handle: string; catalog: Catalog; rows: ItemRow[]; renderLoops: RenderLoops }) {
  useFollowTick();
  const p = producerByHandle(handle);
  const all = useSounds(catalog, rows).filter((s) => s.handle === handle);
  if (!p) {
    return (
      <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
        <EmptyState icon={User} title="No producer by that name" action={<ButtonLink href="/loops" variant="secondary">See every loop</ButtonLink>}>
          {`The demo has no one called @${handle}.`}
        </EmptyState>
      </main>
    );
  }
  const own = p.id === VIEWER.id;
  const following = has("follows", p.id);
  const loops = all.filter((s) => s.row).sort(SORTS.new.by).map((s) => s.row!);
  const midi = all.filter((s) => s.item).sort(SORTS.new.by).map((s) => s.item!);
  const downloads = all.reduce((n, s) => n + s.downloads, 0);
  const likes = all.reduce((n, s) => n + s.likes, 0);
  const genres = [...new Set(all.flatMap((s) => s.genres))];
  const bpms = all.map((s) => s.bpm).filter((b): b is number => b !== null);

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <section aria-label="Producer" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-6">
        <div className="flex flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={p.displayName} src={null} size={64} />
            <div className="flex min-w-0 flex-col">
              <h1 className="truncate text-title">{p.displayName}</h1>
              <span className="text-body text-text-muted">@{p.handle}</span>
            </div>
          </div>
          {own ? (
            <ButtonLink href="/upload" variant="primary" icon={Upload}>
              Post a MIDI file
            </ButtonLink>
          ) : (
            <Button variant={following ? "secondary" : "primary"} icon={following ? Check : UserPlus} aria-pressed={following} onClick={() => setFollow(p.id, !following)}>
              {following ? "Following" : "Follow"}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 tablet:grid-cols-4">
          <Stat label="Followers" value={p.followers + (following ? 1 : 0)} />
          <Stat label="Sounds" value={all.length} />
          <Stat label="Downloads" value={downloads} />
          <Stat label="Likes" value={likes} />
        </div>
        {(genres.length > 0 || bpms.length > 0) && (
          <p className="text-small text-text-muted">
            {[genres.length > 0 ? `Makes ${genres.join(", ")}` : "", bpms.length > 0 ? `${Math.min(...bpms)} to ${Math.max(...bpms)} BPM` : ""].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="text-small text-text-muted">{own ? "This is you in the demo. What you post stays in this browser." : p.handle === "stash" ? "Stash's own account: the loops, patterns and kits made for this demo. Counts start at zero." : "A producer posting their own sounds. Counts start at zero."}</p>
      </section>

      {loops.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title">{`Loops ${loops.length}`}</h2>
          {renderLoops(`Loops by ${p.displayName}`, loops)}
        </section>
      )}
      {midi.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title">{`MIDI ${midi.length}`}</h2>
          <MidiList label={`MIDI by ${p.displayName}`} items={midi} />
        </section>
      )}
      {all.length === 0 && (
        <EmptyState icon={Upload} title="Nothing posted yet" action={own ? <ButtonLink href="/upload" variant="secondary">Post a MIDI file</ButtonLink> : undefined}>
          {own ? "Post a .mid file and it shows up here." : "When they post, it shows here."}
        </EmptyState>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Crates: a menu on every row and page, and one dialog for naming a new crate.

let pendingItem: { id: string; title: string; meta?: CrateMeta } | null = null;
let pendingTick = 0;
const pendingListeners = new Set<() => void>();
function requestNewCrate(id: string, title: string, meta?: CrateMeta) {
  pendingItem = { id, title, meta };
  pendingTick++;
  for (const l of pendingListeners) l();
}

/** Menu entries for putting a sound in a crate: one per crate (checked when it is in), then "New crate". */
export function useCrateEntries(itemId: string, title: string, meta?: Omit<CrateMeta, "title">): MenuEntry[] {
  const list = useCrates();
  const toast = useToast();
  return [
    ...list.map(
      (c): MenuEntry => ({
        label: `${c.items.includes(itemId) ? "In" : "Add to"} ${c.name}`,
        icon: c.items.includes(itemId) ? Check : Plus,
        onSelect: () => {
          if (meta) rememberMeta(itemId, { title, ...meta });
          const added = toggleInCrate(c.id, itemId);
          toast({ tone: "success", title: added ? `Added to ${c.name}` : `Removed from ${c.name}`, description: title });
        },
      }),
    ),
    ...(list.length > 0 ? [{ separator: true } as MenuEntry] : []),
    { label: "New crate…", icon: Plus, onSelect: () => requestNewCrate(itemId, title, meta ? { title, ...meta } : undefined) },
  ];
}

/**
 * The crate button. Loops and MIDI items need only their id; anything else (a preset, one-shot,
 * sample, kit, sound effect) passes `kind` and `href` so the library can list and link it.
 */
export function CrateMenu({ itemId, title, kind, href, by, size }: { itemId: string; title: string; kind?: string; href?: string; by?: string; size?: "sm" }) {
  const entries = useCrateEntries(itemId, title, kind && href ? { kind, href, by } : undefined);
  if (size === "sm")
    return <Menu entries={entries} trigger={<Button size="sm" variant="ghost" icon={LibraryIcon} aria-label={`Add ${title} to a crate`} className="max-tablet:gap-0 max-tablet:px-2 max-tablet:*:last:sr-only">Crate</Button>} />;
  return <Menu entries={entries} trigger={<Button variant="secondary" icon={LibraryIcon} aria-label={`Add ${title} to a crate`}>Crate</Button>} />;
}

/** Rendered once in the app: the dialog that names a new crate and puts the sound in it. */
export function NewCrateHost() {
  const tick = useSyncExternalStore(
    (l) => {
      pendingListeners.add(l);
      return () => pendingListeners.delete(l);
    },
    () => pendingTick,
    () => 0,
  );
  const [closedAt, setClosedAt] = useState(0);
  const [name, setName] = useState("");
  const toast = useToast();
  const open = tick > closedAt && pendingItem !== null;
  const close = () => {
    setClosedAt(tick);
    setName("");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      variant="form"
      title="New crate"
      description={pendingItem ? `A crate is your own collection. ${pendingItem.title} goes in first.` : undefined}
      confirmLabel="Create crate"
      onConfirm={() => {
        if (!pendingItem) return;
        if (pendingItem.meta) rememberMeta(pendingItem.id, pendingItem.meta);
        const c = createCrate(name || "New crate", pendingItem.id);
        toast({ tone: "success", title: `Made ${c.name}`, description: `${pendingItem.title} is in it. Find it under the Library icon at the top.` });
        close();
      }}
    >
      <TextInput label="Name" value={name} maxLength={40} placeholder="Late night chops" onChange={(e) => setName(e.target.value)} />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// License receipts: one per download, for answering a Content ID claim.

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ReceiptsSection({ receipts }: { receipts: Receipt[] }) {
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<Receipt | null>(null);
  const copy = async (text: string, what: string) =>
    toast((await copyText(text)) ? { tone: "success", title: `Copied the ${what}` } : { tone: "error", title: `Could not copy the ${what}`, description: "Your browser blocked the clipboard." });
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <section id="lib-receipts" aria-labelledby="receipts-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="receipts-title" className="text-title">License receipts</h2>
        <p className="max-w-prose text-body text-text-muted">
          Every download gets a receipt: the sound, who made it, where it came from, the license and the date. If YouTube Content ID claims your beat, copy the
          receipt into your dispute. Downloads also carry it inside the zip.
        </p>
      </div>
      {receipts.length === 0 && <p className="text-body text-text-muted">No downloads yet. Grab any sound and its receipt shows up here.</p>}
      {receipts.length > 0 && (
        <ul aria-label="License receipts" className="flex flex-col gap-3">
          {receipts.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-label text-label-caps text-text-muted">{`${r.kind} · ${fmt(r.createdAt)}`}</span>
                  <span className="truncate text-body-strong text-text">{r.title}</span>
                  <span className="text-small text-text-muted">{`By ${r.by} · Receipt ${r.id}`}</span>
                </div>
                <LicenseBadge kind={r.license} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copy(creditTag(r), "credit tag")}>
                  Copy credit tag
                </Button>
                <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copy(receiptText(r), "receipt")}>
                  Copy receipt
                </Button>
                <Button size="sm" variant="ghost" icon={Download} onClick={() => {
                  const a = document.createElement("a");
                  const url = URL.createObjectURL(new Blob([receiptText(r)], { type: "text/plain" }));
                  a.href = url;
                  a.download = `Stash receipt ${r.id}.txt`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 10_000);
                }}>
                  Save .txt
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {open === r.id ? "Hide details" : "Show details"}
                </Button>
                <IconButton icon={Trash} label={`Delete receipt for ${r.title}`} onClick={() => setDoomed(r)} />
              </div>
              <code className="rounded-control border border-border px-3 py-2 text-small text-text">{creditTag(r)}</code>
              {open === r.id && <pre className="overflow-x-auto whitespace-pre-wrap rounded-control border border-border p-3 text-small text-text-muted">{receiptText(r)}</pre>}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!doomed}
        onOpenChange={(o) => !o && setDoomed(null)}
        variant="confirm"
        destructive
        title="Delete this receipt?"
        description="It is your proof of license if a claim comes in. Copy it somewhere first if you might need it."
        confirmLabel="Delete receipt"
        onConfirm={() => {
          if (doomed) deleteReceipt(doomed.id);
          setDoomed(null);
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The library: what you liked, your crates, who you follow, what you posted.

export function LibraryPage({ catalog, rows, renderLoops }: { catalog: Catalog; rows: ItemRow[]; renderLoops: RenderLoops }) {
  useFollowTick();
  const all = useSounds(catalog, rows);
  const list = useCrates();
  const toast = useToast();
  const [doomed, setDoomed] = useState<string | null>(null);
  const liked = all.filter((s) => has("likes", s.id) || s.row?.viewer?.liked);
  const followed = ALL_PRODUCERS.filter((p) => has("follows", p.id));
  const mine = all.filter((s) => s.item?.mine).map((s) => s.item!);
  const split = (xs: Sound[]) => ({ loops: xs.filter((s) => s.row).map((s) => s.row!), midi: xs.filter((s) => s.item).map((s) => s.item!) });
  const likedSplit = split(liked);
  const byId = new Map(all.map((s) => [s.id, s]));
  const doomedCrate = list.find((c) => c.id === doomed);
  const metas = crateMeta();
  const slips = useReceipts();

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-8 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-title">Your stash</h1>
      </header>

      <nav aria-label="Library sections" className="flex flex-wrap gap-2">
        {[
          ["#lib-crates", `Crates ${list.length}`],
          ["#lib-likes", `Likes ${liked.length}`],
          ["#lib-receipts", `Receipts ${slips.length}`],
          ["#lib-following", `Following ${followed.length}`],
          ["#lib-posts", `Your posts ${mine.length}`],
        ].map(([href, label]) => (
          <a key={href} href={href} onClick={(e) => { e.preventDefault(); document.querySelector(href!)?.scrollIntoView({ behavior: "smooth" }); }} className="rounded-control border border-border px-3 py-2 text-small text-text ui-hover:border-border-strong">
            {label}
          </a>
        ))}
      </nav>

      <section id="lib-crates" aria-labelledby="crates-title" className="flex flex-col gap-4">
        <h2 id="crates-title" className="text-title">Crates</h2>
        {list.length === 0 && (
          <p className="max-w-prose text-body text-text-muted">
            No crates yet. Open the menu on any loop, or the crate button on any MIDI page, and pick “New crate…”. Crates are how you keep sounds for one beat or one
            artist together.
          </p>
        )}
        {list.map((c) => {
          const contents = split(c.items.map((id) => byId.get(id)).filter((s): s is Sound => !!s));
          const others = c.items.filter((id) => !byId.has(id) && metas[id]).map((id) => ({ id, ...metas[id]! }));
          return (
            <div key={c.id} className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-body-strong text-text">{c.name}</span>
                  <span className="text-small text-text-muted">{`${c.items.length} ${c.items.length === 1 ? "sound" : "sounds"}`}</span>
                </div>
                <IconButton icon={Trash} label={`Delete ${c.name}`} onClick={() => setDoomed(c.id)} />
              </div>
              {contents.loops.length > 0 && renderLoops(`Loops in ${c.name}`, contents.loops)}
              {contents.midi.length > 0 && <MidiList label={`MIDI in ${c.name}`} items={contents.midi} />}
              {others.length > 0 && (
                <ul aria-label={`More in ${c.name}`} className="flex flex-col divide-y divide-border rounded-panel border border-border">
                  {others.map((o) => (
                    <li key={o.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-24 shrink-0 text-label text-label-caps text-text-muted">{o.kind}</span>
                      <UiLink href={o.href} className="min-w-0 flex-1 truncate text-body-strong text-text ui-hover:underline">
                        {o.title}
                      </UiLink>
                      {o.by && <span className="hidden truncate text-small text-text-muted tablet:inline">{o.by}</span>}
                      <IconButton icon={Trash} label={`Remove ${o.title} from ${c.name}`} onClick={() => { toggleInCrate(c.id, o.id); toast({ tone: "info", title: `Removed from ${c.name}`, description: o.title }); }} />
                    </li>
                  ))}
                </ul>
              )}
              {c.items.length === 0 && <p className="text-small text-text-muted">Empty. Add sounds from their menu.</p>}
            </div>
          );
        })}
      </section>

      <section id="lib-likes" aria-labelledby="likes-title" className="flex flex-col gap-3">
        <h2 id="likes-title" className="text-title">Likes</h2>
        {liked.length === 0 && <p className="text-body text-text-muted">Nothing liked yet. Tap the heart on any sound.</p>}
        {likedSplit.loops.length > 0 && renderLoops("Liked loops", likedSplit.loops)}
        {likedSplit.midi.length > 0 && <MidiList label="Liked MIDI" items={likedSplit.midi} />}
      </section>

      <ReceiptsSection receipts={slips} />

      <section id="lib-following" aria-labelledby="following-title" className="flex flex-col gap-3">
        <h2 id="following-title" className="text-title">Following</h2>
        {followed.length === 0 && <p className="text-body text-text-muted">You follow no one yet. Open a producer and press Follow.</p>}
        <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
          {followed.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-panel border border-border bg-surface p-3">
              <Avatar name={p.displayName} src={null} size={32} />
              <UiLink href={`/u/${p.handle}`} className="min-w-0 flex-1 truncate text-body-strong text-text ui-hover:underline">
                {p.displayName}
              </UiLink>
              <Button size="sm" variant="ghost" onClick={() => setFollow(p.id, false)}>
                Unfollow
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section id="lib-posts" aria-labelledby="posts-title" className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <h2 id="posts-title" className="text-title">Your posts</h2>
          <ButtonLink href="/upload" variant="ghost" size="sm" icon={Upload}>
            Post a MIDI file
          </ButtonLink>
        </div>
        {mine.length === 0 ? <p className="text-body text-text-muted">Nothing posted from this browser yet.</p> : <MidiList label="Your posts" items={mine} />}
      </section>

      <Dialog
        open={!!doomedCrate}
        onOpenChange={(o) => !o && setDoomed(null)}
        variant="confirm"
        destructive
        title={`Delete ${doomedCrate?.name ?? "crate"}?`}
        description="The sounds stay on Stash; only the crate goes."
        confirmLabel="Delete crate"
        onConfirm={() => {
          if (doomedCrate) {
            deleteCrate(doomedCrate.id);
            toast({ tone: "info", title: `Deleted ${doomedCrate.name}` });
          }
          setDoomed(null);
        }}
      />
    </main>
  );
}

