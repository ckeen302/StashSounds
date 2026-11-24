/**
 * Ticket 101: what the sign-in and profile server code relies on in the database.
 * The server maps P0001 errors by the code prefix in their message, checks reserved handles
 * before calling claim_handle, and selects named columns; these tests hold the database to that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESERVED_HANDLES, errorCodeSchema } from "@stash/contracts";
import { ACCOUNT_COLUMNS, PROFILE_COLUMNS } from "../../apps/web/src/server/profile.ts";
import { TestDb, anon, rejection, user } from "./db.ts";

let db: TestDb;

beforeAll(async () => {
  db = await TestDb.create();
});

afterAll(async () => {
  await db?.drop();
});

/** A signed-up auth user with no handle yet. */
async function newAuthUser(email: string): Promise<string> {
  const r = await db.q<{ id: string }>(`insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`, [email]);
  return r.rows[0]!.id;
}

/** SQLSTATE and message of a rejected statement. */
async function failure(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    const { code, message } = e as { code: string; message: string };
    return { code, message };
  }
  throw new Error("expected the statement to fail");
}

/** The server's reading of a P0001 message: a contracts code, a colon, words for the user. */
function contractsCode(message: string): string | null {
  const m = /^([a-z_]+):\s*\S/.exec(message);
  return m && errorCodeSchema.safeParse(m[1]).success ? m[1]! : null;
}

describe("signing up", () => {
  it("creates no profile or account until the handle is claimed", async () => {
    const id = await newAuthUser("fresh@x.test");
    const r = await db.q(
      `select (select count(*)::int from public.profiles where id = $1) as profiles,
              (select count(*)::int from public.accounts where id = $1) as accounts`,
      [id],
    );
    expect(r.rows[0]).toEqual({ profiles: 0, accounts: 0 });
    // What getSession reads for this user: nothing yet, and no error.
    expect((await db.as(user(id), `select ${PROFILE_COLUMNS} from public.profiles where id = $1`, [id])).rows).toEqual([]);
    expect((await db.as(user(id), `select ${ACCOUNT_COLUMNS} from public.accounts where id = $1`, [id])).rows).toEqual([]);
  });
});

describe("claim_handle errors", () => {
  it("every refusal is P0001 with a contracts code prefix the server maps", async () => {
    const holder = await newAuthUser("holder@x.test");
    await db.as(user(holder), `select public.claim_handle('held')`);
    const id = await newAuthUser("claimer@x.test");
    const cases: Array<[string, string]> = [
      ["No Caps", "invalid"],
      ["ab", "invalid"],
      ["x".repeat(25), "invalid"],
      ["admin", "conflict"],
      ["held", "conflict"],
    ];
    for (const [handle, code] of cases) {
      const f = await failure(db.as(user(id), `select public.claim_handle($1)`, [handle]));
      expect(f.code, handle).toBe("P0001");
      expect(contractsCode(f.message), handle).toBe(code);
    }
  });

  it("a suspended user cannot change handle (forbidden)", async () => {
    const id = await newAuthUser("susp@x.test");
    await db.as(user(id), `select public.claim_handle('susp_one')`);
    await db.q(`update public.accounts set suspended_at = now() where id = $1`, [id]);
    const f = await failure(db.as(user(id), `select public.claim_handle('susp_two')`));
    expect(f.code).toBe("P0001");
    expect(contractsCode(f.message)).toBe("forbidden");
    expect((await db.q(`select handle from public.profiles where id = $1`, [id])).rows[0]).toEqual({ handle: "susp_one" });
  });

  it("anon gets a privilege error, which the server reads as forbidden", async () => {
    const f = await failure(db.as(anon, `select public.claim_handle('ghost_user')`));
    expect(f.code).toBe("42501");
  });
});

describe("reserved handles", () => {
  it("the database list and RESERVED_HANDLES in contracts are the same", async () => {
    const r = await db.q<{ handle: string }>(`select handle from public.reserved_handles order by handle`);
    expect(r.rows.map((x) => x.handle)).toEqual([...RESERVED_HANDLES].sort());
  });

  it("every reserved handle that passes the format is refused by claim_handle", async () => {
    const id = await newAuthUser("reserved@x.test");
    for (const handle of RESERVED_HANDLES) {
      if (!/^[a-z0-9_]{3,24}$/.test(handle)) continue;
      expect(contractsCode(await rejection(db.as(user(id), `select public.claim_handle($1)`, [handle]))), handle).toBe("conflict");
    }
  });
});

