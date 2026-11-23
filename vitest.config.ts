import { defineConfig } from "vitest/config";

/** Unit tests across the workspace. Database policy tests have their own config (pnpm db:test). */
export default defineConfig({
  test: {
    projects: [
      { test: { name: "contracts", include: ["packages/contracts/test/**/*.test.ts"], environment: "node" } },
      { test: { name: "audio", include: ["packages/audio/test/**/*.test.ts"], environment: "node" } },
      { test: { name: "ui", include: ["packages/ui/test/**/*.test.ts"], environment: "node" } },
      { test: { name: "web", include: ["apps/web/src/**/*.test.ts"], environment: "node" } },
      { test: { name: "tooling", include: ["scripts/**/*.test.ts"], environment: "node" } },
    ],
  },
});
