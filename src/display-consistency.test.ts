/**
 * UI UX live walk 2026-10-18, items 2–6: one funder count per page, names not
 * raw ids, Donate notes above the QR, one meter target at a time, one name and
 * one date format per thing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test", lightningUiAllowed: () => false };
});

let catalogRows: Proposal[] = [];
vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return { ...actual, loadedCatalogRows: () => catalogRows, cachedProposalTitle: () => null };
});

import {
  displayHandle,
  displayIdentity,
  isRawIdentityKey,
  looksLikeProjectId,
  shortKey,
} from "./display-names";
import { clearProjectTitlesCache, projectRefHtml } from "./project-titles";
import { withDisplayLabels, type PublicDonation } from "./donations-page";
import { bindActivityStrip } from "./activity";
import {
  donateModalHtml,
  fundingProgressHtml,
  funderConcentrationLine,
  milestonesHtml,
  projectOutcomeHtml,
  statusLabel,
} from "./proposal-ui";
import { breadcrumbListingHtml, isFinishedStatus } from "./proposal-page";
import { shortUserId } from "./reviewers";
import { formatDate, pluralUnit } from "./util";
import type { Proposal } from "./types";

const HEX = "a5a22eafd45e989049a63bf9be8259535aca162d9b4ae526b33edc35261733f6";

afterEach(() => {
  vi.unstubAllGlobals();
  clearProjectTitlesCache();
  document.body.innerHTML = "";
});

function catalogFetch(proposals: { id: string; title: string }[], extra?: (url: string) => unknown) {
  const fn = vi.fn(async (url: string) => {
    if (String(url).includes("/proposals/catalog")) {
      return { ok: true, json: async () => ({ proposals }) } as Response;
    }
    const body = extra?.(String(url));
    return { ok: body != null, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("names, not raw ids (item 3)", () => {
  it("short keys are first 4 … last 4", () => {
    expect(shortKey(HEX)).toBe("a5a2…33f6");
    expect(displayIdentity(`nostr:${HEX}`)).toBe("a5a2…33f6");
    expect(displayIdentity(HEX)).toBe("a5a2…33f6");
    expect(displayIdentity("a5a22eaf…33f6")).toBe("a5a2…33f6");
    expect(displayIdentity("github:184555205")).toBe("GitHub user 184555205");
    expect(displayIdentity("gh:123")).toBe("GitHub user 123");
  });

  it("handles stay handles; keys never get an @", () => {
    expect(displayIdentity("@secsovereign")).toBe("secsovereign");
    expect(displayHandle("secsovereign")).toBe("@secsovereign");
    expect(displayHandle(`nostr:${HEX}`)).toBe("a5a2…33f6");
    expect(isRawIdentityKey("alice")).toBe(false);
    expect(isRawIdentityKey("gh:42")).toBe(true);
    expect(displayHandle("gh:123")).toBe("GitHub user 123"); // never "@123"
    expect(displayHandle("github:ada")).toBe("@ada");
    expect(displayIdentity("")).toBe("");
  });

  it("Shipped by uses the short key and escapes handles", () => {
    expect(projectOutcomeHtml("completed", `nostr:${HEX}`)).toContain("Shipped by a5a2…33f6.");
    expect(projectOutcomeHtml("completed", `nostr:${HEX}`)).not.toContain(HEX);
    expect(projectOutcomeHtml("completed", "alice")).toContain("Shipped by @alice.");
    const evil = projectOutcomeHtml("completed", "<img src=x onerror=alert(1)>");
    expect(evil).not.toContain("<img");
    expect(evil).toContain("&lt;img");
  });

  it("governance short ids: nostr keys shortened, numeric GitHub ids named", () => {
    expect(shortUserId(`nostr:${HEX}`)).toBe("a5a2…33f6");
    expect(shortUserId("github:184555205")).toBe("GitHub user 184555205");
    expect(shortUserId("github:42")).toBe("GitHub user 42");
  });

  it("statuses come from one label map: no raw snake_case", () => {
    expect(statusLabel("in_review")).toBe("In review");
    expect(statusLabel("abandoned_vote")).toBe("Abandoned vote");
    expect(statusLabel("declined")).toBe("Declined");
    for (const s of ["declined_fundable", "redirect_pending", "abandoned_vote"]) {
      expect(statusLabel(s)).not.toContain("_");
    }
  });

  it("project refs: title first, id secondary, both escaped", () => {
    const html = projectRefHtml("PLEBLY-2026-008", "<b>Fee recheck</b>");
    expect(html).toContain("&lt;b&gt;Fee recheck&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html.indexOf("project-ref-title")).toBeLessThan(html.indexOf("project-ref-id"));
    expect(projectRefHtml("PLEBLY-2026-008", null)).not.toContain("project-ref-id");
    expect(looksLikeProjectId("PLEBLY-2026-008", "PLEBLY-2026-008")).toBe(true);
    expect(looksLikeProjectId("Fee recheck", "PLEBLY-2026-008")).toBe(false);
  });

  it("ledger rows that only carry an id get the catalog title (escaped later); key donors shortened", async () => {
    catalogFetch([{ id: "PLEBLY-2026-008", title: "Structure UTXO-selection fee recheck" }]);
    const rows = await withDisplayLabels([
      {
        id: "1",
        amount_sats: 600,
        target_type: "project",
        target_id: "PLEBLY-2026-008",
        target_label: "PLEBLY-2026-008",
        donated_at: "2026-09-23T00:00:00Z",
        anonymous: false,
        donor_display: "a5a22eaf…33f6",
      } as PublicDonation,
      {
        id: "2",
        amount_sats: 1,
        target_type: "project",
        target_id: "PLEBLY-2026-404",
        target_label: "PLEBLY-2026-404",
        donated_at: "2026-09-23T00:00:00Z",
        anonymous: true,
        donor_display: null,
      } as PublicDonation,
    ]);
    expect(rows[0]!.target_label).toBe("Structure UTXO-selection fee recheck");
    expect(rows[0]!.donor_display).toBe("a5a2…33f6");
    expect(rows[1]!.target_label).toBe("PLEBLY-2026-404");
  });

  it("activity strip shows the title with the id secondary, escaped", async () => {
    catalogFetch([{ id: "PLEBLY-2026-010", title: "<i>KH rehearsal</i>" }], (url) =>
      url.endsWith("/events")
        ? { events: [{ type: "completed", proposal_id: "PLEBLY-2026-010", created_at: "2026-09-25T00:00:00Z" }] }
        : null,
    );
    document.body.innerHTML = `<div id="activity-strip" hidden></div>`;
    await bindActivityStrip(document);
    const strip = document.querySelector("#activity-strip")!;
    expect(strip.querySelector(".project-ref-title")?.textContent).toBe("<i>KH rehearsal</i>");
    expect(strip.querySelector("i")).toBeNull();
    expect(strip.querySelector(".project-ref-id")?.textContent).toBe("PLEBLY-2026-010");
  });
});

describe("one funder count per page (item 2)", () => {
  it("header line uses the list's count, the short key, and no 'Largest funder 0%'", () => {
    expect(
      funderConcentrationLine(
        { top_share_bps: 1151, unattributed_bps: 8848, funder_count: 2, top_name: `nostr:${HEX}` },
        "1 funder + 17 anonymous gifts",
      ),
    ).toBe("a5a2…33f6 12% · unattributed 88% · 1 funder + 17 anonymous gifts");
    expect(
      funderConcentrationLine(
        { top_share_bps: 0, unattributed_bps: 10000, funder_count: 1 },
        "2 anonymous gifts",
      ),
    ).toBe("unattributed 100% · 2 anonymous gifts");
    expect(funderConcentrationLine({ top_share_bps: 10000, funder_count: 1, top_name: "ada" })).toBe(
      "ada 100% · 1 funder",
    );
  });

  it("completed with nothing left in escrow: no 0% meter, says it settled", () => {
    const html = fundingProgressHtml(0, 10_000, 10_000, [], { status: "completed" });
    expect(html).toContain("Completed");
    expect(html).toContain("Paid out on-chain");
    expect(html).not.toContain("settled on-chain");
    expect(html).not.toContain("0%");
    expect(html).not.toContain("progressbar");
  });

  it("finished statuses drop the run-up review chrome", () => {
    expect(isFinishedStatus("completed")).toBe(true);
    expect(isFinishedStatus("bounty_settled")).toBe(true);
    expect(isFinishedStatus("in_review")).toBe(false);
  });
});

describe("funding meter and milestones (item 5)", () => {
  const ms = [
    {
      deliverable: "Ship",
      verification: "v",
      out_of_scope: "o",
      allocation_sats: 100_000,
      deadline: "2026-01-01",
      id: "m1",
    },
  ];
  const now = Date.parse("2026-10-18T12:00:00Z");

  it("hides 'overdue' when nothing has been raised", () => {
    expect(milestonesHtml(ms, now)).toContain("overdue");
    const hidden = milestonesHtml(ms, now, { hideOverdue: true });
    expect(hidden).not.toContain("overdue");
    expect(hidden).toContain("Due Jan 1, 2026");
  });

  it("before open: only the amount to open; past goal: Fully funded", () => {
    const before = fundingProgressHtml(0, 10_000, 1_500_000, [], { status: "listed" });
    expect(before).toContain("0 of 10,000 sats to open");
    expect(before).not.toContain("1,500,000");
    const over = fundingProgressHtml(36_030, 10_000, 10_000, [], { status: "claimable" });
    expect(over).toContain("Fully funded");
    expect(over).not.toMatch(/\d+\.\d%|360%/);
  });
});

describe("Donate dialog (item 4)", () => {
  const LIVE_SHARED = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
  const p = {
    id: "PLEBLY-2026-001",
    path: "proposals/listed/PLEBLY-2026-001.md",
    title: "P1",
    status: "listed",
    escrow_address: LIVE_SHARED,
    escrow_shared: true,
  } as Proposal;

  it("shared-escrow / refund note sits above the QR, not under it", () => {
    catalogRows = [p];
    document.body.innerHTML = donateModalHtml(p, { signedIn: false });
    const note = document.querySelector("#donate-shared-count, #donate-refund-route")!;
    const qr = document.querySelector("#donate-qr")!;
    expect(note).toBeTruthy();
    expect(note.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.closest(".donate-pay-layout")).toBeNull();
  });

  it("Continue anonymously sits in the same row as GitHub and Nostr, same button style as Nostr", () => {
    catalogRows = [p];
    document.body.innerHTML = donateModalHtml(p, { signedIn: false });
    const row = document.querySelector(".donate-credit-choices")!;
    const anon = row.querySelector<HTMLButtonElement>("#donate-credit-continue")!;
    const nostr = row.querySelector<HTMLButtonElement>("[data-nostr-login]")!;
    expect(anon.textContent).toBe("Continue anonymously");
    expect(anon.className).toContain("btn ghost");
    expect(nostr.className).toContain("btn ghost");
    expect(row.querySelector("a.btn")?.textContent).toContain("GitHub");
  });
});

describe("one name and one date format (item 6)", () => {
  it("dates read 'Sep 25, 2026' everywhere", () => {
    expect(formatDate("2026-09-25T14:10:53.879Z")).toMatch(/^Sep 2[45], 2026$/);
    expect(formatDate("2026-11-09T12:00:00Z")).toBe("Nov 9, 2026");
    expect(formatDate("not a date")).toBe("not a date");
    expect(formatDate(null)).toBe("");
  });

  it("vote counts are real plurals", () => {
    expect(pluralUnit(1, "vote", "votes")).toBe("1 vote");
    expect(pluralUnit(0, "vote", "votes")).toBe("0 votes");
    expect(pluralUnit(3, "vote", "votes")).toBe("3 votes");
  });

  it("breadcrumb uses the nav's listing name", () => {
    expect(breadcrumbListingHtml({ proposal_type: "bounty" })).toContain(">Bounties<");
    expect(breadcrumbListingHtml({ proposal_type: "direct" })).toContain(">Campaigns<");
    expect(breadcrumbListingHtml({})).not.toContain("Projects");
  });
});
