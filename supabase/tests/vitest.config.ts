import { defineConfig } from "vitest/config";

/** pnpm db:test. Needs a Postgres 16 server; DATABASE_ADMIN_URL defaults to the local one. */
export default defineConfig({
  test: {
    name: "db",
    include: ["supabase/tests/**/*.test.ts"],
    globalSetup: ["supabase/tests/global-setup.ts"],
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
