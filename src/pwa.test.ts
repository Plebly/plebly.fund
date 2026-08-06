import { afterEach, describe, expect, it, vi } from "vitest";
import { applyStandaloneClass, isStandalonePwa } from "./pwa";

describe("pwa helpers", () => {
  afterEach(() => {
    document.documentElement.classList.remove("pwa-standalone");
    vi.restoreAllMocks();
  });

  it("detects standalone display-mode", () => {
    vi.stubGlobal(
      "matchMedia",
      (q: string) =>
        ({
          matches: q.includes("standalone"),
          media: q,
          addEventListener() {},
          removeEventListener() {},
        }) as MediaQueryList,
    );
    expect(isStandalonePwa()).toBe(true);
    applyStandaloneClass();
    expect(document.documentElement.classList.contains("pwa-standalone")).toBe(
      true,
    );
  });
});
