import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gh = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return { ...actual, listAllPublicProposals: gh.list };
});

import { archiveHref, renderArchive } from "./archive-page";
import type { Proposal } from "./types";

const p = (id: string, status: string, over: Partial<Proposal> = {}): Proposal =>
  ({
    id,
    path: `proposals/listed/${id}.md`,
    title: `Title ${id}`,
    status,
    proposal_type: "bounty",
    target_sats: 10_000,
    escrow_address: null,
    created_at: "2026-10-01T00:00:00Z",
    milestones: [],
    body: "",
    ...over,
  }) as Proposal;

const ALL = [
  p("PLEBLY-2026-001", "completed", { claimer: "@alice" }),
  p("PLEBLY-2026-004", "completed", { target_sats: undefined }),
  p("PLEBLY-2026-002", "declined", { claimer: "bob" }),
  p("PLEBLY-2026-005", "declined_fundable"),
  p("PLEBLY-2026-006", "listed"),
  p("PLEBLY-2026-007", "listed", { path: "proposals/declined/PLEBLY-2026-007.md" }),
];

const shell = (inner: string) => `<main data-shell>${inner}</main>`;
const app = () => document.querySelector<HTMLDivElement>("#app")!;
const rowIds = () =>
  [...app().querySelectorAll(".declined-row .mono")].map((el) => el.textContent);
const counts = () =>
  [...app().querySelectorAll(".account-tab")].map((a) => ({
    text: a.textContent!.replace(/\s+/g, " ").trim(),
    active: a.classList.contains("active"),
    current: a.getAttribute("aria-current"),
  }));

beforeEach(() => {
  document.body.innerHTML = `<div id="app"></div>`;
  history.replaceState(null, "", "/archive");
  gh.list.mockReset();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("archiveHref", () => {
  it("completed is the bare /archive; declined carries ?tab=declined", () => {
    expect(archiveHref()).toMatch(/\/archive$/);
    expect(archiveHref("completed")).toMatch(/\/archive$/);
    expect(archiveHref("declined")).toMatch(/\/archive\?tab=declined$/);
  });
});

describe("renderArchive", () => {
  it("completed tab: completed rows newest id first, with claimer and target; counts on both tabs", async () => {
    gh.list.mockResolvedValue(ALL);
    await renderArchive(shell);
    expect(app().querySelector("[data-shell] h1")!.textContent).toBe("Archive");
    expect(rowIds()).toEqual(["PLEBLY-2026-004", "PLEBLY-2026-001"]);
    const rows = [...app().querySelectorAll(".declined-row")];
    expect(rows[1]!.textContent).toContain("Claimed by @alice");
    expect(rows[1]!.textContent).toContain("Target 10,000 sats");
    expect(rows[0]!.textContent).toContain("Target —");
    expect(rows[0]!.textContent).not.toContain("Claimed by");
    expect(counts()).toEqual([
      { text: "Completed 2", active: true, current: "page" },
      { text: "Declined 3", active: false, current: null },
    ]);
    expect(app().querySelector(".lede")!.textContent).toBe(
      "Finished projects kept for public record (2). Discussion is read-only.",
    );
  });

  it("declined tab: declined, declined_fundable and /declined/ paths; no claimer line", async () => {
    gh.list.mockResolvedValue(ALL);
    await renderArchive(shell, "declined");
    expect(rowIds()).toEqual(["PLEBLY-2026-007", "PLEBLY-2026-005", "PLEBLY-2026-002"]);
    expect(app().textContent).not.toContain("Claimed by");
    expect(counts()[1]).toEqual({ text: "Declined 3", active: true, current: "page" });
    expect(app().querySelector(".lede")!.textContent).toBe(
      "Closed or declined listings kept for public record (3).",
    );
  });

  it("listed rows never appear in the archive", async () => {
    gh.list.mockResolvedValue(ALL);
    await renderArchive(shell);
    expect(app().textContent).not.toContain("PLEBLY-2026-006");
    await renderArchive(shell, "declined");
    expect(app().textContent).not.toContain("PLEBLY-2026-006");
  });

  it.each([
    ["completed", "No completed projects yet"],
    ["declined", "No declined proposals yet"],
  ] as const)("%s tab with no rows shows its empty state", async (tab, title) => {
    gh.list.mockResolvedValue([p("PLEBLY-2026-006", "listed")]);
    await renderArchive(shell, tab);
    expect(app().querySelector(".empty-state-title")!.textContent).toBe(title);
    expect(app().querySelector(".declined-list")).toBeNull();
  });

  it("a load failure says so and drops the tab counts", async () => {
    gh.list.mockRejectedValue(new Error("rate limited"));
    await renderArchive(shell);
    expect(app().textContent).toContain("Could not load archive.");
    expect(app().querySelector(".account-tab-count")).toBeNull();
    expect(app().querySelector(".empty-state")).toBeNull();
  });

  it("links each row to its stable proposal page and escapes titles", async () => {
    gh.list.mockResolvedValue([
      p("PLEBLY-2026-001", "completed", { title: '<img src=x onerror="alert(1)">', claimer: "<b>x</b>" }),
    ]);
    await renderArchive(shell);
    const row = app().querySelector(".declined-row")!;
    expect(row.querySelector("img, b")).toBeNull();
    expect(row.querySelector("a")!.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(row.querySelector("a")!.getAttribute("href")).toMatch(/\/p\/plebly-2026-001$/);
  });

  it.each([
    ["/completed", "completed", /\/archive$/],
    ["/declined", "declined", /\/archive\?tab=declined$/],
  ] as const)("legacy %s URL is rewritten in place to the archive tab", async (path, tab, want) => {
    history.replaceState(null, "", path);
    gh.list.mockResolvedValue(ALL);
    await renderArchive(shell, tab);
    expect(location.pathname + location.search).toMatch(want);
  });

  it("leaves a non-legacy URL alone", async () => {
    history.replaceState(null, "", "/archive?tab=declined&x=1");
    gh.list.mockResolvedValue(ALL);
    await renderArchive(shell, "declined");
    expect(location.search).toBe("?tab=declined&x=1");
  });
});
