/**
 * Writes JSON Schema copies of the contracts the Python worker must honour, so the worker
 * validates its output against the same shapes the web app imports. Run: pnpm --filter @stash/contracts gen
 * A unit test fails if the committed files are stale.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderJsonSchemas } from "../src/json-schema.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "generated");
mkdirSync(out, { recursive: true });
for (const [name, text] of Object.entries(renderJsonSchemas())) {
  writeFileSync(join(out, `${name}.schema.json`), text);
}
console.log(`wrote ${Object.keys(renderJsonSchemas()).length} schemas to ${out}`);
