"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { INTENT_PARAM, parseIntent, pathWithIntent, pathWithoutIntent } from "./intent";
import { claimIntent, intentStorage, rememberIntent } from "./intent-store";
import { useViewer } from "./viewer-context";

/** The kinds this app's pages gate today; the mechanism itself takes any kind a page registers. */
export type IntentKind = "like" | "follow" | "download";

const TITLE: Record<IntentKind, string> = {
  like: "Sign in to like this",
  follow: "Sign in to follow",
  download: "Sign in to download",
};
const DESCRIPTION: Record<IntentKind, string> = {
  like: "We will save the like when you are back.",
  follow: "We will follow them for you when you are back.",
  download: "The download starts when you are back.",
};

// Loaded on the first ask: the dialog and the sign-in form are not part of any page's first load.
const SignInDialogView = lazy(() => import("./sign-in-dialog-view"));

type Run = (target: string) => void;
type Gate = {
  ask: (kind: IntentKind, target: string) => void;
  /** Registers the action for a kind; returns the unregister. */
  register: (kind: IntentKind, run: { current: Run }) => () => void;
};
const GateContext = createContext<Gate>({ ask: () => {}, register: () => () => {} });

/**
 * Holds the one sign-in dialog the signed-out actions open (build spec: signed-out actions), and
 * replays the remembered action once after sign-in.
 *
 * Asking stores `{kind, target, nonce, expiry}` in this browser and puts the nonce in `next`. When a
 * member loads a page whose `do` matches that record, the provider runs the registered action for
 * that kind exactly once, clears the record and strips `do`. A `do` with no matching record (a
 * posted link, a forged nonce, another kind or target) runs nothing.
 */
export function SignInDialogProvider({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<{ kind: IntentKind; next: string } | null>(null);
  const [open, setOpen] = useState(false);
  const actions = useRef(new Map<string, { current: Run }>());

  const ask = useCallback(
    (kind: IntentKind, target: string) => {
      const pending = rememberIntent(intentStorage(), { kind, target });
      setState({ kind, next: pathWithIntent(pathname, window.location.search, pending) });
      setOpen(true);
    },
    [pathname],
  );
  const register = useCallback((kind: IntentKind, run: { current: Run }) => {
    actions.current.set(kind, run);
    return () => {
      if (actions.current.get(kind) === run) actions.current.delete(kind);
    };
  }, []);

  // Children register in their effects, which run before this one, so the action is known here.
  useEffect(() => {
    if (viewer.status !== "member") return;
    const pending = parseIntent(new URLSearchParams(window.location.search).get(INTENT_PARAM));
    if (!pending) return;
    const run = actions.current.get(pending.kind);
    if (!run) return; // Not this page's action: leave the record for the page that has it.
    const intent = claimIntent(intentStorage(), pending);
    if (!intent) return;
    router.replace(pathWithoutIntent(pathname, window.location.search), { scroll: false });
    run.current(intent.target);
  }, [viewer.status, pathname, router]);

  return (
    <GateContext.Provider value={{ ask, register }}>
      {children}
      {state && (
        <Suspense fallback={null}>
          <SignInDialogView open={open} onOpenChange={setOpen} title={TITLE[state.kind]} description={DESCRIPTION[state.kind]} next={state.next} />
        </Suspense>
      )}
    </GateContext.Provider>
  );
}

/**
 * Wraps a like, follow or download. A member runs it at once; a signed-out visitor gets the
 * sign-in dialog, and the provider runs it once after sign-in. A viewer who still needs a handle is
 * sent to claim one by the shell, so the action waits for the claim too. One action per kind per
 * page: a second registration replaces the first, and either way it runs once.
 */
export function useSignedInAction(kind: IntentKind, run: Run): Run {
  const viewer = useViewer();
  const { ask, register } = useContext(GateContext);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => register(kind, runRef), [register, kind]);

  return useCallback(
    (target: string) => {
      if (viewer.status === "member") return runRef.current(target);
      ask(kind, target);
    },
    [viewer.status, ask, kind],
  );
}
