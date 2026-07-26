import { describe, expect, it } from "vitest";
import { listingReportControlHtml } from "./report-panel";

describe("listingReportControlHtml", () => {
  it("renders report control for challengeable statuses", () => {
    const html = listingReportControlHtml(
      "listed",
      "proposals/listed/demo.md",
      "PLEBLY-1",
    );
    expect(html).toContain("listing-report-open");
    expect(html).toContain("Report listing");
    expect(html).toContain("listing-report-modal");
  });

  it("hides for non-reportable statuses", () => {
    expect(
      listingReportControlHtml("completed", "proposals/completed/x.md", "PLEBLY-1"),
    ).toBe("");
    expect(
      listingReportControlHtml("listed", "proposals/listed/x.md", null),
    ).toBe("");
  });
});
