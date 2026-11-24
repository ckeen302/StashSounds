import type { Result } from "@stash/contracts";

/**
 * Handles are lowercase a to z, 0 to 9 and underscore (contracts handleSchema). The field lowercases
 * as you type and drops what people paste from other sites (a leading @, spaces). Anything else is
 * kept so the action's error can say what is wrong.
 */
export function normalizeHandle(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "").replace(/^@+/, "");
}

export type FormErrors = { fields: Record<string, string>; form: string | undefined };

/**
 * Splits an action's Result into messages under the fields this form shows and one message above
 * the button. A field the form does not show is not dropped: the form message stands in for it.
 */
export function formErrors(result: Result<unknown>, shown: readonly string[]): FormErrors {
  if (result.ok) return { fields: {}, form: undefined };
  const fields: Record<string, string> = {};
  let unshown = false;
  for (const [k, v] of Object.entries(result.fields ?? {})) {
    if (shown.includes(k)) fields[k] = v;
    else unshown = true;
  }
  const form = Object.keys(fields).length === 0 || unshown ? result.message : undefined;
  return { fields, form };
}

const SIGN_IN_FAILED = "That sign-in did not finish. The link may have expired. Ask for a new one.";

/** The line /login shows when the callback sent the user back with ?error=. */
export function signInFailedMessage(code: string | undefined): string | undefined {
  return code ? SIGN_IN_FAILED : undefined;
}
