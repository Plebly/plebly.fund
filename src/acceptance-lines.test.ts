import { describe, expect, it } from "vitest";
import {
  NAMED_REQUIREMENT_MAX,
  bountyVerificationFieldError,
  bountyVerificationScoreHint,
  countNamedRequirementLines,
  namedRequirementLines,
} from "./acceptance-lines";

const FIXTURES = {
  numbered: "1. tests\n2. docs\nNotes about the work",
  paren: "1) tests\n2) docs",
  dashes: "- Suite green\n- Docs updated\nNotes",
  stars: "* Suite green\n* Docs updated",
  prose: "A reader opens the report and confirms a yes/no conclusion.",
  inline: "1. a 2. b 3. c",
};

describe("namedRequirementLines", () => {
  it("parses 1. 1) - and * lines and ignores prose", () => {
    expect(namedRequirementLines(FIXTURES.numbered)).toEqual(["tests", "docs"]);
    expect(namedRequirementLines(FIXTURES.paren)).toEqual(["tests", "docs"]);
    expect(namedRequirementLines(FIXTURES.dashes)).toEqual([
      "Suite green",
      "Docs updated",
    ]);
    expect(namedRequirementLines(FIXTURES.stars)).toEqual([
      "Suite green",
      "Docs updated",
    ]);
    expect(namedRequirementLines(FIXTURES.prose)).toEqual([]);
    expect(namedRequirementLines(FIXTURES.inline)).toEqual([]);
  });

  it("caps MCP send at 12 but count sees overflow", () => {
    const lines = Array.from(
      { length: NAMED_REQUIREMENT_MAX + 2 },
      (_, i) => `${i + 1}. check ${i + 1}`,
    ).join("\n");
    expect(namedRequirementLines(lines)).toHaveLength(NAMED_REQUIREMENT_MAX);
    expect(countNamedRequirementLines(lines)).toBe(NAMED_REQUIREMENT_MAX + 2);
  });
});

describe("bounty verification copy", () => {
  it("requires 3–12 lines and reports scoreable N", () => {
    expect(bountyVerificationFieldError("1. a\n2. b")).toMatch(/3–12/);
    expect(
      bountyVerificationFieldError("1. a\n2. b\n3. c"),
    ).toBeNull();
    const tooMany = Array.from({ length: 13 }, (_, i) => `${i + 1}. check ${i + 1}`).join(
      "\n",
    );
    expect(bountyVerificationFieldError(tooMany)).toMatch(/At most 12/);
    expect(bountyVerificationScoreHint("1. a\n2. b\n3. c")).toBe(
      "AI can score these 3 lines.",
    );
    expect(bountyVerificationScoreHint("prose only")).toMatch(/cannot score/);
  });
});
