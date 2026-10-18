/**
 * Review H2/H3 on fund#117: one test per removable guard in the display
 * change, so dropping any of them fails here.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import type { Proposal } from "./types";

const PAYLOAD = "<img src=x onerror=1>";

describe("projectRefHtml escapes the id in both branches", () => {
  it("no title: the id alone is escaped", async () => {
    const { projectRefHtml } = await import("./project-titles");
    const html = projectRefHtml(PAYLOAD, null);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
  });

  it("with title: the secondary id is escaped", async () => {
    const { projectRefHtml } = await import("./project-titles");
    const html = projectRefHtml(PAYLOAD, "Real title");
    expect(html).toContain('class="project-ref-id');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
  });
});

describe("funding meter guards (page)", () => {
  it("settled copy only when nothing is left in escrow", async () => {
    const { fundingProgressHtml } = await import("./proposal-funding-bar");
    const empty = fundingProgressHtml(0, 10_000, 10_000, [], { status: "completed" });
    expect(empty).toContain("Paid out on-chain");
    const withBalance = fundingProgressHtml(4_000, 10_000, 10_000, [], { status: "completed" });
    expect(withBalance).not.toContain("Paid out on-chain");
    expect(withBalance).toContain("4,000 sats raised");
  });

  it("negative balance is clamped: never '-5 of'", async () => {
    const { fundingProgressHtml } = await import("./proposal-funding-bar");
    const html = fundingProgressHtml(-5, 10_000, null, [], { status: "listed" });
    expect(html).toContain("0 of 10,000 sats to open");
    expect(html).not.toContain("-5");
  });

  for (const status of ["in_review", "claimed", "completed"]) {
    it(`${status} below the open amount: just "X raised", no 'to open' and no goal`, async () => {
      const { fundingProgressHtml } = await import("./proposal-funding-bar");
      const html = fundingProgressHtml(4_000, 10_000, 1_500_000, [], {
        status,
        claimer: status === "completed" ? null : "alice",
      });
      expect(html).toContain("4,000 sats raised");
      expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/to open|goal|1,500,000/);
    });
  }

  it("still raising: 'to open' and then the goal", async () => {
    const { fundingProgressHtml } = await import("./proposal-funding-bar");
    expect(fundingProgressHtml(4_000, 10_000, 1_500_000, [], { status: "listed" })).toContain(
      "4,000 of 10,000 sats to open",
    );
    expect(fundingProgressHtml(40_000, 10_000, 100_000, [], { status: "claimable" })).toContain(
      "40,000 of 100,000 sats goal (40%)",
    );
  });
});

describe("home card guards", () => {
  const card = (over: Partial<Proposal>): Proposal =>
    ({
      id: "PLEBLY-2026-099",
      path: "proposals/listed/PLEBLY-2026-099.md",
      title: "T",
      status: "listed",
      proposal_type: "bounty",
      target_sats: 1_500_000,
      escrow_address: null,
      escrow_shared: false,
      milestones: [],
      balance_sats: 4_000,
      ...over,
    }) as Proposal;

  it("still raising below open: 'X of Y sats to open'", async () => {
    const { progressHtml } = await import("./home-page");
    expect(progressHtml(card({}), 10_000)).toContain("4,000 of 10,000 sats to open");
  });

  it("past the goal: 'Fully funded'", async () => {
    const { progressHtml } = await import("./home-page");
    const html = progressHtml(card({ status: "claimable", target_sats: 10_000, balance_sats: 36_030 }), 10_000);
    expect(html).toContain("Fully funded");
    expect(html).not.toContain("Overfunded");
  });

  for (const status of ["in_review", "claimed", "completed"]) {
    it(`${status} below the open amount: just "X sats raised"`, async () => {
      const { progressHtml } = await import("./home-page");
      const html = progressHtml(
        card({ status, claimer: status === "completed" ? null : "alice" }),
        10_000,
      );
      expect(html).toContain("4,000 sats raised");
      expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/to open|goal/);
    });
  }

  it("completed with nothing left: 'Paid out on-chain'", async () => {
    const { progressHtml } = await import("./home-page");
    expect(progressHtml(card({ status: "completed", balance_sats: 0 }), 10_000)).toContain(
      "Paid out on-chain",
    );
  });
});

describe("milestone overdue guards", () => {
  const now = Date.parse("2026-10-18T16:00:00Z");
  const ms = (deadline: string) => [
    { deliverable: "d", verification: "v", out_of_scope: "o", allocation_sats: 1, deadline, id: "m" },
  ];

  it("page hides 'overdue' only while nothing is raised", async () => {
    const { hideMilestoneOverdue } = await import("./proposal-page");
    expect(hideMilestoneOverdue(0)).toBe(true);
    expect(hideMilestoneOverdue(null)).toBe(true);
    expect(hideMilestoneOverdue(undefined)).toBe(true);
    expect(hideMilestoneOverdue(1)).toBe(false);
  });

  it("'due today' still shows when overdue is hidden", async () => {
    const { milestonesHtml } = await import("./proposal-ui");
    const html = milestonesHtml(ms("2026-10-18T12:00:00Z"), now, { hideOverdue: true });
    expect(html).toContain("due today");
  });

  it("a past date is hidden only with hideOverdue", async () => {
    const { milestonesHtml } = await import("./proposal-ui");
    expect(milestonesHtml(ms("2026-01-01T12:00:00Z"), now)).toContain("overdue");
    expect(milestonesHtml(ms("2026-01-01T12:00:00Z"), now, { hideOverdue: true })).not.toContain("overdue");
  });
});

/* ---- finished project: no AI review card (first paint and claim sync) ---- */

