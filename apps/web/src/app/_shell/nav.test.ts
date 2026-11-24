import { describe, expect, it } from "vitest";
import { isCurrent, navFor, navItems } from "./nav";

const item = (label: string) => navItems.find((i) => i.label === label)!;

describe("navigation", () => {
  it("lists the five destinations in the spec's order", () => {
    expect(navItems.map((i) => i.label)).toEqual(["Home", "Browse", "Upload", "Library", "Profile"]);
  });

  it("marks Home only on the root", () => {
    expect(isCurrent("/", item("Home"))).toBe(true);
    expect(isCurrent("/browse/loops", item("Home"))).toBe(false);
  });

  it("marks a section for its whole subtree and nothing that merely shares a prefix", () => {
    expect(isCurrent("/browse/kits", item("Browse"))).toBe(true);
    expect(isCurrent("/browse", item("Browse"))).toBe(true);
    expect(isCurrent("/browsers", item("Browse"))).toBe(false);
    expect(isCurrent("/u/kilo_beats", item("Profile"))).toBe(true);
    expect(isCurrent("/upload", item("Profile"))).toBe(false);
    expect(isCurrent("/upload", item("Upload"))).toBe(true);
  });
});

describe("navigation for a viewer", () => {
  const profile = (items: ReturnType<typeof navFor>) => items.find((i) => i.label === "Profile")!;
  it("sends a visitor, or someone still choosing a handle, to sign in", () => {
    expect(profile(navFor({ status: "signed_out" })).href).toBe("/login");
    expect(profile(navFor({ status: "needs_handle" })).href).toBe("/login");
  });
  it("sends a member to their own page, current there and not on someone else's", () => {
    const p = profile(navFor({ status: "member", handle: "kilo_beats", displayName: "Kilo Beats", avatarUrl: null }));
    expect(p.href).toBe("/u/kilo_beats");
    expect(isCurrent("/u/kilo_beats", p)).toBe(true);
    expect(isCurrent("/u/nova", p)).toBe(false);
  });
});
