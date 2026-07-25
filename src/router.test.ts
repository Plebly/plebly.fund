import { describe, expect, it } from "vitest";
import { parseLocation, seoForRoute } from "./router";

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
});
