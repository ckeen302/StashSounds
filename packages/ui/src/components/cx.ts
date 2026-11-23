/** Joins class names, skipping falsy entries. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Hover and press change background and border color in 120 ms (design spec, Motion). */
export const transition = "transition-colors duration-control";

/**
 * Gallery-only state attributes. Each draws the same styles as the real pointer or keyboard state
 * (see the ui-hover and ui-active variants in components.css), so the gallery can show them frozen.
 */
export type PreviewState = {
  "data-hover"?: boolean;
  "data-focus"?: boolean;
  "data-active"?: boolean;
};
