/**
 * The item page's keys (build spec, Behavior every screen shares): space plays and pauses, left and
 * right scrub, [ and ] shift key, - and = change tempo, L likes, D downloads. The global keyboard
 * map is ticket 225; this covers the page until then. Pure, so it is unit-tested.
 */
export type ItemKeyAction = "toggle" | "seekBack" | "seekForward" | "keyDown" | "keyUp" | "tempoDown" | "tempoUp" | "like" | "download";

export type KeyInput = {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: { tagName: string; role: string | null; editable: boolean };
};

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);
/** Elements that answer space themselves (a focused button presses, a link follows). */
const PRESSABLE_TAGS = new Set(["BUTTON", "A", "SUMMARY"]);
const PRESSABLE_ROLES = new Set(["button", "link", "checkbox", "switch", "tab", "menuitem", "option", "radio", "slider"]);
/** Elements that answer the arrows themselves. */
const ARROW_ROLES = new Set(["slider", "tab", "menuitem", "option", "radio", "listbox", "menu", "tablist", "group"]);

const MAP: Record<string, ItemKeyAction> = {
  " ": "toggle",
  ArrowLeft: "seekBack",
  ArrowRight: "seekForward",
  "[": "keyDown",
  "]": "keyUp",
  "-": "tempoDown",
  "=": "tempoUp",
  l: "like",
  d: "download",
};

export function itemKeyAction(e: KeyInput): ItemKeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const { tagName, role, editable } = e.target;
  if (editable || TYPING.has(tagName)) return null;
  const action = MAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!action) return null;
  if (action === "toggle" && (PRESSABLE_TAGS.has(tagName) || (role && PRESSABLE_ROLES.has(role)))) return null;
  if ((action === "seekBack" || action === "seekForward") && role && ARROW_ROLES.has(role)) return null;
  return action;
}

/** Reads what itemKeyAction needs from a real keyboard event. */
export function keyInputFrom(e: KeyboardEvent): KeyInput {
  const el = e.target instanceof Element ? e.target : null;
  return {
    key: e.key,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    target: {
      tagName: el?.tagName ?? "BODY",
      role: el?.getAttribute("role") ?? null,
      editable: el instanceof HTMLElement && el.isContentEditable,
    },
  };
}