describe("claim_handle results", () => {
  it("returns the new profile row with every column the server selects, and defaults the display name", async () => {
    const id = await newAuthUser("cols@x.test");
    const r = await db.as(user(id), `select ${PROFILE_COLUMNS} from public.claim_handle('cols_user', '  ')`);
    expect(r.rows[0]).toMatchObject({ id, handle: "cols_user", display_name: "cols_user", bio: null, avatar_path: null, links: [] });
    const a = await db.as(user(id), `select ${ACCOUNT_COLUMNS} from public.accounts where id = $1`, [id]);
    expect(a.rows[0]).toMatchObject({ id, role: "user", strikes: 0, suspended_at: null });
  });

  it("changing handle keeps the display name unless a new one is given", async () => {
    const id = await newAuthUser("keep@x.test");
    await db.as(user(id), `select public.claim_handle('keep_one', 'Keep Me')`);
    const r = await db.as(user(id), `select handle, display_name from public.claim_handle('keep_two')`);
    expect(r.rows[0]).toEqual({ handle: "keep_two", display_name: "Keep Me" });
  });

  it("a freed handle can be claimed by someone else", async () => {
    const a = await newAuthUser("free_a@x.test");
    const b = await newAuthUser("free_b@x.test");
    await db.as(user(a), `select public.claim_handle('passing')`);
    await db.as(user(a), `select public.claim_handle('passed_on')`);
    const r = await db.as(user(b), `select handle from public.claim_handle('passing')`);
    expect(r.rows[0]).toEqual({ handle: "passing" });
  });
});

describe("updateProfile's write", () => {
  it("updating own granted columns returns the row with the selected columns", async () => {
    const id = await newAuthUser("upd@x.test");
    await db.as(user(id), `select public.claim_handle('upd_user')`);
    const r = await db.as(
      user(id),
      `update public.profiles set display_name = $2, bio = $3, links = $4 where id = $1 returning ${PROFILE_COLUMNS}`,
      [id, "Up Dated", "bio", JSON.stringify([{ kind: "website", url: "https://upd.example" }])],
    );
    expect(r.rows[0]).toMatchObject({ handle: "upd_user", display_name: "Up Dated", bio: "bio", links: [{ kind: "website", url: "https://upd.example" }] });
  });

  it("a suspended user's direct writes to every editable column change nothing, until restored", async () => {
    const id = await newAuthUser("susp_edit@x.test");
    await db.as(user(id), `select public.claim_handle('susp_edit', 'Before')`);
    await db.q(`update public.accounts set suspended_at = now() where id = $1`, [id]);
    const r = await db.as(
      user(id),
      `update public.profiles set display_name = 'After', bio = 'spam', links = $2, avatar_path = $3 where id = $1 returning id`,
      [id, JSON.stringify([{ kind: "website", url: "https://spam.example" }]), `${id}/avatar.webp`],
    );
    expect(r.rowCount).toBe(0);
    expect((await db.q(`select display_name, bio, links, avatar_path from public.profiles where id = $1`, [id])).rows[0]).toEqual({
      display_name: "Before",
      bio: null,
      links: [],
      avatar_path: null,
    });
    await db.q(`update public.accounts set suspended_at = null where id = $1`, [id]);
    expect((await db.as(user(id), `update public.profiles set bio = 'back' where id = $1 returning id`, [id])).rowCount).toBe(1);
  });

  it("another user's row is never updated: zero rows, which the server reports as not_found", async () => {
    const owner = await newAuthUser("own@x.test");
    const other = await newAuthUser("oth@x.test");
    await db.as(user(owner), `select public.claim_handle('own_user')`);
    await db.as(user(other), `select public.claim_handle('oth_user')`);
    const r = await db.as(user(other), `update public.profiles set bio = 'pwned' where id = $1 returning id`, [owner]);
    expect(r.rowCount).toBe(0);
    expect((await db.q(`select bio from public.profiles where id = $1`, [owner])).rows[0]).toEqual({ bio: null });
  });
});
