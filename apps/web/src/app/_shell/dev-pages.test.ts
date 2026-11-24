import { describe, expect, it } from "vitest";
import { devPagesEnabled } from "./dev-pages";

describe("dev pages", () => {
  it("are off unless STASH_DEV_PAGES is exactly 1", () => {
    expect(devPagesEnabled({})).toBe(false);
    expect(devPagesEnabled({ STASH_DEV_PAGES: "0" })).toBe(false);
    expect(devPagesEnabled({ STASH_DEV_PAGES: "true" })).toBe(false);
    expect(devPagesEnabled({ STASH_DEV_PAGES: "" })).toBe(false);
    expect(devPagesEnabled({ STASH_DEV_PAGES: "1" })).toBe(true);
  });
  it("do not follow NODE_ENV: a production build serves them only with the flag", () => {
    expect(devPagesEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devPagesEnabled({ NODE_ENV: "production", STASH_DEV_PAGES: "1" })).toBe(true);
  });
});
