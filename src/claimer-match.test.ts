import { describe, expect, it } from "vitest";
import {
  sessionMatchesClaimer,
  sessionMatchesPendingClaim,
} from "./claimer-match";

const full =
  "5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6";
const truncated = "5255bf327a89";

describe("sessionMatchesClaimer", () => {
  it("matches truncated nostr claimerLabel against full session id", () => {
    const user = {
      id: `nostr:${full}`,
      nostr: full,
      username: "npub12f2m7",
    };
    expect(
      sessionMatchesClaimer(user as never, `nostr:${truncated}`, "individual"),
    ).toBe(true);
    expect(
      sessionMatchesClaimer(user as never, `nostr:${full}`, "individual"),
    ).toBe(true);
    expect(
      sessionMatchesClaimer(user as never, "nostr:deadbeefdead", "individual"),
    ).toBe(false);
  });

  it("still matches github claimers exactly", () => {
    const user = { id: "github:1", github: "alice", username: "alice" };
    expect(sessionMatchesClaimer(user as never, "alice", "individual")).toBe(
      true,
    );
  });
});

describe("sessionMatchesPendingClaim", () => {
  it("matches full pending user_id", () => {
    const user = { id: `nostr:${full}`, nostr: full };
    expect(
      sessionMatchesPendingClaim(user as never, `nostr:${full}`),
    ).toBe(true);
    expect(
      sessionMatchesPendingClaim(user as never, `nostr:${truncated}`),
    ).toBe(false);
  });
});
