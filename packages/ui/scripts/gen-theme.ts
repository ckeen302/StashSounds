import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderThemeCss } from "../src/theme-css.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "theme.css");
writeFileSync(out, renderThemeCss());
console.log(`wrote ${out}`);
