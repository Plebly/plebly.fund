import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "./types";
import type { PublicDonation } from "./donations-page";
import { PROPOSALS_API, PROPOSALS_RAW } from "./config";
import { bindActivityStrip } from "./activity";
import { renderArchive } from "./archive-page";
import { bindDonationsLive } from "./donations-live";
import { clearListedProposalsCache } from "./github";
import {
  clearHiddenCompletedListingIdsCache,
  hiddenCompletedListingIds,
} from "./home-feed-hidden";
import { renderHome } from "./home-page";
import { renderStats } from "./stats-page";

const VISIBLE_COMPLETED = "PLEBLY-2026-001";
const HIDDEN_010 = "PLEBLY-2026-010";
const HIDDEN_011 = "PLEBLY-2026-011";
const OPEN = "PLEBLY-KNOTS-SIZE-VALUE-SPAM";

function proposal(
  overrides: Partial<Proposal> & Pick<Proposal, "id" | "status" | "title">,
): Proposal {
  const id = overrides.id as string;
  const status = overrides.status;
  const dir =
    status === "completed"
      ? "completed"
      : status === "declined"
        ? "declined"
        : "listed";
  return {
    path: `proposals/${dir}/${id}.md`,
    proposal_type: "bounty",
    target_sats: status === "completed" ? 50_000 : null,
    escrow_address: null,
    submission_fee_txid: null,
    created_at: "2026-10-01T00:00:00Z",
    escrow_index: null,
    milestones: [],
    body: "",
    balance_sats: status === "completed" ? 0 : 1_000,
    ...overrides,
  };
}

const visibleCompleted = proposal({
  id: VISIBLE_COMPLETED,
  status: "completed",
  title: "Visible completed",
  target_sats: 100_000,
  balance_sats: 0,
});
const hidden010 = proposal({
  id: HIDDEN_010,
  status: "completed",
  title: "Hidden completed 010",
  target_sats: 50_000,
  balance_sats: 0,
});
const hidden011 = proposal({
  id: HIDDEN_011,
  status: "completed",
  title: "Hidden completed 011",
  target_sats: 40_000,
  balance_sats: 0,
});
const openListing = proposal({
  id: OPEN,
  status: "listed",
  title: "Knots size/value spam",
});

const ALL = [visibleCompleted, hidden010, hidden011, openListing];
const LISTED = [visibleCompleted, openListing];

function catalogEntry(p: Proposal) {
  return {
    id: p.id,
    path: p.path,
    title: p.title,
    status: p.status,
    proposal_type: p.proposal_type,
    target_sats: p.target_sats,
    balance_sats: p.balance_sats,
    created_at: p.created_at,
  };
}

function markdownFor(p: Proposal): string {
  return `---
id: ${p.id}
title: ${p.title}
status: ${p.status}
proposal_type: ${p.proposal_type || "bounty"}
target_sats: ${p.target_sats ?? 0}
created_at: ${p.created_at}
---
`;
}

const don = (
  id: string,
  targetId: string,
  label: string,
): PublicDonation => ({
  id,
  amount_sats: 21_000,
  target_type: "project",
  target_id: targetId,
  target_label: label,
  donated_at: "2026-11-12T00:00:00Z",
  anonymous: false,
  donor_display: "alice",
});

const DONATIONS: PublicDonation[] = [
  don("d-010", HIDDEN_010, "Hidden completed 010"),
  don("d-011", HIDDEN_011, "Hidden completed 011"),
  don("d-visible", VISIBLE_COMPLETED, "Visible completed"),
  don("d-open", OPEN, "Knots size/value spam"),
  don("d-endowment", "endowment", "Endowment"),
];
DONATIONS[4] = {
  ...DONATIONS[4]!,
  target_type: "endowment",
  target_id: "endowment",
};

const EVENTS = [
  { type: "completed", proposal_id: HIDDEN_010, created_at: "2026-11-11T00:00:00Z" },
  { type: "completed", proposal_id: HIDDEN_011, created_at: "2026-11-11T01:00:00Z" },
  { type: "completed", proposal_id: VISIBLE_COMPLETED, created_at: "2026-11-10T00:00:00Z" },
  { type: "listed", proposal_id: OPEN, created_at: "2026-11-09T00:00:00Z" },
];

const shell = (inner: string) => `<main data-shell>${inner}</main>`;
const app = () => document.querySelector<HTMLDivElement>("#app")!;

function textOf(el: Element | null): string {
  return el?.textContent || "";
}

function assertHiddenOffHomeAndDonations(): void {
  const page = textOf(app());
  expect(page).not.toContain("Hidden completed 010");
  expect(page).not.toContain("Hidden completed 011");
  expect(page).not.toContain(HIDDEN_010);
  expect(page).not.toContain(HIDDEN_011);
  const donationIds = [...app().querySelectorAll(".donations-live-row")].map(
    (el) => (el as HTMLElement).dataset.donationId,
  );
  expect(donationIds).not.toContain("d-010");
  expect(donationIds).not.toContain("d-011");
}

