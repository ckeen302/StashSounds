import { beforeAll, describe, expect, it } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { encodePeaks, type ItemRow } from "@stash/contracts";
import {
  Bell,
  ButtonLink,
  IconLink,
  PlayerSheetPreview,
  describePlayer,
  PlayerBar,
  playerFraction,
  Slider,
  ToastProvider,
  ToastViewport,
  TooltipProvider,
  volumeText,
  type PlayerBarProps,
  type PlayerStatus,
} from "../src/index.ts";

/** Ticket 132: the player bar, the volume slider and the toast viewport the shell places. */
const html = (el: ReactElement) => renderToStaticMarkup(h(TooltipProvider, { children: el }));

const row: ItemRow = {
  id: "00000000-0000-4000-8000-000000000001",
  publicId: "k3j9x0a2b1",
  type: "loop",
  title: "Dusty soul chops",
  slug: "dusty-soul-chops",
  href: "/loop/dusty-soul-chops-k3j9x0a2b1",
  owner: { handle: "kilo_beats", displayName: "Kilo Beats", avatarUrl: null },
  license: "royalty_free",
  bpm: 90,
  key: { root: 2, mode: "minor" },
  durationMs: 5333,
  length: { unit: "bars", value: 2 },
  tags: ["soul"],
  peaks: encodePeaks(new Array(800).fill(100)),
  playable: { kind: "loop", id: "00000000-0000-4000-8000-000000000001", previewUrl: "https://media.example/p.ogg", loopSamples: 235200, sampleRate: 44100 },
  likesCount: 3,
  downloadsCount: 9,
  publishedAt: "2026-11-20T18:00:00Z",
};

const noop = () => {};

// The loaded bar's details and the sheet load lazily (player-details.tsx), so the first paint of an
// idle bar stays inside the script budget. prerender waits for them once; after that every render
// below draws them synchronously, as the client does after the first play.
beforeAll(async () => {
  await prerender(
    h(TooltipProvider, {
      children: h(PlayerBar, { item: row, status: "playing", durationMs: 5333, getPositionMs: () => 0, onPlayPause: noop, volume: 0.8, onVolumeChange: noop }),
    }),
  );
});
const bar = (p: Partial<PlayerBarProps>) =>
  html(
    h(PlayerBar, {
      item: row,
      status: "playing",
      durationMs: 5333,
      getPositionMs: () => 1200,
      onPlayPause: noop,
      volume: 0.8,
      onVolumeChange: noop,
      ...p,
    }),
  );

describe("describePlayer", () => {
  it("announces title, uploader and state", () => {
    expect(describePlayer("playing", row)).toBe("Playing Dusty soul chops by @kilo_beats");
    expect(describePlayer("paused", row)).toBe("Paused Dusty soul chops by @kilo_beats");
    expect(describePlayer("loading", row)).toBe("Loading Dusty soul chops by @kilo_beats");
    expect(describePlayer("error", row)).toBe("Could not play Dusty soul chops by @kilo_beats. Press play to retry.");
  });
  it("says nothing is playing when idle or without an item", () => {
    expect(describePlayer("idle", null)).toBe("Nothing playing");
    expect(describePlayer("playing", null)).toBe("Nothing playing");
  });
});

describe("playerFraction", () => {
  it("is position over duration, kept inside 0..1", () => {
    expect(playerFraction(1000, 4000)).toBe(0.25);
    expect(playerFraction(-5, 4000)).toBe(0);
    expect(playerFraction(5000, 4000)).toBe(1);
  });
  it("is 0 when the duration is unknown", () => {
    expect(playerFraction(1000, 0)).toBe(0);
    expect(playerFraction(1000, Number.NaN)).toBe(0);
    expect(playerFraction(Number.NaN, 4000)).toBe(0);
  });
});

