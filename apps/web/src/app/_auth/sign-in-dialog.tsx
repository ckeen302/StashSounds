"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PanelDialog } from "@stash/ui";
import { parseIntent, pathWithIntent, pathWithoutIntent, INTENT_PARAM, type IntentKind } from "./intent";
import { SignInPanel } from "./sign-in-panel";
import { useViewer } from "./viewer-context";

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

type Ask = (kind: IntentKind, next: string) => void;
const AskContext = createContext<Ask>(() => {});

/** Holds the one sign-in dialog the signed-out actions open (build spec: signed-out actions). */
export function SignInDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ kind: IntentKind; next: string } | null>(null);
  const [open, setOpen] = useState(false);
  const ask = useCallback<Ask>((kind, next) => {
    setState({ kind, next });
    setOpen(true);
  }, []);
  return (
    <AskContext.Provider value={ask}>
      {children}
      {state && (
        <PanelDialog open={open} onOpenChange={setOpen} title={TITLE[state.kind]} description={DESCRIPTION[state.kind]}>
          {/* A fresh panel per ask, so a sent state never carries over to another action. */}
          <SignInPanel key={state.next} next={state.next} />
        </PanelDialog>
      )}
    </AskContext.Provider>
  );
}

/**
 * Wraps a like, follow or download. A member runs it at once. A signed-out visitor gets the sign-in
 * dialog, with `next` set to this page plus `do=<kind>:<target>`; when a member loads that page the
 * action runs once and `do` leaves the URL. A viewer who still needs a handle is sent to claim one by
 * the shell, so the action waits for the claim too.
 */
export function useSignedInAction(kind: IntentKind, run: (target: string) => void): (target: string) => void {
  const viewer = useViewer();
  const ask = useContext(AskContext);
  const pathname = usePathname();
  const router = useRouter();
  const runRef = useRef(run);
  const done = useRef<string | null>(null);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (viewer.status !== "member") return;
    const raw = new URLSearchParams(window.location.search).get(INTENT_PARAM);
    const intent = parseIntent(raw);
    if (!intent || intent.kind !== kind || done.current === raw) return;
    done.current = raw;
    router.replace(pathWithoutIntent(pathname, window.location.search), { scroll: false });
    runRef.current(intent.target);
  }, [viewer.status, kind, pathname, router]);

  return useCallback(
    (target: string) => {
      if (viewer.status === "member") return runRef.current(target);
      ask(kind, pathWithIntent(pathname, window.location.search, { kind, target }));
    },
    [viewer.status, ask, kind, pathname],
  );
}
