import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SITE_NAV_ID,
  bindMobileNav,
  mobileNavToggleHtml,
} from "./nav-menu";

function mountHeader(): HTMLElement {
  document.body.innerHTML = `
    <header class="site-header">
      ${mobileNavToggleHtml()}
      <div class="header-end" id="${SITE_NAV_ID}">
        <nav class="nav">
          <a href="/about">About</a>
          <details class="login-menu">
            <summary>Log in</summary>
            <div class="login-menu-panel">
              <a href="/auth/github">Continue with GitHub</a>
              <button type="button" data-nostr-login>Continue with Nostr</button>
            </div>
          </details>
          <button type="button" class="link-btn" id="logout-btn">Log out</button>
        </nav>
      </div>
    </header>
    <main>page</main>
  `;
  bindMobileNav();
  return document.querySelector(".site-header")!;
}

describe("mobile nav pancake", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a pancake toggle that controls site-nav", () => {
    const html = mobileNavToggleHtml();
    expect(html).toContain('class="nav-toggle"');
    expect(html).toContain(`aria-controls="${SITE_NAV_ID}"`);
    expect(html).toContain("nav-toggle-pancake");
    expect(html).toContain("Open menu");
  });

  it("opens and closes the header drawer", () => {
    const header = mountHeader();
    const btn = header.querySelector<HTMLButtonElement>(".nav-toggle")!;
    expect(header.classList.contains("is-nav-open")).toBe(false);
    btn.click();
    expect(header.classList.contains("is-nav-open")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-label")).toBe("Close menu");
    btn.click();
    expect(header.classList.contains("is-nav-open")).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when a primary nav link is chosen", () => {
    const header = mountHeader();
    header.querySelector<HTMLButtonElement>(".nav-toggle")!.click();
    header.querySelector<HTMLAnchorElement>('a[href="/about"]')!.click();
    expect(header.classList.contains("is-nav-open")).toBe(false);
  });

  it("closes on log out, not on Log in summary", () => {
    const header = mountHeader();
    const btn = header.querySelector<HTMLButtonElement>(".nav-toggle")!;
    btn.click();
    header.querySelector("summary")!.click();
    expect(header.classList.contains("is-nav-open")).toBe(true);
    header.querySelector<HTMLButtonElement>("#logout-btn")!.click();
    expect(header.classList.contains("is-nav-open")).toBe(false);
  });

  it("closes on outside click and Escape", () => {
    const header = mountHeader();
    header.querySelector<HTMLButtonElement>(".nav-toggle")!.click();
    document.querySelector("main")!.click();
    expect(header.classList.contains("is-nav-open")).toBe(false);

    header.querySelector<HTMLButtonElement>(".nav-toggle")!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(header.classList.contains("is-nav-open")).toBe(false);
  });
});
