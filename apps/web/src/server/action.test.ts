import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { err, errorResultSchema, ok } from "@stash/contracts";
import { defineAction, type ActionDeps } from "./action.ts";
import { IDS, TEST_ENV, fakeSupabase, member, pgError, profileRow } from "./testing/fake-supabase.ts";

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
});

const echo = (auth: "public" | "user" | "member", extra: Partial<Parameters<typeof defineAction>[0]> = {}) =>
  defineAction({
    name: "echo",
    auth,
    input: z.object({ n: z.int().min(1), label: z.string().max(5).optional() }),
    output: z.object({ n: z.int(), by: z.string().nullable() }),
    handler: async (input, ctx) => ok({ n: input.n, by: ctx.session?.user.id ?? null }),
    ...extra,
  });

function deps(opts: Parameters<typeof fakeSupabase>[0] = {}): ActionDeps & { fake: ReturnType<typeof fakeSupabase> } {
  const fake = fakeSupabase(opts);
  return { fake, supabase: async () => fake.client, origin: async () => "http://localhost:3000" };
}

describe("defineAction: session", () => {
  it("public actions run signed out", async () => {
    expect(await echo("public").run({ n: 1 }, deps())).toEqual({ ok: true, data: { n: 1, by: null } });
  });

  it("unauthorized when a signed-in action has no session", async () => {
    for (const mode of ["user", "member"] as const) {
      const handler = vi.fn();
      const r = await echo(mode, { handler }).run({ n: 1 }, deps());
      expect(r).toMatchObject({ ok: false, code: "unauthorized" });
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("user actions run before the handle is claimed; member actions are forbidden then", async () => {
    const d = () => deps({ user: { id: IDS.alice, email: "a@x.test" } });
    expect(await echo("user").run({ n: 2 }, d())).toEqual({ ok: true, data: { n: 2, by: IDS.alice } });
    expect(await echo("member").run({ n: 2 }, d())).toMatchObject({ ok: false, code: "forbidden", message: "Choose a handle first." });
  });

  it("member actions run for a member and are forbidden for a suspended account", async () => {
    expect(await echo("member").run({ n: 3 }, deps(member()))).toEqual({ ok: true, data: { n: 3, by: IDS.alice } });
    const suspended = member(IDS.alice, "alice", { account: { suspended_at: "2026-11-01T00:00:00+00:00" } });
    expect(await echo("member").run({ n: 3 }, deps(suspended))).toMatchObject({ ok: false, code: "forbidden", message: "This account is suspended." });
  });

  it("checks the session before validating input", async () => {
    expect(await echo("member").run({ n: "nope" }, deps())).toMatchObject({ code: "unauthorized" });
  });
});

describe("defineAction: validation", () => {
  it("invalid input returns invalid with a message per field", async () => {
    const r = await echo("public").run({ n: 0, label: "far too long" }, deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid");
    expect(Object.keys(r.fields ?? {}).sort()).toEqual(["label", "n"]);
    expect(errorResultSchema.parse(r)).toEqual(r);
  });

  it("non-object input is invalid, not a crash", async () => {
    for (const raw of [null, "x", 3, [1]]) expect(await echo("public").run(raw, deps())).toMatchObject({ code: "invalid" });
  });

  it("strips keys the contract does not name", async () => {
    const handler = vi.fn(async (input: unknown) => ok({ n: 1, by: JSON.stringify(input) }));
    const r = await echo("public", { handler }).run({ n: 1, ownerId: IDS.bob }, deps());
    expect(handler.mock.calls[0]![0]).toEqual({ n: 1 });
    expect(r.ok).toBe(true);
  });

  it("an output that breaks its contract is a server bug and throws", async () => {
    const bad = echo("public", { handler: async () => ok({ n: "one", by: null }) });
    await expect(bad.run({ n: 1 }, deps())).rejects.toThrow(/output/);
  });
});

describe("defineAction: rate limit hook", () => {
  it("runs after validation and before the handler, and can refuse", async () => {
    const order: string[] = [];
    const handler = vi.fn(async () => (order.push("handler"), ok({ n: 1, by: null })));
    const rateLimit = vi.fn(async (_ctx: unknown, input: { n: number }) => {
      order.push(`limit:${input.n}`);
      return input.n > 5 ? err("rate_limited", "Slow down.") : undefined;
    });
    const a = echo("public", { handler, rateLimit });
    expect(await a.run({ n: 1 }, deps())).toMatchObject({ ok: true });
    expect(await a.run({ n: 9 }, deps())).toEqual({ ok: false, code: "rate_limited", message: "Slow down." });
    expect(order).toEqual(["limit:1", "handler", "limit:9"]);
    expect(await a.run({ n: 0 }, deps())).toMatchObject({ code: "invalid" });
    expect(rateLimit).toHaveBeenCalledTimes(2);
  });

  it("a database limit raised in the hook maps to rate_limited", async () => {
    const a = echo("public", {
      rateLimit: async () => {
        throw pgError("P0001", "rate_limited: Too many requests. Try again shortly.");
      },
    });
    expect(await a.run({ n: 1 }, deps())).toEqual({ ok: false, code: "rate_limited", message: "Too many requests. Try again shortly." });
  });
});

describe("defineAction: errors are data", () => {
  it("returns each contracts error code the handler raises through Postgres", async () => {
    for (const code of ["unauthorized", "forbidden", "not_found", "invalid", "rate_limited", "quota_exceeded", "conflict"] as const) {
      const a = echo("public", {
        handler: async () => {
          throw pgError("P0001", `${code}: From the database.`);
        },
      });
      expect(await a.run({ n: 1 }, deps())).toEqual({ ok: false, code, message: "From the database." });
    }
  });

  it("passes through an error result the handler returns", async () => {
    const a = echo("public", { handler: async () => err("quota_exceeded", "Full.") });
    expect(await a.run({ n: 1 }, deps())).toEqual({ ok: false, code: "quota_exceeded", message: "Full." });
  });

  it("rethrows errors it cannot map rather than inventing a code", async () => {
    const boom = new Error("socket hang up");
    const a = echo("public", {
      handler: async () => {
        throw boom;
      },
    });
    await expect(a.run({ n: 1 }, deps())).rejects.toBe(boom);
  });

  it("a failing profile read during the session check is rethrown, not treated as signed out", async () => {
    const d = deps({ ...member(), failures: { "profiles.select": pgError("XX000", "db down") } });
    await expect(echo("member").run({ n: 1 }, d)).rejects.toMatchObject({ code: "XX000" });
  });
});

describe("defineAction: context", () => {
  it("hands the handler the client, the session with profile and account, and the origin", async () => {
    const seen = vi.fn();
    const a = defineAction({
      name: "ctx",
      auth: "member",
      input: z.object({}),
      output: z.object({}),
      handler: async (_input, ctx) => {
        seen(ctx.session.profile.handle, ctx.session.account.role, await ctx.origin(), typeof ctx.supabase.from);
        return ok({});
      },
    });
    const d = deps({ ...member(), tables: { ...member().tables, profiles: [profileRow(IDS.alice, "alice")] } });
    expect(await a.run(undefined, d)).toEqual({ ok: true, data: {} });
    expect(seen).toHaveBeenCalledWith("alice", "user", "http://localhost:3000", "function");
  });
});
