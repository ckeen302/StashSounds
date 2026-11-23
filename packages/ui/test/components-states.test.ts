import { describe, expect, it } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodePeaks, type ItemRow } from "@stash/contracts";
import {
  Avatar,
  Button,
  describeRow,
  formatCount,
  IconButton,
  Heart,
  initials,
  MenuPreview,
  ProgressSteps,
  ResultListSkeleton,
  ResultRow,
  ResultRowSkeleton,
  SkeletonCard,
  SkeletonText,
  Stat,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  ToastPreview,
  Tooltip,
  TooltipProvider,
  TooltipSurface,
  uploadStepFor,
  Waveform,
  type MenuEntry,
} from "../src/index.ts";

/** States and edge cases beyond components.test.ts, from the PR #5 test review. */
const html = (el: ReactElement) => renderToStaticMarkup(h(TooltipProvider, { children: el }));

const base: ItemRow = {
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
  tags: ["soul", "boom bap"],
  peaks: encodePeaks(new Array(800).fill(100)),
  playable: { kind: "loop", id: "x", previewUrl: "https://media.example/p.ogg", loopSamples: 235200, sampleRate: 44100 },
  likesCount: 3,
  downloadsCount: 9,
  publishedAt: "2026-11-20T18:00:00Z",
};

describe("Tabs", () => {
  const out = html(
    h(Tabs, {
      defaultValue: "loops",
      children: [
        h(TabList, {
          key: "l",
          label: "Content type",
          children: [
            h(Tab, { key: "a", value: "loops", count: 38, children: "Loops" }),
            h(Tab, { key: "b", value: "kits", count: 12000, children: "Kits" }),
            h(Tab, { key: "c", value: "presets", disabled: true, children: "Presets" }),
          ],
        }),
        h(TabPanel, { key: "p", value: "loops", children: "38 loops" }),
      ],
    }),
  );
  it("is a labelled tablist with the selected tab marked", () => {
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-label="Content type"');
    expect(out).toMatch(/role="tab" aria-selected="true"[^>]*>Loops/);
    expect(out).toMatch(/role="tab" aria-selected="false"[^>]*>Kits/);
  });
  it("shows counts in the tab's name, compact above ten thousand", () => {
    expect(out).toMatch(/>Loops<span[^>]*>38<\/span>/);
    expect(out).toContain(">12K</span>");
  });
  it("disables a tab with the attribute", () => {
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Presets/);
  });
  it("draws its focus ring inside the tab, so the scrolling list cannot clip it", () => {
    expect(out).toMatch(/role="tab"[^>]*class="[^"]*-outline-offset-2/);
  });
  it("renders the selected panel", () => {
    expect(out).toMatch(/role="tabpanel"[^>]*>38 loops/);
  });
});

describe("Menu preview", () => {
  const entries: MenuEntry[] = [
    { label: "Add to queue", shortcut: "Q" },
    { label: "Download stems", disabled: true },
    { separator: true },
    { label: "Report", destructive: true },
  ];
  const out = html(h(MenuPreview, { entries, highlighted: "Add to queue" }));
  it("marks the highlighted and disabled items as Radix does", () => {
    expect(out).toMatch(/data-highlighted=""[^>]*>.*Add to queue/);
    expect(out).toMatch(/data-disabled=""[^>]*>.*Download stems/);
  });
  it("shows shortcuts as keys and the destructive item in the danger hue with its words", () => {
    expect(out).toContain("<kbd");
    expect(out).toMatch(/text-type-kit[^>]*>.*Report/);
  });
});

describe("Tooltip", () => {
  it("renders only its trigger while closed", () => {
    const out = html(h(Tooltip, { content: "Like", shortcut: "L", children: h(IconButton, { icon: Heart, label: "Like" }) }));
    expect(out).toContain('aria-label="Like"');
    expect(out).not.toContain("<kbd");
  });
  it("the surface shows the shortcut as a key", () => {
    expect(html(h(TooltipSurface, { shortcut: "L", children: "Like" }))).toMatch(/Like<\/span><kbd[^>]*>L<\/kbd>/);
  });
});

