import { BankHead, LcdSearch } from "../bank-head";
import { DrumPadsHero } from "../heroes/drum-pads";
import { SigLed, signatureOf } from "../live/sig";
import { sigVar } from "../live/signature";
import { wordsThatHit } from "../live/relax";
import { NoSignal } from "../live/states";
import { DawDragZone } from "../daw-drag";
import { kitSoundSource, shotSource } from "../daw-sources";
import {
  Button,
  ButtonLink,
  Download,
  EmptyState,
  FilterChip,
  Heart,
  Icon,
  IconButton,
  Menu,
  PlayButton,
  Stat,
  TextInput,
  Trash,
  UiLink,
  Upload,
  useToast,
  X,
  type MenuEntry,
} from "@stash/ui";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CrateMenu } from "../explore";
import { ShareButton } from "../share";
import { CommentToggle, Comments, RowThread } from "../social";
import { navigate } from "../router";
import { styleLink } from "../producers/data";
import { has, set } from "../store";
import { allShots, saveShots } from "../oneshots/store";
import { CATEGORIES, categoryOf, clipBuffer, cleanName, decode, labelOf, play, playSequence, postKit, removeKit, useKits, warmSounds, type Category, type Draft, type Kit, type KitSound } from "./store";
import { usePageKeys } from "../shortcuts";

/**
 * The drum kits screens: every kit, one kit's sounds, and posting a kit of your own one-shots.
 */

