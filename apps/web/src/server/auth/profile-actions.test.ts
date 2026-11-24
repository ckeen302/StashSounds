import { beforeEach, describe, expect, it, vi } from "vitest";
import { profileSchema } from "@stash/contracts";
import { claimHandle, updateProfile } from "./profile-actions.ts";
import type { ActionDeps } from "../action.ts";
import { IDS, TEST_ENV, fakeSupabase, member, pgError, profileRow, type FakeOptions } from "../testing/fake-supabase.ts";

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
});

function deps(opts: FakeOptions = {}) {
  const fake = fakeSupabase(opts);
  const d: ActionDeps = { supabase: async () => fake.client };
  return { fake, d };
}

/** Answers claim_handle the way the migration does for a few handles. */
function claimRpc(uid: string) {
  return (fn: string, args: Record<string, unknown>) => {
    if (fn !== "claim_handle") return { data: null, error: pgError("42883", "no such function") };
    if (args.p_handle === "taken") return { data: null, error: pgError("P0001", "conflict: That handle is taken.") };
    if (args.p_handle === "db_says_no") return { data: null, error: pgError("P0001", "invalid: Handles are 3 to 24 characters: a to z, 0 to 9 and underscore.") };
    if (args.p_handle === "racer") return { data: null, error: pgError("23505", 'duplicate key value violates unique constraint "profiles_handle_key"') };
    return { data: profileRow(uid, String(args.p_handle), { display_name: args.p_display_name ?? args.p_handle }), error: null };
  };
}

