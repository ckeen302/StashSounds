import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Linter } from "eslint";
import { color } from "../src/tokens.ts";
import { renderThemeCss } from "../src/theme-css.ts";
import plugin from "../eslint-plugin.js";

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("tokens", () => {
  it("theme.css is generated from tokens.ts (run pnpm --filter @stash/ui gen)", () => {
    expect(readFileSync(join(import.meta.dirname, "../src/theme.css"), "utf8")).toBe(renderThemeCss());
  });

  // Design spec: Colors and measured contrast. These are the only allowed text/background pairs.
  const textPairs: [string, string[]][] = [
    ["text", ["bg", "surface", "raised"]],
    ["text-muted", ["bg", "surface", "raised"]],
    ["accent", ["bg", "surface"]],
    ["type-loop", ["surface", "raised"]],
    ["type-oneshot", ["surface", "raised"]],
    ["type-kit", ["surface", "raised"]],
    ["type-midi", ["surface", "raised"]],
    ["type-preset", ["surface", "raised"]],
  ];
  for (const [fg, bgs] of textPairs)
    for (const bg of bgs)
      it(`${fg} on ${bg} clears 4.5 to 1`, () => {
        expect(contrast(color[fg as keyof typeof color], color[bg as keyof typeof color])).toBeGreaterThanOrEqual(4.5);
      });

  it("text on the accent uses bg and clears 4.5 to 1", () => {
    expect(contrast(color.bg, color.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it("border-strong clears 3 to 1 for control edges", () => {
    for (const bg of ["bg", "surface", "raised"] as const) expect(contrast(color["border-strong"], color[bg])).toBeGreaterThanOrEqual(3);
  });
});

describe("lint rules", () => {
  const linter = new Linter({ configType: "flat" });
  const lint = (code: string) =>
    linter
      .verify(code, [
        {
          files: ["**/*.tsx"],
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { stash: plugin },
          rules: {
            "stash/no-raw-color": "error",
            "stash/no-arbitrary-values": "error",
            "stash/spacing-scale": "error",
            "stash/motion-scale": "error",
            "stash/no-inline-style": "error",
          },
        },
      ], "x.tsx")
      .map((m) => m.ruleId);

  it.each([
    [`const a = <div className="bg-[#fff]" />;`, "stash/no-arbitrary-values"],
    [`const a = <div className="p-[13px]" />;`, "stash/no-arbitrary-values"],
    [`const a = <div style={{ color: "#C8FF3E" }} />;`, "stash/no-raw-color"],
    [`const a = "rgb(0, 0, 0)";`, "stash/no-raw-color"],
    [`const a = <div className="p-5 gap-2" />;`, "stash/spacing-scale"],
    [`const a = <div className="-mt-7" />;`, "stash/spacing-scale"],
    [`const a = <div className="[mask-type:luminance]" />;`, "stash/no-arbitrary-values"],
    [`const a = <div className="p-(--gap)" />;`, "stash/no-arbitrary-values"],
    [`const a = <div className="!p-5" />;`, "stash/spacing-scale"],
    [`const a = <div className="p-5!" />;`, "stash/spacing-scale"],
    [`const a = <div className="gap-px" />;`, "stash/spacing-scale"],
    [`const a = <div className="translate-x-5" />;`, "stash/spacing-scale"],
    [`const a = <div className="-translate-y-7" />;`, "stash/spacing-scale"],
    [`const a = <div className="md:hover:mt-5" />;`, "stash/spacing-scale"],
    [`const a = <div className="duration-300" />;`, "stash/motion-scale"],
    [`const a = <div className="delay-75" />;`, "stash/motion-scale"],
    [`const a = <div style={{ marginTop: 7 }} />;`, "stash/no-inline-style"],
    [`const s = { marginTop: 7 }; const a = <div style={s} />;`, "stash/no-inline-style"],
  ])("rejects %s", (code, rule) => {
    expect(lint(code)).toContain(rule);
  });

  it.each([
    `const a = <div className="p-4 gap-2 mt-6 bg-surface text-accent h-14 w-58 rounded-control" />;`,
    `const a = <div className="hover:bg-raised focus-visible:ring-2 px-3 py-1" />;`,
    `import x from "#lib/thing";`,
    `const a = <div className="duration-120 duration-control delay-0 translate-x-4 !p-4" />;`,
    `const a = <div style={{ "--progress": 0.5 }} />;`,
  ])("accepts %s", (code) => {
    expect(lint(code)).toEqual([]);
  });
});

describe("favicon", () => {
  it("uses only token colors", () => {
    const svg = readFileSync(join(import.meta.dirname, "../../../apps/web/src/app/icon.svg"), "utf8");
    const used = [...svg.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase());
    const tokens = new Set(Object.values(color).map((c) => c.toUpperCase()));
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((c) => !tokens.has(c))).toEqual([]);
  });
});
