import { describe, expect, it } from "vitest";
import {
  parseLocation,
  proposalHref,
  proposalJsonLd,
  seoForRoute,
} from "./router";

describe("router governance paths", () => {
  it("parses /reviewers and /governance", () => {
    expect(parseLocation("/reviewers", "")).toEqual({ name: "reviewers" });
    expect(parseLocation("/governance", "")).toEqual({ name: "reviewers" });
  });

  it("seo for reviewers page", () => {
    const seo = seoForRoute({ name: "reviewers" });
    expect(seo.path).toBe("/reviewers");
    expect(seo.title).toMatch(/Reviewers/i);
  });

  it("parses and links stable proposal IDs", () => {
    expect(parseLocation("/p/PLEBLY-42", "")).toEqual({
      name: "proposal",
      id: "PLEBLY-42",
      stable: true,
    });
    expect(parseLocation("/p/plebly-42", "")).toEqual({
      name: "proposal",
      id: "plebly-42",
      stable: true,
    });
    expect(proposalHref("proposals/listed/example.md", "PLEBLY-42")).toBe(
      "/p/plebly-42",
    );
  });

  it("keeps legacy folder URLs and adds /stats + /declined", () => {
    expect(parseLocation("/proposal/listed/example", "")).toEqual({
      name: "proposal",
      id: "proposals/listed/example.md",
    });
    expect(proposalHref("proposals/listed/example.md")).toBe(
      "/proposal/listed/example",
    );
    expect(parseLocation("/stats", "")).toEqual({ name: "stats" });
    expect(parseLocation("/declined", "")).toEqual({ name: "declined" });
    expect(seoForRoute({ name: "declined" }).path).toBe("/declined");
  });

  it("builds FundingCampaign JSON-LD for stable proposal URLs", () => {
    const ld = proposalJsonLd({
      id: "PLEBLY-42",
      title: "Demo",
      description: "Fund open work",
      path: "/p/plebly-42",
      status: "listed",
      target_sats: 100_000,
      balance_sats: 25_000,
    });
    expect(ld["@type"]).toBe("FundingCampaign");
    expect(ld.url).toBe("https://plebly.fund/p/plebly-42");
    expect(ld.fundingGoal).toMatchObject({ currency: "XBT" });
    expect(ld.amount).toMatchObject({ currency: "XBT" });
  });
});


