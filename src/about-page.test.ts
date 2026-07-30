import { afterEach, describe, expect, it, vi } from "vitest";
import { bindAboutPage } from "./about-page";

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