describe("PlayerBar", () => {
  it("is a labelled region with a polite announcement of what plays", () => {
    const out = bar({});
    expect(out).toMatch(/<section[^>]*aria-label="Player"/);
    expect(out).toMatch(/aria-live="polite"[^>]*>Playing Dusty soul chops by @kilo_beats</);
  });

  it("links the title to the item and the handle to the uploader", () => {
    const out = bar({});
    expect(out).toContain('href="/loop/dusty-soul-chops-k3j9x0a2b1"');
    expect(out).toContain('href="/u/kilo_beats"');
    expect(out).toContain("@kilo_beats");
  });

  it("draws the play button for each engine status", () => {
    const states: [PlayerStatus, string][] = [
      ["playing", "Pause Dusty soul chops"],
      ["paused", "Play Dusty soul chops"],
      ["loading", "Loading Dusty soul chops"],
      ["error", "Could not play Dusty soul chops. Retry"],
    ];
    for (const [status, label] of states) expect(bar({ status })).toContain(`aria-label="${label}"`);
    expect(bar({ status: "loading" })).toContain('aria-busy="true"');
  });

  it("is idle with nothing loaded: play disabled, no links, a plain line", () => {
    const out = bar({ item: null, status: "idle" });
    expect(out).toContain("Nothing playing");
    expect(out).not.toContain("href=");
    expect(out).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*data-play-state="paused")/);
  });

  it("shows BPM and key as engraved readouts and the total time", () => {
    const out = bar({});
    expect(out).toMatch(/BPM<\/span><span[^>]*>90</);
    expect(out).toMatch(/KEY<\/span><span[^>]*>Dm</);
    expect(out).toContain("0:05");
  });

  it("disables previous and next without a queue neighbour", () => {
    const out = bar({});
    const disabled = (name: string) => new RegExp(`<button(?=[^>]*disabled="")(?=[^>]*aria-label="${name}")`);
    expect(out).toMatch(disabled("Previous"));
    expect(out).toMatch(disabled("Next"));
    const withQueue = bar({ onPrevious: noop, onNext: noop });
    expect(withQueue).not.toMatch(disabled("Previous"));
    expect(withQueue).not.toMatch(disabled("Next"));
  });

  it("has a volume slider and a mute toggle", () => {
    const out = bar({ volume: 0.5 });
    expect(out).toMatch(/<span(?=[^>]*role="slider")(?=[^>]*aria-label="Volume")(?=[^>]*aria-valuetext="50 percent")/);
    expect(out).toMatch(/<button(?=[^>]*aria-label="Mute")(?=[^>]*aria-pressed="false")/);
    expect(bar({ volume: 0 })).toMatch(/<button(?=[^>]*aria-label="Mute")(?=[^>]*aria-pressed="true")/);
  });

  it("opens the sheet from the phone mini player when given a handler", () => {
    expect(bar({ onOpenSheet: noop })).toContain('aria-label="Open player"');
    expect(bar({})).not.toContain('aria-label="Open player"');
  });

  it("describes the waveform in text", () => {
    expect(bar({})).toContain('aria-label="Loop, 2 bars, 90 BPM, Dm"');
  });

  it("draws the progress line below desktop, where the bar has no waveform (PR #12 review)", () => {
    expect(bar({})).toMatch(/<span(?=[^>]*data-player-progress="")(?=[^>]*class="[^"]*desktop:hidden)/);
  });

  it("restores the level from before mute it is given, as after a reload", () => {
    // Muted at first render: without the remembered level the toggle could only fall back to 0.8.
    expect(bar({ volume: 0, unmuteVolume: 0.6 })).toMatch(/<button(?=[^>]*aria-label="Mute")(?=[^>]*aria-pressed="true")/);
  });

  it("never reads position into the markup beyond the first frame", () => {
    // The time text starts at 0:00 on the server; the animation frame writes it on the client.
    expect(bar({ getPositionMs: () => 4000 })).toMatch(/data-player-elapsed=""[^>]*>0:00</);
  });
});

describe("Slider", () => {
  const out = html(h(Slider, { label: "Volume", value: 0.8, onValueChange: noop, valueText: volumeText }));
  it("renders a labelled slider thumb with its value as text", () => {
    expect(out).toMatch(/role="slider"/);
    expect(out).toContain('aria-label="Volume"');
    expect(out).toContain('aria-valuetext="80 percent"');
  });
  it("shows the frozen states for the gallery", () => {
    expect(html(h(Slider, { label: "Volume", value: 0.4, "data-focus": true }))).toContain("data-focus");
    expect(html(h(Slider, { label: "Volume", value: 0.4, "data-dragging": true }))).toContain("data-dragging");
    expect(html(h(Slider, { label: "Volume", value: 0.4, disabled: true }))).toContain("data-disabled");
  });
  it("draws the unfilled track in border-strong, which clears 3 to 1 (PR #12 review)", () => {
    expect(out).toMatch(/<span(?=[^>]*data-orientation="horizontal")(?=[^>]*class="[^"]*\bbg-border-strong\b)[^>]*>/);
  });
  it("rounds the volume text", () => {
    expect(volumeText(0)).toBe("0 percent");
    expect(volumeText(0.333)).toBe("33 percent");
    expect(volumeText(1)).toBe("100 percent");
  });
});

describe("ToastViewport", () => {
  it("renders the notifications region where the shell places it", () => {
    const out = html(h(ToastProvider, { viewport: false, children: h(ToastViewport, {}) }));
    expect(out).toContain('aria-label="Notifications');
    expect(out.match(/aria-label="Notifications/g)).toHaveLength(1);
  });
});

describe("PlayerSheetPreview", () => {
  const out = html(
    h(PlayerSheetPreview, { item: row, status: "playing", durationMs: 5333, getPositionMs: () => 0, onPlayPause: noop, onSeek: noop, volume: 0.8, onVolumeChange: noop }),
  );
  it("is an inert picture of the sheet with the hero seek, transport and volume", () => {
    expect(out).toMatch(/^<div inert=""/);
    expect(out).toContain('aria-label="Seek, Loop, 2 bars, 90 BPM, Dm"');
    expect(out).toContain('aria-label="Pause Dusty soul chops"');
    expect(out).toContain('aria-label="Close player"');
    expect(out).toContain('aria-label="Volume"');
  });
  it("lets a long title take two lines, and the handle is a 40 px target", () => {
    expect(out).toMatch(/<p class="[^"]*line-clamp-2[^"]*">Dusty soul chops</);
    expect(out).toMatch(/<a(?=[^>]*href="\/u\/kilo_beats")(?=[^>]*class="[^"]*\bh-10\b)/);
  });
});

describe("IconLink", () => {
  it("is a named link drawn as a ghost icon button", () => {
    const out = html(h(IconLink, { href: "/notifications", icon: Bell, label: "Notifications" }));
    expect(out).toMatch(/<a (?=[^>]*href="\/notifications")(?=[^>]*aria-label="Notifications")/);
    expect(out).toContain('aria-hidden="true"');
  });
});

describe("ButtonLink", () => {
  it("is a link drawn as a button", () => {
    const out = html(h(ButtonLink, { href: "/login", variant: "primary", size: "sm", children: "Sign in" }));
    expect(out).toMatch(/<a [^>]*href="\/login"/);
    expect(out).toContain("bg-accent");
    expect(out).toContain(">Sign in</span>");
  });
});
