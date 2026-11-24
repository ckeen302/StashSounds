import { describe, expect, it, vi } from "vitest";
import { fixtureItemPage } from "./fixtures";

const requestDownload = vi.fn(async (input: unknown) => ({ ok: true as const, data: { input } }));
vi.mock("@/server/downloads/actions", () => ({ requestDownload }));

const { serverActions } = await import("./server-actions");
const { actionsFor } = await import("./actions-source");

const page = () => {
  const r = fixtureItemPage("loop", "dusty-soul-chops-k3j9x0a2b1", { signedIn: true });
  if (r.kind !== "page") throw new Error("fixture missing");
  return r.page;
};

describe("the item page's actions", () => {
  it("server download is requestDownload with the item id, saved by following the signed URL", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    await serverActions.download(id);
    expect(requestDownload).toHaveBeenCalledWith({ itemId: id });
    expect(serverActions.save).toBe("navigate");
    expect(serverActions.like).toBeUndefined();
    expect(serverActions.follow).toBeUndefined();
  });

  it("a server page uses the server actions; a local page the local ones, saved as a blob", () => {
    expect(actionsFor("server", page())).toBe(serverActions);
    const local = actionsFor("local", page());
    expect(local).not.toBe(serverActions);
    expect(local.save).toBe("blob");
    expect(local.like).toBeTypeOf("function");
  });
});
