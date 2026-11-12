import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aboutTeamMembersHtml,
  bindAboutPage,
  keyholdersHtml,
  publicKeyholderStatus,
} from "./about-page";

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

describe("keyholdersHtml", () => {
  it("names stall seats and links Terms plus the dispute catalog", () => {
    const html = keyholdersHtml({
      escrow_mode: "3-of-5",
      keyholders: [],
      seats: 5,
      threshold: 3,
      min_seats: 3,
      target_seats: 5,
    });
    expect(html).toContain("which seats have not signed");
    expect(html).toContain("Plebly cannot move the coins");
    expect(html).toContain("/terms");
    expect(html).toContain("/keyholders");
    expect(html).not.toContain("tab=keyholders");
    expect(html).not.toContain("PSBT");
    expect(html).not.toContain("Dispute catalog");
    expect(html).not.toContain("on-chain");
  });

  it("never advertises signet single-key-test as a 1-of-1 product", () => {
    const html = keyholdersHtml({
      escrow_mode: "single-key-test",
      keyholders: [],
      seats: 0,
      threshold: 1,
      quorum: "1-of-1",
      min_seats: 2,
      target_seats: 5,
    });
    expect(html).toContain("3-of-5");
    expect(html).toContain("Need 2 seats (0 live)");
    expect(html).not.toContain("1-of-1");
    expect(html).not.toContain("temporary");
    expect(html).not.toContain("single-key");
  });

  it("exposes a single id=trust anchor for the signet caveat", () => {
    const html = keyholdersHtml({
      escrow_mode: "2-of-3",
      keyholders: [
        { github: "alice", xpub: "xpub1", fingerprint: "aaa" },
        { github: "bob", xpub: "xpub2", fingerprint: "bbb" },
        { github: "carol", xpub: "xpub3", fingerprint: "ccc" },
      ],
      seats: 3,
      threshold: 2,
      min_seats: 3,
      target_seats: 5,
    });
    expect(html.match(/id="trust"/g)?.length).toBe(1);
    expect(html).toContain("Keyholders are not yet independent of the operator");
    expect(html).toContain("Live <strong>2-of-3</strong>. Target 3-of-5.");
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
