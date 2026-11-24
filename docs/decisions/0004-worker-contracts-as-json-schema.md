# 0004 The worker validates against JSON Schemas generated from the Zod contracts
- Context: The worker is Python; the contracts are Zod. The rule is "import shapes, never retype them".
- Options: Hand-written Pydantic models; generated JSON Schema.
- Choice: `pnpm --filter @stash/contracts gen` writes packages/contracts/generated/*.schema.json with z.toJSONSchema. The worker validates every result with jsonschema before calling worker_complete. A unit test fails if the generated files are stale.
- Reason: One source of truth across both languages.
- Consequence: Contract changes that affect the worker need a regenerate in the same commit.