const GENRES = ["Trap", "Drill", "Boom bap", "Phonk", "R&B", "Jersey club", "Plugg", "Rage", "Lo-fi", "Other"];

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function summary(sounds: { category: Category }[]): string {
  return CATEGORIES.map((c) => [c, sounds.filter((s) => s.category === c.id).length] as const)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${n} ${n === 1 ? c.label.toLowerCase() : c.plural.toLowerCase()}`)
    .join(" · ");
}

/** Plays a few of the kit's sounds in a row: kick, snare or clap, hat, and an 808 if it has one. */
export function preview(k: Kit) {
  const pick = (cats: Category[]) => k.sounds.find((s) => cats.includes(s.category));
  const order = [pick(["kick", "808"]), pick(["hat"]), pick(["snare", "clap"]), pick(["hat"]), pick(["808", "kick"]), pick(["open hat", "hat"]), pick(["clap", "snare"])].filter(
    (s): s is KitSound => !!s,
  );
  // Cut the sounds first, then play them in time: started cold, the beat would otherwise wait on the
  // download and come out as one late hit instead of a groove.
  const mine = ++previewSeq;
  void Promise.all(order.map((s) => ("clip" in s && s.clip ? clipBuffer(s.clip).catch(() => null) : null))).then(() => {
    if (mine === previewSeq) playSequence(order, 210);
  });
}
let previewSeq = 0;

/** Saves every sound in the kit as one zip. */
export async function saveKit(k: Kit, toast: ReturnType<typeof useToast>) {
  const shots = allShots([k]).filter((s) => s.kit?.id === k.id);
  const { outcome, names } = await saveShots(shots, k.name, 200).catch(() => ({ outcome: "failed" as const, names: [] as string[] }));
  if (outcome === "saved") {
    set("downloads", k.id, true);
    toast({ tone: "success", title: `Saved ${names.length} sounds`, description: `${k.name}.zip` });
  } else if (outcome === "empty") toast({ tone: "error", title: "Nothing to save", description: "This kit's audio isn't in this browser anymore." });
  else if (outcome === "failed") toast({ tone: "error", title: "The kit did not save", description: "Try again in a moment." });
}

/** The drum sound types the Drums page lists one by one, beside whole kits. */
const SOUND_TYPES: Category[] = ["808", "kick", "snare", "clap", "hat", "open hat", "perc", "cymbal"];

/** Single drum sounds of one type, from every kit and from posts of single sounds. */
const shotText = (s: ReturnType<typeof allShots>[number]) => [s.name, s.kit?.name ?? "", (s.kit?.name ?? "").replace(/['’]/g, ""), s.owner.handle, s.genre];
const kitText = (k: Kit) => [k.name, k.name.replace(/['’]/g, ""), k.owner.displayName, k.owner.handle, k.genre, ...k.sounds.map((s) => s.name)];
const hasText = (texts: string[], needle: string) => texts.some((x) => x.toLowerCase().includes(needle));

function DrumSounds({ type, needle, onSearch }: { type: Category; needle: string; onSearch: (q: string) => void }) {
  const toast = useToast();
  const all = useKits();
  const [talk, setTalk] = useState<string | null>(null);
  const ofType = allShots(all).filter((s) => s.category === type);
  const sounds = ofType.filter((s) => !needle || hasText(shotText(s), needle));
  if (sounds.length === 0)
    return (
      <NoSignal
        title={`No ${CATEGORIES.find((c) => c.id === type)!.plural.toLowerCase()} for “${needle}”`}
        tries={wordsThatHit(needle, (w) => ofType.some((s) => hasText(shotText(s), w)))}
        onTry={onSearch}
        onClear={() => onSearch("")}
        more={
          <ButtonLink href="/kit-upload" variant="secondary" size="sm" className="self-start">
            Upload sounds
          </ButtonLink>
        }
      >
        Clear the search, or post the first one.
      </NoSignal>
    );
  return (
    <DawDragZone sources={sounds.map(shotSource)} className="overflow-hidden rounded-panel border border-border bg-surface">
      <ul aria-label={CATEGORIES.find((c) => c.id === type)!.plural}>
        {sounds.map((s) => {
          const cid = s.kit ? `kit:${s.kit.id}:${s.id}` : `kit:sound:${s.id}`;
          return (
          <Fragment key={`${s.kit?.id ?? "mine"}-${s.id}`}>
          <li className="flex h-16 items-center gap-3 border-b border-border px-3 last:border-b-0 ui-hover:bg-raised tablet:h-14">
            <PlayButton title={s.name} state="paused" onClick={() => void play(s)} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-strong text-text">{s.name}</span>
              <span className="truncate text-small text-text-muted">
                <UiLink href={`/u/${s.owner.handle}`} className="ui-hover:text-text">{`@${s.owner.handle}`}</UiLink>
                {s.kit ? (
                  <>
                    {" · from "}
                    <UiLink href={`/kit/${s.kit.id}`} className="underline underline-offset-2 ui-hover:text-text">
                      {s.kit.name}
                    </UiLink>
                  </>
                ) : null}
              </span>
            </span>
            <span className="hidden w-24 shrink-0 text-small text-text-muted tablet:block">{s.genre}</span>
            <span className="hidden w-16 shrink-0 text-right font-mono text-numeric tabular text-text-muted tablet:block">{seconds(s.durationMs)}</span>
            <IconButton
              icon={Download}
              label={`Download ${s.name}`}
              onClick={async () => {
                const { outcome } = await saveShots([s], s.name, 1).catch(() => ({ outcome: "failed" as const }));
                if (outcome === "failed") toast({ tone: "error", title: "The sound did not save", description: "Try again in a moment." });
                else if (outcome === "empty") toast({ tone: "error", title: "Nothing to save", description: "This sound's audio isn't in this browser anymore." });
              }}
            />
            <CommentToggle itemId={cid} title={s.name} open={talk === cid} onToggle={() => setTalk(talk === cid ? null : cid)} />
            <CrateMenu
              itemId={cid}
              title={s.name}
              kind="Drum sound"
              href={s.kit ? `/kit/${s.kit.id}` : "/kits"}
              by={s.owner.displayName}
              size="sm"
            />
          </li>
          {talk === cid && <RowThread itemId={cid} title={s.name} />}
          </Fragment>
          );
        })}
      </ul>
    </DawDragZone>
  );
}

/** Kit cards: hear a few of its sounds, open it, crate it, download it. The Drums page and profiles share them. */
export function KitCards({ kits, hidden = false, label = "Kits" }: { kits: Kit[]; hidden?: boolean; label?: string }) {
  const toast = useToast();
  return (
  <ul aria-label={label} hidden={hidden} className="lib-grid">
    {kits.map((k) => (
      <li key={k.id} className="sp-cart lib-cart" data-sig="" style={{ ["--sig" as string]: sigVar(signatureOf(k.owner.handle).color) }}>
        <div className="flex items-start gap-3">
          <PlayButton title={`a preview of ${k.name}`} state="paused" onPointerEnter={() => warmSounds(k.sounds)} onPointerDown={(e) => e.button === 0 && preview(k)} onClick={(e) => e.detail === 0 && preview(k)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <UiLink href={`/kit/${k.id}`} className="lib-cart-title ui-hover:underline">
              {k.name}
            </UiLink>
            <span className="lib-sub truncate">
              <SigLed handle={k.owner.handle} />@{k.owner.handle} · {k.genre}
              {k.mine ? " · posted from this browser" : ""}
            </span>
          </div>
        </div>
        <KitBank k={k} />
        <div className="mt-auto flex items-center justify-end gap-2">
          <CrateMenu itemId={`kit:${k.id}`} title={k.name} kind="Drum kit" href={`/kit/${k.id}`} by={k.owner.displayName} size="sm" />
          <button type="button" className="sp-key" aria-label={`Download ${k.name}`} onClick={() => void saveKit(k, toast)}>
            <Icon icon={Download} />
            Download
          </button>
        </div>
      </li>
    ))}
  </ul>
  );
}

/** The kit as a pad bank: one pad per drum type, tap one to hear that sound. A type the kit lacks is a dark pad. */
function KitBank({ k }: { k: Kit }) {
  return (
    <div className="lib-deck">
      <div role="group" aria-label={`Pads of ${k.name}`} className="lib-bank">
        {SOUND_TYPES.map((c, i) => {
          const s = k.sounds.find((x) => x.category === c);
          const name = CATEGORIES.find((x) => x.id === c)!.label;
          return (
            <button
              key={c}
              type="button"
              className="sp-pad"
              disabled={!s}
              aria-label={s ? `Play the ${name.toLowerCase()} from ${k.name}` : `${k.name} has no ${name.toLowerCase()}`}
              onPointerEnter={() => warmSounds(k.sounds)}
              onPointerDown={(e) => s && e.button === 0 && void play(s)}
              onClick={(e) => s && e.detail === 0 && void play(s)}
            >
              <span className="sp-pad-code">{String(i + 1).padStart(2, "0")}</span>
              <span className="sp-pad-label">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function KitsPage() {
  const all = useKits();
  const [type, setType] = useState<Category | "kits">("kits");
  const [genre, setGenre] = useState("All");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = all.filter((k) => (genre === "All" || k.genre === genre) && (!needle || hasText(kitText(k), needle)));
  // Phones have no hover to warm a kit before its tap: fetch the first kits on screen now.
  const firstKits = shown.slice(0, 2);
  useEffect(() => {
    for (const k of firstKits) warmSounds(k.sounds);
  }, [firstKits.map((k) => k.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const genres = ["All", ...GENRES.filter((g) => all.some((k) => k.genre === g))];

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-5 tablet:px-4 desktop:px-6">
      <BankHead
        kicker="DRUM BANK"
        title="Drums"
        blurb="Whole kits and single hits. Tap a pad to hear it, grab the folder or one sound."
        search={<LcdSearch id="kits-q" label="Search kits, producers, sounds" placeholder="kit, producer or sound" value={q} onChange={setQ} />}
        hero={<DrumPadsHero kits={all} />}
        actions={
          <UiLink href="/kit-upload" className="sp-key sp-key-hot st-wide-only">
            <Icon icon={Upload} />
            Upload a kit
          </UiLink>
        }
      />

      <section aria-label="Browse drums" className="flex flex-col gap-3">
        <div className="sp-head">
          <h2 className="sp-label">Bank select</h2>
        </div>
        <div role="group" aria-label="Drum type" className="lib-shelf">
          <button type="button" className="sp-pad lib-pad-chip" aria-pressed={type === "kits"} onClick={() => setType("kits")}>
            <span className="sp-pad-code">A</span>
            <span className="sp-pad-label">Kits</span>
          </button>
          {SOUND_TYPES.map((c, i) => (
            <button key={c} type="button" className="sp-pad lib-pad-chip" aria-pressed={type === c} onClick={() => setType(c)}>
              <span className="sp-pad-code">{`B${String(i + 1).padStart(2, "0")}`}</span>
              <span className="sp-pad-label">{CATEGORIES.find((x) => x.id === c)!.plural}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-label="Genre" className="flex flex-wrap gap-2" hidden={type !== "kits"}>
          {genres.map((g) => (
            <button key={g} type="button" className="sp-key sp-key-pill" aria-pressed={genre === g} onClick={() => setGenre(g)}>
              {g}
            </button>
          ))}
        </div>
      </section>

      {type !== "kits" ? <DrumSounds type={type} needle={needle} onSearch={setQ} /> : null}
      <KitCards kits={shown} hidden={type !== "kits"} />
      {type === "kits" && shown.length === 0 && (
        <NoSignal
          title={needle ? `No kits for “${needle}”` : "No kits match"}
          tries={wordsThatHit(needle, (w) => all.some((k) => hasText(kitText(k), w)))}
          onTry={(t) => {
            setGenre("All");
            setQ(t);
          }}
          onClear={() => {
            setGenre("All");
            setQ("");
          }}
          more={
            <ButtonLink href="/kit-upload" variant="secondary" size="sm" className="self-start">
              Upload a kit
            </ButtonLink>
          }
        >
          Clear the search, or post the first one.
        </NoSignal>
      )}
    </main>
  );
}

export function KitPage({ id }: { id: string }) {
  const all = useKits();
  const k = all.find((x) => x.id === id) ?? null;
  const toast = useToast();
  const [cat, setCat] = useState<Category | "all">("all");
  const [selected, setSelected] = useState(0);
  const [likeTick, setLikeTick] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const sounds = useMemo(() => (k ? (cat === "all" ? k.sounds : k.sounds.filter((s) => s.category === cat)) : []), [k, cat]);

  // Fetch and cut the kit's sounds as the page opens, so the first tap plays at once.
  useEffect(() => {
    if (k) warmSounds(k.sounds);
  }, [k]);

  // The site-wide shortcuts stand aside for this page's own keys.
  usePageKeys(["ArrowDown", "ArrowUp", " "]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => {
          const n = Math.max(0, Math.min(sounds.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
          if (sounds[n]) void play(sounds[n]);
          return n;
        });
      } else if (e.key === " " && sounds[selected]) {
        e.preventDefault();
        void play(sounds[selected]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sounds, selected]);

  if (!k) {
    return (
      <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
        <EmptyState icon={Upload} title="That kit isn't here" action={<ButtonLink href="/kits" variant="secondary">All drum kits</ButtonLink>}>
          It may have been posted from another browser. Kits posted in the demo stay on the device that made them.
        </EmptyState>
      </main>
    );
  }
  void likeTick;
  // A new filter starts at its first sound, so Space never points past the end of a shorter list.
  const pick = (c: Category | "all") => {
    setCat(c);
    setSelected(0);
  };
  const liked = has("likes", k.id);
  const counts = (c: Category) => k.sounds.filter((s) => s.category === c).length;
  const styleOfKit = k.inspiredBy ? styleLink(k.inspiredBy) : null;

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 tablet:p-6">
        <div className="flex flex-col gap-4 tablet:flex-row tablet:items-start tablet:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <PlayButton size="hero" title={`a preview of ${k.name}`} state="paused" onClick={() => preview(k)} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-label text-label-caps text-text-muted">{`Drum kit · ${k.genre}`}</span>
              <h1 className="text-title break-words">{k.name}</h1>
              <UiLink href={`/u/${k.owner.handle}`} className="w-fit text-small text-text-muted ui-hover:text-text">
                {`by ${k.owner.displayName} @${k.owner.handle}`}
              </UiLink>
              {styleOfKit && (
                <UiLink href={styleOfKit.href} className="w-fit text-small text-text-muted ui-hover:text-text">
                  {`Everything for ${styleOfKit.name} on Stash →`}
                </UiLink>
              )}
            </div>
          </div>
          {/* On a phone: Download across the top, Crate and Like side by side under it. */}
          <div className="grid grid-cols-2 gap-2 *:w-full tablet:flex tablet:flex-wrap tablet:*:w-auto">
            <Button
              variant="primary"
              icon={Download}
              className="col-span-2"
              onClick={() => void saveKit(k, toast)}
            >
              Download kit
            </Button>
            <CrateMenu itemId={`kit:${k.id}`} title={k.name} kind="Drum kit" href={`/kit/${k.id}`} by={k.owner.displayName} />
            <Button
              variant="secondary"
              icon={Heart}
              aria-pressed={liked}
              className="aria-pressed:*:fill-current"
              onClick={() => {
                set("likes", k.id, !liked);
                setLikeTick((n) => n + 1);
              }}
            >
              {liked ? "Liked" : "Like"}
            </Button>
            <ShareButton
              path={`/kit/${k.id}`}
              size="md"
              className="col-span-2"
              card={{ kind: "Drum kit", title: k.name.replace(/ \(inspired by .*\)$/, ""), subtitle: k.inspiredBy ? `In the style of ${k.inspiredBy}` : `by ${k.owner.displayName}`, line: `${k.genre} · Free on Stash` }}
            />
            {k.mine && (
              <Button
                variant="danger"
                icon={Trash}
                onClick={() => {
                  removeKit(k.id);
                  navigate("/kits");
                  toast({ tone: "success", title: "Removed", description: `${k.name} is gone from this browser.` });
                }}
              >
                Remove kit
              </Button>
            )}
          </div>
        </div>
        {k.description && <p className="max-w-prose text-body text-text">{k.description}</p>}
        <div className="grid grid-cols-2 gap-4 tablet:grid-cols-4">
          <Stat label="Sounds" value={k.sounds.length} />
          <Stat label="Downloads" value={k.downloads} />
          <Stat label="Likes" value={k.likes + (liked ? 1 : 0)} />
          <Stat label="License" value="Royalty free" />
        </div>
      </header>

      <div role="group" aria-label="Sound type" className="flex flex-wrap gap-2">
        <FilterChip selected={cat === "all"} onToggle={() => pick("all")}>
          All
        </FilterChip>
        {CATEGORIES.filter((c) => counts(c.id) > 0).map((c) => (
          <FilterChip key={c.id} selected={cat === c.id} onToggle={() => pick(c.id)}>
            {c.plural}
          </FilterChip>
        ))}
      </div>

      <DawDragZone sources={k ? sounds.map((s) => kitSoundSource(k, s)) : []} className="overflow-hidden rounded-panel border border-border bg-surface">
        <ul ref={listRef} aria-label="Sounds">
          {sounds.map((s, i) => (
            <li
              key={s.id}
              data-selected={i === selected || undefined}
              className="flex h-14 items-center gap-3 border-b border-border px-3 last:border-b-0 data-selected:bg-raised ui-hover:bg-raised"
            >
              <PlayButton
                title={s.name}
                state="paused"
                // Fire on press, not release, like a pad; a keyboard press (no pointer) still plays on click.
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  setSelected(i);
                  void play(s);
                }}
                onClick={(e) => {
                  if (e.detail !== 0) return;
                  setSelected(i);
                  void play(s);
                }}
              />
              <span className="min-w-0 flex-1 truncate text-body-strong text-text">{s.name}</span>
              <span className="w-24 shrink-0 text-small text-text-muted">{labelOf(s.category)}</span>
              <span className="hidden w-16 shrink-0 text-right font-mono text-numeric tabular text-text-muted tablet:block">{seconds(s.durationMs)}</span>
            </li>
          ))}
        </ul>
      </DawDragZone>
      <p className="text-small text-text-muted">The arrow keys move through the sounds and play each one; Space plays the selected sound again.</p>
      <Comments itemId={`kit:${k.id}`} title={k.name} />
    </main>
  );
}

// ---------------------------------------------------------------------------------------------

const AUDIO = /\.(wav|wave|mp3|aif|aiff|ogg|flac|m4a)$/i;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_SOUNDS = 64;
const MAX_LENGTH_MS = 15_000;

type Row = Draft & { key: string };

export function KitUploadPage({ embedded = false }: { embedded?: boolean } = {}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("Trap");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const add = async (files: File[]) => {
    const bad: string[] = [];
    const next: Row[] = [];
    let folder = "";
    for (const f of files) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (rel && !folder) folder = rel.split("/")[0] ?? "";
      if (!AUDIO.test(f.name)) {
        if (!f.name.startsWith(".")) bad.push(`${f.name}: not an audio file (wav, mp3, aiff, ogg, flac)`);
        continue;
      }
      if (f.size > MAX_FILE) {
        bad.push(`${f.name}: over 8 MB; a one-shot should be much smaller`);
        continue;
      }
      try {
        const data = await f.arrayBuffer();
        const buf = await decode(data);
        if (buf.duration * 1000 > MAX_LENGTH_MS) {
          bad.push(`${f.name}: ${buf.duration.toFixed(0)} seconds long; that's a loop, post it on the upload page`);
          continue;
        }
        next.push({ key: `${f.name}-${f.size}-${Math.random()}`, name: cleanName(f.name), category: categoryOf(f.name), durationMs: Math.round(buf.duration * 1000), data });
      } catch {
        bad.push(`${f.name}: the browser couldn't read this audio`);
      }
    }
    setRows((r) => [...r, ...next].slice(0, MAX_SOUNDS));
    if (rows.length + next.length > MAX_SOUNDS) bad.push(`A kit holds up to ${MAX_SOUNDS} sounds; the rest were left out`);
    setProblems(bad);
    if (folder && !name) setName(folder.replace(/[_-]+/g, " "));
  };

  const categoryMenu = (r: Row): MenuEntry[] =>
    CATEGORIES.map((c) => ({ label: c.label, onSelect: () => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, category: c.id } : x))) }));

  const post = async () => {
    setBusy(true);
    try {
      const k = await postKit(name, genre, description, rows);
      toast({ tone: "success", title: "Kit posted", description: `${k.name} is on Stash, in this browser.` });
      navigate(`/kit/${k.id}`);
    } finally {
      setBusy(false);
    }
  };

  const Wrap = embedded ? "div" : "main";
  return (
    <Wrap className={embedded ? "flex w-full flex-col gap-6" : "mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6"}>
      {embedded ? (
        <h1 className="sr-only">Post your drum kit</h1>
      ) : (
        <BankHead kicker="LOAD · DRUM BANK" title="Post your drum kit" blurb="Drop the one-shots and name the kit. Each sound is sorted by type." />
      )}

      <section
        aria-label="Add sounds"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add([...e.dataTransfer.files]);
        }}
        className="sp-bezel"
      >
        <div data-over={over || undefined} className="sp-lcd lib-drop">
        <p className="sp-lcd-text m-0">INSERT FILES&gt; <span className="sp-lcd-blink">_</span></p>
        <p className="sp-lcd-small m-0">Drop wav, mp3 or aiff one-shots here</p>
        <p className="sp-lcd-small m-0">{`Up to ${MAX_SOUNDS} sounds, 8 MB and 15 seconds each.`}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <label className="sp-key focus-within:outline-2 focus-within:outline-offset-2">
            Choose sounds
            <input type="file" accept="audio/*,.wav,.mp3,.aif,.aiff,.flac,.ogg" multiple className="sr-only" onChange={(e) => void add([...(e.target.files ?? [])])} />
          </label>
          <label className="sp-key focus-within:outline-2 focus-within:outline-offset-2">
            Choose a folder
            <input ref={folderRef} type="file" multiple className="sr-only" onChange={(e) => void add([...(e.target.files ?? [])])} />
          </label>
        </div>
        </div>
      </section>

      {problems.length > 0 && (
        <ul role="alert" aria-label="Files left out" className="flex flex-col gap-1 rounded-panel border border-border bg-surface p-4 text-small text-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <>
          <section aria-label="Sounds in the kit" className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-title">Sounds</h2>
              <span className="text-small text-text-muted">{summary(rows)}</span>
            </div>
            <div className="overflow-hidden rounded-panel border border-border bg-surface">
              <ul aria-label="Sounds to post">
                {rows.map((r) => (
                  <li key={r.key} className="flex h-14 items-center gap-3 border-b border-border px-3 last:border-b-0">
                    <PlayButton title={r.name} state="paused" onClick={() => void play(r, r.key)} />
                    <span className="min-w-0 flex-1 truncate text-body-strong text-text">{r.name}</span>
                    <Menu entries={categoryMenu(r)} trigger={<Button size="sm" variant="secondary" aria-label={`Type of ${r.name}: ${labelOf(r.category)}`}>{labelOf(r.category)}</Button>} />
                    <span className="hidden w-16 shrink-0 text-right font-mono text-numeric tabular text-text-muted tablet:block">{seconds(r.durationMs)}</span>
                    <Button size="sm" variant="ghost" icon={X} aria-label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section aria-label="Kit details" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
            <TextInput label="Kit name" value={name} maxLength={60} placeholder="Night Shift trap kit" onChange={(e) => setName(e.target.value)} />
            <div className="flex flex-col gap-2">
              <span className="text-label text-label-caps text-text-muted">Genre</span>
              <div role="group" aria-label="Kit genre" className="flex flex-wrap gap-2">
                {GENRES.map((g) => (
                  <FilterChip key={g} selected={genre === g} onToggle={() => setGenre(g)}>
                    {g}
                  </FilterChip>
                ))}
              </div>
            </div>
            <TextInput label="About the kit" value={description} maxLength={240} placeholder="What it's for, what it's tuned to" onChange={(e) => setDescription(e.target.value)} />
            <p className="text-small text-text-muted">Post only sounds you made or have the right to share. Kits on Stash are royalty free unless you say otherwise.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={Upload} disabled={busy || rows.length === 0 || !name.trim()} onClick={() => void post()}>
                {busy ? "Posting…" : "Post kit"}
              </Button>
              <Button variant="ghost" onClick={() => setRows([])}>
                Start over
              </Button>
            </div>
          </section>
        </>
      )}
    </Wrap>
  );
}
