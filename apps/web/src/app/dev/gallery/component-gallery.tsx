"use client";

import {
  Avatar,
  Button,
  Copy,
  Dialog,
  DialogPreview,
  Download,
  Ellipsis,
  EmptyState,
  ErrorState,
  FilterChip,
  Flag,
  Heart,
  IconButton,
  Inbox,
  LicenseBadge,
  Link as LinkIcon,
  Menu,
  MenuPreview,
  Play,
  PlayButton,
  Plus,
  ProgressSteps,
  ResultList,
  ResultListSkeleton,
  ResultRow,
  SearchInput,
  Share2,
  SkeletonCard,
  SkeletonText,
  SlidersHorizontal,
  Stat,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TagChip,
  TextInput,
  ToastPreview,
  Tooltip,
  TooltipSurface,
  Trash,
  TypeChip,
  Upload,
  UploaderCard,
  useToast,
  Waveform,
  type MenuEntry,
  type PlayState,
} from "@stash/ui";
import { ITEM_TYPES } from "@stash/contracts";
import { useState, type ReactNode } from "react";
import { rows } from "./gallery-data";

/** A component's block: engraved name, then its specimens. */
function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-label text-label-caps text-text-muted">
          {title}
        </h2>
        {note && <p className="text-small text-text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** One state of one component on a surface panel, captioned below. */
function Specimen({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <figure className={`flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface p-4 ${wide ? "col-span-full" : ""}`}>
      <div className="flex min-h-10 flex-wrap items-center gap-3">{children}</div>
      <figcaption className="text-label text-label-caps text-text-muted">{label}</figcaption>
    </figure>
  );
}

function Grid({ children, cols = "desktop:grid-cols-5" }: { children: ReactNode; cols?: string }) {
  return <div className={`grid grid-cols-1 gap-3 tablet:grid-cols-2 ${cols}`}>{children}</div>;
}

const menuEntries: MenuEntry[] = [
  { label: "Add to queue", icon: Plus, shortcut: "Q" },
  { label: "Copy link", icon: LinkIcon, shortcut: "C" },
  { label: "Share", icon: Share2 },
  { label: "Download stems", icon: Download, disabled: true },
  { separator: true },
  { label: "Report", icon: Flag, destructive: true },
];

/** The right-click and long-press menu on a row: the row's own actions first, with their keys. */
const contextEntries: MenuEntry[] = [
  { label: "Play", icon: Play, shortcut: "Space" },
  { label: "Like", icon: Heart, shortcut: "L" },
  { label: "Download", icon: Download, shortcut: "D" },
  { separator: true },
  ...menuEntries,
];

function LiveDialogs() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  return (
    <div className="flex flex-wrap gap-3">
      <Dialog
        trigger={<Button>Open confirm</Button>}
        title="Delete this loop?"
        description="Midnight keys will be removed from your profile and from every playlist. This cannot be undone."
        confirmLabel="Delete"
        destructive
      />
      <Dialog
        variant="form"
        open={open}
        onOpenChange={setOpen}
        trigger={<Button>Open form</Button>}
        title="Edit title"
        confirmLabel="Save"
        loading={loading}
        onConfirm={() => {
          setLoading(true);
          setTimeout(() => {
            setLoading(false);
            setOpen(false);
          }, 1200);
        }}
      >
        <TextInput label="Title" defaultValue="Midnight keys" />
      </Dialog>
    </div>
  );
}

function LiveToasts() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => toast({ tone: "info", title: "Added to queue", description: "Dusty soul chops plays next." })}>Info</Button>
      <Button onClick={() => toast({ tone: "success", title: "Published", description: "Midnight keys is live on your profile." })}>Success</Button>
      <Button onClick={() => toast({ tone: "error", title: "Upload failed", description: "This file is longer than 60 seconds. Trim it and upload again." })}>Error</Button>
      <Button onClick={() => toast({ tone: "info", title: "Removed from likes", action: { label: "Undo", altText: "Like it again from its page", onAction: () => undefined } })}>
        With undo
      </Button>
    </div>
  );
}

