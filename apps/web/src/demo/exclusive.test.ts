import { describe, expect, it } from "vitest";
import { onSilence, silenceOthers } from "./exclusive";

describe("one sound at a time", () => {
  it("stops every registered player but the one starting", () => {
    const stopped: string[] = [];
    const a = () => stopped.push("a");
    const b = () => stopped.push("b");
    onSilence(a);
    onSilence(b);
    silenceOthers(a);
    expect(stopped).toEqual(["b"]);
    silenceOthers();
    expect(stopped).toEqual(["b", "a", "b"]);
  });
});
