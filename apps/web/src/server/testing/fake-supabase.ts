/**
 * A small stand-in for the Supabase client, for unit tests only. It records every query and RPC
 * and answers from in-memory rows, so server code can be tested without a live Supabase stack
 * (the full stack needs Docker; policies are proven separately by pnpm db:test).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import type { AccountRow, ProfileRow } from "../profile.ts";

type Row = Record<string, unknown>;
type Res = { data: unknown; error: unknown };

export type FakeUser = { id: string; email?: string; email_confirmed_at?: string | null };

export type QueryCall = {
  table: string;
  op: "select" | "update";
  columns?: string;
  values?: Row;
  filters: Array<[string, unknown]>;
};

export type FakeOptions = {
  user?: FakeUser | null;
  /** Error returned by auth.getUser instead of a user. */
  userError?: unknown;
  tables?: Record<string, Row[]>;
  /** Answer for supabase.rpc(fn, args). Defaults to an error naming the function. */
  rpc?: (fn: string, args: Record<string, unknown>) => Res | Promise<Res>;
  /** Force an error for an operation on a table, e.g. { "profiles.update": pgError }. */
  failures?: Record<string, unknown>;
  /** Tables whose updates match no row, as row-level security makes them for another user's row. */
  emptyUpdates?: string[];
};

export function fakeSupabase(opts: FakeOptions = {}) {
  const tables: Record<string, Row[]> = structuredClone(opts.tables ?? {});
  const queries: QueryCall[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  function from(table: string) {
    const call: QueryCall = { table, op: "select", filters: [] };
    queries.push(call);
    const run = (mode: "many" | "maybe" | "single"): Res => {
      const failure = opts.failures?.[`${table}.${call.op}`];
      if (failure) return { data: null, error: failure };
      const rows = (tables[table] ??= []);
      const hidden = call.op === "update" && opts.emptyUpdates?.includes(table);
      const matches = hidden ? [] : rows.filter((r) => call.filters.every(([c, v]) => r[c] === v));
      if (call.op === "update") for (const r of matches) Object.assign(r, call.values);
      const out = matches.map((r) => ({ ...r }));
      if (mode === "many") return { data: out, error: null };
      if (out.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
      if (out.length === 0 && mode === "single") return { data: null, error: { code: "PGRST116", message: "no rows" } };
      return { data: out[0] ?? null, error: null };
    };
    const builder = {
      select(columns = "*") {
        call.columns = columns;
        return builder;
      },
      update(values: Row) {
        call.op = "update";
        call.values = values;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return builder;
      },
      maybeSingle: () => Promise.resolve(run("maybe")),
      single: () => Promise.resolve(run("single")),
      then: <T>(resolve: (r: Res) => T, reject?: (e: unknown) => T) => Promise.resolve(run("many")).then(resolve, reject),
    };
    return builder;
  }

  const user = opts.user ?? null;
  const auth = {
    getUser: vi.fn(async () =>
      user
        ? { data: { user: { email_confirmed_at: null, ...user } }, error: null }
        : { data: { user: null }, error: opts.userError ?? sessionMissing() },
    ),
    signInWithOtp: vi.fn(async (_: unknown): Promise<Res> => ({ data: { user: null, session: null }, error: null })),
    signInWithOAuth: vi.fn(
      async (c: { provider: string }): Promise<Res> => ({
        data: { provider: c.provider, url: `https://auth.example.test/authorize?provider=${c.provider}` },
        error: null,
      }),
    ),
    signOut: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
    exchangeCodeForSession: vi.fn(async (_: string): Promise<Res> => ({ data: { user, session: {} }, error: null })),
    verifyOtp: vi.fn(async (_: unknown): Promise<Res> => ({ data: { user, session: {} }, error: null })),
  };

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    rpcCalls.push({ fn, args });
    if (opts.rpc) return opts.rpc(fn, args);
    return { data: null, error: { code: "42883", message: `function ${fn} not faked` } };
  });

  const client = { from, rpc, auth } as unknown as SupabaseClient;
  return { client, auth, rpc, queries, rpcCalls, tables };
}

/** What auth-js returns from getUser when there is no session cookie. */
export function sessionMissing() {
  return Object.assign(new Error("Auth session missing!"), { name: "AuthSessionMissingError", status: 400, __isAuthError: true });
}

/** A PostgREST error as supabase-js returns it. */
export function pgError(code: string, message: string) {
  return { code, message, details: "", hint: "" };
}

export const IDS = {
  alice: "11111111-1111-4111-8111-111111111111",
  bob: "22222222-2222-4222-8222-222222222222",
} as const;

export function profileRow(id: string, handle: string, extra: Row = {}): ProfileRow {
  return {
    id,
    handle,
    display_name: handle,
    bio: null,
    avatar_path: null,
    links: [],
    followers_count: 0,
    following_count: 0,
    created_at: "2026-11-23T22:18:04.123456+00:00",
    ...extra,
  } as ProfileRow;
}

export function accountRow(id: string, extra: Row = {}): AccountRow {
  return { id, role: "user", storage_bytes: 0, strikes: 0, suspended_at: null, ...extra } as AccountRow;
}

/** A signed-in user with a claimed handle. */
export function member(id: string = IDS.alice, handle = "alice", extra: { account?: Row; profile?: Row } = {}) {
  return {
    user: { id, email: `${handle}@example.test`, email_confirmed_at: "2026-11-23T00:00:00Z" },
    tables: { profiles: [profileRow(id, handle, extra.profile)], accounts: [accountRow(id, extra.account)] },
  };
}

export const TEST_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-for-tests",
  NEXT_PUBLIC_PREVIEWS_BASE_URL: "http://127.0.0.1:9000/previews",
};
