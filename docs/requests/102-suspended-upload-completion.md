# Request 102 Suspended users can still finish an upload by calling the database directly
From lane: platform
For: lead
Blocking ticket: none

## What I need changed
supabase/migrations: `create_upload_draft` refuses suspended accounts, but these do not:
- `add_demo_file`: a user suspended after creating a preset draft can still attach a demo.
- `enqueue_processing` (service role): it checks ownership and size, but not suspension. The
  server's completeUpload refuses suspended accounts, because the action wrapper requires an
  active member. The database does not, so a future caller that forgets this would queue work for
  a suspended user.

Proposed (tightening only): in both functions, add
`if exists (select 1 from public.accounts where id = <owner> and suspended_at is not null) then perform public.fail('forbidden', 'This account is suspended.'); end if;`
Use `auth.uid()` in `add_demo_file` and `p_user_id` in `enqueue_processing`.

## Why
Suspension should stop new content from reaching the worker, the same as it stops likes, follows
and new drafts.

## Workaround in the meantime
The app never calls either function for a suspended account. Platform adds the policy tests when
the migration lands.
