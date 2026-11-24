# Handoff 133 Sign-in screens and handle claim

## Plan (proceeding on the lead's go-ahead: stays within the ticket and the Interface paths)
Branch `lane/interface-133` from `lane/interface-132` (the shell, after the PR #12 review round),
with `origin/lane/platform-104` merged in. It carries 101's sign-in, profile and handle-claim
actions, and foundations through 75f06c8. No contract or schema change:
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

## What changed
- **`apps/web/src/app/_auth/`**
  - `form.ts`: `normalizeHandle`, `formErrors` (turns a Result's errors into field and form messages), `signInFailedMessage`.
  - `intent.ts`: `do=<kind>:<target>`, strict pattern.
  - `viewer.ts`: a Session reduced to what the shell draws; never the email or account.
  - `viewer-context.tsx`.
  - `sign-in-panel.tsx`: email link, Google, Discord, and the "Check your inbox" state.
  - `claim-handle-form.tsx`.
  - `sign-in-dialog.tsx`: `SignInDialogProvider` and `useSignedInAction`.
- **`/login`:** dynamic. It shows the sign-in panel, then the handle claim for a signed-in user with no profile, then redirects a member to `safeNextPath(next)`. `?error=` shows the failure line.
- **Root layout:** reads `getSession()` once and passes `viewerFrom(...)` through `Providers`. An auth outage draws the signed-out frame instead of failing every page; screens that need a user still check with `requireUser`.
- **Shell:**
  - A member gets an avatar menu ("Your profile", "Sign out") in place of "Sign in", and the Profile item points at `/u/<handle>` (`navFor`).
  - A `needs_handle` viewer is sent to `/login?next=<here>` from every other page.
  - `/u/[handle]` is a placeholder.
- **`/dev/player`:** like, download and a "Follow @nova" button go through `useSignedInAction`. They mark local state and raise a toast, because the real like, follow and download actions come with their own tickets.
- **packages/ui:**
  - `PanelDialog`: a modal whose body holds its own buttons, and which returns focus to what opened it.
  - `DialogSurface`'s footer is now optional.
  - Icons added: `AtSign`, `LogOut`, `Mail`, `MailCheck`.

## Proof
```
$ pnpm check
apps/web typecheck: Done
packages/contracts typecheck: Done
packages/audio typecheck: Done
packages/ui typecheck: Done
(eslint . --max-warnings 0: clean, exit 0)

$ pnpm test
      Tests  525 passed | 9 skipped (534)        (the 9 skipped are Platform's storage tests without SeaweedFS)

$ STASH_E2E_PORT=3132 pnpm e2e
  ✓ signed out › /login offers an email link, Google and Discord, and passes the accessibility scan
  ✓ signed out › a link that did not work says so and what to do
  ✓ signed out › an empty or malformed email gets the action's message under the field
  ✓ signed out › Continue with Google goes to Supabase's authorize URL and comes back to next
  ✓ signed out › Continue with Discord goes to Supabase's authorize URL and comes back to next
  ✓ signed out › a hostile next is replaced by home before it reaches the link
  ✓ signed out › a signed-out like opens the sign-in dialog, which remembers it
  ✓ signed out › a signed-out download opens the sign-in dialog, which remembers it
  ✓ signed out › a signed-out follow opens the sign-in dialog, which remembers it
  ✓ signed out › Escape closes the dialog and focus goes back to the action
  ✓ signed out › a do parameter does nothing for a visitor
  ✓ signed out › at 380 the sign-in screen fits and its controls are 40 px targets
  - with the local Supabase stack › sign up by email link, claim a handle, land on home
  - with the local Supabase stack › the claim shows reserved, malformed and taken handles under the field
  - with the local Supabase stack › a signed-out like completes after sign-up and the claim
  - with the local Supabase stack › follow and download complete after an existing member signs in
  - with the local Supabase stack › sign out from the account menu
  5 skipped
  63 passed (48.6s)
```

## Not done
- **The five stack-backed journeys did not run here.** That includes the ticket's "sign up by email link, claim handle, land on home". This container has no Docker daemon, and starting one was refused, so there is no Supabase or Mailpit. The tests are written against the local stack's real Mailpit API. With `CI` set they fail rather than skip when the stack is missing. docs/requests/133-e2e-supabase.md asks for the stack on the browser job.
- **`pnpm visual`:** no Docker. The new `login.png` and `sign-in-dialog.png` have no baselines. A `visual-update/133-*` run is pointless until the public Supabase env is on that workflow (same request, item 1): without it the proxy throws on every page. The `shell-tablet-list` shot will also move, because the fixture rows' liked state now comes from `/dev/player`'s local state.

## Surprises and decisions
- **No `useSearchParams`.** The intent replay reads `window.location.search` in an effect. It only matters after a full page load (the auth callback), and this keeps pages free of Suspense boundaries.
- **The replay runs once.** A ref guards against React's double effects, and `router.replace` strips `do` before the action runs, so a reload never repeats it. e2e covers that in the stack block.
- **Profile current state.** For a member, the Profile item is current only on their own `/u/<handle>`, not on someone else's profile.
- **Outage handling.** The layout treats an Auth outage as signed out for the frame only. The alternative was a 500 on every page.
- **Signed-out `do` is ignored.** A visitor who opens a `?do=` link sees nothing happen, and no dialog opens by itself.

## Requests filed
- docs/requests/133-e2e-supabase.md

## Update: script budget and lane/interface-132 merged in
I merged lane/interface-132 at a44f74c: the lazy player details, `@stash/contracts/format` and
foundations 5a05d1e. The sign-in work added about 17 KB to `/`, which left only about 4 KB under
the budget. Two parts now load on first use:
- The sign-in dialog and panel (`_auth/sign-in-dialog-view.tsx`, through `React.lazy`) load when
  a signed-out action asks.
- The member account menu (`_shell/account-menu.tsx`) loads only for members. A 40 px
  placeholder holds its place while it loads.

`/` now loads 185,795 gz bytes of script before audio, against a budget of 204,800.

```
$ pnpm check                       exit 0
$ pnpm test                        Tests  528 passed | 9 skipped (537)
$ STASH_E2E_PORT=3132 pnpm e2e     63 passed, 5 skipped (the stack-backed sign-in block) (40.9s)
$ STASH_E2E_PORT=3132 pnpm perf    2 passed (11.7s)
```
