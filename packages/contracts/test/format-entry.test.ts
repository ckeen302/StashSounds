import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as format from "../src/format.ts";
import { LICENSES, decodePeaks, encodePeaks, formatKey, parseKey } from "../src/index.ts";

const src = join(dirname(fileURLToPath(import.meta.url)), "../src");

/** Value imports reachable from a module, following relative imports; `import type` is erased. */
function valueImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = readFileSync(join(src, file), "utf8");
  for (const m of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)) {
    const spec = m[1]!;
    if (spec.startsWith("./")) valueImports(spec.slice(2), seen);
    else seen.add(spec);
  }
  return seen;
}

describe("@stash/contracts/format", () => {
  it("pulls in no zod (it is the entry client components use)", () => {
    const reached = valueImports("format.ts");
    expect([...reached].filter((s) => s === "zod" || s.endsWith("limits.ts") || s.endsWith("common.ts"))).toEqual([]);
  });
  it("gives the same answers as the main entry", () => {
    expect(format.formatKey({ root: 6, mode: "minor" })).toBe(formatKey({ root: 6, mode: "minor" }));
    expect(format.parseKey("Ebmaj")).toEqual(parseKey("Ebmaj"));
    expect(format.decodePeaks(encodePeaks([0, 128, 255]))).toEqual(decodePeaks(encodePeaks([0, 128, 255])));
    expect(format.itemHref({ type: "loop", slug: "a", publicId: "k3j9x0a2bq" })).toBe("/loop/a-k3j9x0a2bq");
    expect(format.LICENSE_LABELS).toEqual(LICENSES);
  });
});
