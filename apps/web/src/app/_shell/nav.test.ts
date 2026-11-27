import { describe, expect, it } from "vitest";
import { isCurrent, itemsFor, navItems } from "./nav";

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

describe("itemsFor", () => {
  it("sends Profile to sign-in when nobody is signed in", () => {
    expect(itemsFor(null).find((i) => i.label === "Profile")?.href).toBe("/login");
  });
  it("sends Profile to the viewer's own page once signed in", () => {
    expect(itemsFor({ handle: "you", name: "You" }).find((i) => i.label === "Profile")?.href).toBe("/u/you");
    expect(navItems.find((i) => i.label === "Profile")?.href).toBe("/login");
  });
});
