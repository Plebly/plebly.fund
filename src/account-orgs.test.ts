import { describe, expect, it } from "vitest";
import { connectedAccountsHtml } from "./profile-pages";
import type { AuthUser } from "./auth";

function user(partial: Partial<AuthUser> & Pick<AuthUser, "id">): AuthUser {
  return {
    created_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("connectedAccountsHtml", () => {
  it("offers Link organizations when GitHub session has no orgs", () => {
    const html = connectedAccountsHtml(
      user({ id: "github:1", github: "alice" }),
    );
    expect(html).toContain("Connected accounts");
    expect(html).toContain("Organizations");
    expect(html).toContain("Link organizations");
    expect(html).toContain('id="link-github-orgs-btn"');
    expect(html).toContain("btn-compact");
    expect(html).toContain("org-access-hint");
    expect(html).not.toContain("Resync GitHub orgs");
  });

  it("shows Refresh when orgs are already linked", () => {
    const html = connectedAccountsHtml(
      user({
        id: "github:1",
        github: "alice",
        github_orgs: [
          {
            login: "bitcoindevkit",
            role: "admin",
            verified_at: new Date().toISOString(),
          },
        ],
      }),
    );
    expect(html).toContain("@bitcoindevkit");
    expect(html).toContain("Refresh from GitHub");
    expect(html).toContain("Unlink");
    expect(html).not.toContain("Link organizations");
  });

  it("explains GitHub login is required for org linking", () => {
    const html = connectedAccountsHtml(
      user({ id: "nostr:npub1abc", nostr: "npub1abc" }),
    );
    expect(html).toContain("Sign in with GitHub");
    expect(html).not.toContain('id="link-github-orgs-btn"');
  });
});
