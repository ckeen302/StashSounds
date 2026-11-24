import { describe, expect, it } from "vitest";
import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { errorCodeSchema, errorResultSchema } from "@stash/contracts";
import { mapError } from "./errors.ts";
import { pgError } from "./testing/fake-supabase.ts";

describe("mapError", () => {
  it("maps every contracts code raised by public.fail (P0001, code prefix in the message)", () => {
    for (const code of errorCodeSchema.options) {
      const r = mapError(pgError("P0001", `${code}: Plain words for the user.`));
      expect(r).toEqual({ ok: false, code, message: "Plain words for the user." });
      expect(errorResultSchema.parse(r)).toEqual(r);
    }
  });

  it("keeps a message that itself contains a colon", () => {
    expect(mapError(pgError("P0001", "invalid: Tags: up to eight."))).toMatchObject({ code: "invalid", message: "Tags: up to eight." });
  });

  it("does not map a P0001 whose prefix is not a contracts code", () => {
    expect(mapError(pgError("P0001", "boom: something internal"))).toBeNull();
    expect(mapError(pgError("P0001", "no prefix at all"))).toBeNull();
  });

  it("maps constraint and privilege errors without leaking their internals", () => {
    const unique = mapError(pgError("23505", 'duplicate key value violates unique constraint "profiles_handle_key"'));
    expect(unique).toMatchObject({ code: "conflict" });
    expect(unique?.message).not.toMatch(/profiles_handle_key|duplicate key/);

    const check = mapError(pgError("23514", 'new row for relation "profiles" violates check constraint "profiles_links_check"'));
    expect(check).toMatchObject({ code: "invalid" });
    expect(check?.message).not.toMatch(/profiles/);

    expect(mapError(pgError("22P02", "invalid input syntax for type uuid"))).toMatchObject({ code: "invalid" });
    expect(mapError(pgError("42501", "permission denied for table accounts"))).toMatchObject({ code: "forbidden" });
    expect(mapError(pgError("PGRST116", "JSON object requested, multiple (or no) rows returned"))).toMatchObject({ code: "not_found" });
  });

  it("maps Supabase Auth errors by status", () => {
    expect(mapError(new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit"))).toMatchObject({ code: "rate_limited" });
    expect(mapError(new AuthApiError("Unable to validate email address: invalid format", 400, "validation_failed"))).toMatchObject({ code: "invalid" });
    expect(mapError(new AuthApiError("Email address is invalid", 422, "email_address_invalid"))).toMatchObject({ code: "invalid" });
    expect(mapError(new AuthApiError("Bad request", 400, undefined))).toEqual({
      ok: false,
      code: "invalid",
      message: "That did not work. Check the details and try again.",
    });
    expect(mapError(new AuthSessionMissingError())).toMatchObject({ code: "unauthorized" });
    expect(mapError(new AuthApiError("Token has expired or is invalid", 403, "otp_expired"))).toMatchObject({ code: "unauthorized" });
  });

  it("returns null for anything it does not recognise, so the wrapper rethrows it", () => {
    expect(mapError(new Error("socket hang up"))).toBeNull();
    expect(mapError(pgError("XX000", "internal error"))).toBeNull();
    expect(mapError(new AuthApiError("Database error saving new user", 500, "unexpected_failure"))).toBeNull();
    expect(mapError("a string")).toBeNull();
    expect(mapError(null)).toBeNull();
  });
});
