/**
 * WCAG contrast arithmetic, and the machine's colour tokens read from its stylesheets, so a test can
 * hold every text colour to its background (4.5:1 for text, 3:1 for large text and controls).
 */

/** Relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Every `--name: value` declared at the top of the sheets (:root, and the Sampler look's own block), with var() references followed. */
export function rootTokens(...css: string[]): Map<string, string> {
  const raw = new Map<string, string>();
  for (const sheet of css)
    for (const block of sheet.matchAll(/(?:^|\n)\s*(?::root|html\[data-look="sampler"\])\s*\{([^}]*)\}/g))
      for (const d of block[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) raw.set(d[1]!, d[2]!.trim());
  const resolve = (v: string, depth = 0): string => {
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    if (!ref || depth > 8) return v;
    const next = raw.get(ref[1]!);
    return next === undefined ? v : resolve(next, depth + 1);
  };
  return new Map([...raw].map(([k, v]) => [k, resolve(v)]));
}

/** Every font size set in pixels in a stylesheet, with the selector it belongs to. */
export function pixelSizes(css: string): { selector: string; px: number }[] {
  const out: { selector: string; px: number }[] = [];
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    for (const m of rule[2]!.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) out.push({ selector: rule[1]!.trim(), px: Number(m[1]) });
  return out;
}
