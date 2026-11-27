import { describe, expect, it } from "vitest";
import { isTyping, shortcutFor } from "./shortcuts";

const el = (tagName: string, o: { type?: string; isContentEditable?: boolean; inControl?: boolean } = {}) =>
  ({ tagName, type: o.type ?? "", isContentEditable: !!o.isContentEditable, closest: () => (o.inControl ? {} : null) }) as unknown as EventTarget;
const press = (key: string, target: EventTarget | null = el("BODY"), mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; defaultPrevented: boolean }> = {}) => ({
  key,
  target,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  defaultPrevented: false,
  ...mods,
});

describe("keyboard shortcuts", () => {
  it("maps Space, the arrows, L and / to their actions", () => {
    expect(shortcutFor(press(" "))).toBe("play");
    expect(shortcutFor(press("ArrowDown"))).toBe("next");
    expect(shortcutFor(press("ArrowUp"))).toBe("previous");
    expect(shortcutFor(press("l"))).toBe("like");
    expect(shortcutFor(press("L"))).toBe("like");
    expect(shortcutFor(press("/"))).toBe("search");
    expect(shortcutFor(press("k"))).toBeNull();
  });

  it("stays out of the way while typing", () => {
    expect(isTyping(el("INPUT", { type: "search" }))).toBe(true);
    expect(isTyping(el("TEXTAREA"))).toBe(true);
    expect(isTyping(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTyping(el("INPUT", { type: "checkbox" }))).toBe(false);
    for (const k of [" ", "l", "/", "ArrowDown"]) expect(shortcutFor(press(k, el("INPUT", { type: "text" })))).toBeNull();
  });

  it("leaves modified keys, handled keys and a page's own keys alone", () => {
    expect(shortcutFor(press("l", el("BODY"), { metaKey: true }))).toBeNull();
    expect(shortcutFor(press("/", el("BODY"), { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(press("ArrowDown", el("BODY"), { defaultPrevented: true }))).toBeNull();
    expect(shortcutFor(press(" "), new Set([" "]))).toBeNull();
    expect(shortcutFor(press("L"), new Set(["l"]))).toBeNull();
  });

  it("lets Space click a focused button instead", () => {
    expect(shortcutFor(press(" ", el("BUTTON", { inControl: true })))).toBeNull();
    expect(shortcutFor(press("l", el("BUTTON", { inControl: true })))).toBe("like");
  });
});
