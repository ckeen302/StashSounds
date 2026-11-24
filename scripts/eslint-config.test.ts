/**
 * Loads the real eslint.config.mjs and lints snippets as if they lived in each lane, so the lane
 * boundaries and token rules in CLAUDE.md are proven to apply to the paths they claim to.
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { join } from "node:path";

const eslint = new ESLint({ cwd: join(import.meta.dirname, "..") });

async function rulesFor(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

const cases: Array<{ name: string; path: string; code: string; expect: string | null }> = [
  // Interface lane
  { name: "app may not query the database", path: "apps/web/src/app/x/page.tsx", code: `import { createClient } from "@supabase/supabase-js";\nexport const c = createClient;\n`, expect: "no-restricted-imports" },
  { name: "app may not use pg", path: "apps/web/src/app/x/page.tsx", code: `import pg from "pg";\nexport const c = pg;\n`, expect: "no-restricted-imports" },
  { name: "ui may not use storage", path: "packages/ui/src/components/x.tsx", code: `import { S3Client } from "@aws-sdk/client-s3";\nexport const c = S3Client;\n`, expect: "no-restricted-imports" },
  { name: "app may not reach into package internals", path: "apps/web/src/app/x/page.tsx", code: `import { x } from "@stash/contracts/src/item.ts";\nexport const c = x;\n`, expect: "no-restricted-imports" },
  { name: "app may not use relative paths into packages", path: "apps/web/src/app/x/y/page.tsx", code: `import { x } from "../../../../../packages/contracts/src/index.ts";\nexport const c = x;\n`, expect: "no-restricted-imports" },
  { name: "app may use the contracts entry", path: "apps/web/src/app/x/page.tsx", code: `import { limits } from "@stash/contracts";\nexport const c = limits;\n`, expect: null },
  { name: "ui may use the zod-free contracts entry", path: "packages/ui/src/components/x.tsx", code: `import { formatKey } from "@stash/contracts/format";\nexport const c = formatKey;\n`, expect: null },
  { name: "app may not use raw colors", path: "apps/web/src/app/x/page.tsx", code: `export const C = () => <div className="bg-[#ff0000]" />;\n`, expect: "stash/no-raw-color" },
  { name: "app may not use arbitrary values", path: "apps/web/src/app/x/page.tsx", code: `export const C = () => <div className="p-[13px]" />;\n`, expect: "stash/no-arbitrary-values" },
  // Platform lane, including route handlers under app/api
  { name: "server may not render UI", path: "apps/web/src/server/x.ts", code: `import { Button } from "@stash/ui";\nexport const c = Button;\n`, expect: "no-restricted-imports" },
  { name: "server may not use the audio engine", path: "apps/web/src/server/x.ts", code: `import { getEngine } from "@stash/audio";\nexport const c = getEngine;\n`, expect: "no-restricted-imports" },
  { name: "route handlers follow Platform rules", path: "apps/web/src/app/api/x/route.ts", code: `import { Button } from "@stash/ui";\nexport const c = Button;\n`, expect: "no-restricted-imports" },
  { name: "route handlers may query data", path: "apps/web/src/app/api/x/route.ts", code: `import pg from "pg";\nexport const c = pg;\n`, expect: null },
  // Audio lane
  { name: "audio may not use ui", path: "packages/audio/src/x.ts", code: `import { Button } from "@stash/ui";\nexport const c = Button;\n`, expect: "no-restricted-imports" },
  { name: "audio tsx may not use next", path: "packages/audio/src/x.tsx", code: `import Link from "next/link";\nexport const c = Link;\n`, expect: "no-restricted-imports" },
  { name: "audio may not query data", path: "packages/audio/src/x.ts", code: `import { createClient } from "@supabase/supabase-js";\nexport const c = createClient;\n`, expect: "no-restricted-imports" },
  // Contracts
  { name: "contracts import only zod", path: "packages/contracts/src/x.ts", code: `import { Button } from "@stash/ui";\nexport const c = Button;\n`, expect: "no-restricted-imports" },
  { name: "contracts may not use react", path: "packages/contracts/src/x.ts", code: `import { useState } from "react";\nexport const c = useState;\n`, expect: "no-restricted-imports" },
];

describe("eslint.config.mjs lane rules", () => {
  for (const c of cases) {
    it(c.name, async () => {
      const rules = await rulesFor(c.path, c.code);
      if (c.expect === null) expect(rules).toEqual([]);
      else expect(rules).toContain(c.expect);
    });
  }
});
