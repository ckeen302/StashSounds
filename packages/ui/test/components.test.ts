import { describe, expect, it } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodePeaks, type ItemRow } from "@stash/contracts";
import {
  Avatar,
  Button,
  DialogPreview,
  EmptyState,
  ErrorState,
  FilterChip,
  Heart,
  IconButton,
  initials,
  LicenseBadge,
  LinkProvider,
  PlayButton,
  ProgressSteps,
  ResultRow,
  SearchInput,
  Stat,
  TagChip,
  TextInput,
  TooltipProvider,
  TypeChip,
  UploaderCard,
  Waveform,
  formatCount,
  type LinkLikeProps,
} from "../src/index.ts";

/** The accessibility contract each component promises, checked on its server-rendered markup. */
const html = (el: ReactElement) => renderToStaticMarkup(h(TooltipProvider, null, el));

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
  tags: ["soul", "boom bap", "dusty"],
  peaks: encodePeaks(new Array(800).fill(100)),
  playable: { kind: "loop", id: "x", previewUrl: "https://media.example/p.ogg", loopSamples: 235200, sampleRate: 44100 },
  likesCount: 3,
  downloadsCount: 9,
  publishedAt: "2026-11-20T18:00:00Z",
  viewer: { liked: true },
};

describe("Button", () => {
  it("is a real button that does not submit forms by default", () => {
    expect(html(h(Button, { children: "Upload" }))).toMatch(/^<button type="button"/);
  });
  it("loading keeps the label, sets aria-busy and aria-disabled", () => {
    const out = html(h(Button, { loading: true, children: "Publishing" }));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain("Publishing");
  });
  it("disabled is disabled", () => {
    const out = html(h(Button, { disabled: true, children: "Save" }));
    // The attribute itself, not the word in a class name such as disabled:bg-surface.
    expect(out).toMatch(/^<button type="button" disabled=""/);
    expect(html(h(Button, { children: "Save" }))).not.toMatch(/<button[^>]* disabled=""/);
  });
});

describe("Icon button", () => {
  it("is named by its label, its icon is hidden, and on is aria-pressed", () => {
    const out = html(h(IconButton, { icon: Heart, label: "Like", on: true }));
    expect(out).toContain('aria-label="Like"');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('aria-hidden="true"');
  });
});

describe("Play button", () => {
  it("names the action and the sound in every state", () => {
    expect(html(h(PlayButton, { title: "Midnight keys" }))).toContain('aria-label="Play Midnight keys"');
    expect(html(h(PlayButton, { title: "Midnight keys", state: "playing" }))).toContain('aria-label="Pause Midnight keys"');
    expect(html(h(PlayButton, { title: "Midnight keys", state: "loading" }))).toContain('aria-busy="true"');
    expect(html(h(PlayButton, { title: "Midnight keys", state: "error" }))).toContain("Could not play Midnight keys. Retry");
  });
});

describe("Text input", () => {
  it("has a label tied to the field", () => {
    const out = html(h(TextInput, { label: "Title", id: "t" }));
    expect(out).toContain('<label for="t"');
    expect(out).toContain('id="t"');
  });
  it("invalid sets aria-invalid and describes the field with the message", () => {
    const out = html(h(TextInput, { label: "BPM", id: "bpm", error: "BPM must be between 40 and 300." }));
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="bpm-message"');
    expect(out).toContain('id="bpm-message"');
  });
  it("search is a search field with a hidden-able label and the / hint", () => {
    const out = html(h(SearchInput, { hideLabel: true, id: "q" }));
    expect(out).toContain('type="search"');
    expect(out).toContain('class="sr-only"');
    expect(out).toContain("<kbd");
  });
  it("a filled search offers a labelled clear button", () => {
    expect(html(h(SearchInput, { id: "q", value: "dusty", onClear: () => undefined, onChange: () => undefined }))).toContain('aria-label="Clear search"');
  });
});

describe("Chips", () => {
  it("type chips name the type", () => {
    expect(html(h(TypeChip, { type: "oneshot" }))).toContain("One-shot");
  });
  it("a plain tag is not a button; a removable one says what it removes", () => {
    expect(html(h(TagChip, { children: "soul" }))).not.toContain("<button");
    expect(html(h(TagChip, { onRemove: () => undefined, children: "soul" }))).toContain('aria-label="Remove tag soul"');
  });
  it("filters toggle with aria-pressed", () => {
    expect(html(h(FilterChip, { selected: true, onToggle: () => undefined, children: "Trap" }))).toContain('aria-pressed="true"');
    expect(html(h(FilterChip, { onRemove: () => undefined, children: "140 to 150 BPM" }))).toContain('aria-label="Remove filter 140 to 150 BPM"');
  });
});

describe("License badge", () => {
  it("links to the full text and shows the label", () => {
    const out = html(h(LicenseBadge, { kind: "split_on_placement", splitPercent: 50 }));
    expect(out).toContain('href="/licenses#split_on_placement"');
    expect(out).toContain("Split on placement");
    expect(out).toContain("50%");
  });
});

