import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@supabase/supabase-js";
import { signInWithEmail, signInWithProvider, signOut } from "./sign-in.ts";
import { handleAuthCallback } from "./callback.ts";
import { safeNextPath } from "../index.ts";
import type { ActionDeps } from "../action.ts";
import { IDS, TEST_ENV, fakeSupabase, member, type FakeOptions } from "../testing/fake-supabase.ts";

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
});

function deps(opts: FakeOptions = {}) {
  const fake = fakeSupabase(opts);
  const d: ActionDeps = { supabase: async () => fake.client };
  return { fake, d };
}

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/upload")).toBe("/upload");
    expect(safeNextPath("/loop/dark-keys-k3j9x0a2bq?t=1#x")).toBe("/loop/dark-keys-k3j9x0a2bq?t=1#x");
  });
  it("turns anything that could leave the site into /", () => {
    for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "\\\\evil", "upload", "/\tx", "javascript:alert(1)", "/%0d%0aSet-Cookie:x", "/%5cevil.example", "/%5Cevil.example", `/${"a".repeat(500)}`, 42, ["/upload"]]) {
      expect(safeNextPath(bad), String(bad)).toBe("/");
    }
  });
  it("never loops back into the callback", () => {
    expect(safeNextPath("/api/auth/callback?code=x")).toBe("/");
  });
});

describe("signInWithEmail", () => {
  it("sends a magic link that returns through the callback with next", async () => {
    const { fake, d } = deps();
    expect(await signInWithEmail.run({ email: "producer@example.test", next: "/upload" }, d)).toEqual({ ok: true, data: { sent: true } });
    expect(fake.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "producer@example.test",
      options: { emailRedirectTo: "http://localhost:3000/api/auth/callback?next=%2Fupload", shouldCreateUser: true },
    });
  });

  it("drops an off-site next", async () => {
    const { fake, d } = deps();
    await signInWithEmail.run({ email: "producer@example.test", next: "https://evil.example" }, d);
    expect(fake.auth.signInWithOtp.mock.calls[0]![0]).toMatchObject({ options: { emailRedirectTo: "http://localhost:3000/api/auth/callback?next=%2F" } });
  });

  it("an invalid email is invalid with a field error, and no mail is sent", async () => {
    const { fake, d } = deps();
    expect(await signInWithEmail.run({ email: "not an email" }, d)).toMatchObject({ ok: false, code: "invalid", fields: { email: expect.any(String) } });
    expect(fake.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("Supabase's email rate limit is rate_limited", async () => {
    const { fake, d } = deps();
    fake.auth.signInWithOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit") });
    expect(await signInWithEmail.run({ email: "producer@example.test" }, d)).toMatchObject({ ok: false, code: "rate_limited" });
  });
});

describe("redirect origin", () => {
  it("comes from NEXT_PUBLIC_SITE_URL only, never from the request", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://stash.example");
    const { fake, d } = deps();
    await signInWithEmail.run({ email: "producer@example.test" }, d);
    await signInWithProvider.run({ provider: "discord" }, d);
    expect(fake.auth.signInWithOtp.mock.calls[0]![0]).toMatchObject({ options: { emailRedirectTo: "https://stash.example/api/auth/callback?next=%2F" } });
    expect(fake.auth.signInWithOAuth.mock.calls[0]![0]).toMatchObject({ options: { redirectTo: "https://stash.example/api/auth/callback?next=%2F" } });
  });

  it("without a valid site URL, no link is sent and the error is not dressed up as a user error", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const { fake, d } = deps();
    await expect(signInWithEmail.run({ email: "producer@example.test" }, d)).rejects.toThrow(/NEXT_PUBLIC_SITE_URL/);
    await expect(signInWithProvider.run({ provider: "google" }, d)).rejects.toThrow(/NEXT_PUBLIC_SITE_URL/);
    expect(fake.auth.signInWithOtp).not.toHaveBeenCalled();
    expect(fake.auth.signInWithOAuth).not.toHaveBeenCalled();
  });
});

