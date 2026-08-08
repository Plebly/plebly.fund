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
  it("offers Add organization when GitHub session has no orgs", () => {
    const html = connectedAccountsHtml(
      user({ id: "github:1", github: "alice" }),
    );
    expect(html).toContain("Connected accounts");
    expect(html).toContain("Organizations");
    expect(html).toContain("Add organization");
    expect(html).toContain('id="link-github-orgs-btn"');
    expect(html).toContain("btn-compact");
    expect(html).toContain("org-access-hint");
    expect(html).toMatch(/apply or propose/i);
    expect(html).not.toContain("Resync GitHub orgs");
  });

  it("lists linked orgs and sends Add organization to GitHub grant page", () => {
    const html = connectedAccountsHtml(
      user({
        id: "github:1",
        github: "alice",
        github_orgs: [
          {
            login: "plebly",
            name: "Plebly",
            role: "admin",
            verified_at: new Date().toISOString(),
          },
        ],
      }),
    );
    expect(html).toContain("Plebly");
    expect(html).not.toContain(">plebly<");
    expect(html).not.toContain("@plebly");
    expect(html).toContain("account-org-card");
    expect(html).toContain("account-org-grid");
    expect(html).toContain("section-title");
    expect(html).toContain("Organizations · 1 linked");
    expect(html).toContain('id="add-org-grant-link"');
    expect(html).toContain("Sync from GitHub");
    expect(html).toContain('id="sync-github-orgs-btn"');
    expect(html).not.toContain('id="link-github-orgs-btn"');
    expect(html).toContain("Unlink");
    expect(html).toContain('aria-label="Linked GitHub organizations"');
    expect(html).toMatch(/apply or propose/i);
  });

  it("explains GitHub login is required for org linking", () => {
    const html = connectedAccountsHtml(
      user({ id: "nostr:npub1abc", nostr: "npub1abc" }),
    );
    expect(html).toContain("Sign in with GitHub");
    expect(html).not.toContain('id="link-github-orgs-btn"');
  });
});
