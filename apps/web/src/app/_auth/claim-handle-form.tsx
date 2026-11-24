"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AtSign, Button, CircleExclamationPoint, Icon, TextInput } from "@stash/ui";
import { claimHandle } from "@/server/auth/actions";
import { safeNextPath } from "@/server/auth/next-path";
import { formErrors, normalizeHandle } from "./form";

/**
 * The handle claim a new user sees before anything else. The handle lowercases as you type; the
 * action's typed errors (taken, reserved, malformed) show under the field they belong to.
 */
export function ClaimHandleForm({ next }: { next: string }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ fields: Record<string, string>; form: string | undefined }>({ fields: {}, form: undefined });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({ fields: {}, form: undefined });
    try {
      const r = await claimHandle({ handle, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) });
      if (r.ok) {
        // Back where they started, with the session's new profile in the shell.
        router.replace(safeNextPath(next));
        router.refresh();
        return;
      }
      setErrors(formErrors(r, ["handle", "displayName"]));
    } catch {
      setErrors({ fields: {}, form: "That did not go through. Check your connection and try again." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <TextInput
        label="Handle"
        name="handle"
        icon={AtSign}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={handle}
        onChange={(e) => setHandle(normalizeHandle(e.target.value))}
        error={errors.fields.handle}
        hint="3 to 24 characters: a to z, 0 to 9 and underscore.."
      />
      <TextInput
        label="Display name (optional)"
        name="displayName"
        autoComplete="nickname"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        error={errors.fields.displayName}
      />
      {errors.form && (
        <p role="alert" className="flex items-start gap-2 text-small text-type-kit">
          <Icon icon={CircleExclamationPoint} />
          {errors.form}
        </p>
      )}
      <Button type="submit" variant="primary" loading={busy}>
        Claim handle
      </Button>
    </form>
  );
}
