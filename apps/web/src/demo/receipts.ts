import { useSyncExternalStore } from "react";
import type { LicenseKind } from "@stash/contracts";
import { LICENSE_LABELS } from "@stash/contracts/format";

/**
 * License receipts: one per download, kept in this browser for good. A receipt names the sound,
 * who made it, where it came from, the license (with its version) and the date, so a producer can
 * answer a Content ID claim with it. The same text goes inside the downloaded zip.
 */
export type Receipt = {
  id: string;
  title: string;
  by: string;
  kind: string;
  /** The page the sound came from (its address when it was saved). */
  source: string;
  license: LicenseKind;
  licenseVersion: string;
  files: string[];
  createdAt: string;
};

export type ReceiptMeta = { title?: string; by?: string; kind?: string; license?: LicenseKind; source?: string };

const KEY = "stash.demo.receipts";
let memory: Receipt[] = [];
let version = 0;
const listeners = new Set<() => void>();

export function receipts(): Receipt[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Receipt[];
  } catch {
    // Memory copy.
  }
  return memory;
}

function store(next: Receipt[]) {
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // This visit only.
  }
  version++;
  for (const l of listeners) l();
}

function currentSource(): string {
  try {
    return window.location.href;
  } catch {
    return "Stash";
  }
}

function receiptId(): string {
  const n = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 36 ** 4).toString(36).toUpperCase().padStart(4, "0");
  return `STASH-${n}-${r}`;
}

/** Makes a receipt (not yet stored) for a download about to happen. */
export function draftReceipt(fallbackTitle: string, files: string[], meta: ReceiptMeta = {}): Receipt {
  const license = meta.license ?? "royalty_free";
  return {
    id: receiptId(),
    title: meta.title ?? fallbackTitle,
    by: meta.by ?? "Stash",
    kind: meta.kind ?? "Sound",
    source: meta.source ?? currentSource(),
    license,
    licenseVersion: LICENSE_LABELS[license].version,
    files,
    createdAt: new Date().toISOString(),
  };
}

export function keepReceipt(r: Receipt) {
  store([r, ...receipts()].slice(0, 500));
}

export function deleteReceipt(id: string) {
  store(receipts().filter((r) => r.id !== id));
}

/** The line a producer puts in a video description or credits. */
export function creditTag(r: Pick<Receipt, "title" | "by">): string {
  return `${r.title} by ${r.by} (via Stash)`;
}

export function sourceUrl(r: Receipt): string {
  return r.source;
}

/** Plain text, for the zip and for pasting into a Content ID dispute. */
export function receiptText(r: Receipt): string {
  const l = LICENSE_LABELS[r.license];
  const date = new Date(r.createdAt);
  return [
    "STASH LICENSE RECEIPT",
    "",
    `Receipt:   ${r.id}`,
    `Date:      ${date.toUTCString()}`,
    `Sound:     ${r.title}`,
    `Type:      ${r.kind}`,
    `Made by:   ${r.by}`,
    `Source:    ${sourceUrl(r)}`,
    `License:   ${l.label} (version ${r.licenseVersion})`,
    `Terms:     ${l.summary}`,
    `Files:     ${r.files.join(", ")}`,
    "",
    `Credit:    ${creditTag(r)}`,
    "",
    "Keep this receipt. If a Content ID claim lands on a track that uses this sound, send this",
    "receipt with your dispute: it shows where the sound came from and under which license.",
    "",
  ].join("\n");
}

export function useReceipts(): Receipt[] {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  void v;
  return receipts();
}
