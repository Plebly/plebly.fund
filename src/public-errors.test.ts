import { describe, expect, it } from "vitest";
import { sanitizePublicError } from "./public-errors";

describe("sanitizePublicError", () => {
  it("replaces infra errors with a generic message", () => {
    expect(
      sanitizePublicError(
        "GitHub org fetch failed (403) — GitHub denied the request (rate limit or App needs Organization permissions).",
        "Unavailable.",
      ),
    ).toBe("Unavailable.");
    expect(sanitizePublicError("call https://api.plebly.fund/health")).toBe(
      "Something went wrong. Try again in a few minutes.",
    );
  });

  it("keeps normal user-facing errors", () => {
    expect(sanitizePublicError("Org discovery expired — refresh from GitHub again")).toBe(
      "Org discovery expired — refresh from GitHub again",
    );
  });
});
