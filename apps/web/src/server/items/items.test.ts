import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKER_REASON_TEXT, itemPageSchema, limits, ownItemSchema } from "@stash/contracts";
import type { ActionDeps } from "../action.ts";
import { IDS, TEST_ENV, fakeSupabase, member, pgError, profileRow, type FakeOptions } from "../testing/fake-supabase.ts";
import { ITEM_IDS, filesFor, itemDbRow, samplesFor } from "../testing/items.ts";
import { getItemPage } from "./get-item-page.ts";
import { getOwnItem } from "./get-own-item.ts";
import { deleteItem, publishItem, unpublishItem, updateItem } from "./item-actions.ts";

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
});

const LOOP = ITEM_IDS.loop;
const OTHER_LOOP = "a0000000-0000-4000-8000-0000000000aa";
const DRAFT_LOOP = "a0000000-0000-4000-8000-0000000000bb";

type Rpc = NonNullable<FakeOptions["rpc"]>;

/** Rows as RLS would return them to anyone: the published items, their previews, public profiles. */
function publicTables(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return {
    items: [
      itemDbRow("loop"),
      itemDbRow("loop", { id: OTHER_LOOP, public_id: "z0z0z0z0z1", title: "Other", slug: "other", published_at: "2026-11-22T10:00:00+00:00" }),
      itemDbRow("loop", { id: DRAFT_LOOP, public_id: "y0y0y0y0y1", status: "draft", published_at: null, details: null }),
      itemDbRow("kit"),
    ],
    item_files: [...filesFor("loop"), ...filesFor("loop", OTHER_LOOP), ...filesFor("kit")],
    kit_samples: samplesFor(ITEM_IDS.kit, 20),
    profiles: [profileRow(IDS.alice, "alice", { display_name: "Alice", followers_count: 12 }), profileRow(IDS.bob, "bob")],
    tags: [
      { name: "keys", kind: "instrument" },
      { name: "dark", kind: "tag" },
    ],
    follows: [],
    likes: [],
    ...extra,
  };
}

/** Deps with no service role and no storage: any use of either throws, so these tests prove reads and writes run as the caller. */
function callerOnly(fake: ReturnType<typeof fakeSupabase>): ActionDeps {
  return { supabase: async () => fake.client };
}

