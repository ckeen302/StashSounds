/**
 * The /dev/gallery sections and the states each must show (design spec, Components: "States beyond
 * default", plus the variants). Shared by the per-section screenshots (e2e/visual) and the DOM check
 * that every state is on the page (e2e/journeys/gallery.spec.ts). Section ids are the h2 ids that
 * label each section: the selector is section[aria-labelledby="<id>"].
 */
export const tokenSections = ["colors", "type", "spacing", "radius", "treatments"] as const;

export const componentSections: { id: string; name: string; states: string[] }[] = [
  { id: "c-button", name: "Button", states: ["primary", "secondary", "ghost", "danger", "hover", "focus", "pressed", "disabled", "loading"] },
  { id: "c-icon-button", name: "Icon button", states: ["ghost", "pad", "hover", "focus", "pressed", "disabled", "on"] },
  { id: "c-play", name: "Play button", states: ["paused", "loading", "playing", "error", "hover", "focus"] },
  { id: "c-input", name: "Text and search input", states: ["search", "text", "focus", "filled", "invalid", "disabled", "hint"] },
  { id: "c-chip", name: "Chip", states: ["type", "tag", "filter", "selected", "removable", "hover"] },
  { id: "c-license", name: "License badge", states: ["royalty-free", "credit required", "split on placement", "hover shows the summary"] },
  { id: "c-avatar", name: "Avatar", states: ["fallback initials", "loading"] },
  { id: "c-uploader", name: "Uploader card", states: ["compact", "full", "following", "own profile", "pending"] },
  { id: "c-stat", name: "Stat", states: ["default", "loading"] },
  { id: "c-tabs", name: "Tabs", states: ["selected", "hover", "focus", "with count", "disabled"] },
  { id: "c-dialog", name: "Dialog", states: ["confirm", "form", "loading", "error", "live"] },
  { id: "c-menu", name: "Menu", states: ["overflow", "context", "open", "focus", "disabled item", "live"] },
  { id: "c-tooltip", name: "Tooltip", states: ["with shortcut", "plain", "live"] },
  { id: "c-toast", name: "Toast", states: ["info", "success", "error", "with undo", "live"] },
  { id: "c-skeleton", name: "Skeleton", states: ["row", "card", "text"] },
  { id: "c-empty", name: "Empty state and error state", states: ["empty", "error, with retry"] },
  { id: "c-steps", name: "Progress steps", states: ["uploading", "analyzing", "ready", "flagged", "active", "done", "failed"] },
  { id: "c-row", name: "Result row, loop", states: ["default", "hover", "selected", "playing", "loading", "error", "skeleton", "live"] },
  { id: "c-wave", name: "Waveform", states: ["mini", "hero", "loading", "playing", "scrubbing", "error", "idle"] },
];

export const sectionSelector = (id: string) => `section[aria-labelledby="${id}"]`;
