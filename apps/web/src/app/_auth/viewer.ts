import type { Session } from "@/server";

/**
 * What the client shell knows about who is looking: only what it draws. Never the email, the
 * account or the role; the server decides everything that matters.
 */
export type Viewer =
  | { status: "signed_out" }
  | { status: "needs_handle" }
  | { status: "member"; handle: string; displayName: string; avatarUrl: string | null };

export function viewerFrom(session: Session | null): Viewer {
  if (!session) return { status: "signed_out" };
  if (!session.profile) return { status: "needs_handle" };
  const { handle, displayName, avatarUrl } = session.profile;
  return { status: "member", handle, displayName, avatarUrl };
}
