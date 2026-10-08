import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STALE_BUILD_MESSAGE,
  installStaleChunkReload,
  isChunkLoadError,
} from "./stale-chunk";

const EXACT = "Plebly was updated while this tab was open. Reload to continue.";
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

  it("Vite's vite:preloadError shows the same prompt and is prevented (no throw)", () => {
    const ev = new Event("vite:preloadError", { cancelable: true });
    Object.defineProperty(ev, "payload", { value: new Error("Unable to preload CSS for /assets/a.css") });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(app().textContent).toContain(EXACT);
    expect(app().textContent).not.toContain("Unable to preload");
  });

  it("a second failure does not stack prompts", () => {
    window.dispatchEvent(rejection(new TypeError(RAW)));
    window.dispatchEvent(rejection(new TypeError("Importing a module script failed.")));
    expect(app().querySelectorAll("[data-stale-build]")).toHaveLength(1);
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
