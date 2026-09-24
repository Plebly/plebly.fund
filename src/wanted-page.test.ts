import { describe, expect, it } from "vitest";
import { wantedRowHtml } from "./wanted-page";

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
    expect(a).toContain("305.9% funded");

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
