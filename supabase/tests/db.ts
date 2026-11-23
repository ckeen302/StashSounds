import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
export const TEMPLATE_DB = "stash_test_template";
const here = import.meta.dirname;

export function dbUrl(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Shim, then every migration in order. Seed data is not loaded: each test builds what it needs. */
export function schemaSql(): string[] {
  const dir = join(here, "..", "migrations");
  return [
    readFileSync(join(here, "shim.sql"), "utf8"),
    ...readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(join(dir, f), "utf8")),
  ];
}

export type Who = { role: "anon" } | { role: "authenticated"; id: string } | { role: "service_role" } | { role: "postgres" };
export const anon: Who = { role: "anon" };
export const service: Who = { role: "service_role" };
export const superuser: Who = { role: "postgres" };
export const user = (id: string): Who => ({ role: "authenticated", id });

/** A database cloned from the template for one test file, with helpers to act as any role. */
export class TestDb {
  private constructor(private readonly pool: pg.Pool, readonly name: string) {}

  static async create(): Promise<TestDb> {
    const name = `stash_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${name} template ${TEMPLATE_DB}`);
    await admin.end();
    return new TestDb(new pg.Pool({ connectionString: dbUrl(name), max: 4 }), name);
  }

  async drop(): Promise<void> {
    await this.pool.end();
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${this.name} with (force)`);
    await admin.end();
  }

  /** Runs one statement as `who`, inside its own transaction, the way PostgREST does. */
  async as<T extends pg.QueryResultRow = pg.QueryResultRow>(who: Who, sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      if (who.role !== "postgres") {
        const claims = who.role === "authenticated" ? { sub: who.id, role: "authenticated" } : { role: who.role };
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        await c.query(`set local role ${who.role}`);
      }
      const r = await c.query<T>(sql, params);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }

  /** Superuser shortcut for arranging test data. */
  q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.as<T>(superuser, sql, params);
  }

  // ---- arrangement helpers -------------------------------------------------

  /** A signed-up user with a claimed handle (profile + account rows). */
  async makeUser(handle: string, opts: { role?: "user" | "trusted" | "admin"; verified?: boolean } = {}): Promise<string> {
    const { rows } = await this.q<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id`,
      [`${handle}@example.test`, opts.verified === false ? null : new Date()],
    );
    const id = rows[0]!.id;
    await this.as(user(id), `select public.claim_handle($1)`, [handle]);
    if (opts.role && opts.role !== "user") await this.q(`update public.accounts set role = $2 where id = $1`, [id, opts.role]);
    return id;
  }

  async makeItem(
    ownerId: string,
    opts: { status?: string; type?: string; title?: string; license?: string; split?: number | null } = {},
  ): Promise<string> {
    const { rows } = await this.q<{ id: string }>(
      `insert into public.items (owner_id, type, status, title, slug, license, split_percent, details, published_at)
       values ($1, $2::public.item_type, $3::public.item_status, $4, public.slugify($4), $5::public.license_kind, $6, '{}',
               case when $3 = 'published' then now() end)
       returning id`,
      [ownerId, opts.type ?? "loop", opts.status ?? "published", opts.title ?? "Test loop", opts.license ?? "royalty_free", opts.split ?? null],
    );
    return rows[0]!.id;
  }
}

/** The message of a rejected query, for asserting on policy failures. */
export async function rejection(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the query to be rejected, but it succeeded");
}
