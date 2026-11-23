/**
 * Design tokens: the only source of color, type, spacing, radius and motion values.
 * Design spec: Type and color, Layout and grid, Motion. theme.css is generated from this file
 * (pnpm --filter @stash/ui gen) and a unit test fails if the two drift.
 */

export const color = {
  bg: "#0B0B0D",
  surface: "#141418",
  raised: "#1D1D23",
  border: "#2A2A33",
  "border-strong": "#6B6B78",
  text: "#F2F2F5",
  "text-muted": "#9A9AA8",
  accent: "#C8FF3E",
  "type-loop": "#5EC8FF",
  "type-oneshot": "#FF8A4C",
  "type-kit": "#FF5C8A",
  "type-midi": "#B18CFF",
  "type-preset": "#4CE0B3",
} as const;
export type ColorToken = keyof typeof color;

/** Danger and success reuse the kit and preset hues, always paired with an icon or word. */
export const semantic = { danger: color["type-kit"], success: color["type-preset"] } as const;

export const typeColor = {
  loop: color["type-loop"],
  oneshot: color["type-oneshot"],
  kit: color["type-kit"],
  midi: color["type-midi"],
  preset: color["type-preset"],
} as const;

/** Chip backgrounds use the type color at this opacity, with the full color as chip text. */
export const CHIP_TINT_OPACITY = 0.16;
/** Mini and hero waveforms draw unplayed bars at this opacity. */
export const WAVEFORM_UNPLAYED_OPACITY = 0.35;

/** The spacing scale. Nothing sits between these values. */
export const space = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;
/** Tailwind step names for the scale above (--spacing is 4px): p-1 = 4px ... p-16 = 64px. */
export const SPACE_STEPS = ["0", "1", "2", "3", "4", "6", "8", "12", "16"] as const;

export const radius = { control: 6, panel: 10 } as const;

export const size = {
  control: 32,
  controlLg: 40,
  rowDesktop: 56,
  rowPhone: 64,
  touchMin: 40,
  rail: 232,
  railCollapsed: 64,
  topBar: 56,
  topBarPhone: 48,
  playerBar: 72,
  playerBarTablet: 64,
  miniPlayer: 56,
  tabBar: 56,
  contentMax: 1280,
} as const;

export const breakpoint = { tablet: 640, desktop: 1024 } as const;

export const font = {
  sans: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
} as const;

/** Seven text styles. [size px, line height px, weight]. */
export const text = {
  display: { size: 40, line: 44, weight: 600, phone: { size: 28, line: 32 } },
  title: { size: 20, line: 28, weight: 600 },
  "body-strong": { size: 14, line: 20, weight: 500 },
  body: { size: 14, line: 20, weight: 400 },
  small: { size: 13, line: 18, weight: 400 },
  numeric: { size: 13, line: 18, weight: 500, mono: true },
  label: { size: 11, line: 16, weight: 500, mono: true, uppercase: true, tracking: "0.06em" },
} as const;
export type TextStyle = keyof typeof text;

export const motion = {
  control: 120,
  playStart: 160,
  padIn: 80,
  padOut: 160,
  like: 200,
  rowSelect: 120,
  overlayMin: 160,
  overlayMax: 200,
  feedIn: 200,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

export const focusRing = { width: 2, offset: 2 } as const;
