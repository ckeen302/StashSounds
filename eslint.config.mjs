// Lint for the whole workspace. `pnpm check` runs it with --max-warnings 0.
// Lane boundaries (CLAUDE.md, Layout and ownership) are enforced here as import restrictions.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import stash from "./packages/ui/eslint-plugin.js";

const deepImports = {
  group: [
    "@stash/*/src/*", "@stash/*/src/**",
    "../packages/*", "../../packages/*", "../../../packages/*", "../../../../packages/*", "../../../../../packages/*",
  ],
  message: "Import a package through its public entry point (for example @stash/contracts), never its internals.",
};

const tokenRules = {
  "stash/no-raw-color": "error",
  "stash/no-arbitrary-values": "error",
  "stash/spacing-scale": "error",
  "stash/motion-scale": "error",
  "stash/no-inline-style": "error",
};

const config = [
  {
    ignores: [
      "**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "apps/worker/**",
      "test-results/**", "playwright-report/**", "**/next-env.d.ts", ".claude/**", "fixtures/**",
      "apps/web/public/worklets/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    settings: { next: { rootDir: "apps/web" }, react: { version: "19.3" } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-imports": ["error", { patterns: [deepImports] }],
    },
  },
  // Anything a user sees: tokens only.
  {
    files: ["apps/web/src/app/**/*.{ts,tsx}", "packages/ui/src/components/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/app/api/**"],
    plugins: { stash },
    rules: tokenRules,
  },
  // Interface lane: no data access and no audio internals. It calls what Platform and Audio expose.
  // Route handlers under app/api belong to the Platform lane (CLAUDE.md) and get its rules below.
  {
    files: ["apps/web/src/app/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            deepImports,
            { group: ["@supabase/*", "pg", "@aws-sdk/*"], message: "The Interface lane does not query data. Call a server action or query from apps/web/src/server." },
          ],
        },
      ],
    },
  },
  // Platform lane: no UI.
  {
    files: ["apps/web/src/server/**/*.{ts,tsx}", "apps/web/src/app/api/**/*.{ts,tsx}", "apps/web/src/proxy.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            deepImports,
            { group: ["@stash/ui", "@stash/ui/*", "@stash/audio", "@/app/*", "react-dom", "react-dom/*"], message: "The Platform lane exposes data and functions; it renders nothing." },
          ],
        },
      ],
    },
  },
  // Audio lane: no UI, no data.
  {
    files: ["packages/audio/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            deepImports,
            { group: ["@stash/ui", "@stash/ui/*", "@supabase/*", "next", "next/*"], message: "The Audio lane renders no UI beyond a bare test page and makes no data calls." },
          ],
        },
      ],
    },
  },
  // Contracts depend on nothing in the workspace.
  {
    files: ["packages/contracts/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [deepImports, { group: ["@stash/*", "react", "next", "next/*"], message: "Contracts import only zod." }] }],
    },
  },
];

export default config;
