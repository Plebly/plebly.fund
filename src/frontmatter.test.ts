import { describe, expect, it } from "vitest";
import { parseFrontMatter, parseYamlFrontMatter } from "./frontmatter";

describe("parseYamlFrontMatter", () => {
  it("parses nested proposer map", () => {
    const data = parseYamlFrontMatter(`
title: "Demo"
proposer:
  username: secsovereign
  github: null
created_at: "2026-07-24T00:00:00Z"
`);
    expect(data.title).toBe("Demo");
    expect(data.proposer).toEqual({
      username: "secsovereign",
      github: null,
    });
    expect(data.created_at).toBe("2026-07-24T00:00:00Z");
  });

  it("parses milestones list of maps", () => {
    const data = parseYamlFrontMatter(`
milestones:
  - id: m1
    deliverable: "Ship smoke checklist"
    verification: "Page loads"
    out_of_scope: "Mainnet"
    allocation_sats: 50000
    deadline: "2026-09-01"
  - id: m2
    deliverable: "Fund and claim path"
    verification: "Balance updates"
    out_of_scope: "Multisig"
    allocation_sats: 50000
    deadline: "2026-10-01"
`);
    expect(data.milestones).toEqual([
      {
        id: "m1",
        deliverable: "Ship smoke checklist",
        verification: "Page loads",
        out_of_scope: "Mainnet",
        allocation_sats: 50000,
        deadline: "2026-09-01",
      },
      {
        id: "m2",
        deliverable: "Fund and claim path",
        verification: "Balance updates",
        out_of_scope: "Multisig",
        allocation_sats: 50000,
        deadline: "2026-10-01",
      },
    ]);
  });

  it("parses JSON scalar objects from worker-rendered proposals", () => {
    const data = parseYamlFrontMatter(`
proposer: {"username":"secsovereign","github":null}
milestones: []
`);
    expect(data.proposer).toEqual({
      username: "secsovereign",
      github: null,
    });
    expect(data.milestones).toEqual([]);
  });
});

describe("parseFrontMatter", () => {
  it("splits body", () => {
    const { data, body } = parseFrontMatter(`---
title: "X"
---

# Hello
`);
    expect(data.title).toBe("X");
    expect(body).toContain("# Hello");
  });
});
