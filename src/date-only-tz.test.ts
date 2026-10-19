/**
 * Date-only strings ('YYYY-MM-DD') are calendar dates, not UTC midnight: west
 * of UTC, `new Date("2026-01-01")` is Dec 31 local. CI runs west of UTC.
 * This file pins a western zone before any Date is made and checks it took.
 */
const prevTz = process.env.TZ;
process.env.TZ = "America/Los_Angeles";

import { afterAll, describe, expect, it } from "vitest";
import { formatDate, formatTimeAhead } from "./util";
import { milestonesHtml } from "./proposal-ui";

afterAll(() => {
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

describe("date-only strings in a western time zone", () => {
  it("the zone took effect (Jan 1 local is UTC-8)", () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(480);
    expect(new Date("2026-01-01").getDate()).toBe(31); // the bug being guarded
  });

  it("formatDate keeps the calendar day", () => {
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("2026-11-09")).toBe("Nov 9, 2026");
    // Full timestamps still convert to local time.
    expect(formatDate("2026-01-01T03:00:00Z")).toBe("Dec 31, 2025");
  });

  it("milestone deadline, its tooltip and the overdue check use the calendar day", () => {
    const ms = [
      {
        deliverable: "Ship",
        verification: "v",
        out_of_scope: "o",
        allocation_sats: 1,
        deadline: "2026-01-01",
        id: "m1",
      },
    ];
    const html = milestonesHtml(ms, Date.parse("2026-10-18T12:00:00Z"));
    expect(html).toContain("Due Jan 1, 2026");
    expect(html).toContain('title="Jan 1, 2026"');
    expect(html).not.toContain("Dec 31, 2025");
    expect(formatTimeAhead("2026-01-01", new Date(2026, 0, 1, 10).getTime())?.text).toBe("due today");
  });
});