describe("Avatar", () => {
  it("falls back to up to two initials", () => {
    expect(initials("Kilo Beats")).toBe("KB");
    expect(initials("nova")).toBe("N");
    expect(initials("Deja On Keys")).toBe("DO");
    expect(html(h(Avatar, { name: "Kilo Beats" }))).toContain("KB");
  });
  it("is decorative next to a name, labelled when it stands alone", () => {
    expect(html(h(Avatar, { name: "Kilo Beats" }))).toContain('aria-hidden="true"');
    expect(html(h(Avatar, { name: "Kilo Beats", labelled: true }))).toContain('aria-label="Kilo Beats"');
  });
});

describe("Uploader card", () => {
  it("names who the follow button follows", () => {
    expect(html(h(UploaderCard, { owner: row.owner, href: "/u/kilo_beats" }))).toContain('aria-label="Follow Kilo Beats"');
    expect(html(h(UploaderCard, { owner: row.owner, href: "/u/kilo_beats", following: true }))).toContain('aria-label="Following Kilo Beats"');
  });
  it("shows no follow button on the viewer's own card", () => {
    const out = html(h(UploaderCard, { owner: row.owner, href: "/u/kilo_beats", own: true, editHref: "/settings/profile", variant: "full" }));
    expect(out).not.toContain("Follow");
    expect(out).toContain("Edit profile");
  });
  it("uses the app's link component when one is provided", () => {
    const Marked = (p: LinkLikeProps) => h("a", { ...p, "data-router": "" });
    const card = h(UploaderCard, { owner: row.owner, href: "/u/kilo_beats" });
    expect(renderToStaticMarkup(h(LinkProvider, { component: Marked, children: card }))).toContain("data-router");
  });
});

describe("Stat", () => {
  it("is a label over a number, and says when it is loading", () => {
    expect(html(h(Stat, { label: "Followers", value: 1204 }))).toMatch(/<dt[^>]*>Followers<\/dt><dd[^>]*>1,204<\/dd>/);
    expect(html(h(Stat, { label: "Followers", loading: true }))).toContain("Loading");
    expect(formatCount(48210)).toBe("48.2K");
  });
});

describe("Dialog preview", () => {
  it("shows the error as an alert", () => {
    expect(html(h(DialogPreview, { title: "Report", confirmLabel: "Send", error: "We could not send that." }))).toMatch(/role="alert"[^>]*>.*We could not send that\./);
  });
});

describe("Empty and error states", () => {
  it("empty offers its one action; error is an alert with retry", () => {
    expect(html(h(EmptyState, { title: "Nothing liked yet", action: h(Button, { children: "Browse loops" }) }))).toContain("Browse loops");
    const err = html(h(ErrorState, { title: "Could not load these sounds", onRetry: () => undefined }));
    expect(err).toContain('role="alert"');
    expect(err).toContain("Retry");
  });
});

describe("Progress steps", () => {
  it("marks the current step and states each step in words", () => {
    const out = html(h(ProgressSteps, { step: "analyzing" }));
    expect(out).toContain('aria-current="step"');
    expect(out).toContain(", done");
    expect(out).toContain(", in progress");
    expect(out).toContain(", not started");
  });
  it("uploading carries a progressbar with its value", () => {
    expect(html(h(ProgressSteps, { step: "uploading", progress: 0.42 }))).toContain('aria-valuenow="42"');
  });
  it("flagged says it needs review", () => {
    expect(html(h(ProgressSteps, { step: "flagged" }))).toContain("needs review");
  });
});

describe("Waveform", () => {
  it("is described in text", () => {
    expect(html(h(Waveform, { peaks: row.peaks, type: "loop", label: "Loop, 2 bars, 90 BPM, Dm" }))).toContain('role="img" aria-label="Loop, 2 bars, 90 BPM, Dm"');
  });
  it("a scrubbable hero is a slider with the time as its value", () => {
    const out = html(h(Waveform, { peaks: row.peaks, type: "loop", variant: "hero", progress: 0.5, durationMs: 6000, onScrub: () => undefined, label: "Loop" }));
    expect(out).toContain('role="slider"');
    expect(out).toContain('aria-valuenow="50"');
    expect(out).toContain('aria-valuetext="0:03 of 0:06"');
  });
});

describe("Result row", () => {
  const out = html(h(ResultRow, { row, playState: "playing", progress: 0.4 }));
  it("names every control with the sound's title", () => {
    expect(out).toContain('aria-label="Pause Dusty soul chops"');
    expect(out).toContain('aria-label="Like Dusty soul chops"');
    expect(out).toContain('aria-label="Download Dusty soul chops"');
    expect(out).toContain('aria-label="More for Dusty soul chops"');
  });
  it("labels its numbers for screen readers and links the title", () => {
    expect(out).toContain('<span class="sr-only">Key </span>Dm');
    expect(out).toContain('<span class="sr-only"> BPM</span>');
    expect(out).toContain('href="/loop/dusty-soul-chops-k3j9x0a2b1"');
  });
  it("shows the first two tags only", () => {
    expect(out).toContain("boom bap");
    expect(out).not.toContain("dusty</span>");
  });
  it("reflects the viewer's like", () => {
    expect(out).toMatch(/aria-label="Like Dusty soul chops" aria-pressed="true"/);
  });
});
