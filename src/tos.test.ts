import { describe, expect, it } from "vitest";
import { reviewKindPayLabel, tosDisplayMarkdown, tosStatus } from "./tos";

describe("tosDisplayMarkdown", () => {
  it("strips machine version keys from the public terms page", () => {
    const html = tosDisplayMarkdown(
      "# Terms of Service\n\nversion: tos-2026-08-13\npublished_at: 2026-08-13T00:00:00.000Z\n\nPlebly routes proposals.\n",
    );
    expect(html).toContain("Plebly routes proposals.");
    expect(html).not.toContain("version:");
    expect(html).not.toContain("published_at:");
    expect(html).not.toContain("tos-2026-08-13");
  });
});

describe("tosStatus", () => {
  it("requires when missing", () => {
    expect(tosStatus(null)).toBe("required");
    expect(tosStatus({ tos_version: "tos-2026-08-13" })).toBe("current");
  });
});

describe("reviewKindPayLabel", () => {
  it("stays human", () => {
    expect(reviewKindPayLabel("deliverable_confirm")).toBe("Unpaid");
    expect(reviewKindPayLabel("second_review")).toBe(
      "10,000 sats · payment not enabled yet",
    );
  });
});
