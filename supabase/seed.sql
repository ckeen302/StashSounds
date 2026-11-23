-- Local development seed. Three producers with a little published content, so screens are never
-- empty on a fresh `pnpm dev`. Runs after migrations (supabase db reset, or scripts/db-reset.mjs).
-- Preview paths point at files scripts/dev.mjs uploads from fixtures/generated into local storage.

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'nova@example.test',  now()),
  ('22222222-2222-4222-8222-222222222222', 'kilo@example.test',  now()),
  ('33333333-3333-4333-8333-333333333333', 'admin@example.test', now())
on conflict do nothing;

insert into public.profiles (id, handle, display_name, bio, links) values
  ('11111111-1111-4111-8111-111111111111', 'novaloops', 'Nova', 'Dark keys and dusty drums. Atlanta.',
   '[{"kind":"instagram","url":"https://instagram.com/example"}]'),
  ('22222222-2222-4222-8222-222222222222', 'kilo808', 'Kilo', '808s, mostly.', '[]'),
  ('33333333-3333-4333-8333-333333333333', 'stash_admin', 'Stash admin', null, '[]')
on conflict do nothing;

insert into public.accounts (id, role) values
  ('11111111-1111-4111-8111-111111111111', 'trusted'),
  ('22222222-2222-4222-8222-222222222222', 'user'),
  ('33333333-3333-4333-8333-333333333333', 'admin')
on conflict do nothing;

insert into public.items (id, public_id, owner_id, type, status, title, slug, license, genre, bpm, key_root, key_mode,
                          duration_ms, details, published_at, split_percent) values
  ('a0000000-0000-4000-8000-000000000001', 'seedloop01', '11111111-1111-4111-8111-111111111111', 'loop', 'published',
   'Midnight keys', 'midnight-keys', 'royalty_free', 'trap', 140, 9, 'minor', 6857,
   '{"sampleRate":44100,"channels":2,"loudnessLufs":-14,"truePeakDb":-1,"loopSamples":302400,"bars":4,
     "detection":{"bpmSource":"filename","bpmAgreed":true,"bpmCandidates":[140],"keySource":"chroma","keyConfidence":0.4}}',
   now() - interval '2 days', null),
  ('a0000000-0000-4000-8000-000000000002', 'seedloop02', '11111111-1111-4111-8111-111111111111', 'loop', 'published',
   'Dusty soul chop', 'dusty-soul-chop', 'credit_required', 'boom bap', 90, 2, 'minor', 10667,
   '{"sampleRate":44100,"channels":2,"loudnessLufs":-14,"truePeakDb":-1,"loopSamples":470400,"bars":4,
     "detection":{"bpmSource":"duration","bpmAgreed":false,"bpmCandidates":[90,180],"keySource":"chroma","keyConfidence":0.12}}',
   now() - interval '1 day', null),
  ('a0000000-0000-4000-8000-000000000003', 'seed808001', '22222222-2222-4222-8222-222222222222', 'oneshot', 'published',
   'Long 808 in F', 'long-808-in-f', 'royalty_free', 'trap', null, 5, 'minor', 2400,
   '{"sampleRate":44100,"channels":1,"loudnessLufs":null,"truePeakDb":-1,"category":"808","rootNote":29,"rootNoteSource":"filename"}',
   now() - interval '3 hours', null),
  ('a0000000-0000-4000-8000-000000000004', 'seedmidi01', '22222222-2222-4222-8222-222222222222', 'midi', 'published',
   'Sad piano chords', 'sad-piano-chords', 'split_on_placement', 'rnb', 72, 1, 'minor', 13333,
   '{"kind":"chords","bars":4,"noteCount":16,"pitchMin":49,"pitchMax":68,"timeSignature":[4,4],"tempoAssumed":false,
     "detection":{"bpmSource":"midi_file","bpmAgreed":true,"bpmCandidates":[72],"keySource":"midi_notes","keyConfidence":0.5}}',
   now() - interval '5 hours', 10),
  ('a0000000-0000-4000-8000-000000000005', 'seeddraft1', '22222222-2222-4222-8222-222222222222', 'loop', 'draft',
   'Unfinished idea', 'unfinished-idea', 'royalty_free', null, null, null, null, null, null, null, null)
on conflict do nothing;

insert into public.tags (name, kind) values ('keys','instrument'), ('dark','mood'), ('soul','tag'), ('808','instrument'),
  ('piano','instrument'), ('metro boomin','reference'), ('j dilla','reference')
on conflict do nothing;

insert into public.item_tags (item_id, tag_id)
select i, t.id from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'keys'), ('a0000000-0000-4000-8000-000000000001'::uuid, 'dark'),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'metro boomin'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'soul'), ('a0000000-0000-4000-8000-000000000002'::uuid, 'j dilla'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, '808'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'piano')) v(i, name)
join public.tags t on t.name = v.name
on conflict do nothing;

insert into public.follows (follower_id, followee_id) values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')
on conflict do nothing;

insert into public.likes (user_id, item_id) values
  ('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-000000000001')
on conflict do nothing;
