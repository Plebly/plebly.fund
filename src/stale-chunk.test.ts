import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STALE_BUILD_MESSAGE,
  STALE_BUILD_OFFLINE_MESSAGE,
  installStaleChunkReload,
  isChunkLoadError,
} from "./stale-chunk";

const EXACT = "Plebly was updated while this tab was open. Reload to continue.";
const OFFLINE = "You're offline. Reconnect, then reload.";
const RAW = "Failed to fetch dynamically imported module: https://signet.plebly.fund/assets/profile-pages-Ab12Cd.js";

function rejection(reason: unknown): Event {
  const ev = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(ev, "reason", { value: reason });
  return ev;
}

const app = () => document.querySelector<HTMLDivElement>("#app")!;
let reload: ReturnType<typeof vi.fn>;
let uninstall: () => void;

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><p class="loading">Loading…</p></div>`;
  reload = vi.fn();
  uninstall = installStaleChunkReload(window, reload);
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("isChunkLoadError", () => {
  it.each([
    ["Chrome", new TypeError(RAW)],
    ["Safari", new TypeError("Importing a module script failed.")],
    ["Firefox", new TypeError("error loading dynamically imported module: https://x/a.js")],
    ["Vite CSS preload", new Error("Unable to preload CSS for /assets/a.css")],
    ["webpack-style name", Object.assign(new Error("x"), { name: "ChunkLoadError" })],
    ["plain string", "Failed to fetch dynamically imported module: /a.js"],
  ])("%s → true", (_n, err) => {
    expect(isChunkLoadError(err)).toBe(true);
  });

  it.each([
    ["generic", new Error("boom")],
    ["network fetch", new TypeError("Failed to fetch")],
    ["null", null],
    ["undefined", undefined],
  ])("%s → false", (_n, err) => {
    expect(isChunkLoadError(err)).toBe(false);
  });
});

describe("installStaleChunkReload", () => {
  it("uses the exact copy", () => {
    expect(STALE_BUILD_MESSAGE).toBe(EXACT);
  });

  it("an unhandled chunk-load rejection replaces the view with the exact line and a Reload button, never the raw error", () => {
    const ev = rejection(new TypeError(RAW));
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const text = app().textContent!.replace(/\s+/g, " ").trim();
    expect(text).toBe(`${EXACT} Reload`);
    expect(app().innerHTML).not.toContain("Failed to fetch");
    expect(app().innerHTML).not.toContain("profile-pages");
    expect(app().innerHTML).not.toContain("TypeError");
    expect(app().querySelector(".loading")).toBeNull();
    const btn = app().querySelector<HTMLButtonElement>("button[data-stale-reload]")!;
    expect(btn.textContent).toBe("Reload");
    expect(app().querySelector("[role=alert]")).not.toBeNull();
  });

  it("Reload reloads the page", () => {
    window.dispatchEvent(rejection(new TypeError(RAW)));
    app().querySelector<HTMLButtonElement>("[data-stale-reload]")!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("Vite's vite:preloadError shows the same prompt and is not prevented (the import still rejects)", () => {
    const ev = new Event("vite:preloadError", { cancelable: true });
    Object.defineProperty(ev, "payload", { value: new Error("Unable to preload CSS for /assets/a.css") });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(app().textContent).toContain(EXACT);
    expect(app().textContent).not.toContain("Unable to preload");
  });

  it("a second failure does not stack prompts", () => {
    window.dispatchEvent(rejection(new TypeError(RAW)));
    window.dispatchEvent(rejection(new TypeError("Importing a module script failed.")));
    expect(document.querySelectorAll("[data-stale-build]")).toHaveLength(1);
    app().querySelector<HTMLButtonElement>("[data-stale-reload]")!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("other unhandled rejections are left alone (view untouched, not prevented)", () => {
    const ev = rejection(new Error("boom"));
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(app().querySelector(".loading")).not.toBeNull();
    expect(app().textContent).not.toContain(EXACT);
  });

  it("uninstall stops listening", () => {
    uninstall();
    window.dispatchEvent(rejection(new TypeError(RAW)));
    expect(app().textContent).not.toContain(EXACT);
    uninstall = () => {};
  });
});

/** A rendered page: site header + a form the user is typing into. */
function renderPageWithInput(): HTMLInputElement {
  document.body.innerHTML = `<div id="app">
    <header class="site-header"><a href="/">Plebly</a></header>
    <main id="main-content">
      <section class="detail"><h1>Propose</h1>
        <form><label>Title <input id="typed" name="title" /></label></form>
      </section>
    </main>
  </div>`;
  const input = document.querySelector<HTMLInputElement>("#typed")!;
  input.value = "My half-written proposal";
  input.focus();
  return input;
}

const prompts = () => document.querySelectorAll("[data-stale-build]");
const banner = () => document.querySelector<HTMLElement>(".stale-build-banner");

describe("stale build prompt keeps a live page (UI UX hold)", () => {
  it("a page with content keeps its view and typed input; the prompt is a fixed banner on top", () => {
    const input = renderPageWithInput();
    const before = app().innerHTML;
    window.dispatchEvent(rejection(new TypeError(RAW)));
    // Same element, same value, view markup untouched.
    expect(document.querySelector("#typed")).toBe(input);
    expect(input.value).toBe("My half-written proposal");
    expect(app().innerHTML).toBe(before);
    expect(app().querySelector("h1")?.textContent).toBe("Propose");
    // One banner, outside #app, exact line + Reload, never the raw error.
    expect(prompts()).toHaveLength(1);
    const b = banner()!;
    expect(b).not.toBeNull();
    expect(app().contains(b)).toBe(false);
    expect(b.getAttribute("role")).toBe("alert");
    expect(b.textContent!.replace(/\s+/g, " ").trim()).toBe(`${EXACT} Reload`);
    expect(document.body.innerHTML).not.toContain("Failed to fetch");
    expect(document.body.innerHTML).not.toContain("profile-pages");
  });

  it("a 'Loading…' placeholder plus a filled form is not an empty view: banner, input kept", () => {
    document.body.innerHTML = `<div id="app">
      <header class="site-header"><a href="/">Plebly</a></header>
      <main id="main-content">
        <div id="ballot-status"><p class="muted">Loading…</p></div>
        <form><label>Note <input id="typed" name="note" /></label></form>
      </main>
    </div>`;
    const input = document.querySelector<HTMLInputElement>("#typed")!;
    input.value = "typed while a panel was still loading";
    const before = app().innerHTML;
    window.dispatchEvent(rejection(new TypeError(RAW)));
    expect(document.querySelector("#typed")).toBe(input);
    expect(input.value).toBe("typed while a panel was still loading");
    expect(app().innerHTML).toBe(before);
    expect(banner()).not.toBeNull();
    expect(prompts()).toHaveLength(1);
  });

  it.each([
    ["input", `<input id="typed" />`],
    ["textarea", `<textarea id="typed"></textarea>`],
  ])("'Loading…' plus an unlabelled %s with a typed value (no other text): banner, value kept", (_n, field) => {
    document.body.innerHTML = `<div id="app"><main id="main-content"><p class="loading">Loading…</p>${field}</main></div>`;
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>("#typed")!;
    el.value = "half-written";
    window.dispatchEvent(rejection(new TypeError(RAW)));
    expect(document.querySelector("#typed")).toBe(el);
    expect(el.value).toBe("half-written");
    expect(banner()).not.toBeNull();
    expect(prompts()).toHaveLength(1);
  });

  it.each([
    ["placeholder first", `<p class="muted">Loading…</p><section><h1>Bounty 42</h1><p>Escrow funded.</p></section>`],
    ["placeholder after content", `<section><h1>Bounty 42</h1><p>Escrow funded.</p></section><p class="muted">Loading…</p>`],
  ])("a 'Loading…' placeholder next to rendered content (%s) is not an empty view: banner, view kept", (_n, inner) => {
    document.body.innerHTML = `<div id="app"><main id="main-content">${inner}</main></div>`;
    const before = app().innerHTML;
    window.dispatchEvent(rejection(new TypeError(RAW)));
    expect(app().innerHTML).toBe(before);
    expect(banner()).not.toBeNull();
    expect(prompts()).toHaveLength(1);
  });

  it("the banner's Reload reloads", () => {
    renderPageWithInput();
    window.dispatchEvent(rejection(new TypeError(RAW)));
    banner()!.querySelector<HTMLButtonElement>("[data-stale-reload]")!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the banner is fixed to the top in CSS", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "style.css"), "utf8");
    const rule = css.match(/\.stale-build-banner\s*\{([^}]*)\}/);
    expect(rule, ".stale-build-banner rule").not.toBeNull();
    expect(rule![1]).toMatch(/position:\s*fixed/);
    expect(rule![1]).toMatch(/top:\s*0/);
  });

  it.each([
    ["empty", ""],
    ["Loading…", `<section class="wrap-wide detail"><p class="loading">Loading…</p></section>`],
  ])("a %s view is replaced by the prompt (header kept, no banner)", (_n, inner) => {
    document.body.innerHTML = `<div id="app"><header class="site-header"><a href="/">Plebly</a></header><main id="main-content">${inner}</main></div>`;
    window.dispatchEvent(rejection(new TypeError(RAW)));
    const main = document.querySelector("#main-content")!;
    expect(main.querySelector("[data-stale-build]")).not.toBeNull();
    expect(main.textContent!.replace(/\s+/g, " ").trim()).toBe(`${EXACT} Reload`);
    expect(document.querySelector(".site-header")).not.toBeNull();
    expect(banner()).toBeNull();
    expect(prompts()).toHaveLength(1);
  });

  it.each([
    ["banner", () => void renderPageWithInput()],
    ["replaced view", () => {}],
  ])("offline (%s): shows the offline line, not the deploy line", (_n, setup) => {
    setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(rejection(new TypeError(RAW)));
    expect(STALE_BUILD_OFFLINE_MESSAGE).toBe(OFFLINE);
    const p = prompts()[0] as HTMLElement;
    expect(p.textContent!.replace(/\s+/g, " ").trim()).toBe(`${OFFLINE} Reload`);
    expect(document.body.textContent).not.toContain("was updated");
  });

  it("online shows the deploy line (onLine true)", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(rejection(new TypeError(RAW)));
    expect(app().textContent).toContain(EXACT);
    expect(app().textContent).not.toContain("offline");
  });

  it.each([
    ["banner", () => void renderPageWithInput()],
    ["replaced view", () => {}],
  ])("focus moves to Reload (%s)", (_n, setup) => {
    setup();
    window.dispatchEvent(rejection(new TypeError(RAW)));
    const btn = document.querySelector<HTMLButtonElement>("[data-stale-reload]")!;
    expect(document.activeElement).toBe(btn);
  });

  it.each([
    ["banner", () => void renderPageWithInput()],
    ["replaced view", () => {}],
  ])("two errors give one prompt (%s), and one reload per click", (_n, setup) => {
    setup();
    window.dispatchEvent(rejection(new TypeError(RAW)));
    const ev = new Event("vite:preloadError", { cancelable: true });
    Object.defineProperty(ev, "payload", { value: new Error("Unable to preload CSS for /assets/a.css") });
    window.dispatchEvent(ev);
    window.dispatchEvent(rejection(new TypeError("Importing a module script failed.")));
    expect(prompts()).toHaveLength(1);
    expect(document.querySelectorAll("[data-stale-reload]")).toHaveLength(1);
    document.querySelector<HTMLButtonElement>("[data-stale-reload]")!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
