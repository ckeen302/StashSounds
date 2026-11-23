/**
 * Platform lane. Server actions, queries and route handler logic live here; src/app only imports
 * from this folder. Ticket 101 adds the Supabase clients and the single action wrapper that checks
 * the session, validates input against contracts, applies the rate limit and returns a Result.
 */
export { health } from "./health.ts";
