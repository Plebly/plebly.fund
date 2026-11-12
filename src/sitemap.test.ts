import { describe, expect, it } from "vitest";
import {
  canonicalSitemapPath,
  isDemoListingId,
  isSitemapListing,
  listingIdsFromCatalog,
  listingPath,
  mergeCatalogProposals,
  sitemapPaths,
  STATIC_PATHS,
  xmlFor,
} from "../scripts/sitemap-urls.mjs";

describe("canonicalSitemapPath", () => {
  it("adds a trailing slash on HTML routes and keeps / as /", () => {
    expect(canonicalSitemapPath("/")).toBe("/");
    expect(canonicalSitemapPath("/about")).toBe("/about/");
    expect(canonicalSitemapPath("/about/")).toBe("/about/");
    expect(canonicalSitemapPath("p/plebly-2026-008")).toBe("/p/plebly-2026-008/");
  });

  it("does not add a trailing slash to files", () => {
    expect(canonicalSitemapPath("/llms.txt")).toBe("/llms.txt");
    expect(canonicalSitemapPath("/humans.txt")).toBe("/humans.txt");
    expect(canonicalSitemapPath("/sitemap.xml")).toBe("/sitemap.xml");
  });
});

describe("sitemap listing filter", () => {
  it("drops the signet demo and declined/voided rows", () => {
    expect(isDemoListingId("PLEBLY-SIGNET-DEMO")).toBe(true);
    expect(isSitemapListing({ id: "PLEBLY-SIGNET-DEMO", status: "declined" })).toBe(false);
    expect(isSitemapListing({ id: "PLEBLY-2026-010", status: "declined" })).toBe(false);
    expect(isSitemapListing({ id: "PLEBLY-2026-001", status: "voided" })).toBe(false);
    expect(isSitemapListing({ id: "PLEBLY-2026-008", status: "listed" })).toBe(true);
    expect(isSitemapListing({ id: "PLEBLY-2026-010", status: "completed" })).toBe(true);
  });

  it("builds listing paths with a trailing slash and lower-case id", () => {
    expect(listingPath("PLEBLY-KNOTS-SIZE-VALUE-SPAM")).toBe(
      "/p/plebly-knots-size-value-spam/",
    );
  });
});

describe("xmlFor + sitemapPaths", () => {
  it("emits trailing-slash locs, keeps file urls, and omits the demo", () => {
    const listings = [
      { id: "PLEBLY-KNOTS-SIZE-VALUE-SPAM", status: "listed" },
      { id: "PLEBLY-SIGNET-DEMO", status: "declined" },
      { id: "PLEBLY-2026-008", status: "listed" },
      { id: "PLEBLY-2026-001", status: "voided" },
    ];
    const xml = xmlFor(sitemapPaths(STATIC_PATHS, listings));
    expect(xml).toContain("<loc>https://plebly.fund/</loc>");
    expect(xml).toContain("<loc>https://plebly.fund/about/</loc>");
    expect(xml).toContain("<loc>https://plebly.fund/donations/</loc>");
    expect(xml).toContain("<loc>https://plebly.fund/llms.txt</loc>");
    expect(xml).not.toContain("https://plebly.fund/about</loc>");
    expect(xml).toContain("/p/plebly-knots-size-value-spam/</loc>");
    expect(xml).toContain("/p/plebly-2026-008/</loc>");
    expect(xml).not.toContain("plebly-signet-demo");
    expect(xml).not.toContain("plebly-2026-001");
  });

  it("merges listed then all without duplicating ids", () => {
    const merged = mergeCatalogProposals([
      [{ id: "PLEBLY-2026-008", status: "listed", title: "from listed" }],
      [
        { id: "PLEBLY-2026-008", status: "listed", title: "from all" },
        { id: "PLEBLY-SIGNET-DEMO", status: "declined" },
      ],
    ]);
    expect(listingIdsFromCatalog(merged)).toEqual(["plebly-2026-008"]);
    expect(merged[0]!.title).toBe("from listed");
  });
});