describe("signInWithProvider", () => {
  it("returns the Google or Discord authorize URL, returning through the callback", async () => {
    for (const provider of ["google", "discord"] as const) {
      const { fake, d } = deps();
      const r = await signInWithProvider.run({ provider, next: "/library" }, d);
      expect(r).toEqual({ ok: true, data: { url: `https://auth.example.test/authorize?provider=${provider}` } });
      expect(fake.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider,
        options: { redirectTo: "http://localhost:3000/api/auth/callback?next=%2Flibrary", skipBrowserRedirect: true },
      });
    }
  });

  it("refuses any other provider", async () => {
    const { fake, d } = deps();
    expect(await signInWithProvider.run({ provider: "github" }, d)).toMatchObject({ ok: false, code: "invalid", fields: { provider: expect.any(String) } });
    expect(fake.auth.signInWithOAuth).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("signs the caller out", async () => {
    const { fake, d } = deps(member());
    expect(await signOut.run(undefined, d)).toEqual({ ok: true, data: { signedOut: true } });
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("is unauthorized when already signed out", async () => {
    const { fake, d } = deps();
    expect(await signOut.run(undefined, d)).toMatchObject({ ok: false, code: "unauthorized" });
    expect(fake.auth.signOut).not.toHaveBeenCalled();
  });
});

describe("handleAuthCallback", () => {
  const url = (q: string) => new URL(`http://localhost:3000/api/auth/callback?${q}`);

  it("exchanges an OAuth or email-link code, then goes to next for a member", async () => {
    const f = fakeSupabase(member());
    expect(await handleAuthCallback(url("code=abc&next=%2Fupload"), f.client)).toBe("/upload");
    expect(f.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("refuses email token hashes: only the PKCE code, bound to this browser's verifier cookie, signs in", async () => {
    const f = fakeSupabase(member());
    for (const type of ["magiclink", "signup", "email", "recovery"]) {
      expect(await handleAuthCallback(url(`token_hash=th&type=${type}`), f.client), type).toBe("/login?error=signin_failed");
    }
    expect(f.auth.verifyOtp).not.toHaveBeenCalled();
    expect(f.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("parses the query: an oversized code fails, an oversized or odd next falls back to /", async () => {
    const f = fakeSupabase(member());
    expect(await handleAuthCallback(url(`code=${"c".repeat(1025)}`), f.client)).toBe("/login?error=signin_failed");
    expect(f.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(await handleAuthCallback(url(`code=abc&next=/${"a".repeat(600)}`), f.client)).toBe("/");
    expect(await handleAuthCallback(url("code=abc&next=%2F%5cevil.example"), f.client)).toBe("/");
    expect(await handleAuthCallback(url("code=&next=%2Fupload"), f.client)).toBe("/login?error=signin_failed&next=%2Fupload");
  });

  it("sends a new user (no handle yet) to /login to claim one, keeping next", async () => {
    const f = fakeSupabase({ user: { id: IDS.bob, email: "b@x.test" } });
    expect(await handleAuthCallback(url("code=abc&next=%2Fupload"), f.client)).toBe("/login?next=%2Fupload");
  });

  it("an off-site next becomes /", async () => {
    const f = fakeSupabase(member());
    expect(await handleAuthCallback(url("code=abc&next=https%3A%2F%2Fevil.example"), f.client)).toBe("/");
  });

  it("a failed exchange, a provider error or a missing code goes back to /login with an error", async () => {
    const f = fakeSupabase(member());
    f.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: { user: null, session: null }, error: new AuthApiError("invalid flow state", 400, "flow_state_not_found") });
    expect(await handleAuthCallback(url("code=bad&next=%2Fupload"), f.client)).toBe("/login?error=signin_failed&next=%2Fupload");
    expect(await handleAuthCallback(url("error=access_denied&error_description=denied"), f.client)).toBe("/login?error=signin_failed");
    expect(await handleAuthCallback(url(""), f.client)).toBe("/login?error=signin_failed");
  });

});
