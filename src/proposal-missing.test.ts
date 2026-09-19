import { describe, expect, it } from "vitest";
import { missingProposalHtml } from "./proposal-page";

describe("missingProposalHtml", () => {
  it("says the project is gone instead of dumping home copy", () => {
    const html = missingProposalHtml("no-such-id");
    expect(html).toContain("Project not found");
    expect(html).toContain("no-such-id");
    expect(html).toContain("Browse projects");
    expect(html).not.toContain("Fund Bitcoin work in public");
  });
});
