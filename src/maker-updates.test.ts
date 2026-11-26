import { describe, expect, it } from "vitest";
import {
  makerUpdateHeading,
  makerUpdateRailHtml,
  makerUpdateRemoveLabel,
  makerUpdateSideLabel,
  makerUpdatesHtml,
  summarizeUpdateLatest,
  visibleMakerFeed,
  type MakerUpdateFeedItem,
} from "./maker-updates";

const item = (id: string, title: string): MakerUpdateFeedItem => ({
  id: `u-${id}`,
  proposal_id: id,
  proposal_path: `proposals/listed/${id}.md`,
  title,
  excerpt: "Progress on the work.",
  author: "writer",
  created_at: "2026-11-25T00:00:00.000Z",
});

describe("maker update rail", () => {
  it("hides an empty rail", () => {
    expect(makerUpdateRailHtml([])).toBe("");
  });

  it("drops ids the home feed already hides", () => {
    const hidden = new Set(["PLEBLY-2026-010"]);
    const visible = visibleMakerFeed(
      [item("PLEBLY-2026-010", "Hidden"), item("PLEBLY-2026-003", "Shown")],
      (id) => hidden.has(id),
    );
    expect(visible.map((row) => row.title)).toEqual(["Shown"]);
    expect(makerUpdateRailHtml(visible)).toContain("Shown");
    expect(makerUpdateRailHtml(visible)).toContain("PLEBLY-2026-003");
    expect(makerUpdateRailHtml(visible)).toContain("#maker-updates");
    expect(makerUpdateRailHtml(visible)).toContain("sort=updated");
    expect(makerUpdateRailHtml(visible)).not.toContain("Hidden");
  });

  it("names the project ahead of the update title", () => {
    const html = makerUpdateRailHtml([
      { ...item("PLEBLY-2026-003", "Shipped"), proposal_title: "Knots PR" },
    ]);
    const projectAt = html.indexOf("Knots PR");
    const titleAt = html.indexOf("Shipped");
    expect(projectAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(projectAt);
  });
});

describe("makerUpdateHeading", () => {
  it("names the count only after a post exists", () => {
    expect(makerUpdateHeading(0)).toBe("From the maker");
    expect(makerUpdateHeading(1)).toBe("From the maker · 1 update");
    expect(makerUpdateHeading(2)).toBe("From the maker · 2 updates");
    expect(makerUpdateSideLabel(0)).toBe("Updates");
    expect(makerUpdateSideLabel(2)).toBe("Updates · 2");
    expect(makerUpdateRemoveLabel("Shipped")).toBe("Remove Shipped");
    expect(makerUpdateRemoveLabel("  ")).toBe("Remove update");
    expect(makerUpdatesHtml("P")).toContain('role="alert"');
  });
});

describe("summarizeUpdateLatest", () => {
  it("sums live posts and skips a blank title", () => {
    expect(
      summarizeUpdateLatest([
        { title: "Shipped", count: 2 },
        { title: "Notes", count: 1 },
        { title: "  " },
      ]),
    ).toEqual({ projects: 2, updates: 3 });
  });
});
