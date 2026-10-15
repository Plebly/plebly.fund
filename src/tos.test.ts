import { describe, expect, it } from "vitest";
import {
  reviewKindPayLabel,
  TOS_CURRENT,
  TOS_GRACE_DAYS,
  tosDisplayMarkdown,
  tosStatus,
} from "./tos";

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
  const published = Date.parse(TOS_CURRENT.published_at);
  const graceEnd = published + TOS_GRACE_DAYS * 86400_000;
  const inGrace = published + 86400_000;

  it("requires when missing", () => {
    expect(tosStatus(null, inGrace)).toBe("required");
    expect(tosStatus({ tos_version: "tos-2026-09-13" }, inGrace)).toBe("current");
    expect(tosStatus({ tos_version: "tos-2026-08-13" }, inGrace)).toBe("grace");
  });

  it("ends the grace window for the previous version", () => {
    expect(tosStatus({ tos_version: "tos-2026-08-13" }, graceEnd - 1)).toBe("grace");
    expect(tosStatus({ tos_version: "tos-2026-08-13" }, graceEnd)).toBe("required");
    expect(tosStatus({ tos_version: "tos-2026-09-13" }, graceEnd)).toBe("current");
  });
});

describe("reviewKindPayLabel", () => {
  it("stays human", () => {
    expect(reviewKindPayLabel("deliverable_confirm")).toBe(
      "Share of the 2% reviewer reserve when the review finishes",
    );
    expect(reviewKindPayLabel("second_review")).toBe(
      "Share of the 2% reviewer reserve when the review finishes",
    );
    expect(reviewKindPayLabel("listing_challenge")).toBe(
      "10,000 sats · payment not enabled yet",
    );
  });
});
