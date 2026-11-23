import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountSchema, limits, profileSchema } from "@stash/contracts";
import { loadSession } from "./session-core.ts";
import { toAccount, toProfile } from "./profile.ts";
import { IDS, TEST_ENV, accountRow, fakeSupabase, member, pgError, profileRow } from "./testing/fake-supabase.ts";

const fake = { current: fakeSupabase() };
vi.mock("./supabase/server.ts", () => ({ createServerSupabase: async () => fake.current.client }));
const redirect = vi.fn((path: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${path}` });
});
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  redirect.mockClear();
});

describe("loadSession", () => {
  it("is null when signed out", async () => {
    expect(await loadSession(fakeSupabase().client)).toBeNull();
  });

  it("returns the user with a null profile and account before the handle is claimed", async () => {
    const s = await loadSession(fakeSupabase({ user: { id: IDS.alice, email: "a@x.test" } }).client);
    expect(s).toEqual({ user: { id: IDS.alice, email: "a@x.test", emailVerified: false }, profile: null, account: null });
  });

  it("returns profile and account in their contracts shapes once claimed", async () => {
    const s = await loadSession(fakeSupabase(member()).client);
    expect(s?.user).toEqual({ id: IDS.alice, email: "alice@example.test", emailVerified: true });
    expect(profileSchema.parse(s?.profile)).toEqual(s?.profile);
    expect(accountSchema.parse(s?.account)).toEqual(s?.account);
    expect(s?.profile?.handle).toBe("alice");
    expect(s?.account?.emailVerified).toBe(true);
  });

  it("reads only the signed-in user's rows", async () => {
    const f = fakeSupabase({
      ...member(),
      tables: {
        profiles: [profileRow(IDS.bob, "bob"), profileRow(IDS.alice, "alice")],
        accounts: [accountRow(IDS.bob, { role: "admin" }), accountRow(IDS.alice)],
      },
    });
    const s = await loadSession(f.client);
    expect(s?.profile?.id).toBe(IDS.alice);
    expect(s?.account?.role).toBe("user");
    for (const q of f.queries) expect(q.filters).toEqual([["id", IDS.alice]]);
  });

  it("treats an invalid or expired token as signed out", async () => {
    const userError = Object.assign(new Error("invalid JWT"), { name: "AuthApiError", status: 403, __isAuthError: true });
    expect(await loadSession(fakeSupabase({ userError }).client)).toBeNull();
  });

  it("rethrows an auth outage instead of signing the user out", async () => {
    const userError = Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0, __isAuthError: true });
    await expect(loadSession(fakeSupabase({ userError }).client)).rejects.toThrow("fetch failed");
  });

  it("rethrows a failed row read", async () => {
    const f = fakeSupabase({ ...member(), failures: { "accounts.select": pgError("XX000", "down") } });
    await expect(loadSession(f.client)).rejects.toMatchObject({ code: "XX000" });
  });
});

describe("getSession and requireUser", () => {
  it("getSession reads through the cookie-bound server client", async () => {
    const { getSession } = await import("./session.ts");
    fake.current = fakeSupabase(member());
    expect((await getSession())?.profile?.handle).toBe("alice");
    fake.current = fakeSupabase();
    expect(await getSession()).toBeNull();
  });

  it("requireUser returns the session, profile possibly null", async () => {
    const { requireUser } = await import("./session.ts");
    fake.current = fakeSupabase({ user: { id: IDS.bob } });
    expect(await requireUser()).toMatchObject({ user: { id: IDS.bob }, profile: null, account: null });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("requireUser sends a signed-out visitor to /login", async () => {
    const { requireUser } = await import("./session.ts");
    fake.current = fakeSupabase();
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
    await expect(requireUser({ next: "/upload" })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenLastCalledWith("/login?next=%2Fupload");
  });
});

describe("row mapping", () => {
  it("builds the avatar URL from the previews bucket", () => {
    const p = toProfile(profileRow(IDS.alice, "alice", { avatar_path: `${IDS.alice}/avatar.webp` }));
    expect(p.avatarUrl).toBe(`http://127.0.0.1:9000/previews/${IDS.alice}/avatar.webp`);
    expect(toProfile(profileRow(IDS.alice, "alice")).avatarUrl).toBeNull();
  });

  it("maps every profile column", () => {
    const p = toProfile(
      profileRow(IDS.alice, "alice", {
        display_name: "Alice A",
        bio: "drums",
        links: [{ kind: "instagram", url: "https://instagram.com/alice" }],
        followers_count: 4,
        following_count: 2,
      }),
    );
    expect(p).toEqual({
      id: IDS.alice,
      handle: "alice",
      displayName: "Alice A",
      bio: "drums",
      avatarUrl: null,
      links: [{ kind: "instagram", url: "https://instagram.com/alice" }],
      followersCount: 4,
      followingCount: 2,
      createdAt: "2026-11-23T22:18:04.123456+00:00",
    });
  });

  it("takes the storage quota from the role and limits.json", () => {
    expect(toAccount(accountRow(IDS.alice), true).storageQuotaBytes).toBe(limits.quota.storageBytes);
    expect(toAccount(accountRow(IDS.alice, { role: "trusted" }), true).storageQuotaBytes).toBe(limits.quota.storageBytesTrusted);
    expect(toAccount(accountRow(IDS.alice, { role: "admin" }), false)).toEqual({
      id: IDS.alice,
      role: "admin",
      storageBytes: 0,
      storageQuotaBytes: limits.quota.storageBytesTrusted,
      strikes: 0,
      suspendedAt: null,
      emailVerified: false,
    });
  });

  it("refuses a row that breaks the contract", () => {
    expect(() => toProfile(profileRow(IDS.alice, "Not Valid"))).toThrow();
  });
});
