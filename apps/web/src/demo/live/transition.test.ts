import { describe, expect, it } from "vitest";
import { slideOf } from "./transition";

describe("page slides", () => {
  it("go forward to a bank further along the pad bank, back to one before", () => {
    expect(slideOf("/", "/loops")).toBe("forward");
    expect(slideOf("/samples", "/kits")).toBe("back");
  });

  it("go forward into a page inside a bank, and back out of it", () => {
    expect(slideOf("/kits", "/kit/abc")).toBe("forward");
    expect(slideOf("/kit/abc", "/kits")).toBe("back");
    expect(slideOf("/loops", "/loop/dark-keys-k3j9")).toBe("forward");
  });
});
