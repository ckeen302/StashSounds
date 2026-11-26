import { useEffect, useRef, type ReactNode } from "react";
import { useToast } from "@stash/ui";
import { draftReceipt, keepReceipt, type ReceiptMeta } from "./receipts";
import { set } from "./store";

/**
 * Drag into your DAW: drag any row (a loop, a MIDI file, a drum hit, a one-shot, a sound effect) out of
 * the browser and drop it on FL Studio's playlist or channel rack, or an Ableton track, the same way a
 * file is dragged out of Finder or Explorer.
 *
 * How: Chrome and Edge turn a drag that carries "DownloadURL" (type:name:url) into a real file at the
 * drop target. The file has to exist when the drag starts (dragstart can't wait), so each row builds its
 * file when the pointer first comes near it and keeps a blob URL for it. Other browsers drag the
 * file's name only; there the row's Download button saves the same file.
 *
 * Lists stay as they are: a zone wraps a list and makes each of its rows draggable, by position.
 */

export type DragFile = { name: string; data: Blob };
export type DragSource = {
  /** Stable per sound, so a file is built once however often the row is hovered. */
  key: string;
  make: () => Promise<DragFile | null>;
  /** For the license receipt a drag leaves, like a download does. */
  meta?: ReceiptMeta;
  /** Counted as a download of this item id. */
  downloadId?: string;
};

type Ready = { url: string; name: string; type: string; data: Blob };
const ready = new Map<string, Ready>();
const pending = new Map<string, Promise<Ready | null>>();
const MAX_READY = 60;

const MIME: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", mid: "audio/midi", aif: "audio/aiff", aiff: "audio/aiff", flac: "audio/flac", ogg: "audio/ogg" };

/** A file name a DAW and a file system both accept; the DownloadURL format splits on ":". */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "sound";
}

export function mimeOf(name: string, blobType = ""): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? (blobType || "application/octet-stream");
}

/** The "DownloadURL" value Chrome and Edge read: "<mime>:<file name>:<url>". */
export function downloadUrlValue(r: { type: string; name: string; url: string }): string {
  return `${r.type}:${r.name}:${r.url}`;
}

/** Builds the source's file ahead of a drag. Safe to call often. */
export function prime(s: DragSource): Promise<Ready | null> {
  const have = ready.get(s.key);
  if (have) return Promise.resolve(have);
  const going = pending.get(s.key);
  if (going) return going;
  const p = s
    .make()
    .then((f) => {
      if (!f) return null;
      const name = safeName(f.name);
      const r: Ready = { url: URL.createObjectURL(f.data), name, type: mimeOf(name, f.data.type), data: f.data };
      ready.set(s.key, r);
      // Keep memory bounded: let go of the oldest files.
      while (ready.size > MAX_READY) {
        const [k, old] = ready.entries().next().value as [string, Ready];
        URL.revokeObjectURL(old.url);
        ready.delete(k);
      }
      return r;
    })
    .catch(() => null)
    .finally(() => pending.delete(s.key));
  pending.set(s.key, p);
  return p;
}

/** Fills a drag with the file. False when the file isn't built yet. */
export function fillDrag(dt: DataTransfer, s: DragSource): boolean {
  const r = ready.get(s.key);
  dt.effectAllowed = "copy";
  if (!r) return false;
  dt.setData("DownloadURL", downloadUrlValue(r));
  dt.setData("text/uri-list", r.url);
  dt.setData("text/plain", r.name);
  try {
    // Browsers that hand dragged files to other apps (and drops inside a page) take the file itself.
    dt.items.add(new File([r.data], r.name, { type: r.type }));
  } catch {
    // Not allowed here; DownloadURL carries it.
  }
  return true;
}

let toldHow = false;
function readTold(): boolean {
  if (toldHow) return true;
  try {
    toldHow = window.localStorage.getItem("stash.demo.dawTip") === "1";
  } catch {
    // Storage blocked: tell once per visit.
  }
  return toldHow;
}
function markTold() {
  toldHow = true;
  try {
    window.localStorage.setItem("stash.demo.dawTip", "1");
  } catch {
    // Kept for this visit.
  }
}

/** Rows that count: the direct children of the zone's first list. */
function rowsOf(zone: HTMLElement): HTMLLIElement[] {
  const list = zone.querySelector("ul, ol");
  return list ? ([...list.children].filter((c) => c instanceof HTMLLIElement && c.getAttribute("aria-hidden") !== "true") as HTMLLIElement[]) : [];
}

function rowOf(zone: HTMLElement, target: EventTarget | null): number {
  if (!(target instanceof Element)) return -1;
  const li = target.closest("li[data-daw-row]");
  return li && zone.contains(li) ? Number((li as HTMLElement).dataset.dawRow) : -1;
}

/**
 * Wraps a list (loop rows, MIDI rows, kit sounds...) so each row drags out as its file. `sources[i]` is
 * the file for the list's i-th row.
 */
export function DawDragZone({ sources, children, className }: { sources: (DragSource | null)[]; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const latest = useRef(sources);

  // Mark rows after every render: lists grow ("Show more") and reorder under the zone.
  useEffect(() => {
    latest.current = sources;
    const zone = ref.current;
    if (!zone) return;
    rowsOf(zone).forEach((li, i) => {
      if (!latest.current[i]) {
        li.removeAttribute("data-daw-row");
        li.draggable = false;
        return;
      }
      li.dataset.dawRow = String(i);
      li.draggable = true;
      li.classList.add("st-daw-row");
    });
  });

  const near = (target: EventTarget | null) => {
    const zone = ref.current;
    const i = zone ? rowOf(zone, target) : -1;
    const s = i >= 0 ? latest.current[i] : null;
    if (s) void prime(s);
  };

  return (
    <div
      ref={ref}
      className={className}
      onPointerOver={(e) => near(e.target)}
      onFocus={(e) => near(e.target)}
      onTouchStart={(e) => near(e.target)}
      onDragStart={(e) => {
        const zone = ref.current;
        if (!zone) return;
        const i = rowOf(zone, e.target);
        const s = i >= 0 ? latest.current[i] : null;
        if (!s) return;
        // A drag on a waveform is a scrub (it captures the pointer), and text in a field is for selecting.
        if (e.target instanceof Element && e.target.closest('[role="slider"], input, textarea, .touch-none')) {
          e.preventDefault();
          return;
        }
        if (!fillDrag(e.dataTransfer, s)) {
          void prime(s);
          e.dataTransfer.setData("text/plain", "");
          toast({ tone: "info", title: "Getting the file ready", description: "Drag it again in a second." });
          return;
        }
        const r = ready.get(s.key)!;
        const receipt = draftReceipt(r.name.replace(/\.[^.]+$/, ""), [r.name], s.meta);
        keepReceipt(receipt);
        if (s.downloadId) set("downloads", s.downloadId, true);
        if (!readTold()) {
          markTold();
          toast({ tone: "info", title: "Drop it on your DAW", description: "FL Studio's playlist or channel rack, or an Ableton track. Works in Chrome and Edge; elsewhere use Download." });
        }
      }}
    >
      {children}
    </div>
  );
}
