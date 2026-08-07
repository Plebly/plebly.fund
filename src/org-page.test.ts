import { describe, expect, it } from "vitest";
import { orgProfileShellHtml, type PublicOrg } from "./org-page";
import { orgHref, parseLocation, seoForRoute } from "./router";
import { claimerIdentityHtml } from "./builder-panel";

describe("org routing", () => {
  it("parses /org/:login and builds href", () => {
    expect(parseLocation("/org/Acme", "")).toEqual({
      name: "org",
      login: "acme",
    });
    expect(orgHref("@Acme")).toBe("/org/acme");
    const seo = seoForRoute({ name: "org", login: "acme" });
    expect(seo.path).toBe("/org/acme");
    expect(seo.title).toMatch(/org/i);
  });
});

describe("org profile HTML", () => {
  const org: PublicOrg = {
    login: "acme",
    avatar_url: "https://avatars.example/acme",
    html_url: "https://github.com/acme",
    name: "Acme",
    description: "Builders",
    public_members: [
      { login: "alice", avatar_url: "https://avatars.example/alice" },
    ],
    synced_at: new Date().toISOString(),
    claim_summary: {
      active: 0,
      completed: 1,
      expired: 0,
      rejected: 0,
      abandoned: 0,
    },
  };

  it("shows members, avatar, header layout, and Resync only for admins", () => {
    const admin = orgProfileShellHtml(org, true);
    expect(admin).toContain("org-profile-header");
    expect(admin).toContain("org-profile-avatar-img");
    expect(admin).toContain("avatars.example/acme");
    expect(admin).toContain(">alice<");
    expect(admin).not.toContain("@alice");
    expect(admin).toContain("/u/alice");
    expect(admin).not.toContain("github.com/alice");
    expect(admin).toContain("<h1>acme</h1>");
    expect(admin).toContain("org-resync-btn");
    expect(admin).toContain("Claims done 1");
    expect(admin).toContain("GitHub org");

    const publicView = orgProfileShellHtml(org, false);
    expect(publicView).not.toContain("org-resync-btn");
    expect(publicView).toContain("/u/alice");
  });
});

describe("claimerIdentityHtml", () => {
  it("links orgs to /org and individuals to /u", () => {
    const org = claimerIdentityHtml("acme", "org", "alice");
    expect(org).toContain("/org/acme");
    expect(org).toContain("data-avatar-org=\"acme\"");
    expect(org).toContain("github.com/alice");

    const user = claimerIdentityHtml("bob", "individual");
    expect(user).toContain("/u/bob");
    expect(user).toContain("data-avatar-user=\"bob\"");
  });
});
