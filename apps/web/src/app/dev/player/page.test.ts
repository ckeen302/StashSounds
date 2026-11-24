import { afterEach, describe, expect, it, vi } from "vitest";

// The page's only server logic is the gate. The fixture player itself is a client component the
// end-to-end tests drive, so it is stubbed here.
vi.mock("./fixture-player", () => ({ FixturePlayer: () => null }));

const { default: PlayerPage, dynamic } = await import("./page");

describe("/dev/player", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers 404 without STASH_DEV_PAGES=1, as in production", () => {
    vi.stubEnv("STASH_DEV_PAGES", "");
    let thrown: unknown;
    try {
      PlayerPage();
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { digest?: string } | undefined)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("renders with the flag", () => {
    vi.stubEnv("STASH_DEV_PAGES", "1");
    expect(PlayerPage()).toBeTruthy();
  });

  it("reads the flag per request, not at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