describe("hidden listings when the listed catalog falls back to GitHub folders", () => {
  let catalogDown = false;

  beforeEach(() => {
    catalogDown = false;
    document.body.innerHTML = `<div id="app">
      <div id="donations-live-mount"></div>
      <section id="activity-strip" hidden aria-label="Recent activity"></section>
    </div>`;
    clearListedProposalsCache();
    clearHiddenCompletedListingIdsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes("/proposals/catalog")) {
          if (catalogDown) return new Response("down", { status: 503 });
          const listed = u.includes("scope=listed");
          return Response.json({
            proposals: (listed ? LISTED : ALL).map(catalogEntry),
          });
        }
        if (u.startsWith(`${PROPOSALS_API}/`)) {
          const dir = u.slice(PROPOSALS_API.length + 1);
          const files = ALL.filter((p) => p.path.startsWith(`proposals/${dir}/`)).map(
            (p) => ({
              name: `${p.id}.md`,
              path: p.path,
              type: "file",
              download_url: `${PROPOSALS_RAW}/${p.path}`,
            }),
          );
          if (!files.length && !["listed", "claimed", "completed", "unindexed", "declined"].includes(dir)) {
            return new Response("missing", { status: 404 });
          }
          return Response.json(files);
        }
        if (u.startsWith(`${PROPOSALS_RAW}/`)) {
          const path = u.slice(PROPOSALS_RAW.length + 1);
          const row = ALL.find((p) => p.path === path);
          if (!row) return new Response("missing", { status: 404 });
          return new Response(markdownFor(row));
        }
        if (u.includes("/endowment")) {
          return Response.json({ configured: false });
        }
        if (u.includes("/donations")) {
          return Response.json({ donations: DONATIONS, total: DONATIONS.length });
        }
        if (u.includes("/events")) {
          return Response.json({ events: EVENTS });
        }
        if (u.startsWith("https://api.test")) {
          return Response.json({});
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearListedProposalsCache();
    clearHiddenCompletedListingIdsCache();
    document.body.innerHTML = "";
  });

  it("treats every completed row as hidden when both catalogs are down and the folder fallback still returns completed", async () => {
    catalogDown = true;
    const ids = await hiddenCompletedListingIds();
    expect(ids.has(HIDDEN_010)).toBe(true);
    expect(ids.has(HIDDEN_011)).toBe(true);
    expect(ids.has(VISIBLE_COMPLETED)).toBe(true);
    expect(ids.has(OPEN)).toBe(false);
  });

  it("keeps 010 and 011 hidden in donations and the home project list after first paint when both catalogs are then blocked", async () => {
    history.replaceState(null, "", "/");
    await bindDonationsLive(document);
    await bindActivityStrip(document);
    const firstDonationIds = [...app().querySelectorAll(".donations-live-row")].map(
      (el) => (el as HTMLElement).dataset.donationId,
    );
    expect(firstDonationIds).toEqual(["d-visible", "d-open", "d-endowment"]);
    expect(textOf(app().querySelector("#donations-live"))).toContain("Visible completed");
    expect(textOf(app().querySelector("#activity-strip"))).toContain("Visible completed");
    assertHiddenOffHomeAndDonations();

    document.body.innerHTML = `<div id="app"></div>`;
    await renderHome(shell);
    const firstPage = textOf(app());
    expect(firstPage).toContain("Visible completed");
    expect(firstPage).toContain("Knots size/value spam");
    expect(firstPage).not.toContain("Hidden completed 010");
    expect(firstPage).not.toContain("Hidden completed 011");
    expect(firstPage).not.toContain(HIDDEN_010);
    expect(firstPage).not.toContain(HIDDEN_011);

    catalogDown = true;
    clearListedProposalsCache();
    clearHiddenCompletedListingIdsCache();

    document.body.innerHTML = `<div id="app">
      <div id="donations-live-mount"></div>
      <section id="activity-strip" hidden aria-label="Recent activity"></section>
    </div>`;
    await bindDonationsLive(document);
    await bindActivityStrip(document);
    const donationIds = [...app().querySelectorAll(".donations-live-row")].map(
      (el) => (el as HTMLElement).dataset.donationId,
    );
    expect(donationIds).toContain("d-open");
    expect(donationIds).toContain("d-endowment");
    expect(donationIds).not.toContain("d-010");
    expect(donationIds).not.toContain("d-011");
    const donationText = textOf(app().querySelector("#donations-live"));
    expect(donationText).not.toContain("Hidden completed 010");
    expect(donationText).not.toContain("Hidden completed 011");
    expect(donationText).not.toContain(HIDDEN_010);
    expect(donationText).not.toContain(HIDDEN_011);
    expect(textOf(app().querySelector("#activity-strip"))).not.toContain("Hidden completed 010");
    expect(textOf(app().querySelector("#activity-strip"))).not.toContain("Hidden completed 011");

    document.body.innerHTML = `<div id="app"></div>`;
    await renderHome(shell);
    const home = textOf(app());
    expect(home).toContain("Knots size/value spam");
    expect(home).not.toContain("Hidden completed 010");
    expect(home).not.toContain("Hidden completed 011");
    expect(home).not.toContain(HIDDEN_010);
    expect(home).not.toContain(HIDDEN_011);
    const listText = textOf(app().querySelector("#list"));
    const completedRail = textOf(app().querySelector("#completed-rail"));
    expect(listText).not.toContain("Hidden completed 010");
    expect(listText).not.toContain("Hidden completed 011");
    expect(completedRail).not.toContain("Hidden completed 010");
    expect(completedRail).not.toContain("Hidden completed 011");

    history.replaceState(null, "", "/stats");
    await renderStats(shell);
    const completed = [...app().querySelectorAll(".stats-metric dt")]
      .find((el) => el.textContent === "Completed")
      ?.parentElement?.querySelector("dd")?.textContent;
    expect(completed).toBe("3");

    history.replaceState(null, "", "/archive");
    await renderArchive(shell);
    const archiveIds = [...app().querySelectorAll(".declined-row .mono")].map(
      (el) => el.textContent,
    );
    expect(archiveIds).toContain(HIDDEN_010);
    expect(archiveIds).toContain(HIDDEN_011);
    expect(archiveIds).toContain(VISIBLE_COMPLETED);
    expect(textOf(app())).toContain("Hidden completed 010");
    expect(textOf(app())).toContain("Hidden completed 011");
    expect(app().querySelector(".account-tab")!.textContent).toMatch(/Completed 3/);
  });
});
