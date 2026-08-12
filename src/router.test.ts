import { describe, expect, it } from "vitest";
import {
  parseLocation,
  projectsHref,
  proposalHref,
  proposalJsonLd,
  seoForRoute,
  isStaticDocumentPath,
} from "./router";

describe("router governance paths", () => {
  it("links Projects nav to the home open-projects section", () => {
    expect(projectsHref()).toBe("/#projects");
    expect(projectsHref("?for=builders")).toBe("/?for=builders#projects");
  });

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

  it("keeps legacy folder URLs and maps archive aliases", () => {
    expect(parseLocation("/proposal/listed/example", "")).toEqual({
      name: "proposal",
      id: "proposals/listed/example.md",
    });
    expect(proposalHref("proposals/listed/example.md")).toBe(
      "/proposal/listed/example",
    );
    expect(parseLocation("/stats", "")).toEqual({ name: "stats" });
    expect(parseLocation("/archive", "")).toEqual({
      name: "archive",
      tab: "completed",
    });
    expect(parseLocation("/archive", "?tab=declined")).toEqual({
      name: "archive",
      tab: "declined",
    });
    expect(parseLocation("/declined", "")).toEqual({
      name: "archive",
      tab: "declined",
    });
    expect(parseLocation("/completed", "")).toEqual({
      name: "archive",
      tab: "completed",
    });
    expect(seoForRoute({ name: "archive", tab: "declined" }).path).toBe(
      "/archive?tab=declined",
    );
    expect(seoForRoute({ name: "archive", tab: "completed" }).path).toBe(
      "/archive",
    );
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
    const graph = ld["@graph"] as Array<Record<string, unknown>>;
    expect(graph.map((n) => n["@type"])).toEqual([
      "FundingCampaign",
      "WebPage",
      "BreadcrumbList",
    ]);
    const campaign = graph[0]!;
    expect(campaign.url).toBe("https://plebly.fund/p/plebly-42");
    expect(campaign.fundingGoal).toMatchObject({ currency: "XBT" });
    expect(campaign.amount).toMatchObject({ currency: "XBT" });
  });

  it("does not treat /docs and static files as SPA routes", () => {
    expect(isStaticDocumentPath("/docs/keyholder-responsibilities.md")).toBe(
      true,
    );
    expect(isStaticDocumentPath("/llms-full.txt")).toBe(true);
    expect(isStaticDocumentPath("/sitemap.xml")).toBe(true);
    expect(isStaticDocumentPath("/reviewers")).toBe(false);
    expect(isStaticDocumentPath("/keyholders")).toBe(false);
  });
});


