import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openShareMenu,
  prefersNativeShare,
  shareDestinations,
} from "./share-menu";

describe("shareDestinations", () => {
  it("builds X, Reddit, and HN intents", () => {
    const dest = shareDestinations({
      title: "Demo",
      text: "Demo: fund open Bitcoin work on Plebly",
      url: "https://plebly.fund/p/PLEBLY-1",
    });
    expect(dest.x).toContain("x.com/intent/post");
    expect(dest.reddit).toContain("reddit.com/submit");
    expect(dest.hn).toContain("news.ycombinator.com/submitlink");
  });
});

describe("prefersNativeShare", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false without navigator.share", () => {
    vi.stubGlobal("navigator", { share: undefined, userAgent: "Mozilla" });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    expect(prefersNativeShare()).toBe(false);
  });

  it("is true on coarse-pointer devices with share", () => {
    vi.stubGlobal("navigator", {
      share: vi.fn(),
      canShare: () => true,
      userAgent: "Mozilla",
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });
    expect(prefersNativeShare()).toBe(true);
  });
});

describe("openShareMenu", () => {
  afterEach(() => {
    document.querySelectorAll(".share-menu-modal").forEach((el) => el.remove());
  });

  it("renders a desktop share sheet", async () => {
    const pending = openShareMenu({
      title: "Demo",
      text: "Demo text",
      url: "https://plebly.fund/p/PLEBLY-1",
    });
    const modal = document.querySelector(".share-menu-modal");
    expect(modal).toBeTruthy();
    expect(modal?.textContent).toContain("Copy link");
    expect(modal?.innerHTML).toContain("fa-reddit");
    document
      .querySelector<HTMLButtonElement>("[data-share-close]")
      ?.click();
    await pending;
    expect(document.querySelector(".share-menu-modal")).toBeNull();
  });
});
