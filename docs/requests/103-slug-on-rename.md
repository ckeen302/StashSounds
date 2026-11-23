# Request 103 The slug does not follow a title change
From lane: platform
For: lead
Blocking ticket: none

## What I need decided
updateItem can change the title, but the slug does not follow it:
- create_upload_draft sets items.slug once.
- slug is not a granted column, so updateItem cannot change it.
- As a result, /loop/old-title-<id> stays the canonical URL after a rename.

Proposed: a trigger that sets `slug = slugify(title)` when the title changes. It could run only while the item is not yet published, or always. Old URLs would still redirect either way, because getItemPage finds the item by its public id.

## Provisional choice in 103
The slug stays as it is. Any slug with the right public id redirects to the canonical href.