describe("Toast tone", () => {
  it("pairs each tone with its own icon and hue, so color is never the only signal", () => {
    const info = html(h(ToastPreview, { tone: "info", title: "Added to queue" }));
    const ok = html(h(ToastPreview, { tone: "success", title: "Published" }));
    const err = html(h(ToastPreview, { tone: "error", title: "Upload failed" }));
    expect(info).toMatch(/text-text-muted"><svg[^>]*lucide-info/);
    expect(ok).toMatch(/text-type-preset"><svg[^>]*lucide-circle-check/);
    expect(err).toMatch(/text-type-kit"><svg[^>]*lucide-circle-exclamation-point/);
  });
  it("shows the undo action", () => {
    expect(html(h(ToastPreview, { title: "Removed from likes", action: "Undo" }))).toMatch(/<button[^>]*>.*Undo/);
  });
});

describe("Skeletons", () => {
  it("announce loading once and hide their blocks", () => {
    expect(html(h(SkeletonText, { lines: 2 }))).toMatch(/^<div role="status" aria-label="Loading"/);
    expect(html(h(SkeletonCard))).toMatch(/^<div role="status" aria-label="Loading"/);
    const list = html(h(ResultListSkeleton, { rows: 3 }));
    expect(list).toMatch(/^<div role="status" aria-label="Loading sounds"/);
    expect(list.match(/<li aria-hidden="true"/g)).toHaveLength(3);
  });
  it("a skeleton row is hidden from screen readers", () => {
    expect(html(h(ResultRowSkeleton))).toMatch(/^<li aria-hidden="true"/);
  });
  it("never pulse: only the loading ring may loop", () => {
    expect(html(h(ResultListSkeleton))).not.toMatch(/animate-/);
  });
});

describe("Edge cases", () => {
  it("malformed peaks render the loading bars instead of throwing", () => {
    expect(() => html(h(Waveform, { peaks: "not base64 at all!!", type: "loop", label: "Loop" }))).not.toThrow();
  });
  it("a hero slider clamps progress outside 0 to 1", () => {
    const over = html(h(Waveform, { peaks: base.peaks, type: "loop", variant: "hero", progress: 1.7, durationMs: 6000, onScrub: () => undefined, label: "Loop" }));
    const under = html(h(Waveform, { peaks: base.peaks, type: "loop", variant: "hero", progress: -0.4, durationMs: 6000, onScrub: () => undefined, label: "Loop" }));
    expect(over).toContain('aria-valuenow="100"');
    expect(under).toContain('aria-valuenow="0"');
  });
  it("a hero without a duration has no time text", () => {
    const out = html(h(Waveform, { peaks: base.peaks, type: "loop", variant: "hero", progress: 0.5, durationMs: null, onScrub: () => undefined, label: "Loop" }));
    expect(out).not.toContain("aria-valuetext");
    expect(out).not.toMatch(/\d:\d\d/);
  });
  it("upload progress outside 0 to 1 is clamped", () => {
    expect(html(h(ProgressSteps, { step: "uploading", progress: 3 }))).toContain('aria-valuenow="100"');
    expect(html(h(ProgressSteps, { step: "uploading", progress: -1 }))).toContain('aria-valuenow="0"');
  });
  it("initials of an empty or spaced name are empty, and the avatar still renders", () => {
    expect(initials("")).toBe("");
    expect(initials("   ")).toBe("");
    expect(() => html(h(Avatar, { name: "" }))).not.toThrow();
  });
  it("formatCount switches to compact at ten thousand", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(9999)).toBe("9,999");
    expect(formatCount(10_000)).toBe("10K");
    expect(formatCount(1_250_000)).toBe("1.3M");
  });
  it("a stat with no value shows the loading block", () => {
    expect(html(h(Stat, { label: "Followers" }))).toContain('aria-busy="true"');
  });
  it("a row with no peaks, BPM or key draws loading bars and dashes", () => {
    const out = html(h(ResultRow, { row: { ...base, peaks: null, bpm: null, key: null, tags: [] } }));
    expect(out).toContain('role="img" aria-label="Loop, 2 bars"');
    expect(out).toContain('<span class="sr-only">Key </span>—');
    expect(out).toMatch(/—<span class="sr-only"> BPM<\/span>/);
  });
  it("a row with one tag shows one chip; with none, none", () => {
    expect(html(h(ResultRow, { row: { ...base, tags: ["soul"] } })).match(/rounded-control bg-bg px-2 text-small/g)).toHaveLength(1);
    expect(html(h(ResultRow, { row: { ...base, tags: [] } }))).not.toMatch(/rounded-control bg-bg px-2 text-small/);
  });
  it("the bars cell drops the unit; screen readers still hear it", () => {
    const out = html(h(ResultRow, { row: base }));
    expect(out).toContain('<span aria-hidden="true">2</span><span class="sr-only">2 bars</span>');
  });
  it("describes each content type by name", () => {
    expect(describeRow({ ...base, type: "oneshot", length: { unit: "seconds", value: 1.25 }, bpm: null })).toBe("One-shot, 1.3 seconds, Dm");
    expect(describeRow({ ...base, type: "kit", length: { unit: "samples", value: 24 }, bpm: null, key: null })).toBe("Kit, 24 samples");
  });
  it("a loading button cannot be clicked into a second submit", () => {
    expect(html(h(Button, { loading: true, type: "submit", children: "Save" }))).toContain('aria-disabled="true"');
  });
});

describe("Upload step from item status", () => {
  it("follows the item and its job", () => {
    expect(uploadStepFor("draft", null)).toEqual({ step: "uploading", status: "active" });
    expect(uploadStepFor("draft", { status: "queued", attempts: 0, error: null })).toEqual({ step: "analyzing", status: "active" });
    expect(uploadStepFor("draft", { status: "failed", attempts: 3, error: "Too long" })).toEqual({ step: "analyzing", status: "failed" });
    expect(uploadStepFor("processing", { status: "running", attempts: 1, error: null })).toEqual({ step: "analyzing", status: "active" });
    expect(uploadStepFor("ready", null)).toEqual({ step: "ready", status: "done" });
    expect(uploadStepFor("published", null)).toEqual({ step: "ready", status: "done" });
    expect(uploadStepFor("flagged", null)).toEqual({ step: "flagged", status: "done" });
    expect(uploadStepFor("removed", null)).toBeNull();
  });
  it("flagged reads as a review, not a failure", () => {
    const out = html(h(ProgressSteps, { step: "flagged", detail: "This matches something already on Stash." }));
    expect(out).not.toContain("text-type-kit");
    expect(out).toContain("needs review");
  });
});
