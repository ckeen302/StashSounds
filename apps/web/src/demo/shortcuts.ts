import { useEffect } from "react";
import { getEngine } from "@stash/audio";

/**
 * Desktop keyboard shortcuts, on every page:
 *   Space  play or pause (the sound picked with the arrows, else what is loaded, else the first one)
 *   ↑ ↓    move between the sounds on the page (and play the next one when something is playing)
 *   L      like the picked sound, or the one playing
 *   /      jump to search
 * Off while typing in a field, with a modifier held, or while a dialog or menu is open. A page with
 * keys of its own (the pads, the MIDI player) claims them with `usePageKeys`, and keeps them.
 */

export type Shortcut = "play" | "next" | "previous" | "like" | "search";

const KEYS: Record<string, Shortcut> = { " ": "play", ArrowDown: "next", ArrowUp: "previous", l: "like", L: "like", "/": "search" };

type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; defaultPrevented: boolean; target: EventTarget | null };

/** Whether the person is typing: a text field, a select, or anything editable. */
export function isTyping(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).tagName !== "string") return false;
  const el = t as HTMLElement;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(type);
}

/** The shortcut a key press asks for, or null when it is not one or should be left alone. */
export function shortcutFor(e: KeyLike, claimed: ReadonlySet<string> = new Set()): Shortcut | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return null;
  const s = KEYS[e.key];
  if (!s || isTyping(e.target) || claimed.has(e.key) || claimed.has(e.key.toLowerCase())) return null;
  // On a focused button or link, Space is that control's own click.
  if (s === "play" && (e.target as Element | null)?.closest?.("button, a, [role=button], [role=menuitem], [role=tab], [role=option]")) return null;
  return s;
}

// Keys a page handles itself, while it is on screen.
const claims = new Map<symbol, string[]>();
function claimed(): Set<string> {
  return new Set([...claims.values()].flat());
}

/** A page with its own keys (pads, a MIDI player) keeps them: the site-wide ones stand aside. */
export function usePageKeys(keys: string[]) {
  const k = keys.join("\u0000");
  useEffect(() => {
    const id = Symbol();
    claims.set(id, k.split("\u0000"));
    return () => void claims.delete(id);
  }, [k]);
}

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** Every sound's play button on the page, in order. */
function sounds(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("main [data-play-state]")].filter(visible);
}

/** The play button of the sound the person is on: the one focused, or inside the focused row. */
function picked(): HTMLButtonElement | null {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  if (a.matches("[data-play-state]")) return a as HTMLButtonElement;
  return a.closest("li, tr, [role=row]")?.querySelector<HTMLButtonElement>("[data-play-state]") ?? null;
}

const playing = () => sounds().find((b) => b.dataset.playState === "playing" || b.dataset.playState === "loading") ?? null;

function pick(b: HTMLButtonElement) {
  b.focus({ preventScroll: true });
  b.scrollIntoView({ block: "nearest" });
}

function likeNear(b: Element | null): HTMLButtonElement | null {
  const row = b?.closest("li, tr, [role=row], article, section");
  const sel = 'button[aria-label^="Like "], button[aria-label^="Unlike "]';
  return row?.querySelector<HTMLButtonElement>(sel) ?? null;
}

function run(s: Shortcut): boolean {
  switch (s) {
    case "search": {
      // The page's own search box (Loops, Search) first, then the one in the top bar.
      const all = [...document.querySelectorAll<HTMLInputElement>('input[type="search"]')].filter(visible);
      const box = all.find((x) => !x.hasAttribute("aria-keyshortcuts")) ?? all[0];
      if (box) {
        box.focus();
        box.select();
        return true;
      }
      // No box on screen (a phone-sized window): the search page has one.
      const link = document.querySelector<HTMLAnchorElement>('a[href$="search"]');
      link?.click();
      return !!link;
    }
    case "play": {
      const b = picked();
      if (b) {
        b.click();
        return true;
      }
      const engine = getEngine();
      const st = engine.getState();
      if (st.current && st.status === "playing") {
        engine.pause();
        return true;
      }
      if (st.current && st.status === "paused") {
        void engine.play();
        return true;
      }
      const first = playing() ?? sounds()[0];
      if (!first) return false;
      first.click();
      return true;
    }
    case "next":
    case "previous": {
      const all = sounds();
      if (!all.length) return false;
      const from = picked() ?? playing();
      const i = from ? all.indexOf(from) : -1;
      const n = i < 0 ? (s === "next" ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, i + (s === "next" ? 1 : -1)));
      const target = all[n]!;
      const wasPlaying = !!playing();
      pick(target);
      // Auditioning: with something playing, the next sound plays as you land on it.
      if (wasPlaying && target.dataset.playState !== "playing") target.click();
      return true;
    }
    case "like": {
      const b = likeNear(picked() ?? playing());
      const only = b ?? [...document.querySelectorAll<HTMLButtonElement>('main button[aria-label^="Like "], main button[aria-label^="Unlike "]')].filter(visible);
      const target = Array.isArray(only) ? (only.length === 1 ? only[0] : null) : only;
      if (!target) return false;
      target.click();
      return true;
    }
  }
}

/** Installs the shortcuts for the whole app. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      const s = shortcutFor(e, claimed());
      if (s && run(s)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
