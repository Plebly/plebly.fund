import { beforeAll, describe, expect, it } from "vitest";
import {
  commentsHtml,
  funderCreditHtml,
  fundersListHtml,
} from "./proposal-engagement";

const locationState = {
  origin: "https://plebly.fund",
  pathname: "/p/PLEBLY-1",
  search: "",
  hash: "",
};

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    value: { location: locationState },
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    get: () => locationState,
    configurable: true,
  });
});

describe("funderCreditHtml", () => {
  it("is empty without a proposal id", () => {
    expect(funderCreditHtml(null)).toBe("");
  });

  it("is a public funders list only (no credit prefs form)", () => {
    const html = funderCreditHtml("PLEBLY-1");
    expect(html).toContain('id="funder-credit"');
    expect(html).toContain("hidden");
    expect(html).toContain("Funders");
    expect(html).not.toContain("login-choices");
    expect(html).not.toContain("funder-credit-form");
    expect(html).not.toContain("funder-credit-prefs");
    expect(html).not.toContain("credit-txid");
  });
});

describe("commentsHtml", () => {
  it("is empty without a proposal id", () => {
    expect(commentsHtml(null, true)).toBe("");
  });

  it("shows comment composer when signed in", () => {
    const html = commentsHtml("PLEBLY-1", true);
    expect(html).toContain("proposal-comment-input");
    expect(html).toContain("Post comment");
    expect(html).not.toContain("Sign in to comment");
  });

  it("asks for login when signed out", () => {
    const html = commentsHtml("PLEBLY-1", false);
    expect(html).toContain("Sign in to comment");
    expect(html).toContain("login-choices");
    expect(html).toContain("comment-login-msg");
  });
});

describe("fundersListHtml", () => {
  it("returns empty string when there are no funders", () => {
    expect(fundersListHtml([])).toBe("");
  });

  it("renders profile chips with tooltips", () => {
    const html = fundersListHtml([
      { identity: "alice", anonymous: false, amount_sats: 21_000 },
      { identity: null, anonymous: true },
    ]);
    expect(html).toContain("funder-chips");
    expect(html).toContain("funder-chip");
    expect(html).toContain("alice");
    expect(html).toContain('href="/u/alice"');
    expect(html).toContain("Anonymous");
    expect(html).toContain("funder-chip-static");
  });

  it("escapes identity HTML", () => {
    const html = fundersListHtml([
      { identity: "<script>x</script>", anonymous: false },
    ]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
