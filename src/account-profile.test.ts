import { beforeAll, describe, expect, it } from "vitest";
import { accountProfilePaneHtml } from "./profile-pages";
import type { AuthUser } from "./auth";

function user(partial: Partial<AuthUser> & Pick<AuthUser, "id">): AuthUser {
  return {
    created_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("account profile editor layout", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: {
        origin: "https://plebly.bitcoin",
        pathname: "/account",
        search: "",
        hash: "",
      },
    });
  });

  it("groups public fields separately from logins, orgs, and delete", () => {
    const html = accountProfilePaneHtml(
      user({
        id: "github:1",
        github: "alice",
        username: "alice",
        bio: "Builder",
      }),
      { status: "active", fingerprint: "AAAA", xpub: "xpub1abc" },
    );
    document.body.innerHTML = html;

    const form = document.querySelector<HTMLFormElement>("#account-form");
    const side = document.querySelector(".account-profile-side");
    expect(form).toBeTruthy();
    expect(side).toBeTruthy();
    expect(html).toContain("Public profile");
    expect(html).toContain("Payout &amp; donations");
    expect(html).toContain("account-profile-layout");
    expect(form?.querySelector("#username-input")).toBeTruthy();
    expect(form?.querySelector("#bio-input")).toBeTruthy();
    expect(form?.querySelector("#payout-input")).toBeTruthy();
    expect(form?.querySelector("#account-credit-public")).toBeTruthy();
    expect(form?.textContent).not.toMatch(/Connected accounts/);
    expect(form?.querySelector("#delete-account-btn")).toBeNull();
    expect(side?.textContent).toMatch(/Connected accounts/);
    expect(side?.querySelector("#delete-account-btn")).toBeTruthy();
    expect(side?.textContent).toMatch(/Keyholder keys/);
    expect(html).toContain("tag-input-more");
    expect(html).not.toContain(">Display<");
  });

  it("labels receive/payout destination and shows missing vs clear affordance", () => {
    const withAddr = accountProfilePaneHtml(
      user({
        id: "github:1",
        github: "alice",
        username: "alice",
        payout_address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      }),
      null,
    );
    expect(withAddr).toContain("Receive / payout destination");
    expect(withAddr).toContain("clear-payout-btn");
    expect(withAddr).toContain("Clear receive address");
    expect(withAddr).toMatch(/tb1/);

    const missing = accountProfilePaneHtml(
      user({
        id: "github:2",
        github: "bob",
        username: "bob",
      }),
      null,
    );
    expect(missing).toContain("payout-status");
    expect(missing).toMatch(/not set yet/i);
    expect(missing).not.toContain("clear-payout-btn");
  });
});
