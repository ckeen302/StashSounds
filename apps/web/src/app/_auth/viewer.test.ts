import { describe, expect, it } from "vitest";
import type { Session } from "@/server";
import { viewerFrom } from "./viewer";

const user = { id: "00000000-0000-4000-8000-000000000001", email: "kilo@example.com", emailVerified: true };
const profile = {
  id: user.id,
  handle: "kilo_beats",
  displayName: "Kilo Beats",
  bio: null,
  avatarUrl: null,
  links: [],
  followersCount: 0,
  followingCount: 0,
  createdAt: "2026-11-01T00:00:00Z",
};
const account = { id: user.id, role: "user", storageBytes: 0, storageQuotaBytes: 1, strikes: 0, suspendedAt: null, emailVerified: true } as const;

describe("viewerFrom", () => {
  it("is signed out without a session", () => {
    expect(viewerFrom(null)).toEqual({ status: "signed_out" });
  });
  it("needs a handle before the claim", () => {
    const s: Session = { user, profile: null, account: null };
    expect(viewerFrom(s)).toEqual({ status: "needs_handle" });
  });
  it("is a member with only what the shell shows, never the email or account", () => {
    const s: Session = { user, profile, account };
    expect(viewerFrom(s)).toEqual({ status: "member", handle: "kilo_beats", displayName: "Kilo Beats", avatarUrl: null });
  });
});
