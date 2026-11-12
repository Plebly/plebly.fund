import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAIM_FLOOR_SATS } from "./config";
import type { Proposal } from "./types";

const gh = vi.hoisted(() => ({ listAll: vi.fn(), listListed: vi.fn() }));
vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return {
    ...actual,
    listAllPublicProposals: gh.listAll,
    listListedProposals: gh.listListed,
  };
});

import { computePublicStats, renderStats } from "./stats-page";

function proposal(
  overrides: Partial<Proposal> & Pick<Proposal, "status">,
): Proposal {
  return {
    id: "p",
    title: "t",
    path: "x.md",
    target_sats: null,
    escrow_address: null,
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    ...overrides,
  };
}

describe("computePublicStats", () => {
  it("aggregates escrow, open/completed counts, and claim-floor shortfall", () => {
    const stats = computePublicStats([
      proposal({ status: "funding", balance_sats: 100_000 }),
      proposal({ status: "claimed", balance_sats: 50_000, claimer: "bob" }),
      proposal({
        status: "completed",
        balance_sats: 0,
        target_sats: 200_000,
      }),
      proposal({ status: "in_review", balance_sats: 10_000, claimer: "carol" }),
      proposal({ status: "listed", balance_sats: 1_000 }),
    ]);

    expect(stats.tracked).toBe(5);
    expect(stats.open).toBe(4);
    expect(stats.completed).toBe(1);
    expect(stats.claimedLifecycle).toBe(3);
    expect(stats.escrowed).toBe(161_000);
    expect(stats.paidEstimate).toBe(200_000);
    expect(stats.completionRate).toBe(33);
    // Floor comes from parameters (signet 10k): only the 1k listed project is short.
    expect(stats.belowFloorCount).toBe(1);
    expect(stats.shortfallSats).toBe(CLAIM_FLOOR_SATS - 1_000);
    expect(stats.fundedTowardFloor).toBe(1_000);
  });

  it("returns null completion rate when no claim lifecycle yet", () => {
    const stats = computePublicStats([
      proposal({ status: "listed", balance_sats: 0 }),
    ]);
    expect(stats.completionRate).toBeNull();
    expect(stats.claimedLifecycle).toBe(0);
    expect(stats.belowFloorCount).toBe(1);
  });

  it("counts a hidden completed listing once in /stats totals", () => {
    const visible = proposal({
      id: "PLEBLY-2026-001",
      status: "completed",
      target_sats: 100_000,
      balance_sats: 0,
    });
    const hiddenCompleted = proposal({
      id: "010",
      status: "completed",
      title: "Hidden completed fixture",
      target_sats: 50_000,
      balance_sats: 0,
    });
    const open = proposal({
      id: "PLEBLY-2026-009",
      status: "listed",
      balance_sats: 2_000,
    });

    const stats = computePublicStats([visible, hiddenCompleted, open]);

    expect(stats.tracked).toBe(3);
    expect(stats.completed).toBe(2);
    expect(stats.claimedLifecycle).toBe(2);
    expect(stats.open).toBe(1);
    expect(stats.paidEstimate).toBe(150_000);
    expect(stats.escrowed).toBe(2_000);
    expect(stats.completionRate).toBe(100);
    // Completed hidden rows do not widen the claim-floor gap.
    expect(stats.belowFloorCount).toBe(1);
    expect(stats.shortfallSats).toBe(CLAIM_FLOOR_SATS - 2_000);
  });

  it("does not count a non-completed hidden row as completed", () => {
    const stats = computePublicStats([
      proposal({
        id: "010",
        status: "completed",
        target_sats: 50_000,
        balance_sats: 0,
      }),
      proposal({
        id: "099",
        status: "listed",
        balance_sats: 1_000,
      }),
    ]);

    expect(stats.completed).toBe(1);
    expect(stats.tracked).toBe(2);
    expect(stats.open).toBe(1);
    expect(stats.paidEstimate).toBe(50_000);
  });
});

describe("renderStats", () => {
  const shell = (inner: string) => `<main data-shell>${inner}</main>`;
  const app = () => document.querySelector<HTMLDivElement>("#app")!;
  const metric = (label: string) => {
    const dts = [...app().querySelectorAll(".stats-metric dt")];
    const dt = dts.find((el) => el.textContent === label);
    return dt?.parentElement?.querySelector("dd")?.textContent ?? null;
  };

  beforeEach(() => {
    document.body.innerHTML = `<div id="app"></div>`;
    history.replaceState(null, "", "/stats");
    gh.listAll.mockReset();
    gh.listListed.mockReset();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads scope=all and includes a hidden completed listing in the totals", async () => {
    gh.listAll.mockResolvedValue([
      proposal({
        id: "PLEBLY-2026-001",
        status: "completed",
        target_sats: 100_000,
        balance_sats: 0,
      }),
      proposal({
        id: "010",
        status: "completed",
        title: "Hidden completed fixture",
        target_sats: 50_000,
        balance_sats: 0,
      }),
      proposal({
        id: "PLEBLY-2026-009",
        status: "listed",
        balance_sats: 2_000,
      }),
    ]);

    await renderStats(shell);

    expect(gh.listAll).toHaveBeenCalledOnce();
    expect(gh.listListed).not.toHaveBeenCalled();
    expect(metric("Completed")).toBe("2");
    expect(metric("Open projects")).toBe("1");
    expect(app().querySelector(".stats-primary-detail")!.textContent).toBe(
      "Live confirmed balances across 3 tracked projects",
    );
  });
});
