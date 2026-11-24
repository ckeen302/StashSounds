import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { err, type ErrorResult, type Result } from "@stash/contracts";
import { mapError } from "./errors.ts";
import { isMember, loadSession, type MemberSession, type Session } from "./session-core.ts";

/**
 * The single action wrapper (build spec: API surface). Every server action and route handler
 * goes through it, in this order:
 *   1. session check: `public` runs for anyone; `user` needs a signed-in user (only claimHandle,
 *      since the handle may not be claimed yet); `member` needs a claimed handle and an account
 *      that is not suspended.
 *   2. input validated against the contracts schema: `invalid`, with a message per field.
 *   3. rate limit hook (ticket 203 fills these in; the database also limits likes, follows,
 *      reports and downloads itself).
 *   4. the handler, whose output is parsed with the contracts schema.
 * Errors are data: database errors raised by public.fail (P0001, 'code: message') and known
 * Postgres and Auth errors come back as { ok: false, code, message }. Anything else is a bug or an
 * outage and is rethrown, never relabelled with a made-up code.
 */

export type AuthMode = "public" | "user" | "member";

type SessionFor<M extends AuthMode> = M extends "member" ? MemberSession : M extends "user" ? Session : Session | null;

export type ActionContext<M extends AuthMode> = {
  supabase: SupabaseClient;
  session: SessionFor<M>;
};

/** What an action needs from the request. Injected so the wrapper is unit tested without Next or Supabase. */
export type ActionDeps = {
  supabase: () => Promise<SupabaseClient>;
};

export type ActionDefinition<I extends z.ZodType, O extends z.ZodType, M extends AuthMode> = {
  name: string;
  auth: M;
  input: I;
  output: O;
  rateLimit?: (ctx: ActionContext<M>, input: z.output<I>) => Promise<ErrorResult | void>;
  handler: (input: z.output<I>, ctx: ActionContext<M>) => Promise<Result<z.input<O>>>;
};

export type Action<I extends z.ZodType, O extends z.ZodType, M extends AuthMode> = ActionDefinition<I, O, M> & {
  run: (raw: unknown, deps: ActionDeps) => Promise<Result<z.output<O>>>;
};

export function defineAction<I extends z.ZodType, O extends z.ZodType, M extends AuthMode>(def: ActionDefinition<I, O, M>): Action<I, O, M> {
  async function run(raw: unknown, deps: ActionDeps): Promise<Result<z.output<O>>> {
    try {
      const supabase = await deps.supabase();

      // 1. Session.
      const session = await loadSession(supabase);
      if (def.auth !== "public" && !session) return err("unauthorized", "Sign in first.");
      if (def.auth === "member") {
        if (!isMember(session)) return err("forbidden", "Choose a handle first.");
        if (session.account.suspendedAt) return err("forbidden", "This account is suspended.");
      }
      const ctx = { supabase, session } as ActionContext<M>;

      // 2. Input. A call with no argument is an empty object.
      const parsed = def.input.safeParse(raw === undefined ? {} : raw);
      if (!parsed.success) return invalid(parsed.error);

      // 3. Rate limit.
      const limited = await def.rateLimit?.(ctx, parsed.data);
      if (limited) return limited;

      // 4. Handler and output.
      const result = await def.handler(parsed.data, ctx);
      if (!result.ok) return result;
      const out = def.output.safeParse(result.data);
      if (!out.success) throw new Error(`${def.name}: output does not match its contract: ${out.error.message}`);
      return { ok: true, data: out.data };
    } catch (e) {
      const mapped = mapError(e);
      if (mapped) return mapped;
      throw e;
    }
  }
  return { ...def, run };
}

function invalid(error: z.ZodError): ErrorResult {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    fields[key] ??= issue.message;
  }
  const first = error.issues[0]?.message ?? "Check the highlighted fields.";
  return err("invalid", Object.keys(fields).length > 1 ? "Check the highlighted fields." : first, fields);
}
