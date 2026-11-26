import { describe, expect, it } from "vitest";
import { clean, LIMITS, problemWith, type Post } from "./comments-store";

const now = Date.parse("2026-11-25T12:00:00Z");
const ago = (s: number) => new Date(now - s * 1000).toISOString();
const post = (over: Partial<Post> = {}): Post => ({ id: "a1", item: "loop1", parent: null, text: "hard", at: ago(3600), ...over });

describe("problemWith", () => {
  it("accepts a normal comment", () => {
    expect(problemWith("This flips so hard at 70", "@nightowl", "loop1", [], now)).toBeNull();
  });

  it("needs a name and some text, and caps both", () => {
    expect(problemWith("hi", " ", "loop1", [], now)).toMatch(/name/);
    expect(problemWith("   ", "Kai", "loop1", [], now)).toMatch(/Write/);
    expect(problemWith("x".repeat(LIMITS.text + 1), "Kai", "loop1", [], now)).toMatch(/under 500/);
    expect(problemWith("hi", "k".repeat(LIMITS.name + 1), "loop1", [], now)).toMatch(/under 30/);
  });

  it("stops link spam, held-down keys and shouting", () => {
    expect(problemWith("go to https://a.com and https://b.com", "Kai", "loop1", [], now)).toMatch(/one link/);
    expect(problemWith("one link https://a.com is fine", "Kai", "loop1", [], now)).toBeNull();
    expect(problemWith("fireeeeeeeeeeeeeeee", "Kai", "loop1", [], now)).toMatch(/key held/);
    expect(problemWith("BUY MY BEATS NOW CHEAP CHEAP", "Kai", "loop1", [], now)).toMatch(/caps/);
  });

  it("rate-limits posting", () => {
    expect(problemWith("again", "Kai", "loop1", [post({ at: ago(5) })], now)).toMatch(/Wait 10 s/);
    const burst = [1, 2, 3, 4, 5].map((i) => post({ id: `b${i}`, text: `t${i}`, at: ago(60 * i) }));
    expect(problemWith("one more", "Kai", "loop1", burst, now)).toMatch(/breather/);
    expect(problemWith("one more", "Kai", "loop1", burst.slice(0, 4), now)).toBeNull();
  });

  it("refuses the same comment twice on one sound, but not on another", () => {
    const history = [post({ text: "Hard  Loop" })];
    expect(problemWith("hard loop", "Kai", "loop1", history, now)).toMatch(/already/);
    expect(problemWith("hard loop", "Kai", "loop2", history, now)).toBeNull();
  });
});

describe("clean", () => {
  it("keeps well-formed comments and likes", () => {
    const doc = clean({ name: "Kai", posts: { a1: post() }, likes: { "u2/x1": ago(10) }, follows: { p1: ago(5), bad: 3 } });
    expect(Object.keys(doc.follows)).toEqual(["p1"]);
    expect(doc.name).toBe("Kai");
    expect(doc.posts.a1?.text).toBe("hard");
    expect(Object.keys(doc.likes)).toEqual(["u2/x1"]);
  });

  it("drops anything malformed or over the limits from another browser", () => {
    const doc = clean({
      name: "n".repeat(99),
      posts: {
        ok: post({ id: "ok" }),
        long: post({ text: "x".repeat(LIMITS.text + 1) }),
        nodate: post({ at: "yesterday" }),
        "bad id!": post(),
        notext: { item: "loop1", at: ago(1) },
      },
      likes: { k: 5 },
    });
    expect(doc.name).toBe("");
    expect(Object.keys(doc.posts)).toEqual(["ok"]);
    expect(doc.likes).toEqual({});
    expect(clean(undefined)).toEqual({ name: "", posts: {}, likes: {}, follows: {} });
  });
});
