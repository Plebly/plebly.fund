/**
 * Review B1 on fund#117: a plain 'YYYY-MM-DD' deadline is a whole local
 * calendar day. "due today" all day, overdue from 00:00 the next day; full
 * timestamps keep the ±12h window. Run in several zones (each is asserted to
 * have taken effect), including a US DST switch day.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDate, formatTimeAhead, parseDateValue } from "./util";
import { milestonesHtml } from "./proposal-ui";

const prevTz = process.env.TZ;
afterAll(() => {
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();
const rel = (iso: string, nowMs: number) => formatTimeAhead(iso, nowMs)?.text;
const ms = (deadline: string) => [
  { deliverable: "d", verification: "v", out_of_scope: "o", allocation_sats: 1, deadline, id: "m" },
];

const ZONES: Array<[string, number]> = [
  ["America/Los_Angeles", 480],
  ["UTC", 0],
  ["Asia/Tokyo", -540],
];

for (const [tz, janOffset] of ZONES) {
  describe(`plain-date deadlines in ${tz}`, () => {
    beforeAll(() => {
      process.env.TZ = tz;
    });

    it("the zone took effect", () => {
      expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(janOffset);
    });

    for (const [due, y, m, d] of [
      ["2026-01-15", 2026, 1, 15],
      ["2026-03-08", 2026, 3, 8], // US spring-forward day (23h long in LA)
    ] as const) {
      it(`${due}: due today all day, overdue from the next day`, () => {
        expect(rel(due, at(y, m, d, 0, 0))).toBe("due today");
        expect(rel(due, at(y, m, d, 12, 0))).toBe("due today");
        expect(rel(due, at(y, m, d, 23, 59))).toBe("due today");
        // 23:59 the day before: ahead, per the existing "in N" copy.
        expect(rel(due, at(y, m, d - 1, 23, 59))).toBe("in 1 day");
        // 00:00 the next day: 1 day overdue.
        expect(rel(due, at(y, m, d + 1, 0, 0))).toBe("1 day overdue");
        expect(rel(due, at(y, m, d + 3, 9, 0))).toBe("3 days overdue");
      });

      it(`${due}: the milestone rail matches`, () => {
        const today = milestonesHtml(ms(due), at(y, m, d, 23, 59));
        expect(today).toContain("· due today");
        expect(today).not.toContain("overdue");
        const before = milestonesHtml(ms(due), at(y, m, d - 1, 23, 59));
        expect(before).toContain("· in 1 day");
        expect(before).not.toMatch(/overdue|due today/);
        const next = milestonesHtml(ms(due), at(y, m, d + 1, 0, 0));
        expect(next).toContain("· 1 day overdue");
        expect(milestonesHtml(ms(due), at(y, m, d + 1, 0, 0), { hideOverdue: true })).not.toContain(
          "overdue",
        );
      });
    }

    if (tz === "America/Los_Angeles") {
      it("DST days count as one calendar day (23h spring-forward, 25h fall-back)", () => {
        expect(rel("2026-03-09", at(2026, 3, 8, 12, 0))).toBe("in 1 day");
        expect(rel("2026-11-01", at(2026, 11, 2, 12, 0))).toBe("1 day overdue");
      });
    }

    it("full timestamps keep the ±12h window", () => {
      const iso = "2026-01-15T12:00:00Z";
      const t = Date.parse(iso);
      expect(rel(iso, t + 11 * 3600_000)).toBe("due today");
      expect(rel(iso, t - 11 * 3600_000)).toBe("due today");
      expect(rel(iso, t + 13 * 3600_000)).toBe("1 day overdue");
      expect(rel(iso, t - 13 * 3600_000)).toBe("in 1 day");
    });

    it("impossible plain dates don't roll over; real leap days still work", () => {
      for (const bad of ["2026-02-30", "2026-13-01", "2026-04-31", "2026-00-10"]) {
        expect(Number.isNaN(parseDateValue(bad).getTime())).toBe(true);
        expect(formatDate(bad)).toBe(bad);
        expect(formatTimeAhead(bad, at(2026, 3, 1))).toBeNull();
        const html = milestonesHtml(ms(bad), at(2026, 3, 1));
        expect(html).toContain(`Due ${bad}`);
        expect(html).not.toMatch(/Mar \d|overdue|due today|in \d/);
      }
      expect(formatDate("2024-02-29")).toBe("Feb 29, 2024");
    });
  });
}