describe("getItemPage", () => {
  it("anon: the published item, its owner, tags with kinds, and more from the owner", async () => {
    const fake = fakeSupabase({ tables: publicTables() });
    const r = await getItemPage(fake.client, null, "loop", "dark-keys-k3j9x0a2bq");
    if (r.kind !== "page") throw new Error(`expected a page, got ${r.kind}`);
    expect(itemPageSchema.parse(r.page)).toEqual(r.page);
    expect(r.page.item).toMatchObject({
      id: LOOP,
      href: "/loop/dark-keys-k3j9x0a2bq",
      description: "Late night keys.",
      genre: "trap",
      splitPercent: null,
      licenseVersion: limits.licenses.royalty_free.version,
      allTags: [
        { name: "dark", kind: "tag" },
        { name: "keys", kind: "instrument" },
      ],
      owner: { handle: "alice", displayName: "Alice", avatarUrl: null },
      playable: { kind: "loop", previewUrl: `${TEST_ENV.NEXT_PUBLIC_PREVIEWS_BASE_URL}/${LOOP}/preview.mp3` },
    });
    expect(r.page.item).not.toHaveProperty("viewer");
    expect(r.page.owner).toEqual({ id: IDS.alice, handle: "alice", displayName: "Alice", avatarUrl: null, followersCount: 12, viewerFollows: false });
    // Other published items by the owner, newest first, never this one and never a draft.
    expect(r.page.moreFromOwner.map((i) => i.id)).toEqual([ITEM_IDS.kit, OTHER_LOOP]);
    expect(r.page.similar).toEqual([]);
    expect(r.page).not.toHaveProperty("samples");
  });

  it("reads only published items and previews-bucket files", async () => {
    const fake = fakeSupabase({ tables: publicTables() });
    await getItemPage(fake.client, null, "loop", "dark-keys-k3j9x0a2bq");
    for (const q of fake.queries.filter((q) => q.table === "items")) expect(q.filters).toContainEqual(["status", "published"]);
    for (const q of fake.queries.filter((q) => q.table === "item_files")) expect(q.filters).toContainEqual(["bucket", "previews"]);
    expect(fake.queries.some((q) => q.table === "kit_samples" && /original_path/.test(q.columns ?? ""))).toBe(false);
  });

  it("a list reads only the first sixteen kit samples (the pads), filtered in the query", async () => {
    const fake = fakeSupabase({ tables: publicTables() });
    await getItemPage(fake.client, null, "loop", "dark-keys-k3j9x0a2bq");
    // moreFromOwner includes the kit: its samples are read for the pads only.
    const padReads = fake.queries.filter((q) => q.table === "kit_samples");
    expect(padReads.length).toBeGreaterThan(0);
    for (const q of padReads) expect(q.ops).toContainEqual(["lt", "position", 16]);
  });

  it("a signed-in viewer sees their like and follow", async () => {
    const fake = fakeSupabase({
      tables: publicTables({ likes: [{ user_id: IDS.bob, item_id: LOOP }], follows: [{ follower_id: IDS.bob, followee_id: IDS.alice }] }),
    });
    const r = await getItemPage(fake.client, IDS.bob, "loop", "dark-keys-k3j9x0a2bq");
    if (r.kind !== "page") throw new Error("expected a page");
    expect(r.page.item.viewer).toEqual({ liked: true });
    expect(r.page.owner.viewerFollows).toBe(true);
    expect(r.page.moreFromOwner.every((i) => i.viewer?.liked === false)).toBe(true);
  });

  it("a wrong slug or type with the right id redirects to the canonical href", async () => {
    const fake = fakeSupabase({ tables: publicTables() });
    expect(await getItemPage(fake.client, null, "loop", "old-title-k3j9x0a2bq")).toEqual({ kind: "redirect", href: "/loop/dark-keys-k3j9x0a2bq" });
    expect(await getItemPage(fake.client, null, "loop", "k3j9x0a2bq")).toEqual({ kind: "redirect", href: "/loop/dark-keys-k3j9x0a2bq" });
    expect(await getItemPage(fake.client, null, "kit", "dark-keys-k3j9x0a2bq")).toEqual({ kind: "redirect", href: "/loop/dark-keys-k3j9x0a2bq" });
  });

  it("not found: a malformed param, an unknown id, or an item that is not published (even for its owner)", async () => {
    const fake = fakeSupabase({ tables: publicTables() });
    expect(await getItemPage(fake.client, null, "loop", "nope")).toEqual({ kind: "not_found" });
    expect(await getItemPage(fake.client, null, "loop", "dark-keys-0000000000")).toEqual({ kind: "not_found" });
    expect(await getItemPage(fake.client, IDS.alice, "loop", "dark-keys-y0y0y0y0y1")).toEqual({ kind: "not_found" });
  });

  it("a kit page lists every sample; its row has sixteen pads", async () => {
    const fake = fakeSupabase({ tables: publicTables() });
    const r = await getItemPage(fake.client, null, "kit", "dark-keys-c0c0c0c0c1");
    if (r.kind !== "page") throw new Error("expected a page");
    expect(r.page.samples).toHaveLength(20);
    expect(r.page.samples![19]).toMatchObject({ position: 19, name: "Kick 20", previewUrl: `${TEST_ENV.NEXT_PUBLIC_PREVIEWS_BASE_URL}/${ITEM_IDS.kit}/s19.mp3` });
    if (r.page.item.playable.kind !== "kit") throw new Error("expected a kit");
    expect(r.page.item.playable.pads).toHaveLength(16);
  });

  it("a published item that cannot be played is a bug, not a page", async () => {
    const fake = fakeSupabase({ tables: publicTables({ item_files: [] }) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getItemPage(fake.client, null, "loop", "dark-keys-k3j9x0a2bq")).rejects.toThrow(/cannot be played/);
    warn.mockRestore();
  });
});

describe("getOwnItem", () => {
  const draft = itemDbRow("loop", { status: "processing", details: null, published_at: null });
  const setup = (tables: Record<string, Array<Record<string, unknown>>>, base = member()) =>
    fakeSupabase({ ...base, tables: { ...base.tables, tags: publicTables().tags, ...tables } });

  it("the owner's processing item with its latest job; the worker's reason in plain language", async () => {
    const fake = setup({
      items: [draft],
      processing_jobs: [
        { item_id: LOOP, status: "failed", attempts: 1, error: "timeout", created_at: "2026-11-23T20:00:00Z" },
        { item_id: LOOP, status: "queued", attempts: 2, error: "corrupt_file", created_at: "2026-11-23T21:00:00Z" },
      ],
    });
    const r = await getOwnItem.run({ itemId: LOOP }, callerOnly(fake));
    if (!r.ok) throw new Error(r.message);
    expect(ownItemSchema.parse(r.data)).toEqual(r.data);
    expect(r.data.item).toMatchObject({ id: LOOP, status: "processing", details: null, tags: [{ name: "dark", kind: "tag" }, { name: "keys", kind: "instrument" }] });
    expect(r.data.job).toEqual({ status: "queued", attempts: 2, error: WORKER_REASON_TEXT.corrupt_file });
    expect(r.data.checkFields).toEqual([]);
    expect(fake.queries.find((q) => q.table === "items")!.filters).toEqual([
      ["id", LOOP],
      ["owner_id", IDS.alice],
    ]);
  });

  it("a ready item marks the fields to check; no job yet is null; an unknown error is never shown raw", async () => {
    const ready = itemDbRow("loop", { status: "ready", published_at: null, details: { ...(itemDbRow().details as object), detection: { bpmSource: "onset", bpmAgreed: false, bpmCandidates: [70, 140], keySource: "chroma", keyConfidence: 0.05 } } });
    const none = await getOwnItem.run({ itemId: LOOP }, callerOnly(setup({ items: [ready] })));
    expect(none).toMatchObject({ ok: true, data: { job: null, checkFields: ["bpm", "key"] } });
    const raw = await getOwnItem.run({ itemId: LOOP }, callerOnly(setup({ items: [ready], processing_jobs: [{ item_id: LOOP, status: "failed", attempts: 3, error: "Traceback: /srv/worker.py" }] })));
    expect(raw).toMatchObject({ ok: true, data: { job: { error: WORKER_REASON_TEXT.internal } } });
  });

  it("flaggedReason is shown in plain language, never raw", async () => {
    const flagged = itemDbRow("loop", { status: "flagged", published_at: null, flagged_reason: "duplicate_exact" });
    expect(await getOwnItem.run({ itemId: LOOP }, callerOnly(setup({ items: [flagged] })))).toMatchObject({
      ok: true,
      data: { item: { flaggedReason: WORKER_REASON_TEXT.duplicate_exact } },
    });
    const raw = itemDbRow("loop", { status: "flagged", published_at: null, flagged_reason: "SELECT * FROM fingerprints" });
    expect(await getOwnItem.run({ itemId: LOOP }, callerOnly(setup({ items: [raw] })))).toMatchObject({
      ok: true,
      data: { item: { flaggedReason: WORKER_REASON_TEXT.internal } },
    });
  });

  it("another user's item, or a removed one: not_found", async () => {
    expect(await getOwnItem.run({ itemId: LOOP }, callerOnly(setup({ items: [{ ...draft, owner_id: IDS.bob }] })))).toMatchObject({ ok: false, code: "not_found" });
    expect(await getOwnItem.run({ itemId: LOOP }, callerOnly(setup({ items: [{ ...draft, status: "removed" }] })))).toMatchObject({ ok: false, code: "not_found" });
  });

  it("signed out: unauthorized; a bad id: invalid", async () => {
    expect(await getOwnItem.run({ itemId: LOOP }, callerOnly(fakeSupabase({ tables: { items: [draft] } })))).toMatchObject({ code: "unauthorized" });
    expect(await getOwnItem.run({ itemId: "x" }, callerOnly(setup({ items: [draft] })))).toMatchObject({ code: "invalid" });
  });
});

describe("updateItem", () => {
  const ready = () => itemDbRow("loop", { status: "ready", published_at: null });
  const setup = (opts: { items?: Array<Record<string, unknown>>; rpc?: Rpc; emptyUpdates?: string[]; tags?: Array<Record<string, unknown>> } = {}) => {
    const base = member();
    return fakeSupabase({
      ...base,
      rpc: opts.rpc,
      emptyUpdates: opts.emptyUpdates,
      tables: { ...base.tables, items: opts.items ?? [ready()], tags: opts.tags ?? [...publicTables().tags, { name: "drake", kind: "reference" }] },
    });
  };

  it("owner: edits the granted columns, filtered to their own row, and returns the item", async () => {
    const fake = setup();
    const r = await updateItem.run({ itemId: LOOP, title: "Night Keys", bpm: 141, key: { root: 2, mode: "major" }, genre: null }, callerOnly(fake));
    expect(r).toMatchObject({ ok: true, data: { id: LOOP, title: "Night Keys", bpm: 141, key: { root: 2, mode: "major" }, genre: null } });
    const update = fake.queries.find((q) => q.op === "update")!;
    expect(update.values).toEqual({ title: "Night Keys", bpm: 141, key_root: 2, key_mode: "major", genre: null });
    expect(update.filters).toEqual([
      ["id", LOOP],
      ["owner_id", IDS.alice],
    ]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("tags go through set_item_tags; the set not being edited is sent back unchanged", async () => {
    const rpc: Rpc = (fn) => (fn === "set_item_tags" ? { data: ["dark", "drake", "keys"], error: null } : { data: null, error: pgError("42883", fn) });
    const fake = setup({ items: [itemDbRow("loop", { status: "ready", published_at: null, tag_names: ["dark", "drake", "keys"] })], rpc });
    expect(await updateItem.run({ itemId: LOOP, tags: ["dark", "808"] }, callerOnly(fake))).toMatchObject({ ok: true });
    expect(fake.rpcCalls).toEqual([{ fn: "set_item_tags", args: { p_item_id: LOOP, p_tags: ["dark", "808"], p_reference_tags: ["drake"] } }]);
    fake.rpcCalls.length = 0;
    await updateItem.run({ itemId: LOOP, referenceTags: ["metro boomin"] }, callerOnly(fake));
    expect(fake.rpcCalls[0]!.args).toEqual({ p_item_id: LOOP, p_tags: ["dark", "keys"], p_reference_tags: ["metro boomin"] });
    expect(fake.queries.some((q) => q.op === "update")).toBe(false);
  });

  it("tags sent plus tags kept over the limit: invalid before anything is written (the title is not saved)", async () => {
    // Two reference tags on the item; the owner sends a title and eight tags: ten in total.
    const withRefs = itemDbRow("loop", { status: "ready", published_at: null, tag_names: ["drake", "metro boomin"] });
    const fake = setup({
      items: [withRefs],
      tags: [
        { name: "drake", kind: "reference" },
        { name: "metro boomin", kind: "reference" },
      ],
      rpc: () => ({ data: null, error: pgError("P0001", "invalid: Up to 8 tags in total.") }),
    });
    const tags = Array.from({ length: limits.tags.perItem }, (_, i) => `tag${i}`);
    expect(await updateItem.run({ itemId: LOOP, title: "Saved?", tags }, callerOnly(fake))).toMatchObject({
      ok: false,
      code: "invalid",
      fields: { tags: expect.stringMatching(/tags in total/) },
    });
    expect(fake.queries.some((q) => q.op === "update")).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.tables.items![0]!.title).toBe("Dark Keys");
  });

  it("the edit answer shows flaggedReason in plain language", async () => {
    const fake = setup({ items: [itemDbRow("loop", { status: "flagged", published_at: null, flagged_reason: "commercial_match" })] });
    expect(await updateItem.run({ itemId: LOOP, title: "Mine" }, callerOnly(fake))).toMatchObject({ ok: true, data: { flaggedReason: WORKER_REASON_TEXT.commercial_match } });
  });

  it("too many tags in total is invalid before the database", async () => {
    const fake = setup();
    const tags = Array.from({ length: limits.tags.perItem }, (_, i) => `tag${i}`);
    expect(await updateItem.run({ itemId: LOOP, tags, referenceTags: ["drake"] }, callerOnly(fake))).toMatchObject({ ok: false, code: "invalid" });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("license: leaving split on placement clears the share; choosing it needs one", async () => {
    const split = itemDbRow("loop", { status: "ready", published_at: null, license: "split_on_placement", split_percent: 50 });
    const fake = setup({ items: [split] });
    expect(await updateItem.run({ itemId: LOOP, license: "royalty_free" }, callerOnly(fake))).toMatchObject({ ok: true, data: { license: "royalty_free", splitPercent: null } });
    expect(fake.queries.find((q) => q.op === "update")!.values).toEqual({ license: "royalty_free", split_percent: null });

    const plain = setup();
    expect(await updateItem.run({ itemId: LOOP, license: "split_on_placement" }, callerOnly(plain))).toMatchObject({ ok: false, code: "invalid", fields: { splitPercent: expect.any(String) } });
    expect(await updateItem.run({ itemId: LOOP, splitPercent: 40 }, callerOnly(plain))).toMatchObject({ ok: false, code: "invalid", fields: { splitPercent: expect.any(String) } });
    expect(plain.queries.some((q) => q.op === "update")).toBe(false);
    const min = limits.licenses.split_on_placement.minPercent;
    expect(await updateItem.run({ itemId: LOOP, license: "split_on_placement", splitPercent: min }, callerOnly(plain))).toMatchObject({ ok: true, data: { splitPercent: min } });
  });

  it("another user's item: not_found, nothing written", async () => {
    const fake = setup({ items: [{ ...ready(), owner_id: IDS.bob }] });
    expect(await updateItem.run({ itemId: LOOP, title: "Mine now", tags: ["x1"] }, callerOnly(fake))).toMatchObject({ ok: false, code: "not_found" });
    expect(fake.queries.some((q) => q.op === "update")).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("wrong status: a removed item is not_found; an update the policy hides is not_found", async () => {
    const removed = setup({ items: [{ ...ready(), status: "removed" }] });
    expect(await updateItem.run({ itemId: LOOP, title: "Back" }, callerOnly(removed))).toMatchObject({ ok: false, code: "not_found" });
    const hidden = setup({ emptyUpdates: ["items"] });
    expect(await updateItem.run({ itemId: LOOP, title: "Back" }, callerOnly(hidden))).toMatchObject({ ok: false, code: "not_found" });
  });

  it("the database's own refusals come back as typed errors", async () => {
    const rpc: Rpc = () => ({ data: null, error: pgError("P0001", "invalid: Tags are 2 to 40 characters.") });
    expect(await updateItem.run({ itemId: LOOP, tags: ["ok"] }, callerOnly(setup({ rpc })))).toEqual({ ok: false, code: "invalid", message: "Tags are 2 to 40 characters." });
  });
});

describe("publishItem", () => {
  const published = { id: LOOP, type: "loop", slug: "dark-keys", public_id: "k3j9x0a2bq", published_at: "2026-11-23T23:00:00.5+00:00", status: "published" };
  const run = (input: Record<string, unknown>, rpc: Rpc) => {
    const fake = fakeSupabase({ ...member(), rpc });
    return { fake, result: publishItem.run(input, callerOnly(fake)) };
  };

  it("owner, ready: published through publish_item as the owner, with the canonical href", async () => {
    const { fake, result } = run({ itemId: LOOP, rightsConfirmed: true }, () => ({ data: published, error: null }));
    expect(await result).toEqual({ ok: true, data: { itemId: LOOP, publishedAt: published.published_at, href: "/loop/dark-keys-k3j9x0a2bq" } });
    expect(fake.rpcCalls).toEqual([{ fn: "publish_item", args: { p_item_id: LOOP, p_rights_confirmed: true, p_wavetables_confirmed: false } }]);
  });

  it("the rights confirmation is required before the database is asked", async () => {
    for (const input of [{ itemId: LOOP }, { itemId: LOOP, rightsConfirmed: false }]) {
      const { fake, result } = run(input, () => ({ data: published, error: null }));
      expect(await result).toMatchObject({ ok: false, code: "invalid", fields: { rightsConfirmed: expect.any(String) } });
      expect(fake.rpcCalls).toEqual([]);
    }
  });

  it("wrong status (flagged, draft, already published): conflict from publish_item", async () => {
    const { result } = run({ itemId: LOOP, rightsConfirmed: true }, () => ({ data: null, error: pgError("P0001", "conflict: Only a processed item can be published.") }));
    expect(await result).toEqual({ ok: false, code: "conflict", message: "Only a processed item can be published." });
  });

  it("another user's item: not_found; a preset without the wavetables confirmation: invalid", async () => {
    expect(await run({ itemId: LOOP, rightsConfirmed: true }, () => ({ data: null, error: pgError("P0001", "not_found: Item not found.") })).result).toMatchObject({ code: "not_found" });
    const { fake, result } = run({ itemId: LOOP, rightsConfirmed: true, wavetablesConfirmed: true }, () => ({
      data: null,
      error: pgError("P0001", "invalid: Confirm any wavetables are your own or factory content."),
    }));
    expect(await result).toMatchObject({ code: "invalid" });
    expect(fake.rpcCalls[0]!.args).toMatchObject({ p_wavetables_confirmed: true });
  });

  it("signed out: unauthorized", async () => {
    const fake = fakeSupabase({ rpc: () => ({ data: published, error: null }) });
    expect(await publishItem.run({ itemId: LOOP, rightsConfirmed: true }, callerOnly(fake))).toMatchObject({ code: "unauthorized" });
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("unpublishItem", () => {
  it("owner, published: back to ready through unpublish_item", async () => {
    const fake = fakeSupabase({ ...member(), rpc: () => ({ data: { id: LOOP, status: "ready" }, error: null }) });
    expect(await unpublishItem.run({ itemId: LOOP }, callerOnly(fake))).toEqual({ ok: true, data: { itemId: LOOP, status: "ready" } });
    expect(fake.rpcCalls).toEqual([{ fn: "unpublish_item", args: { p_item_id: LOOP } }]);
  });

  it("not published, or another user's item: not_found from the database", async () => {
    const fake = fakeSupabase({ ...member(), rpc: () => ({ data: null, error: pgError("P0001", "not_found: No published item to unpublish.") }) });
    expect(await unpublishItem.run({ itemId: LOOP }, callerOnly(fake))).toEqual({ ok: false, code: "not_found", message: "No published item to unpublish." });
  });
});

describe("deleteItem", () => {
  const setup = (items: Array<Record<string, unknown>>, base = member()) =>
    fakeSupabase({ ...base, tables: { ...base.tables, items }, rpc: () => ({ data: { id: LOOP, status: "removed" }, error: null }) });

  it("owner, any live status: removed through remove_item", async () => {
    for (const status of ["draft", "ready", "published", "flagged"]) {
      const fake = setup([itemDbRow("loop", { status })]);
      expect(await deleteItem.run({ itemId: LOOP }, callerOnly(fake))).toEqual({ ok: true, data: { itemId: LOOP, status: "removed" } });
      expect(fake.rpcCalls).toEqual([{ fn: "remove_item", args: { p_item_id: LOOP } }]);
    }
  });

  it("another user's item: not_found and remove_item is never called, even for an admin", async () => {
    const admin = member(IDS.bob, "bob", { account: { role: "admin" } });
    const fake = setup([itemDbRow("loop")], admin);
    expect(await deleteItem.run({ itemId: LOOP }, callerOnly(fake))).toMatchObject({ ok: false, code: "not_found" });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("already removed: not_found", async () => {
    const fake = setup([itemDbRow("loop", { status: "removed" })]);
    expect(await deleteItem.run({ itemId: LOOP }, callerOnly(fake))).toMatchObject({ ok: false, code: "not_found" });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("a suspended member: forbidden before the database", async () => {
    const fake = setup([itemDbRow("loop")], member(IDS.alice, "alice", { account: { suspended_at: "2026-11-23T00:00:00Z" } }));
    expect(await deleteItem.run({ itemId: LOOP }, callerOnly(fake))).toMatchObject({ ok: false, code: "forbidden" });
    expect(fake.rpcCalls).toEqual([]);
  });
});
