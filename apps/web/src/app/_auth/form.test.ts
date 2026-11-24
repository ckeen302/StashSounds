import { describe, expect, it } from "vitest";
import { err, ok } from "@stash/contracts";
import { formErrors, normalizeHandle, signInFailedMessage } from "./form";

describe("normalizeHandle", () => {
  it("lowercases as you type, since handles are lowercase only", () => {
    expect(normalizeHandle("Kilo_Beats")).toBe("kilo_beats");
  });
  it("drops spaces and leading @, which people paste from other sites", () => {
    expect(normalizeHandle("@kilo beats")).toBe("kilobeats");
    expect(normalizeHandle("  nova ")).toBe("nova");
  });
  it("keeps other characters so the field can say what is wrong", () => {
    expect(normalizeHandle("nova!")).toBe("nova!");
  });
});

describe("formErrors", () => {
  it("is empty for a success", () => {
    expect(formErrors(ok({ sent: true }), ["email"])).toEqual({ fields: {}, form: undefined });
  });
  it("puts a field's message under that field, and nothing above the button", () => {
    expect(formErrors(err("conflict", "That handle is taken.", { handle: "That handle is taken." }), ["handle", "displayName"])).toEqual({
      fields: { handle: "That handle is taken." },
      form: undefined,
    });
  });
  it("shows the message above the button when no field on this form carries it", () => {
    expect(formErrors(err("rate_limited", "Too many tries. Wait a minute and try again."), ["email"])).toEqual({
      fields: {},
      form: "Too many tries. Wait a minute and try again.",
    });
    // A field this form does not show is not dropped silently.
    expect(formErrors(err("invalid", "Check the highlighted fields.", { next: "Too long." }), ["email"]).form).toBe("Check the highlighted fields.");
  });
});

describe("signInFailedMessage", () => {
  it("explains a failed link and what to do", () => {
    expect(signInFailedMessage("signin_failed")).toBe("That sign-in did not finish. The link may have expired. Ask for a new one.");
    expect(signInFailedMessage(undefined)).toBeUndefined();
    expect(signInFailedMessage("something_else")).toBe("That sign-in did not finish. The link may have expired. Ask for a new one.");
  });
});