function LiveRows() {
  const [current, setCurrent] = useState<string | null>(null);
  const [state, setState] = useState<PlayState>("paused");
  const [progress, setProgress] = useState(0);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const list = [rows.dustySoul, rows.midnightKeys, rows.trapBells];
  return (
    <ResultList label="Live rows">
      {list.map((r) => (
        <ResultRow
          key={r.id}
          row={{ ...r, viewer: { liked: liked[r.id] ?? r.viewer?.liked ?? false } }}
          playState={current === r.id ? state : "paused"}
          progress={current === r.id ? progress : 0}
          onPlay={() => {
            if (current === r.id && state === "playing") return setState("paused");
            setCurrent(r.id);
            setState("playing");
          }}
          onScrub={(f) => {
            setCurrent(r.id);
            setProgress(f);
          }}
          onLike={(v) => setLiked((m) => ({ ...m, [r.id]: v }))}
          menu={contextEntries}
        />
      ))}
    </ResultList>
  );
}

export function ComponentGallery() {
  const [query, setQuery] = useState("dusty");
  const [heroAt, setHeroAt] = useState(0.42);
  return (
    <div className="flex flex-col gap-12">
      <Section id="c-button" title="Button" note="Primary, secondary, ghost, danger at 40 and 32 px; hover, focus, pressed, disabled, loading.">
        {(["primary", "secondary", "ghost", "danger"] as const).map((v) => (
          <Grid key={v} cols="desktop:grid-cols-6">
            <Specimen label={`${v} default`}>
              <Button variant={v} icon={v === "primary" ? Upload : v === "danger" ? Trash : undefined}>
                {v === "primary" ? "Upload" : v === "danger" ? "Delete" : v === "ghost" ? "Cancel" : "Download"}
              </Button>
              <Button variant={v} size="sm">
                Small
              </Button>
            </Specimen>
            <Specimen label="hover">
              <Button variant={v} data-hover>
                Hover
              </Button>
            </Specimen>
            <Specimen label="focus">
              <Button variant={v} data-focus>
                Focus
              </Button>
            </Specimen>
            <Specimen label="pressed">
              <Button variant={v} data-active>
                Pressed
              </Button>
            </Specimen>
            <Specimen label="disabled">
              <Button variant={v} disabled>
                Disabled
              </Button>
            </Specimen>
            <Specimen label="loading">
              <Button variant={v} loading>
                {v === "primary" ? "Publishing" : "Saving"}
              </Button>
            </Specimen>
          </Grid>
        ))}
      </Section>

      <Section id="c-icon-button" title="Icon button" note="Ghost and pad; hover, focus, pressed, disabled, on.">
        <Grid cols="desktop:grid-cols-6">
          {(["ghost", "pad"] as const).map((v) => (
            <div key={v} className="contents">
              <Specimen label={`${v} default`}>
                <IconButton variant={v} icon={Heart} label="Like" />
                <IconButton variant={v} icon={SlidersHorizontal} label="Filters" size="md" />
              </Specimen>
              <Specimen label="hover">
                <IconButton variant={v} icon={Heart} label="Like" data-hover />
              </Specimen>
              <Specimen label="focus">
                <IconButton variant={v} icon={Heart} label="Like" data-focus />
              </Specimen>
              <Specimen label="pressed">
                <IconButton variant={v} icon={Heart} label="Like" data-active />
              </Specimen>
              <Specimen label="disabled">
                <IconButton variant={v} icon={Heart} label="Like" disabled />
              </Specimen>
              <Specimen label="on">
                <IconButton variant={v} icon={Heart} label="Like" on />
              </Specimen>
            </div>
          ))}
        </Grid>
      </Section>

      <Section id="c-play" title="Play button" note="Row 40 px and hero 64 px; paused, loading ring, playing (lit), error.">
        <Grid cols="desktop:grid-cols-5">
          {(["paused", "loading", "playing", "error"] as const).map((s) => (
            <Specimen key={s} label={s}>
              <PlayButton title="Dusty soul chops" state={s} />
              <PlayButton title="Dusty soul chops" state={s} size="hero" />
            </Specimen>
          ))}
          <Specimen label="hover, focus">
            <PlayButton title="Dusty soul chops" data-hover />
            <PlayButton title="Dusty soul chops" data-focus />
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-input" title="Text and search input" note="With icon, with shortcut hint; focus, filled, invalid with message, disabled.">
        <Grid cols="desktop:grid-cols-3">
          <Specimen label="search, default">
            <SearchInput placeholder="Search loops, kits, producers" className="w-full" />
          </Specimen>
          <Specimen label="search, focus">
            <SearchInput placeholder="Search loops, kits, producers" className="w-full" data-focus />
          </Specimen>
          <Specimen label="search, filled">
            <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery("")} className="w-full" />
          </Specimen>
          <Specimen label="text, with hint">
            <TextInput label="Title" placeholder="Name it like you would a bounce" hint="Shown on rows and your profile." className="w-full" />
          </Specimen>
          <Specimen label="text, invalid">
            <TextInput label="BPM" defaultValue="400" error="BPM must be between 40 and 300." className="w-full" inputMode="numeric" />
          </Specimen>
          <Specimen label="text, disabled">
            <TextInput label="Key" defaultValue="F#m" disabled className="w-full" />
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-chip" title="Chip" note="Type, tag, filter; selected, removable, hover.">
        <Grid cols="desktop:grid-cols-4">
          <Specimen label="type">
            {ITEM_TYPES.map((t) => (
              <TypeChip key={t} type={t} />
            ))}
          </Specimen>
          <Specimen label="tag, hover, removable">
            <TagChip>boom bap</TagChip>
            <TagChip onClick={() => undefined} data-hover>
              soul
            </TagChip>
            <TagChip onRemove={() => undefined}>dusty</TagChip>
          </Specimen>
          <Specimen label="filter, off and hover">
            <FilterChip onToggle={() => undefined}>Minor keys</FilterChip>
            <FilterChip onToggle={() => undefined} data-hover>
              Has stems
            </FilterChip>
          </Specimen>
          <Specimen label="filter, selected and removable">
            <FilterChip selected onToggle={() => undefined}>
              Trap
            </FilterChip>
            <FilterChip onRemove={() => undefined}>140 to 150 BPM</FilterChip>
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-license" title="License badge" note="Three licenses; hover or focus shows the summary.">
        <Grid cols="desktop:grid-cols-4">
          <Specimen label="royalty-free">
            <LicenseBadge kind="royalty_free" />
          </Specimen>
          <Specimen label="credit required">
            <LicenseBadge kind="credit_required" />
          </Specimen>
          <Specimen label="split on placement">
            <LicenseBadge kind="split_on_placement" splitPercent={50} />
          </Specimen>
          <Specimen label="hover shows the summary">
            <div className="flex flex-col items-start gap-2">
              <TooltipSurface>Use it in your own music, including commercial releases.</TooltipSurface>
              <LicenseBadge kind="royalty_free" data-hover />
            </div>
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-avatar" title="Avatar" note="24, 32, 64, 96 px; fallback initials, loading.">
        <Grid cols="desktop:grid-cols-2">
          <Specimen label="fallback initials">
            <Avatar name="Kilo Beats" size={24} />
            <Avatar name="Kilo Beats" size={32} />
            <Avatar name="Nova" size={64} />
            <Avatar name="Deja On Keys" size={96} />
          </Specimen>
          <Specimen label="loading">
            <Avatar name="Kilo Beats" size={24} loading />
            <Avatar name="Kilo Beats" size={32} loading />
            <Avatar name="Nova" size={64} loading />
            <Avatar name="Deja" size={96} loading />
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-uploader" title="Uploader card" note="Compact and full; following, own profile, pending.">
        <Grid cols="desktop:grid-cols-3">
          <Specimen label="compact">
            <UploaderCard owner={rows.dustySoul.owner} href="/u/kilo_beats" className="w-full" />
          </Specimen>
          <Specimen label="compact, following">
            <UploaderCard owner={rows.midnightKeys.owner} href="/u/nova" following className="w-full" />
          </Specimen>
          <Specimen label="compact, pending">
            <UploaderCard owner={rows.trapBells.owner} href="/u/sosa_wav" pending className="w-full" />
          </Specimen>
          <Specimen label="full">
            <UploaderCard variant="full" owner={rows.dustySoul.owner} href="/u/kilo_beats" followersCount={1204} itemsCount={38} className="w-full" />
          </Specimen>
          <Specimen label="full, following">
            <UploaderCard variant="full" owner={rows.midnightKeys.owner} href="/u/nova" following followersCount={12480} itemsCount={112} className="w-full" />
          </Specimen>
          <Specimen label="full, own profile">
            <UploaderCard variant="full" owner={rows.rnbPad.owner} href="/u/deja_on_keys" own editHref="/settings/profile" followersCount={86} itemsCount={4} className="w-full" />
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-stat" title="Stat" note="Label over number; loading.">
        <Grid cols="desktop:grid-cols-2">
          <Specimen label="default">
            <div className="flex gap-6">
              <Stat label="Followers" value={1204} />
              <Stat label="Downloads" value={48210} />
              <Stat label="Sounds" value={38} />
              <Stat label="Len" value="0:07" />
            </div>
          </Specimen>
          <Specimen label="loading">
            <div className="flex gap-6">
              <Stat label="Followers" loading />
              <Stat label="Downloads" loading />
              <Stat label="Sounds" loading />
            </div>
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-tabs" title="Tabs" note="Underline; selected, focus, hover, with count, disabled. Arrow keys move.">
        <Grid cols="desktop:grid-cols-2">
          <Specimen label="selected, hover (one-shots), focus (kits), with count, disabled (presets)" wide>
            <Tabs defaultValue="loops" className="w-full">
              <TabList label="Content type">
                <Tab value="loops" count={38}>
                  Loops
                </Tab>
                <Tab value="oneshots" count={12} data-hover>
                  One-shots
                </Tab>
                <Tab value="kits" count={3} data-focus>
                  Kits
                </Tab>
                <Tab value="midi" count={0}>
                  MIDI
                </Tab>
                <Tab value="presets" disabled>
                  Presets
                </Tab>
              </TabList>
              <TabPanel value="loops">
                <p className="text-small text-text-muted">38 loops. One-shots shows hover, Kits shows focus, Presets is disabled.</p>
              </TabPanel>
              <TabPanel value="oneshots">
                <p className="text-small text-text-muted">12 one-shots.</p>
              </TabPanel>
              <TabPanel value="kits">
                <p className="text-small text-text-muted">3 kits.</p>
              </TabPanel>
              <TabPanel value="midi">
                <p className="text-small text-text-muted">No MIDI yet.</p>
              </TabPanel>
            </Tabs>
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-dialog" title="Dialog" note="Confirm and form; loading, error. The live buttons open the real dialog.">
        <Grid cols="desktop:grid-cols-2">
          <Specimen label="confirm">
            <div inert className="w-full">
              <DialogPreview title="Delete this loop?" description="Midnight keys will be removed from your profile. This cannot be undone." confirmLabel="Delete" destructive />
            </div>
          </Specimen>
          <Specimen label="form, loading">
            <div inert className="w-full">
              <DialogPreview variant="form" title="Edit title" confirmLabel="Save" loading>
                <TextInput label="Title" defaultValue="Midnight keys" disabled />
              </DialogPreview>
            </div>
          </Specimen>
          <Specimen label="form, error">
            <div inert className="w-full">
              <DialogPreview variant="form" title="Report this sound" description="Tell us what is wrong. We review every report." confirmLabel="Send report" error="We could not send that. Check your connection and try again.">
                <TextInput label="What happened" defaultValue="This is my loop from 2024" />
              </DialogPreview>
            </div>
          </Specimen>
          <Specimen label="live">
            <LiveDialogs />
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-menu" title="Menu" note="Overflow and context; open, focus, disabled item. Right-click a live row for the context menu.">
        <Grid cols="desktop:grid-cols-3">
          <Specimen label="overflow, open, focus on copy link, disabled item">
            <div inert>
              <MenuPreview entries={menuEntries} highlighted="Copy link" />
            </div>
          </Specimen>
          <Specimen label="context, open">
            <div inert>
              <MenuPreview entries={contextEntries} highlighted="Like" />
            </div>
          </Specimen>
          <Specimen label="live overflow">
            <Menu entries={menuEntries} trigger={<IconButton icon={Ellipsis} label="More for Midnight keys" />} />
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-tooltip" title="Tooltip" note="With shortcut key. Hover or focus a live control.">
        <Grid cols="desktop:grid-cols-3">
          <Specimen label="with shortcut">
            <TooltipSurface shortcut="L">Like</TooltipSurface>
            <TooltipSurface shortcut="D">Download</TooltipSurface>
          </Specimen>
          <Specimen label="plain">
            <TooltipSurface>Copy link</TooltipSurface>
          </Specimen>
          <Specimen label="live">
            <Tooltip content="Like" shortcut="L">
              <IconButton icon={Heart} label="Like" />
            </Tooltip>
            <Tooltip content="Copy link" shortcut="C">
              <IconButton icon={Copy} label="Copy link" />
            </Tooltip>
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-toast" title="Toast" note="Info, success, error, with undo; they enter with a 4 px rise and fade out. The live buttons raise real toasts.">
        <Grid cols="desktop:grid-cols-2">
          <Specimen label="info">
            <div inert className="w-full max-w-90">
              <ToastPreview tone="info" title="Added to queue" description="Dusty soul chops plays next." />
            </div>
          </Specimen>
          <Specimen label="success">
            <div inert className="w-full max-w-90">
              <ToastPreview tone="success" title="Published" description="Midnight keys is live on your profile." />
            </div>
          </Specimen>
          <Specimen label="error">
            <div inert className="w-full max-w-90">
              <ToastPreview tone="error" title="Upload failed" description="This file is longer than 60 seconds. Trim it and upload again." />
            </div>
          </Specimen>
          <Specimen label="with undo">
            <div inert className="w-full max-w-90">
              <ToastPreview tone="info" title="Removed from likes" action="Undo" />
            </div>
          </Specimen>
          <Specimen label="live" wide>
            <LiveToasts />
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-skeleton" title="Skeleton" note="Row, card, text. Static: only the loading ring loops.">
        <Grid cols="desktop:grid-cols-3">
          <Specimen label="text">
            <SkeletonText lines={3} className="w-full" />
          </Specimen>
          <Specimen label="card">
            <SkeletonCard className="w-full" />
          </Specimen>
          <Specimen label="row" wide>
            <div className="w-full">
              <ResultListSkeleton rows={3} />
            </div>
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-empty" title="Empty state and error state" note="Empty points to one next action; error says what happened and offers a retry.">
        <Grid cols="desktop:grid-cols-3">
          <Specimen label="empty">
            <EmptyState icon={Heart} title="Nothing liked yet" action={<Button size="sm">Browse loops</Button>} className="w-full">
              Press L on anything you want to keep.
            </EmptyState>
          </Specimen>
          <Specimen label="empty, uploads">
            <EmptyState icon={Inbox} title="No uploads yet" action={<Button size="sm" variant="primary" icon={Upload}>Upload</Button>} className="w-full">
              Drop a loop, kit or preset and it is ready to share in a minute.
            </EmptyState>
          </Specimen>
          <Specimen label="error, with retry">
            <ErrorState title="Could not load these sounds" onRetry={() => undefined} className="w-full">
              The connection dropped. Check it and retry.
            </ErrorState>
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-steps" title="Progress steps" note="Uploading, analyzing, ready, flagged; active, done, failed.">
        <Grid cols="desktop:grid-cols-3">
          <Specimen label="uploading, active">
            <ProgressSteps step="uploading" progress={0.42} className="w-full" />
          </Specimen>
          <Specimen label="uploading, failed">
            <ProgressSteps step="uploading" status="failed" detail="The upload stopped at 61 percent. Check your connection and retry." className="w-full" />
          </Specimen>
          <Specimen label="analyzing, active">
            <ProgressSteps step="analyzing" detail="Found 140 BPM and A minor. Measuring loop length." className="w-full" />
          </Specimen>
          <Specimen label="analyzing, failed">
            <ProgressSteps step="analyzing" status="failed" detail="This file is longer than 60 seconds. Trim it and upload again." className="w-full" />
          </Specimen>
          <Specimen label="ready, done">
            <ProgressSteps step="ready" detail="140 BPM, A minor, 4 bars. Check the fields and publish." className="w-full" />
          </Specimen>
          <Specimen label="flagged">
            <ProgressSteps step="flagged" detail="This matches something already on Stash. If it is yours, tell us and we will review it." className="w-full" />
          </Specimen>
        </Grid>
      </Section>

      <Section id="c-row" title="Result row, loop" note="Columns line up under the engraved header. Empty and error states for lists are above.">
        <Specimen label="default, hover, selected, playing, loading, error; liked and long title" wide>
        <ResultList label="Row states" className="w-full">
          <ResultRow row={rows.dustySoul} menu={menuEntries} />
          <ResultRow row={rows.midnightKeys} data-hover menu={menuEntries} />
          <ResultRow row={rows.trapBells} selected menu={menuEntries} />
          <ResultRow row={rows.drillLead} playState="playing" progress={0.38} menu={menuEntries} />
          <ResultRow row={rows.rnbPad} playState="loading" menu={menuEntries} />
          <ResultRow row={{ ...rows.dustySoul, id: "00000000-0000-4000-8000-000000000009", title: "Chopped soul, preview missing" }} playState="error" menu={menuEntries} />
        </ResultList>
        </Specimen>
        <Specimen label="skeleton" wide>
          <div className="w-full">
            <ResultListSkeleton rows={2} />
          </div>
        </Specimen>
        <Specimen label="live: play, scrub the waveform, like, right-click or open more" wide>
          <div className="w-full">
            <LiveRows />
          </div>
        </Specimen>
      </Section>

      <Section id="c-wave" title="Waveform" note="Mini 200 by 32 and hero; loading from peaks, playing, scrubbing, error. Drawn on canvas in the type color.">
        <Grid cols="desktop:grid-cols-4">
          <Specimen label="mini, idle">
            <Waveform peaks={rows.dustySoul.peaks} type="loop" label="Loop, 2 bars, 90 BPM, Dm" />
          </Specimen>
          <Specimen label="mini, playing">
            <Waveform peaks={rows.midnightKeys.peaks} type="loop" progress={0.55} label="Loop, 4 bars, 140 BPM, Am" />
          </Specimen>
          <Specimen label="mini, loading">
            <Waveform peaks={null} type="loop" label="Loop, loading" />
          </Specimen>
          <Specimen label="mini, error">
            <Waveform peaks={null} error type="loop" label="Loop, waveform unavailable" />
          </Specimen>
          <Specimen label="mini, other types">
            <div className="flex flex-col gap-2">
              <Waveform peaks={rows.trapBells.peaks} type="oneshot" progress={0.3} label="One-shot" />
              <Waveform peaks={rows.drillLead.peaks} type="kit" progress={0.3} label="Kit demo" />
              <Waveform peaks={rows.rnbPad.peaks} type="preset" progress={0.3} label="Preset demo" />
            </div>
          </Specimen>
        </Grid>
        <div className="grid grid-cols-1 gap-3 desktop:grid-cols-2">
          <Specimen label="hero, playing, bar ticks" wide>
            <div className="w-full">
              <Waveform variant="hero" peaks={rows.midnightKeys.peaks} type="loop" progress={heroAt} playing bars={4} durationMs={rows.midnightKeys.durationMs} onScrub={setHeroAt} label="Loop, 4 bars, 140 BPM, Am" />
            </div>
          </Specimen>
          <Specimen label="hero, scrubbing">
            <div className="w-full">
              <Waveform variant="hero" peaks={rows.dustySoul.peaks} type="loop" progress={0.25} playing pointer={0.7} bars={2} durationMs={rows.dustySoul.durationMs} label="Loop, 2 bars, 90 BPM, Dm" />
            </div>
          </Specimen>
          <Specimen label="hero, idle">
            <div className="w-full">
              <Waveform variant="hero" peaks={rows.trapBells.peaks} type="loop" bars={4} durationMs={rows.trapBells.durationMs} label="Loop, 4 bars, 150 BPM, F#m" />
            </div>
          </Specimen>
          <Specimen label="hero, loading">
            <div className="w-full">
              <Waveform variant="hero" peaks={null} type="loop" label="Loop, loading" />
            </div>
          </Specimen>
          <Specimen label="hero, error">
            <div className="w-full">
              <Waveform variant="hero" peaks={null} error type="loop" label="Loop, waveform unavailable" />
            </div>
          </Specimen>
        </div>
      </Section>
    </div>
  );
}
