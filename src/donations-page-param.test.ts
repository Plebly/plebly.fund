import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test" };
});

import { renderDonations } from "./donations-page";

/**
 * `?page=abc` used to give `Math.max(1, NaN) === NaN`: the ledger said
 * "Page NaN of N" and disabled both pager links (the Worker coerces
 * offset=NaN to 0, so page 1's rows were shown with no way forward).
 */
const fetchMock = vi.fn();
const app = () => document.querySelector<HTMLDivElement>("#app")!;
const row = {
  id: "don-1",
  amount_sats: 1000,
  target_type: "project",
  target_id: "PLEBLY-2026-003",
  target_label: "Relay hardening",
  donated_at: "2026-10-07T12:00:00Z",
  anonymous: true,
  donor_display: null,
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ donations: [row], total: 81 }), { status: 200 }),
  );
  document.body.innerHTML = `<div id="app"></div>`;
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("donations ?page parsing", () => {
  it.each(["abc", "Infinity", "1e999", "", "0"])("?page=%s falls back to page 1", async (raw) => {
    history.replaceState(null, "", `/donations?page=${raw}`);
    await renderDonations((inner) => inner);
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/donations?limit=40&offset=0");
    const pager = app().querySelector(".donations-pager")!;
    expect(pager.textContent).toContain("Page 1 of 3");
    expect(pager.textContent).not.toMatch(/NaN|Infinity/);
    const older = [...pager.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(older).toEqual([expect.stringMatching(/\/donations\?page=2$/)]);
  });

  it("a real page number still works (3.7 floors to 3)", async () => {
    history.replaceState(null, "", "/donations?page=3.7");
    await renderDonations((inner) => inner);
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/donations?limit=40&offset=80");
    expect(app().querySelector(".donations-pager")!.textContent).toContain("Page 3 of 3");
  });
});
