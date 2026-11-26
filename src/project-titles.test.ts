import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test/" };
});

import { clearProjectTitlesCache, projectCatalogIds } from "./project-titles";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  clearProjectTitlesCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearProjectTitlesCache();
});

function catalogReply(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("projectCatalogIds", () => {
  it("returns null when a 200 response's proposals is not an array", async () => {
    for (const body of [{}, { proposals: "nope" }, { proposals: null }, { proposals: { id: "x" } }]) {
      clearProjectTitlesCache();
      catalogReply(body);
      expect(await projectCatalogIds()).toBeNull();
    }
  });

  it("treats a proposals array (including empty) as a loaded catalog", async () => {
    catalogReply({ proposals: [] });
    const empty = await projectCatalogIds();
    expect(empty).toBeInstanceOf(Set);
    expect(empty?.size).toBe(0);

    clearProjectTitlesCache();
    catalogReply({ proposals: [{ id: "PLEBLY-2026-003", title: "Relay hardening" }] });
    const ids = await projectCatalogIds();
    expect(ids).toEqual(new Set(["PLEBLY-2026-003"]));
  });
});
