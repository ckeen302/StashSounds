# Handoff 133 Sign-in screens and handle claim

## Plan (proceeding on the lead's go-ahead: stays within the ticket and the Interface paths)
Branch `lane/interface-133` from `lane/interface-132` (the shell), with `origin/lane/platform-101`
(the sign-in actions) and `origin/phase-0/foundations` merged in. No contract or schema change:
Platform's actions (`signInWithEmail`, `signInWithProvider`, `claimHandle`, `signOut`), `getSession`
and `safeNextPath` cover everything.

1. **/login** (Server Component, dynamic). Reads `next` and `error` and calls `getSession()`.
   - Signed out: the sign-in panel. It has an email field with "Email me a link" and the buttons
     "Continue with Google" and "Continue with Discord". `?error=signin_failed` shows "That sign-in
     link did not work. Ask for a new one." After a send it shows "Check your inbox" with the
     address and a "Use a different email" link.
   - Signed in without a handle: the handle claim form. The handle is lowercased as you type and
     the display name is optional. Errors from `fields.handle` show inline under the field, and any
     other error shows above the button. On success it replaces the URL with `safeNextPath(next)`
     and refreshes, so the shell picks up the session.
   - Signed in with a handle: `redirect(safeNextPath(next))`. Every `next` this screen redirects
     to, client side or server side, goes through `safeNextPath`.
2. **Viewer in the shell.** The root layout calls `getSession()` and passes a small viewer summary
   to a client context: signed out, needs a handle, or a member with handle, name and avatar.
   - The top bar swaps "Sign in" for an avatar menu with "Your profile" and "Sign out".
   - The Profile nav item points at `/u/<handle>` for a member. A placeholder page is added there,
     as for 132's other routes.
   - A viewer who needs a handle is sent to `/login?next=<here>` from any other page ("New users
     choose a handle before anything else").
3. **Signed-out actions: the sign-in dialog and intent replay.**
   - `useSignedInAction(kind, run)` returns a function of a target. For a member it calls
     `run(target)` at once. Signed out, it opens the sign-in dialog with `next` set to the current
     path plus `do=<kind>:<target>`.
   - `next` survives the email link, the provider round trip and the handle claim. When the page
     loads again with `do` and a member viewer, the same hook runs the action once and strips `do`
     from the URL.
   - The kinds are like, follow and download. Targets are checked with a strict pattern, so a
     crafted `do` can only name an action the page registered.
   - The real like, follow and download actions come with their tickets. /dev/player wires them to
     local state (liked and followed marks, and a toast), so the round trip is testable now.
4. **Tests first.**
   - Unit (vitest): intent encode, parse and strip; handle normalising; mapping Result errors to
     field and form messages; the viewer summary from a Session.
   - End-to-end (`e2e/journeys/sign-in.spec.ts`, against the local Supabase stack and Mailpit):
     - sign up by email link, claim a handle, land on home;
     - reserved, taken and malformed handles show inline errors;
     - a bad link shows the failure message;
     - a hostile `next` lands on /;
     - provider buttons go to Supabase's authorize URL for that provider (stubbed, since providers
       are off locally);
     - a signed-out like opens the dialog and completes after sign-up and the claim;
     - follow and download complete after sign-in for an existing member;
     - sign out;
     - the accessibility scan on each state.
   - Visual: /login and the sign-in dialog at the three widths.
5. **Requests.** CI's browser job has no Supabase stack or public env, and since 101 the proxy
   needs both on every request, so `pnpm e2e` and `pnpm visual` cannot pass in CI as they stand.
   The sign-up journey also needs Mailpit. I am filing `docs/requests/133-e2e-supabase.md` for the
   lead.
