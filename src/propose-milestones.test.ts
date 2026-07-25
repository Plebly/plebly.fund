import { describe, expect, it } from "vitest";
import {
  milestoneEditorSectionHtml,
  milestoneRowHtml,
  milestonesAllocatedTotal,
  milestonesFundingHint,
  priorDepsHtml,
  remapDepIdsAfterDelete,
  refreshMilestoneDepSlots,
  validateMilestoneDrafts,
} from "./propose-milestones";

describe("propose milestone editor", () => {
  it("section explains the 1M threshold and empty state", () => {
    const html = milestoneEditorSectionHtml();
    expect(html).toContain("milestones-list");
    expect(html).toContain("add-milestone-btn");
    expect(html).toContain("milestones-empty");
    expect(html).toContain("1,000,000");
    expect(html).toContain("Remove");
  });

  it("row exposes schema fields and a Remove control", () => {
    const html = milestoneRowHtml(0);
    expect(html).toContain("ms-deliverable");
    expect(html).toContain("ms-verification");
    expect(html).toContain("ms-oos");
    expect(html).toContain("ms-sats");
    expect(html).toContain('type="date"');
    expect(html).toContain("Milestone 1");
    expect(html).toContain("remove-milestone");
    expect(html).toContain('type="button"');
    // JS validates length — no HTML minlength trap on optional rows
    expect(html).not.toContain("minlength");
  });

  it("soft funding hint covers threshold and allocation drift", () => {
    expect(milestonesFundingHint(1_000_000, 0, 0)).toContain("1,000,000");
    expect(milestonesFundingHint(100_000, 80_000, 1)).toContain("under");
    expect(milestonesFundingHint(100_000, 100_000, 1)).toBe("");
  });

  it("remaps dependency ids after deleting an earlier stage", () => {
    // m1,m2,m3 with m3→m2; delete m1 → survivors m1(old m2), m2(old m3→m1)
    expect(remapDepIdsAfterDelete(["m2"], 0)).toEqual(["m1"]);
    expect(remapDepIdsAfterDelete(["m1", "m3"], 1)).toEqual(["m1", "m2"]);
    expect(remapDepIdsAfterDelete(["m2"], 1)).toEqual([]);
  });

  it("prior deps HTML and refresh helper stay in sync", () => {
    expect(priorDepsHtml(0, [])).toContain("data-ms-dep-slot");
    expect(priorDepsHtml(1, ["m1"])).toContain('value="m1"');
    expect(priorDepsHtml(1, ["m1"])).toContain("checked");
    expect(typeof refreshMilestoneDepSlots).toBe("function");
  });

  it("sums allocations", () => {
    expect(
      milestonesAllocatedTotal([
        {
          deliverable: "a",
          verification: "b",
          out_of_scope: "c",
          allocation_sats: 50_000,
          deadline: "2026-09-01",
        },
        {
          deliverable: "d",
          verification: "e",
          out_of_scope: "f",
          allocation_sats: 25_000,
          deadline: "2026-10-01",
        },
      ]),
    ).toBe(75_000);
  });

  it("requires milestones when target ≥ 1M", () => {
    const missing = validateMilestoneDrafts([], 1_000_000);
    expect(missing.ok).toBe(false);

    const okEmpty = validateMilestoneDrafts([], 100_000);
    expect(okEmpty.ok).toBe(true);
    if (okEmpty.ok) expect(okEmpty.milestones).toEqual([]);
  });

  it("validates per-milestone required fields", () => {
    const bad = validateMilestoneDrafts(
      [
        {
          deliverable: "too short",
          verification: "also short",
          out_of_scope: "",
          allocation_sats: 0,
          deadline: "",
        },
      ],
      null,
    );
    expect(bad.ok).toBe(false);

    const good = validateMilestoneDrafts(
      [
        {
          deliverable: "Ship the landing page with funding bar",
          verification: "Reviewer loads page and sees escrow balance",
          out_of_scope: "Mainnet multisig",
          allocation_sats: 80_000,
          deadline: "2026-10-01",
        },
      ],
      1_500_000,
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.milestones[0].id).toBe("m1");
      expect(good.milestones[0].deadline).toBe("2026-10-01");
    }
  });

  it("drops invalid forward dependency ids on validate", () => {
    const good = validateMilestoneDrafts(
      [
        {
          deliverable: "First stage deliverable text",
          verification: "First stage verification text",
          out_of_scope: "none",
          allocation_sats: 10,
          deadline: "2026-10-01",
        },
        {
          deliverable: "Second stage deliverable text",
          verification: "Second stage verification text",
          out_of_scope: "none",
          allocation_sats: 10,
          deadline: "2026-11-01",
          dependencies: ["m1", "m9"],
        },
      ],
      null,
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.milestones[1].dependencies).toEqual(["m1"]);
    }
  });
});
