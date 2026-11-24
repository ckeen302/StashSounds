# Request 101 Sign-in input and output schemas in contracts
From lane: platform
For: lead
Blocking ticket: none (133 can build against the local schemas)

## What I need changed
packages/contracts/src/api.ts has claimHandle and updateProfile shapes but nothing for the sign-in
actions ticket 133 calls. Proposed additions (identical to apps/web/src/server/auth/schemas.ts):

```ts
/** A same-site path to return to after sign-in. The server replaces anything else with "/". */
export const nextPathSchema = z.string().max(500);

export const signInWithEmailInput = z.object({ email: z.email().max(320), next: nextPathSchema.optional() });
export const signInWithEmailOutput = z.object({ sent: z.literal(true) });

export const signInProviderSchema = z.enum(["google", "discord"]);
export const signInWithProviderInput = z.object({ provider: signInProviderSchema, next: nextPathSchema.optional() });
/** The provider's authorize URL; the browser navigates to it. */
export const signInWithProviderOutput = z.object({ url: z.url() });

export const signOutInput = z.object({});
export const signOutOutput = z.object({ signedOut: z.literal(true) });
```

## Why
Rule 3: shapes come from contracts. The Interface lane needs the same schemas for its forms.

## Workaround in the meantime
Defined locally in apps/web/src/server/auth/schemas.ts, marked for deletion. When this merges,
Platform switches the imports and deletes that file.
