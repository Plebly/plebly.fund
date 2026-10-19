import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWanted, wantedEmptyHtml, wantedRowHtml } from "./wanted-page";
import { fundableWantedRows, type WantedRow } from "./builder";
import { wantedRailHtml } from "./home-page";
import { projectsHref } from "./router";

function row(
  partial: Partial<Parameters<typeof wantedRowHtml>[0]> = {},
): Parameters<typeof wantedRowHtml>[0] {
  return {
    id: "PLEBLY-2026-002",
    path: "proposals/claimable/wave-b.md",
    title: "[Wave B] Signet escrow+bonds 20260921",
    status: "claimable",
    watches: 0,
    weighted: 0,
    funded_pct: 305.9,
    ...partial,
  };
}

describe("wantedRowHtml", () => {
  it("always shows proposal id and status alongside title", () => {
    const a = wantedRowHtml(row());
    const b = wantedRowHtml(
      row({
        id: "PLEBLY-2026-003",
        status: "in_review",
        watches: 1,
        weighted: 1,
        funded_pct: 30.6,
      }),
    );

    expect(a).toContain("[Wave B] Signet escrow+bonds 20260921");
    expect(a).toContain("PLEBLY-2026-002");
    expect(a).toContain("Claimable");
    expect(a).toContain("pill-status");
    expect(a).toContain("Fully funded");
    expect(a).not.toContain("305.9%");

    expect(b).toContain("PLEBLY-2026-003");
    expect(b).toContain("In review");
    expect(b).toContain("30.6% funded");

    // Same title is fine; id+status distinguish the cards.
    expect(a).toContain("wanted-meta");
    expect(b).toContain("wanted-meta");
    expect(a).not.toEqual(b);
  });

  it("home rail omits the funded word suffix", () => {
    const html = wantedRowHtml(row({ funded_pct: 12 }), { fundedSuffix: false });
    expect(html).toContain(">12%<");
    expect(html).not.toContain("12% funded");
  });

  it("escapes title and id", () => {
    const html = wantedRowHtml(
      row({
        id: 'PLEBLY"><img',
        title: 'Evil <script>alert(1)</script>',
        status: "listed",
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("Evil &lt;script&gt;");
    expect(html).toContain("PLEBLY&quot;&gt;&lt;img");
  });

  it("omits id chip when id is null but still shows status", () => {
    const html = wantedRowHtml(row({ id: null as unknown as string }));
    expect(html).not.toContain("proposal-meta-id");
    expect(html).toContain("Claimable");
  });
});

const EMPTY_LINE = "Nothing is open for gifts right now.";

function apiRow(id: string, status: string, extra: Partial<WantedRow> = {}): WantedRow {
  return {
    id,
    path: `proposals/listed/${id}.md`,
    title: `Title ${id}`,
    status,
    watches: 1,
    weighted: 1,
    funded_pct: 0,
    balance_sats: 0,
    target_sats: 100_000,
    cover_image: null,
    excerpt: "",
    ...extra,
  };
}

/** Live /wanted order before workers#114 (2026-10-17). */
const LIVE_ROWS = [
  apiRow("PLEBLY-2026-005", "voided"),
  apiRow("PLEBLY-KNOTS-SIZE-VALUE-SPAM", "listed"),
  apiRow("PLEBLY-2026-009", "in_review"),
  apiRow("PLEBLY-2026-007", "bounty_settled"),
  apiRow("PLEBLY-2026-006", "in_review"),
  apiRow("PLEBLY-2026-004", "voided"),
];

describe("fundableWantedRows", () => {
  it("drops voided, settled and in-review rows and keeps fundable ones in order", () => {
    const rows = [
      ...LIVE_ROWS,
      apiRow("open2", "funding"),
      apiRow("open3", "claimable"),
      apiRow("open4", "declined_fundable"),
      apiRow("closedflag", "listed", { accepting_funds: false }),
      apiRow("declined", "declined"),
      apiRow("done", "completed"),
    ];
    expect(fundableWantedRows(rows).map((r) => r.id)).toEqual([
      "PLEBLY-KNOTS-SIZE-VALUE-SPAM",
      "open2",
      "open3",
      "open4",
    ]);
  });
});

describe("wanted empty state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("empty line links to all proposals", () => {
    document.body.innerHTML = wantedEmptyHtml();
    expect(document.body.textContent).toContain(EMPTY_LINE);
    const a = document.body.querySelector("a")!;
    expect(a.getAttribute("href")).toBe(projectsHref());
  });

  it("home rail: empty list shows the line; fundable rows render without it", () => {
    document.body.innerHTML = wantedRailHtml([]);
    expect(document.body.textContent).toContain(EMPTY_LINE);
    expect(document.body.querySelector(`a[href="${projectsHref()}"]`)).not.toBeNull();
    document.body.innerHTML = wantedRailHtml([apiRow("PLEBLY-KNOTS-SIZE-VALUE-SPAM", "listed")]);
    expect(document.body.textContent).not.toContain(EMPTY_LINE);
    expect(document.body.innerHTML).toContain("PLEBLY-KNOTS-SIZE-VALUE-SPAM");
  });

  it("home rail: 'Full list →' only when the rail has rows", () => {
    document.body.innerHTML = wantedRailHtml([]);
    expect(document.body.textContent).not.toContain("Full list");
    expect(document.body.querySelector('.rail-head a[href$="/wanted"]')).toBeNull();
    document.body.innerHTML = wantedRailHtml([apiRow("PLEBLY-KNOTS-SIZE-VALUE-SPAM", "listed")]);
    expect(document.body.textContent).toContain("Full list →");
    expect(document.body.querySelector('.rail-head a[href$="/wanted"]')).not.toBeNull();
  });

  async function renderWith(rows: WantedRow[]) {
    document.body.innerHTML = `<div id="app"></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ proposals: rows })),
    );
    await renderWanted((inner) => inner);
    return document.querySelector("#wanted-full")!;
  }

  it("/wanted page against the live API order: only KNOTS, no closed rows", async () => {
    const host = await renderWith(LIVE_ROWS);
    expect(host.textContent).toContain("PLEBLY-KNOTS-SIZE-VALUE-SPAM");
    for (const id of ["PLEBLY-2026-005", "PLEBLY-2026-009", "PLEBLY-2026-007", "PLEBLY-2026-006", "PLEBLY-2026-004"]) {
      expect(host.textContent).not.toContain(id);
    }
    expect(host.textContent).not.toContain(EMPTY_LINE);
  });

  it("/wanted page with only closed rows shows the empty line", async () => {
    const host = await renderWith(LIVE_ROWS.filter((r) => r.status !== "listed"));
    expect(host.textContent).toContain(EMPTY_LINE);
    expect(host.querySelector(`a[href="${projectsHref()}"]`)).not.toBeNull();
    expect(host.querySelectorAll(".wanted-row")).toHaveLength(0);
  });
});
