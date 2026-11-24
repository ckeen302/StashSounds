"use client";

import { useState, type FormEvent } from "react";
import { Button, CircleExclamationPoint, Icon, Mail, MailCheck, TextInput } from "@stash/ui";
import { signInWithEmail, signInWithProvider } from "@/server/auth/actions";
import { formErrors } from "./form";

type Provider = "google" | "discord";

/**
 * Email link, Google and Discord (build spec: /login). `next` is passed to Platform's actions as it
 * is; the server sanitizes it again before building the link. Used on /login and in the sign-in
 * dialog that signed-out like, follow and download open.
 */
export function SignInPanel({ next, initialError }: { next: string; initialError?: string }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"email" | Provider | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>(initialError);

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("email");
    setFieldError(undefined);
    setFormError(undefined);
    try {
      const r = await signInWithEmail({ email: email.trim(), next });
      if (r.ok) return setSentTo(email.trim());
      const { fields, form } = formErrors(r, ["email"]);
      setFieldError(fields.email);
      setFormError(form);
    } catch {
      setFormError("We could not send the link. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function withProvider(provider: Provider) {
    if (busy) return;
    setBusy(provider);
    setFormError(undefined);
    try {
      const r = await signInWithProvider({ provider, next });
      if (r.ok) {
        window.location.assign(r.data.url);
        return; // Stay busy while the browser leaves.
      }
      setFormError(r.message);
    } catch {
      setFormError("That did not go through. Check your connection and try again.");
    }
    setBusy(null);
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4" data-sign-in-sent="">
        <div className="flex items-start gap-3">
          <Icon icon={MailCheck} size={20} className="text-text-muted" />
          <div className="flex flex-col gap-1">
            <p className="text-body-strong text-text" role="status">
              Check your inbox
            </p>
            <p className="text-small text-text-muted">
              We sent a sign-in link to <span className="text-text">{sentTo}</span>. Open it on this device to finish.
            </p>
          </div>
        </div>
        <Button variant="ghost" onClick={() => setSentTo(null)} className="self-start">
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={sendLink} className="flex flex-col gap-3" noValidate>
        <TextInput
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldError}
          icon={Mail}
        />
        <Button type="submit" variant="primary" loading={busy === "email"} disabled={busy !== null && busy !== "email"}>
          Email me a link
        </Button>
      </form>
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-label text-label-caps text-text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        <Button onClick={() => void withProvider("google")} loading={busy === "google"} disabled={busy !== null && busy !== "google"}>
          Continue with Google
        </Button>
        <Button onClick={() => void withProvider("discord")} loading={busy === "discord"} disabled={busy !== null && busy !== "discord"}>
          Continue with Discord
        </Button>
      </div>
      {formError && (
        <p role="alert" className="flex items-start gap-2 text-small text-type-kit">
          <Icon icon={CircleExclamationPoint} />
          {formError}
        </p>
      )}
    </div>
  );
}
