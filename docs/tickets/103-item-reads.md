# 103 Item reads; updateItem, publishItem, unpublishItem, deleteItem
Lane: platform
Depends on: 102

## Goal
The item page, the upload screen and the library can read items in the contract shapes, and owners can edit, publish, unpublish and delete.

## Owned paths
apps/web/src/server/, supabase/tests/

## Spec and contracts that apply
- build-spec.md: API surface, Conventions (list rows carry everything to play)
- data-model.md: items policies, publish_item, unpublish_item, remove_item, set_item_tags
- contracts: itemSchema, itemRowSchema, itemPageSchema, ownItemSchema, updateItemInput, publishItemInput

## Acceptance criteria
- [ ] `getItemPage(type, param)` returns itemPageSchema, using parseItemParam; a wrong slug with the right id redirects to the canonical href
- [ ] `getOwnItem(id)` returns ownItemSchema with job status and checkFields
- [ ] Row builder turns item + files into itemRowSchema, including preview URL (public bucket domain from env), peaks and playable
- [ ] updateItem uses set_item_tags for tags and reference tags
- [ ] publishItem requires rightsConfirmed; flagged items cannot be published
- [ ] Tests for each action: owner, other user, wrong status

## Out of scope
- Search and browse (201)
- Similar items (204)
