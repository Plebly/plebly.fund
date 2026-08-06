import { describe, expect, it } from "vitest";
import { parseLocation, seoForRoute } from "./router";

describe("keyholders route", () => {
  it("parses /keyholders", () => {
    expect(parseLocation("/keyholders", "")).toEqual({ name: "keyholders" });
    const seo = seoForRoute({ name: "keyholders" });
    expect(seo.path).toBe("/keyholders");
    expect(seo.title).toMatch(/Keyholder/i);
  });
});
