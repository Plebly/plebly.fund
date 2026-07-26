import { describe, expect, it } from "vitest";
import { PROPOSAL_TEMPLATES } from "./proposal-templates";

describe("proposal templates", () => {
  it("ships docs/tooling/research starters with required fields", () => {
    expect(PROPOSAL_TEMPLATES.map((t) => t.id).sort()).toEqual([
      "docs",
      "research",
      "tooling",
    ]);
    for (const t of PROPOSAL_TEMPLATES) {
      expect(t.title.length).toBeGreaterThan(5);
      expect(t.problem.length).toBeGreaterThan(20);
      expect(t.deliverable.length).toBeGreaterThan(20);
      expect(t.verification.length).toBeGreaterThan(20);
      expect(t.out_of_scope.length).toBeGreaterThan(5);
      expect(t.tags.length).toBeGreaterThan(0);
    }
  });
});
