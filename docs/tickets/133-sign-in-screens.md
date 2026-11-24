# 133 Sign-in screens and handle claim
Lane: interface
Depends on: 131, 101

## Goal
A visitor signs in at /login and a new user picks a handle before anything else.

## Owned paths
packages/ui/, apps/web/src/app/

## Spec and contracts that apply
- build-spec.md: Routes (/login), Behavior every screen shares (signed-out actions)
- design-spec.md: Voice

## Acceptance criteria
- [ ] Email link, Google, Discord buttons calling Platform's actions
- [ ] Handle claim form with inline errors from the action's typed errors
- [ ] Signed-out like, follow and download open the sign-in dialog and complete after sign-in
- [ ] End-to-end test: sign up by email link (local inbox), claim handle, land on home

## Out of scope
- Settings (337)
