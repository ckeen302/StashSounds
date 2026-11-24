/**
 * Platform lane. Server actions, queries and route handler logic live here; src/app only imports
 * from this folder.
 *
 * For Server Components and route handlers: import from "@/server".
 * For Client Components: import server actions from "@/server/auth/actions" (a "use server" file)
 * and the browser client from "@/server/supabase/browser"; this barrel pulls in next/headers.
 */
export { health } from "./health.ts";
export { getSession, requireUser, type MemberSession, type Session } from "./session.ts";
export { claimHandle, signInWithEmail, signInWithProvider, signOut, updateProfile } from "./auth/actions.ts";
export { authCallback } from "./auth/callback-handler.ts";
export { completeUpload, createUploadSlot } from "./uploads/actions.ts";
export { deleteItem, getOwnItem, publishItem, unpublishItem, updateItem } from "./items/actions.ts";
export { itemPage } from "./items/queries.ts";
export { loadRows } from "./items/load-rows.ts";
export { safeNextPath } from "./auth/next-path.ts";
export { updateSession } from "./supabase/proxy.ts";
export { createServerSupabase } from "./supabase/server.ts";
export { defineAction, type ActionContext, type ActionDeps, type AuthMode } from "./action.ts";
