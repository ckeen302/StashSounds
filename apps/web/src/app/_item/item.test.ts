import { describe, expect, it, vi } from "vitest";
import { itemPageSchema, LICENSES, type ItemPage } from "@stash/contracts";
import { fixtureItemPage, FIXTURE_VIEWER_COOKIE } from "./fixtures";
import { itemKeyAction, type KeyInput } from "./keys";
import { loadItemViewWith } from "./load-core";
import { localActions } from "./local-actions";
import { createWrapWatch } from "./loop-watch";
import { itemDescription, itemMetadata } from "./meta";

const fixture = (): ItemPage => {
  const r = fixtureItemPage("loop", "dusty-soul-chops-k3j9x0a2b1", { signedIn: false });
  if (r.kind !== "page") throw new Error("fixture missing");
  return r.page;
};

describe("fixture pages", () => {
  it("are real item pages: parsed with the contract, owner and more-from-owner consistent", () => {
    const page = fixture();
    expect(() => itemPageSchema.parse(page)).not.toThrow();
    expect(page.item.viewer).toBeUndefined();
    expect(page.moreFromOwner.length).toBeGreaterThan(0);
    for (const r of page.moreFromOwner) {
      expect(r.owner.handle).toBe(page.owner.handle);
      expect(r.id).not.toBe(page.item.id);
    }
    expect(page.similar).toEqual([]);
  });

  it("carry the viewer when signed in", () => {
    const r = fixtureItemPage("loop", "dusty-soul-chops-k3j9x0a2b1", { signedIn: true });
    expect(r.kind === "page" && r.page.item.viewer).toEqual({ liked: false });
  });

  it("redirect a wrong slug or type to the canonical address, and miss unknown ids", () => {
    expect(fixtureItemPage("loop", "old-name-k3j9x0a2b1", { signedIn: false })).toEqual({ kind: "redirect", href: "/loop/dusty-soul-chops-k3j9x0a2b1" });
    expect(fixtureItemPage("kit", "dusty-soul-chops-k3j9x0a2b1", { signedIn: false })).toEqual({ kind: "redirect", href: "/loop/dusty-soul-chops-k3j9x0a2b1" });
    expect(fixtureItemPage("loop", "nope-zzzzzzzzzz", { signedIn: false })).toEqual({ kind: "not_found" });
    expect(fixtureItemPage("loop", "%%%", { signedIn: false })).toEqual({ kind: "not_found" });
  });
});

describe("the item loader", () => {
  const deps = (env: Record<string, string | undefined>, cookie?: string) => ({
    env,
    cookie: vi.fn(async (name: string) => (name === FIXTURE_VIEWER_COOKIE ? cookie : undefined)),
    itemPage: vi.fn(async () => fixture()),
    signedIn: vi.fn(async () => true),
    redirect: vi.fn((href: string): never => {
      throw new Error(`redirect ${href}`);
    }),
    notFound: vi.fn((): never => {
      throw new Error("not found");
    }),
  });

  it("reads the real query in production, even for a fixture id", async () => {
    const d = deps({});
    const view = await loadItemViewWith(d, "loop", "dusty-soul-chops-k3j9x0a2b1");
    expect(d.itemPage).toHaveBeenCalledWith("loop", "dusty-soul-chops-k3j9x0a2b1");
    expect(d.cookie).not.toHaveBeenCalled();
    expect(view.source).toBe("server");
    expect(view.viewer.signedIn).toBe(true);
  });

  it("answers fixture ids from fixtures only with STASH_DEV_PAGES=1", async () => {
    const d = deps({ STASH_DEV_PAGES: "1" });
    const view = await loadItemViewWith(d, "loop", "dusty-soul-chops-k3j9x0a2b1");
    expect(d.itemPage).not.toHaveBeenCalled();
    expect(view.source).toBe("local");
    expect(view.viewer.signedIn).toBe(false);
    expect(view.page.item.title).toBe("Dusty soul chops");
  });

  it("signs the fixture viewer in with the dev cookie", async () => {
    const view = await loadItemViewWith(deps({ STASH_DEV_PAGES: "1" }, "member"), "loop", "dusty-soul-chops-k3j9x0a2b1");
    expect(view.viewer.signedIn).toBe(true);
    expect(view.page.item.viewer).toEqual({ liked: false });
  });

  it("redirects and 404s fixture addresses like the real query", async () => {
    const d = deps({ STASH_DEV_PAGES: "1" });
    await expect(loadItemViewWith(d, "loop", "old-k3j9x0a2b1")).rejects.toThrow("redirect /loop/dusty-soul-chops-k3j9x0a2b1");
    // Ids that are not fixtures still go to the real query in dev.
    await loadItemViewWith(d, "loop", "real-thing-abcdefghij");
    expect(d.itemPage).toHaveBeenCalledWith("loop", "real-thing-abcdefghij");
  });
});

