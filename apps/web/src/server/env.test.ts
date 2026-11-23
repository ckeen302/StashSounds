import { afterEach, describe, expect, it, vi } from "vitest";
import { publicEnv } from "./env.ts";
import { TEST_ENV } from "./testing/fake-supabase.ts";

afterEach(() => vi.unstubAllEnvs());

describe("publicEnv", () => {
  it("reads and validates the public Supabase and previews settings", () => {
    for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
    expect(publicEnv()).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "anon-key-for-tests",
      previewsBaseUrl: "http://127.0.0.1:9000/previews",
    });
  });

  it("drops a trailing slash from the previews base URL", () => {
    for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
    vi.stubEnv("NEXT_PUBLIC_PREVIEWS_BASE_URL", "https://cdn.example.test/previews/");
    expect(publicEnv().previewsBaseUrl).toBe("https://cdn.example.test/previews");
  });

  it("fails loudly, naming the variables but never their values", () => {
    for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    let message = "";
    try {
      publicEnv();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(message).not.toMatch(/not a url/);
  });
});