const ID = "PLEBLY-2026-010";
const PATH = "proposals/completed/PLEBLY-2026-010.md";
const ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const AI = {
  outcome: "ambiguous",
  reasoning: "Named requirements were not supplied.",
  prompt_version: "intel-mcp-v1",
  model: "m",
};

function preloaded(over: Partial<Proposal> = {}): Proposal {
  return {
    id: ID,
    title: "Josh KH 2-of-3 Release cosign rehearsal",
    status: "completed",
    proposal_type: "bounty",
    path: PATH,
    target_sats: 10_000,
    escrow_address: ADDR,
    escrow_shared: false,
    submission_fee_txid: null,
    created_at: "2026-09-25T00:00:00Z",
    escrow_index: 1,
    milestones: [],
    body: "## Problem\n\nBody.\n",
    balance_sats: 0,
    ...over,
  } as Proposal;
}

function stubFetch(claim: Partial<ClaimStatus> | "pending") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/address\//.test(url)) {
        return Response.json({
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        });
      }
      if (url.includes("/proposals/catalog")) return Response.json({ proposals: [] });
      if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
        if (claim === "pending") return new Promise<Response>(() => undefined);
        return Response.json(claim);
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

async function render(p: Proposal, claim: Partial<ClaimStatus> | "pending"): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  stubFetch(claim);
  const { renderProposalPage } = await import("./proposal-page");
  void renderProposalPage(PATH, (inner) => inner, null, () => undefined, p);
  const app = document.querySelector<HTMLElement>("#app")!;
  await vi.waitFor(() => {
    if (!app.querySelector(".proposal-sidebar")) throw new Error("not painted yet");
  });
  return app;
}

const claimView = (over: Partial<ClaimStatus> = {}): Partial<ClaimStatus> => ({
  proposal_id: ID,
  proposal_path: PATH,
  state: "completed",
  status: "completed",
  confirmed_balance_sats: 0,
  claim_floor_sats: CLAIM_FLOOR_SATS,
  escrow_address: ADDR,
  ...over,
});

describe("finished project: no AI review card", () => {
  beforeAll(async () => {
    await import("./proposal-page");
  }, 30_000);
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  it("first paint (proposal-page guard): completed + ai_review paints no card", async () => {
    const app = await render(preloaded({ ai_review: AI }), "pending");
    expect(app.querySelector(".ai-review-card")).toBeNull();
    expect(app.textContent).not.toContain("needs human review");
  });

  it("control: an in-review project still paints the card on first paint", async () => {
    const app = await render(preloaded({ status: "in_review", ai_review: AI }), "pending");
    expect(app.querySelector(".ai-review-card")).toBeTruthy();
  });

  it("claim sync (builder-panel guard): completed claim view with ai_review adds no card", async () => {
    const app = await render(preloaded(), claimView({ ai_review: AI } as Partial<ClaimStatus>));
    await vi.waitFor(() => {
      const s = app.querySelector("#next-card-sentence")?.textContent || "";
      if (!s || s === "…") throw new Error("claim view not applied");
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(app.querySelector(".ai-review-card")).toBeNull();
  });
});