describe("metadata and the preview card", () => {
  it("describes the sound in producer terms", () => {
    expect(itemDescription(fixture())).toBe("Loop, 2 bars, 90 BPM, Dm by Kilo Beats. Royalty-free. Hear it instantly and download it on Stash.");
  });

  it("sets the title, canonical address, Open Graph and a Twitter card", () => {
    const m = itemMetadata(fixture(), "https://stash.example");
    expect(m.title).toBe("Dusty soul chops by Kilo Beats");
    expect(m.alternates?.canonical).toBe("/loop/dusty-soul-chops-k3j9x0a2b1");
    expect(m.metadataBase?.toString()).toBe("https://stash.example/");
    expect(m.openGraph).toMatchObject({ title: "Dusty soul chops", url: "/loop/dusty-soul-chops-k3j9x0a2b1", siteName: "Stash", type: "music.song" });
    expect(m.twitter).toMatchObject({ card: "summary", title: "Dusty soul chops" });
  });

  it("leaves out a base it cannot trust", () => {
    expect(itemMetadata(fixture(), "not a url").metadataBase).toBeUndefined();
    expect(itemMetadata(fixture(), undefined).metadataBase).toBeUndefined();
  });
});

describe("page keys", () => {
  const k = (key: string, more: Partial<KeyInput> = {}): KeyInput => ({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, target: { tagName: "BODY", role: null, editable: false }, ...more });

  it("maps the shared keys to actions", () => {
    expect(itemKeyAction(k(" "))).toBe("toggle");
    expect(itemKeyAction(k("ArrowLeft"))).toBe("seekBack");
    expect(itemKeyAction(k("ArrowRight"))).toBe("seekForward");
    expect(itemKeyAction(k("["))).toBe("keyDown");
    expect(itemKeyAction(k("]"))).toBe("keyUp");
    expect(itemKeyAction(k("-"))).toBe("tempoDown");
    expect(itemKeyAction(k("="))).toBe("tempoUp");
    expect(itemKeyAction(k("l"))).toBe("like");
    expect(itemKeyAction(k("L", { shiftKey: true }))).toBe("like");
    expect(itemKeyAction(k("d"))).toBe("download");
    expect(itemKeyAction(k("x"))).toBeNull();
  });

  it("leaves typing, shortcuts with modifiers and native controls alone", () => {
    expect(itemKeyAction(k("l", { target: { tagName: "INPUT", role: null, editable: false } }))).toBeNull();
    expect(itemKeyAction(k(" ", { target: { tagName: "DIV", role: null, editable: true } }))).toBeNull();
    expect(itemKeyAction(k("d", { metaKey: true }))).toBeNull();
    expect(itemKeyAction(k("-", { ctrlKey: true }))).toBeNull();
    // A focused button or link takes space itself; a slider takes the arrows itself.
    expect(itemKeyAction(k(" ", { target: { tagName: "BUTTON", role: null, editable: false } }))).toBeNull();
    expect(itemKeyAction(k(" ", { target: { tagName: "A", role: null, editable: false } }))).toBeNull();
    expect(itemKeyAction(k("ArrowLeft", { target: { tagName: "SPAN", role: "slider", editable: false } }))).toBeNull();
    // Letters still work from a focused button.
    expect(itemKeyAction(k("l", { target: { tagName: "BUTTON", role: null, editable: false } }))).toBe("like");
  });
});

describe("loop off", () => {
  it("sees the wrap back to the start exactly once per pass", () => {
    const seen = createWrapWatch();
    expect(seen(100, 5000)).toBe(false);
    expect(seen(4900, 5000)).toBe(false);
    expect(seen(30, 5000)).toBe(true);
    expect(seen(60, 5000)).toBe(false);
  });

  it("does not mistake a small step back (a seek) for a wrap", () => {
    const seen = createWrapWatch();
    seen(3000, 5000);
    expect(seen(2000, 5000)).toBe(false);
    seen(0, 0);
    expect(seen(0, 0)).toBe(false);
  });

  it("forgets the last position when reset, so a seek to the start is not a wrap", () => {
    const seen = createWrapWatch();
    seen(4800, 5000);
    seen.reset();
    expect(seen(0, 5000)).toBe(false);
  });
});

describe("local actions (fixtures and the demo)", () => {
  it("download hands back the file with the item's license and version", async () => {
    const page = fixture();
    const a = localActions(page, { downloadUrl: "https://media.stash.local/downloads/x.wav", now: () => new Date("2026-11-24T10:00:00Z") });
    const r = await a.download();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ url: "https://media.stash.local/downloads/x.wav", fileName: "Dusty soul chops.wav", license: page.item.license, licenseVersion: LICENSES[page.item.license].version });
    expect(r.data.expiresAt).toBe("2026-11-24T10:05:00.000Z");
  });

  it("like and follow toggle and count in memory", async () => {
    const page = fixture();
    const a = localActions(page);
    const liked = await a.like!(true);
    expect(liked).toEqual({ ok: true, data: { liked: true, likesCount: page.item.likesCount + 1 } });
    expect(await a.like!(false)).toEqual({ ok: true, data: { liked: false, likesCount: page.item.likesCount } });
    expect(await a.follow!(true)).toEqual({ ok: true, data: { following: true, followersCount: page.owner.followersCount + 1 } });
  });
});