describe("claimHandle", () => {
  const newUser = { user: { id: IDS.bob, email: "b@x.test" }, rpc: claimRpc(IDS.bob) };

  it("claims a handle for a signed-in user with no profile and returns the profile", async () => {
    const { fake, d } = deps(newUser);
    const r = await claimHandle.run({ handle: "bob_beats", displayName: "Bob Beats" }, d);
    expect(r).toMatchObject({ ok: true, data: { id: IDS.bob, handle: "bob_beats", displayName: "Bob Beats" } });
    if (r.ok) expect(profileSchema.parse(r.data)).toEqual(r.data);
    expect(fake.rpcCalls).toEqual([{ fn: "claim_handle", args: { p_handle: "bob_beats", p_display_name: "Bob Beats" } }]);
  });

  it("passes a null display name when none is given, so the database defaults it", async () => {
    const { fake, d } = deps(newUser);
    await claimHandle.run({ handle: "bob_beats" }, d);
    expect(fake.rpcCalls[0]!.args).toEqual({ p_handle: "bob_beats", p_display_name: null });
  });

  it("unauthenticated: unauthorized, and the database is never called", async () => {
    const { fake, d } = deps({ rpc: claimRpc(IDS.bob) });
    expect(await claimHandle.run({ handle: "bob_beats" }, d)).toMatchObject({ ok: false, code: "unauthorized" });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("invalid handle: invalid with a field error, before the database", async () => {
    for (const handle of ["No Caps", "ab", "a".repeat(25), "dots.not.ok", "", "émile"]) {
      const { fake, d } = deps(newUser);
      const r = await claimHandle.run({ handle }, d);
      expect(r, handle).toMatchObject({ ok: false, code: "invalid", fields: { handle: expect.any(String) } });
      expect(fake.rpcCalls).toEqual([]);
    }
  });

  it("reserved handle: conflict, the same answer the database gives", async () => {
    for (const handle of ["admin", "login", "stash", "root", "undefined"]) {
      const { fake, d } = deps(newUser);
      expect(await claimHandle.run({ handle }, d), handle).toEqual({
        ok: false,
        code: "conflict",
        message: "That handle is taken.",
        fields: { handle: "That handle is taken." },
      });
      expect(fake.rpcCalls).toEqual([]);
    }
  });

  it("taken handle: the database's P0001 conflict comes back as data with a field error", async () => {
    const { d } = deps(newUser);
    expect(await claimHandle.run({ handle: "taken" }, d)).toEqual({
      ok: false,
      code: "conflict",
      message: "That handle is taken.",
      fields: { handle: "That handle is taken." },
    });
  });

  it("the database's P0001 invalid comes back with its message as a field error", async () => {
    const { d } = deps(newUser);
    const message = "Handles are 3 to 24 characters: a to z, 0 to 9 and underscore.";
    expect(await claimHandle.run({ handle: "db_says_no" }, d)).toEqual({ ok: false, code: "invalid", message, fields: { handle: message } });
  });

  it("a handle taken in a race (unique violation) is also a conflict", async () => {
    const { d } = deps(newUser);
    expect(await claimHandle.run({ handle: "racer" }, d)).toMatchObject({ ok: false, code: "conflict", fields: { handle: expect.any(String) } });
  });

  it("a suspended member changing handle gets the database's forbidden", async () => {
    const { d } = deps({
      ...member(IDS.alice, "alice", { account: { suspended_at: "2026-11-01T00:00:00+00:00" } }),
      rpc: () => ({ data: null, error: pgError("P0001", "forbidden: This account is suspended.") }),
    });
    expect(await claimHandle.run({ handle: "alice_two" }, d)).toEqual({ ok: false, code: "forbidden", message: "This account is suspended." });
  });

  it("wrong user: an id in the input is ignored; the database claims for the caller only", async () => {
    const { fake, d } = deps(newUser);
    await claimHandle.run({ handle: "bob_beats", id: IDS.alice, userId: IDS.alice }, d);
    expect(fake.rpcCalls[0]!.args).toEqual({ p_handle: "bob_beats", p_display_name: null });
  });
});

describe("updateProfile", () => {
  it("updates the given fields on the caller's own row and returns the profile", async () => {
    const { fake, d } = deps(member());
    const links = [{ kind: "soundcloud", url: "https://soundcloud.com/alice" }];
    const r = await updateProfile.run({ displayName: "Alice A", bio: "808s", links }, d);
    expect(r).toMatchObject({ ok: true, data: { id: IDS.alice, displayName: "Alice A", bio: "808s", links } });
    const update = fake.queries.find((q) => q.op === "update")!;
    expect(update).toMatchObject({ table: "profiles", values: { display_name: "Alice A", bio: "808s", links }, filters: [["id", IDS.alice]] });
  });

  it("clears the bio with null and leaves unnamed fields alone", async () => {
    const { fake, d } = deps(member(IDS.alice, "alice", { profile: { bio: "old", display_name: "Keep" } }));
    const r = await updateProfile.run({ bio: null }, d);
    expect(r).toMatchObject({ ok: true, data: { bio: null, displayName: "Keep" } });
    expect(fake.queries.find((q) => q.op === "update")!.values).toEqual({ bio: null });
  });

  it("an empty update returns the current profile without writing", async () => {
    const { fake, d } = deps(member());
    expect(await updateProfile.run({}, d)).toMatchObject({ ok: true, data: { handle: "alice" } });
    expect(fake.queries.some((q) => q.op === "update")).toBe(false);
  });

  it("wrong user: ids and handles in the input are dropped; only the caller's row is written", async () => {
    const { fake, d } = deps({
      ...member(),
      tables: { ...member().tables, profiles: [profileRow(IDS.alice, "alice"), profileRow(IDS.bob, "bob")] },
    });
    const r = await updateProfile.run({ id: IDS.bob, handle: "hijack", bio: "mine now" }, d);
    expect(r).toMatchObject({ ok: true, data: { id: IDS.alice, handle: "alice", bio: "mine now" } });
    expect(fake.queries.find((q) => q.op === "update")).toMatchObject({ values: { bio: "mine now" }, filters: [["id", IDS.alice]] });
    expect(fake.tables.profiles!.find((p) => p.id === IDS.bob)).toMatchObject({ handle: "bob", bio: null });
  });

  it("wrong user: an avatar path outside the caller's folder is invalid", async () => {
    const { fake, d } = deps(member());
    for (const avatarPath of [
      `${IDS.bob}/avatar.webp`,
      "avatar.webp",
      `${IDS.alice}/../${IDS.bob}/a.webp`,
      `${IDS.alice}//x.webp`,
      `${IDS.alice}/a\nb.webp`,
      `${IDS.alice}/./a.webp`,
      `${IDS.alice}/a\\b.webp`,
    ]) {
      expect(await updateProfile.run({ avatarPath }, d), avatarPath).toMatchObject({ ok: false, code: "invalid", fields: { avatarPath: expect.any(String) } });
    }
    expect(fake.queries.some((q) => q.op === "update")).toBe(false);
    expect(await updateProfile.run({ avatarPath: `${IDS.alice}/avatar.webp` }, d)).toMatchObject({
      ok: true,
      data: { avatarUrl: `http://127.0.0.1:9000/previews/${IDS.alice}/avatar.webp` },
    });
  });

  it("avatarPath null removes the avatar", async () => {
    const { fake, d } = deps(member(IDS.alice, "alice", { profile: { avatar_path: `${IDS.alice}/avatar.webp` } }));
    const r = await updateProfile.run({ avatarPath: null }, d);
    expect(r).toMatchObject({ ok: true, data: { avatarUrl: null } });
    expect(fake.queries.find((q) => q.op === "update")).toMatchObject({ values: { avatar_path: null }, filters: [["id", IDS.alice]] });
  });

  it("unauthenticated: unauthorized", async () => {
    const { fake, d } = deps();
    expect(await updateProfile.run({ bio: "x" }, d)).toMatchObject({ ok: false, code: "unauthorized" });
    expect(fake.queries).toEqual([]);
  });

  it("before the handle is claimed: forbidden", async () => {
    const { d } = deps({ user: { id: IDS.bob } });
    expect(await updateProfile.run({ bio: "x" }, d)).toMatchObject({ ok: false, code: "forbidden", message: "Choose a handle first." });
  });

  it("a suspended account: forbidden", async () => {
    const { fake, d } = deps(member(IDS.alice, "alice", { account: { suspended_at: "2026-11-01T00:00:00+00:00" } }));
    expect(await updateProfile.run({ bio: "x" }, d)).toMatchObject({ ok: false, code: "forbidden" });
    expect(fake.queries.some((q) => q.op === "update")).toBe(false);
  });

  it("invalid fields come back per field", async () => {
    const { d } = deps(member());
    const r = await updateProfile.run({ displayName: "", bio: "x".repeat(281), links: [{ kind: "website", url: "http://plain.example" }] }, d);
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    if (!r.ok) expect(Object.keys(r.fields ?? {}).sort()).toEqual(["bio", "displayName", "links.0.url"]);
  });

  it("a database check violation is invalid without internals", async () => {
    const { d } = deps({ ...member(), failures: { "profiles.update": pgError("23514", 'violates check constraint "profiles_links_check"') } });
    const r = await updateProfile.run({ bio: "fine" }, d);
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    if (!r.ok) expect(r.message).not.toMatch(/constraint/);
  });

  it("no row updated (row-level security) is not_found", async () => {
    const { d } = deps({ ...member(), emptyUpdates: ["profiles"] });
    expect(await updateProfile.run({ bio: "x" }, d)).toMatchObject({ ok: false, code: "not_found" });
  });
});
