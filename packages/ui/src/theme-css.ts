import { breakpoint, color, focusRing, font, motion, radius, text } from "./tokens.ts";

/** Renders theme.css for Tailwind v4. Defaults are reset so only tokens exist as utilities. */
export function renderThemeCss(): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);
  push("/* Generated from src/tokens.ts by `pnpm --filter @stash/ui gen`. Do not edit by hand. */");
  push("@theme {");
  push("  --color-*: initial;");
  for (const [k, v] of Object.entries(color)) push(`  --color-${k}: ${v};`);
  push("  --font-*: initial;");
  push(`  --font-sans: ${font.sans};`);
  push(`  --font-mono: ${font.mono};`);
  push("  --text-*: initial;");
  for (const [k, v] of Object.entries(text)) {
    push(`  --text-${k}: ${v.size}px;`);
    push(`  --text-${k}--line-height: ${v.line}px;`);
    push(`  --text-${k}--font-weight: ${v.weight};`);
    if ("tracking" in v) push(`  --text-${k}--letter-spacing: ${v.tracking};`);
  }
  push("  --spacing: 4px;");
  push("  --radius-*: initial;");
  push(`  --radius-control: ${radius.control}px;`);
  push(`  --radius-panel: ${radius.panel}px;`);
  push("  --radius-full: 9999px;");
  push("  --shadow-*: initial;");
  push("  --inset-shadow-*: initial;");
  push("  --drop-shadow-*: initial;");
  push("  --blur-*: initial;");
  push("  --ease-*: initial;");
  push(`  --ease-out: ${motion.easing};`);
  push("  --animate-*: initial;");
  push("  --breakpoint-*: initial;");
  push(`  --breakpoint-tablet: ${breakpoint.tablet}px;`);
  push(`  --breakpoint-desktop: ${breakpoint.desktop}px;`);
  push("}");
  push("");
  push("@layer base {");
  push("  :root { color-scheme: dark; }");
  push("  html, body { background: var(--color-bg); color: var(--color-text); }");
  push(`  body { font-family: var(--font-sans); font-size: ${text.body.size}px; line-height: ${text.body.line}px; -webkit-font-smoothing: antialiased; }`);
  push(`  :focus-visible { outline: ${focusRing.width}px solid var(--color-accent); outline-offset: ${focusRing.offset}px; }`);
  push("  .tabular { font-variant-numeric: tabular-nums; }");
  push("  @media (prefers-reduced-motion: reduce) {");
  push("    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }");
  push("  }");
  push("}");
  push("");
  push(`@utility text-label-caps { text-transform: uppercase; font-family: var(--font-mono); letter-spacing: ${text.label.tracking}; }`);
  push(`@utility duration-control { transition-duration: ${motion.control}ms; transition-timing-function: var(--ease-out); }`);
  return lines.join("\n") + "\n";
}
