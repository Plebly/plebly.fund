import { describe, expect, it } from "vitest";
import { filterCompletedProposals } from "./completed-page";
import { parseLocation, seoForRoute } from "./router";
import type { Proposal } from "./types";

describe("completed archive", () => {
  it("routes /completed", () => {
    expect(parseLocation("/completed", "")).toEqual({ name: "completed" });
    expect(seoForRoute({ name: "completed" }).path).toBe("/completed");
  });

  it("filters completed proposals", () => {
    const rows = filterCompletedProposals([
      {
        path: "proposals/listed/a.md",
        status: "listed",
        id: "a",
      } as Proposal,
      {
        path: "proposals/completed/b.md",
        status: "completed",
        id: "b",
      } as Proposal,
      {
        path: "proposals/completed/c.md",
        status: "claimed",
        id: "c",
      } as Proposal,
    ]);
    expect(rows.map((p) => p.id)).toEqual(["c", "b"]);
  });
});
