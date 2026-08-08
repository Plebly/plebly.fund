import { afterEach, describe, expect, it, vi } from "vitest";
import { aboutTeamMembersHtml, bindAboutPage, publicKeyholderStatus } from "./about-page";

describe("aboutTeamMembersHtml", () => {
  it("links members to Plebly /u profiles", () => {
    const html = aboutTeamMembersHtml([
      { login: "alice", avatar_url: "https://example.com/a.png" },
      { login: "bob", avatar_url: "" },
    ]);
    expect(html).toContain("/u/alice");
    expect(html).toContain("/u/bob");
    expect(html).toContain(">alice<");
    expect(html).not.toContain("github.com/alice");
  });

  it("shows empty copy when there are no members", () => {
    expect(aboutTeamMembersHtml([])).toContain("No public members");
  });
});

describe("publicKeyholderStatus", () => {
  it("hides pre-launch ops status on the public About page", () => {
    expect(
      publicKeyholderStatus(
        "roster + descriptor still TBD (human publish).",
        false,
        false,
      ),
    ).toBeNull();
  });

  it("hides status once roster is published", () => {
    expect(
      publicKeyholderStatus("Published.", true, false),
    ).toBeNull();
  });
});

describe("bindAboutPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("marks the matching TOC link active from the current hash", () => {
    document.body.innerHTML = `
      <section class="about-page">
        <nav class="about-toc">
          <a class="about-toc-link" href="#beliefs">Beliefs</a>
          <a class="about-toc-link" href="#keyholders">Keyholders</a>
        </nav>
        <section class="about-section" id="beliefs"><h2>Beliefs</h2></section>
        <section class="about-section" id="keyholders"><h2>Keyholders</h2></section>
      </section>
    `;

    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    );

    history.replaceState(null, "", "#keyholders");
    const cleanup = bindAboutPage(document);
    const active = document.querySelector(".about-toc-link.is-active");
    expect(active?.getAttribute("href")).toBe("#keyholders");
    expect(active?.getAttribute("aria-current")).toBe("true");
    cleanup();
    history.replaceState(null, "", "/");
  });
});
