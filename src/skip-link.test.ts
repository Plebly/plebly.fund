import { afterEach, describe, expect, it } from "vitest";
import { bindSkipLink, focusMainContent } from "./skip-link";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("skip link", () => {
  it("focuses #main-content and does not leave focus on the link", () => {
    document.body.innerHTML = `
      <a class="skip-link" href="#main-content">Skip to content</a>
      <div id="app">
        <header><a href="/">Plebly</a></header>
        <main id="main-content"><p>Hello</p></main>
      </div>
    `;
    bindSkipLink();
    const main = document.getElementById("main-content")!;
    const link = document.querySelector<HTMLAnchorElement>("a.skip-link")!;
    expect(document.querySelectorAll("a.skip-link")).toHaveLength(1);
    expect(main.getAttribute("tabindex")).toBe("-1");
    link.focus();
    link.click();
    expect(document.activeElement).toBe(main);
  });

  it("focusMainContent is a no-op without main", () => {
    document.body.innerHTML = `<a class="skip-link" href="#main-content">Skip to content</a>`;
    expect(() => focusMainContent()).not.toThrow();
  });
});
