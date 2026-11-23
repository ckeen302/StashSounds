import { z } from "zod";

/** The only error codes an action or route may return. Build spec: Conventions. */
export const errorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "invalid",
  "rate_limited",
  "quota_exceeded",
  "conflict",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResultSchema = z.object({
  ok: z.literal(false),
  code: errorCodeSchema,
  /** Plain language, safe to show the user. Never contains internals. */
  message: z.string(),
  /** Field-level problems for forms, keyed by input path. */
  fields: z.record(z.string(), z.string()).optional(),
});
export type ErrorResult = z.infer<typeof errorResultSchema>;

export type OkResult<T> = { ok: true; data: T };
export type Result<T> = OkResult<T> | ErrorResult;

export function resultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data }), errorResultSchema]);
}

export const ok = <T>(data: T): OkResult<T> => ({ ok: true, data });
export const err = (code: ErrorCode, message: string, fields?: Record<string, string>): ErrorResult =>
  fields ? { ok: false, code, message, fields } : { ok: false, code, message };
