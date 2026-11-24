import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, safeNextPath } from "@/server";
import { ClaimHandleForm } from "../_auth/claim-handle-form";
import { signInFailedMessage } from "../_auth/form";
import { SignInPanel } from "../_auth/sign-in-panel";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Params = { next?: string | string[]; error?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /login (build spec: Routes): email link, Google, Discord. A signed-in user without a handle claims
 * one here before anything else; a member is sent on to `next`. Every `next` goes through
 * safeNextPath, so a crafted link can only land on this site.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const session = await getSession();
  if (session?.profile) redirect(next);

  const claiming = Boolean(session);
  return (
    <main className="mx-auto flex w-full max-w-110 flex-col gap-6 px-3 py-12 tablet:px-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-title text-text">{claiming ? "Choose your handle" : "Sign in to Stash"}</h1>
        <p className="text-small text-text-muted">
          {claiming
            ? "It is your name on everything you upload, and the address of your profile."
            : "New here? The same link creates your account."}
        </p>
      </header>
      <div className="rounded-panel border border-border bg-surface p-6">
        {claiming ? <ClaimHandleForm next={next} /> : <SignInPanel next={next} initialError={signInFailedMessage(first(params.error))} />}
      </div>
    </main>
  );
}
