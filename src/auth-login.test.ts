import { beforeAll, describe, expect, it } from "vitest";
import { githubLoginUrl, loginChoicesHtml, loginMenuHtml, xLoginUrl } from "./auth";

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    value: { location: { origin: "https://plebly.fund" } },
    configurable: true,
  });
});

describe("login UX helpers", () => {
  it("builds GitHub and X OAuth URLs with return_to", () => {
    expect(githubLoginUrl("/account")).toContain("/auth/github?return_to=");
    expect(xLoginUrl("/account")).toContain("/auth/x?return_to=");
    expect(decodeURIComponent(githubLoginUrl("/propose"))).toContain("/propose");
  });

  it("loginChoicesHtml offers both providers", () => {
    const html = loginChoicesHtml("Sign in to continue.", "/account");
    expect(html).toContain("Sign in to continue.");
    expect(html).toContain("/auth/github");
    expect(html).toContain("/auth/x");
    expect(html).toContain("GitHub");
    expect(html).toContain("fa-x-twitter");
  });

  it("loginMenuHtml is a compact nav details control", () => {
    const html = loginMenuHtml("/");
    expect(html).toContain("<details");
    expect(html).toContain("Continue with GitHub");
    expect(html).toContain("Continue with X");
  });
});
