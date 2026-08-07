import { describe, expect, it } from "vitest";
import {
  freshLinkedOrgs,
  isFreshLinkedOrgAdmin,
  projectCardProposerHtml,
} from "./github-orgs-client";
import {
  proposalsForOrgProposer,
  proposalsForProfile,
} from "./github";
import type { Proposal } from "./types";

describe("freshLinkedOrgs / isFreshLinkedOrgAdmin", () => {
  it("filters admin + fresh attestations", () => {
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const orgs = freshLinkedOrgs({
      id: "github:1",
      github_orgs: [
        { login: "plebly", role: "admin", verified_at: fresh },
        { login: "old", role: "admin", verified_at: stale },
      ],
    });
    expect(orgs.map((o) => o.login)).toEqual(["plebly"]);
    expect(isFreshLinkedOrgAdmin({ id: "github:1", github_orgs: orgs }, "plebly")).toBe(
      true,
    );
  });
});

describe("projectCardProposerHtml", () => {
  it("links org proposers to /org/:login", () => {
    const html = projectCardProposerHtml(
      {
        proposer_type: "org",
        proposer: { github: "plebly", username: null },
      },
      {
        profileHref: (u) => `/u/${u}`,
        orgHref: (l) => `/org/${l}`,
        escapeHtml: (s) => s,
      },
    );
    expect(html).toContain('href="/org/plebly"');
    expect(html).toContain("by plebly");
    expect(html).not.toContain("@plebly");
  });
});

describe("proposalsForOrgProposer / proposalsForProfile agent", () => {
  const orgProp = {
    path: "proposals/listed/a.md",
    title: "A",
    status: "listed",
    proposer_type: "org",
    proposer: { github: "plebly", agent: "alice", username: null },
    claimer: null,
  } as Proposal;

  const claimOnly = {
    path: "proposals/claimed/b.md",
    title: "B",
    status: "claimed",
    proposer_type: "individual",
    proposer: { github: "bob", username: "bob" },
    claimer: "plebly",
    claimer_type: "org",
  } as Proposal;

  it("lists org-proposed projects for the org", () => {
    expect(proposalsForOrgProposer([orgProp, claimOnly], "plebly")).toEqual([
      orgProp,
    ]);
  });

  it("lists org-proposed projects on the agent human profile", () => {
    expect(
      proposalsForProfile([orgProp, claimOnly], { github: "alice" }),
    ).toEqual([orgProp]);
    // Org login alone must not attribute the proposal to a human named plebly.
    expect(
      proposalsForProfile([orgProp], { github: "plebly" }),
    ).toEqual([]);
  });
});
