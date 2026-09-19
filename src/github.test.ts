import { afterEach, describe, expect, it, vi } from "vitest";
import { clearListedProposalsCache, listListedProposals } from "./github";

describe("listed catalog cache", () => {
  afterEach(() => {
    clearListedProposalsCache();
    vi.unstubAllGlobals();
  });

  it("reuses the Worker catalog until cleared", async () => {
    let hits = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/proposals/catalog")) {
          hits += 1;
          return Response.json({
            proposals: [
              {
                id: "PLEBLY-1",
                path: "proposals/listed/PLEBLY-1.md",
                title: "One",
                status: "listed",
              },
            ],
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const first = await listListedProposals();
    const second = await listListedProposals();
    expect(hits).toBe(1);
    expect(first[0]?.id).toBe("PLEBLY-1");
    expect(second[0]?.id).toBe("PLEBLY-1");
    clearListedProposalsCache();
    await listListedProposals();
    expect(hits).toBe(2);
  });
});
