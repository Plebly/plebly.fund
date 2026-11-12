import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "./types";
import type { PublicDonation } from "./donations-page";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test" };
});

const gh = vi.hoisted(() => ({ listAll: vi.fn(), listListed: vi.fn() }));
vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return {
    ...actual,
    listAllPublicProposals: gh.listAll,
    listListedProposals: gh.listListed,
  };
});

import { bindActivityStrip } from "./activity";
import { renderArchive } from "./archive-page";
import { bindDonationsLive } from "./donations-live";
import { renderStats } from "./stats-page";

const VISIBLE_COMPLETED = "PLEBLY-2026-001";
const PUBLIC_DECLINED = "PLEBLY-2026-002";
const HIDDEN_COMPLETED = "PLEBLY-2026-010";
const OPEN = "PLEBLY-KNOTS-SIZE-VALUE-SPAM";

function proposal(
  overrides: Partial<Proposal> & Pick<Proposal, "id" | "status">,
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
    title: id,
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
const hiddenCompleted = proposal({
  id: HIDDEN_COMPLETED,
  status: "completed",
  title: "Hidden completed fixture",
  target_sats: 50_000,
  balance_sats: 0,
});
const publicDeclined = proposal({
  id: PUBLIC_DECLINED,
  status: "declined",
  title: "Public declined",
});
const openListing = proposal({
  id: OPEN,
  status: "listed",
  title: "Knots size/value spam",
});

const ALL = [visibleCompleted, hiddenCompleted, publicDeclined, openListing];
const LISTED = [visibleCompleted, openListing];

const don = (
  id: string,
  targetId: string,
  label: string,
  over: Partial<PublicDonation> = {},
): PublicDonation => ({
  id,
  amount_sats: 21_000,
  target_type: "project",
  target_id: targetId,
  target_label: label,
  donated_at: "2026-11-12T00:00:00Z",
  anonymous: false,
  donor_display: "alice",
  ...over,
});

const DONATIONS: PublicDonation[] = [
  don("d-hidden", HIDDEN_COMPLETED, "Hidden completed fixture"),
  don("d-visible", VISIBLE_COMPLETED, "Visible completed"),
  don("d-open", OPEN, "Knots size/value spam"),
  don("d-endowment", "endowment", "Endowment", {
    target_type: "endowment",
    target_id: "endowment",
  }),
];

const EVENTS = [
  { type: "completed", proposal_id: HIDDEN_COMPLETED, created_at: "2026-11-11T00:00:00Z" },
  { type: "completed", proposal_id: VISIBLE_COMPLETED, created_at: "2026-11-10T00:00:00Z" },
  { type: "listed", proposal_id: OPEN, created_at: "2026-11-09T00:00:00Z" },
];

const shell = (inner: string) => `<main data-shell>${inner}</main>`;
const app = () => document.querySelector<HTMLDivElement>("#app")!;

function seedCatalog(listed: Proposal[] | Error = LISTED) {
  gh.listAll.mockResolvedValue(ALL);
  if (listed instanceof Error) gh.listListed.mockRejectedValue(listed);
  else gh.listListed.mockResolvedValue(listed);
}

describe("hidden completed listings on home feeds", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="app">
      <div id="donations-live-mount"></div>
      <section id="activity-strip" hidden aria-label="Recent activity"></section>
    </div>`;
    gh.listAll.mockReset();
    gh.listListed.mockReset();
    seedCatalog();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/endowment")) {
          return Response.json({ configured: false });
        }
        if (u.includes("/donations")) {
          return Response.json({ donations: DONATIONS, total: DONATIONS.length });
        }
        if (u.includes("/events")) {
          return Response.json({ events: EVENTS });
        }
        if (u.includes("/proposals/catalog")) {
          return Response.json({
            proposals: ALL.map((p) => ({ id: p.id, title: p.title })),
          });
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("stays off Recent donations and the Completed activity feed, and still counts on /stats and /archive", async () => {
    await bindDonationsLive(document);
    await bindActivityStrip(document);

    const donationText = app().querySelector("#donations-live")?.textContent || "";
    const donationIds = [...app().querySelectorAll(".donations-live-row")].map(
      (el) => (el as HTMLElement).dataset.donationId,
    );
    expect(donationIds).toEqual(["d-visible", "d-open", "d-endowment"]);
    expect(donationText).toContain("Visible completed");
    expect(donationText).toContain("Knots size/value spam");
    expect(donationText).not.toContain("Hidden completed fixture");
    expect(donationText).not.toContain(HIDDEN_COMPLETED);

    const strip = app().querySelector("#activity-strip")!;
    expect(strip.hidden).toBe(false);
    const activityText = strip.textContent || "";
    const activityIds = [...strip.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");
    expect(activityText).toContain("Visible completed");
    expect(activityText).toContain("Completed");
    expect(activityText).toContain("Knots size/value spam");
    expect(activityText).not.toContain("Hidden completed fixture");
    expect(activityText).not.toContain(HIDDEN_COMPLETED);
    expect(activityIds.some((href) => href.toLowerCase().includes("plebly-2026-010"))).toBe(
      false,
    );

    history.replaceState(null, "", "/stats");
    await renderStats(shell);
    const completed = [...app().querySelectorAll(".stats-metric dt")]
      .find((el) => el.textContent === "Completed")
      ?.parentElement?.querySelector("dd")?.textContent;
    expect(completed).toBe("2");

    history.replaceState(null, "", "/archive");
    await renderArchive(shell);
    const archiveIds = [...app().querySelectorAll(".declined-row .mono")].map(
      (el) => el.textContent,
    );
    expect(archiveIds).toContain(HIDDEN_COMPLETED);
    expect(archiveIds).toContain(VISIBLE_COMPLETED);
    expect(archiveIds.filter((id) => id === HIDDEN_COMPLETED)).toHaveLength(1);
    expect(app().textContent).toContain("Hidden completed fixture");
    expect(app().querySelector(".account-tab")!.textContent).toMatch(/Completed 2/);
  });

  it("hides completed donations and events when the listed catalog fails to load, without leaking them", async () => {
    seedCatalog(new Error("listed catalog down"));
    await bindDonationsLive(document);
    await bindActivityStrip(document);

    const donationIds = [...app().querySelectorAll(".donations-live-row")].map(
      (el) => (el as HTMLElement).dataset.donationId,
    );
    expect(donationIds).toEqual(["d-open", "d-endowment"]);
    const donationText = app().querySelector("#donations-live")?.textContent || "";
    expect(donationText).not.toContain("Hidden completed fixture");
    expect(donationText).not.toContain("Visible completed");
    expect(donationText).not.toContain(HIDDEN_COMPLETED);
    expect(donationText).not.toContain(VISIBLE_COMPLETED);

    const activityText = app().querySelector("#activity-strip")!.textContent || "";
    expect(activityText).toContain("Knots size/value spam");
    expect(activityText).not.toContain("Hidden completed fixture");
    expect(activityText).not.toContain("Visible completed");
    expect(activityText).not.toContain(HIDDEN_COMPLETED);
    expect(activityText).not.toContain(VISIBLE_COMPLETED);
  });
});
