import { describe, expect, it } from "vitest";
import { DEMO_HOME, shareLink } from "./share";

const at = (href: string) => new URL(href) as unknown as Location;

describe("shareLink", () => {
  it("links to the demo's public address and the page's name", () => {
    expect(shareLink("/song/sicko-mode-travis-scott", at("https://abc.claudeusercontent.com/index.html"))).toBe(`${DEMO_HOME}#song-sicko-mode-travis-scott`);
    expect(shareLink("/kit/insppinksky", at("https://abc.claudeusercontent.com/"))).toBe(`${DEMO_HOME}#kit-insppinksky`);
  });
  it("stays on the local server when run locally", () => {
    expect(shareLink("/song/x-y", at("http://localhost:8811/"))).toBe("http://localhost:8811/#song-x-y");
  });
});
