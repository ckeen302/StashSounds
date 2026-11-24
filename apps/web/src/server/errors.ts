import { isAuthError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { err, errorCodeSchema, type ErrorResult } from "@stash/contracts";

/**
 * Turns a database or Supabase Auth error into a contracts ErrorResult, or null when it is not one
 * the user should see (a bug or an outage), so the action wrapper rethrows it.
 *
 * public.fail raises SQLSTATE P0001 with the message 'code: plain words', e.g.
 * 'conflict: That handle is taken.'. Other Postgres errors map by SQLSTATE with fixed messages,
 * because their own text names tables and constraints.
 */
export function mapError(e: unknown): ErrorResult | null {
  if (isAuthError(e)) return mapAuthError(e.status, isAuthSessionMissingError(e));
  if (typeof e !== "object" || e === null) return null;
  const { code, message } = e as { code?: unknown; message?: unknown };
  if (typeof code !== "string") return null;

  if (code === "P0001" && typeof message === "string") {
    const m = /^([a-z_]+):\s*([\s\S]*)$/.exec(message);
    const parsed = m ? errorCodeSchema.safeParse(m[1]) : null;
    return parsed?.success ? err(parsed.data, m![2]!.trim()) : null;
  }
  if (code === "23505") return err("conflict", "That already exists.");
  if (code === "23514" || code === "23502" || code.startsWith("22")) return err("invalid", "Some of those values are not allowed.");
  if (code === "42501") return err("forbidden", "You cannot do that.");
  if (code === "PGRST116") return err("not_found", "Not found.");
  return null;
}

function mapAuthError(status: number | undefined, sessionMissing: boolean): ErrorResult | null {
  if (sessionMissing || status === 401 || status === 403) return err("unauthorized", "Sign in again to continue.");
  if (status === 429) return err("rate_limited", "Too many attempts. Wait a minute and try again.");
  if (status === 400 || status === 422) return err("invalid", "That did not work. Check the details and try again.");
  return null;
}
