# Request 102 completeUploadOutput for a preset that waits for its other file
From lane: platform
For: lead
Blocking ticket: none (134 can build against the local schema)

## What I need changed
packages/contracts/src/api.ts: `completeUploadOutput` is `{ itemId, status: "processing", jobId }`,
but `enqueue_processing` returns null and leaves the item in draft until a preset has both its
original and its demo confirmed. Proposed:

```ts
export const completeUploadOutput = z.discriminatedUnion("status", [
  z.object({ itemId: uuidSchema, status: z.literal("processing"), jobId: uuidSchema }),
  z.object({
    itemId: uuidSchema,
    status: z.literal("draft"),
    jobId: z.null(),
    /** The file still to be uploaded and confirmed before processing starts. */
    waitingFor: z.enum(["original", "demo"]),
  }),
]);
```

## Why
Confirming a preset's original before its demo is the normal order, and it is not an error. The
upload screen needs to know to ask for the demo.

## Workaround in the meantime
apps/web/src/server/uploads/schemas.ts defines this union from contracts pieces. Delete it when
this merges.
