# Request 101 Suspended users can edit their profile directly
From lane: platform
For: lead
Blocking ticket: none

## What I need changed
supabase/migrations: the `profiles_update` policy is `using (id = auth.uid()) with check (id = auth.uid())`.
A suspended user can still update display name, bio, avatar and links by calling PostgREST
directly. Proposed (a tightening, not a loosening):

```sql
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_user())
  with check (id = auth.uid() and public.is_active_user());
```

## Why
claim_handle, uploads, likes and follows already refuse suspended accounts. A suspended account
editing its bio and links is the obvious way to keep spamming after a suspension.

## Workaround in the meantime
The updateProfile action refuses suspended accounts (the wrapper's `member` mode), so the app
never does it; only a direct API call can. Platform adds the policy test when the migration lands.
