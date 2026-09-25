import { describe, expect, it, vi } from "vitest";
import {
  applicationsPanelHtml,
  builderPanelHtml,
  claimerIdentityHtml,
  claimerTrackHtml,
  payoutStatusCardHtml,
} from "./builder-panel";
import {
  nextActionCardHtml,
  nextActionMoreHtml,
  resolveNextAction,
} from "./next-action";
import type { ClaimApplicationsResponse, ClaimStatus } from "./builder";
import type { Proposal } from "./types";

function proposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "demo",
    path: "proposals/listed/demo.md",
    title: "Demo",
    status: "listed",
    target_sats: null,
    escrow_address: "tb1qtest",
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    balance_sats: 200_000,
    ...partial,
  };
}

describe("builderPanelHtml proposal types", () => {
  it("hides claim UI for direct proposals", () => {
    const html = builderPanelHtml(
      proposal({ proposal_type: "direct" }),
      200_000,
      false,
    );
    expect(html).toContain("direct-deliverable-slot");
    expect(html).toContain("payout-status-slot");
    expect(html).toContain("Donate. Paid monthly.");
    expect(html).toContain("data-open-donate");
    expect(html).toContain('id="builder-watch"');
    expect(html).not.toContain("builder-title");
    expect(html).not.toContain("Direct funding");
    expect(html).not.toContain("builder-claim-modal");
    expect(html).not.toContain("Claim this project");
    expect(html).not.toContain("builder-evaluating");
  });

  it("keeps claim modal for bounty proposals", () => {
    const html = builderPanelHtml(proposal({ proposal_type: "bounty" }), 200_000, false);
    expect(html).toContain("builder-claim-modal");
    expect(html).toContain("payout-status-slot");
    expect(html).toContain("Apply with bond");
    expect(html).not.toContain("builder-title");
    expect(html).not.toContain(">Build<");
    expect(html).not.toContain("direct-deliverable-slot");
    expect(html).not.toContain("builder-evaluating");
  });

  it("applies refund-before-bond wizard markup", () => {
    const html = builderPanelHtml(proposal({ proposal_type: "bounty" }), 200_000, false);
    expect(html).toContain("claim-step-refund");
    expect(html).toContain("claim-payout-ack");
    expect(html).toContain('id="claim-bond-slot" hidden');
    expect(html).toContain("Bond returned");
    expect(html).toContain("Bond forfeited");
    expect(html).toContain("withdraw before award");
    expect(html).toContain("Claim window expires");
    expect(html).toContain('name="claim_payout_rail"');
    expect(html).toContain('value="onchain"');
    expect(html).not.toContain('value="lightning"');
    expect(html).toMatch(/presigned PSBT/i);
    expect(html).toMatch(/Direct campaigns only/i);
    expect(html).not.toMatch(/claim-refund-rail-card[^>]*\bhidden\b/);
    expect(html).toContain('aria-describedby="claim-payout-desc"');
    expect(html).toContain('id="claim-next"');
  });

  it("uses progress copy instead of a disabled claim below floor", () => {
    const html = builderPanelHtml(proposal({ balance_sats: 1 }), 1, false);
    expect(html).toContain("Listed — still raising");
    expect(html).not.toContain('id="builder-claim" disabled');
  });

  it("claimed visitor has no Donate primary and keeps Watch", () => {
    const html = builderPanelHtml(proposal({ status: "claimed", claimer: "bob" }), 200_000, false);
    expect(html).toContain("Waiting on the builder.");
    expect(html).toContain('id="builder-watch"');
    expect(html).not.toContain("data-open-donate");
  });
});

describe("claimed-builder More extras", () => {
  it("puts checkpoint, extension, and challenge in More, not a second primary", () => {
    const action = resolveNextAction({
      proposal: proposal({ status: "claimed", claimer: "bob" }),
      claim: {
        proposal_id: "demo",
        proposal_path: "proposals/claimed/demo.md",
        state: "claimed",
        confirmed_balance_sats: 200_000,
        claim_floor_sats: 10_000,
        claimer: "bob",
        can_challenge_abandoned: true,
      },
      user: { id: "github:2", username: "bob", github: "bob" },
    });
    const html = nextActionCardHtml(action, {
      extra: nextActionMoreHtml(action, {
        checkpoint: `<button type="button" class="btn ghost" id="builder-checkpoint">File checkpoint</button>`,
        extension: `<button type="button" class="btn ghost" id="builder-request-extension">Request 30-day extension</button>`,
        challenge: `<button type="button" class="btn ghost" id="builder-challenge">Challenge as abandoned</button>`,
        collab: `<div id="claim-collab-host"></div>`,
        workboard: `<div id="workboard-settings-host"></div>`,
      }),
    });
    expect(html).toContain("Submit the work when it is done.");
    expect(html).toContain('id="builder-deliverable"');
    expect(html).toContain("next-card-more");
    expect(html).toContain("builder-checkpoint");
    expect(html).toContain("builder-request-extension");
    expect(html).not.toContain("builder-challenge");
    expect(html.match(/class="btn"/g)?.length).toBe(1);
    expect(html).not.toContain("data-rev-vote");
    expect(html).not.toContain("data-dec-vote");
    expect(html).not.toMatch(/deliverable_confirm|⌈|tos-2026|decision_id|PSBT/i);
  });
});

describe("payoutStatusCardHtml", () => {
  it("shows drip schedule without other proposal ids", () => {
    const html = payoutStatusCardHtml({
      proposal_id: "PLEBLY-direct-1",
      proposal_type: "direct",
      state: "accruing",
      payout_sats: 95_000,
      freeze_at: "2026-09-01T00:00:00.000Z",
      confirmed_sats: 100_000,
    });
    expect(html).toContain("Next payout");
    expect(html).toContain("this month");
    expect(html).toContain("Paid after");
    expect(html).not.toContain("00:00 UTC");
    expect(html).not.toContain("psbt");
  });
});

describe("claimerTrackHtml", () => {
  const base: ClaimStatus = {
    proposal_id: "p1",
    proposal_path: "proposals/listed/p1.md",
    state: "claimed",
    confirmed_balance_sats: 100_000,
    claim_floor_sats: 10_000,
  };

  it("omits block when summary absent", () => {
    expect(claimerTrackHtml(base)).toBe("");
    expect(claimerTrackHtml({ ...base, claimer_summary: null })).toBe("");
  });

  it("shows no shipped projects when the track is empty", () => {
    expect(
      claimerTrackHtml({
        ...base,
        claimer_summary: {
          active: 0,
          completed: 0,
          expired: 0,
          rejected: 0,
          abandoned: 0,
          track: [],
        },
      }),
    ).toContain("No shipped projects yet");
  });

  it("lists shipped titles and names other results", () => {
    const html = claimerTrackHtml({
      ...base,
      claimer_summary: {
        active: 1,
        completed: 2,
        expired: 1,
        rejected: 1,
        abandoned: 0,
        track: [
          { proposal_id: "ship-a", outcome: "completed", at: "2026-02-01T00:00:00.000Z" },
          { proposal_id: "ship-b", outcome: "completed", at: "2026-01-01T00:00:00.000Z" },
          { proposal_id: "old", outcome: "rejected", at: "2025-12-01T00:00:00.000Z" },
          { proposal_id: "late", outcome: "expired", at: "2025-11-01T00:00:00.000Z" },
        ],
      },
    });
    expect(html).toContain("ship-a");
    expect(html).toContain("ship-b");
    expect(html).toContain("1 not accepted · 1 window expired");
    expect(html).not.toContain("%");
    expect(html).not.toContain("failed");
  });

  it("hides shipped links past five behind more", () => {
    const track = [1, 2, 3, 4, 5, 6].map((n) => ({
      proposal_id: `ship-${n}`,
      outcome: "completed" as const,
      at: `2026-0${n}-01T00:00:00.000Z`,
    }));
    const html = claimerTrackHtml({
      ...base,
      claimer_summary: {
        active: 0,
        completed: 6,
        expired: 0,
        rejected: 0,
        abandoned: 0,
        track,
      },
    });
    expect(html).toContain("ship-1");
    expect(html).toContain(">1 more<");
    expect(html).toContain("ship-6");
  });
});

describe("applicationsPanelHtml", () => {
  const baseApps = (): ClaimApplicationsResponse => ({
    proposal_id: "demo",
    proposal_path: "proposals/listed/demo.md",
    claim_mode: "proposer_select",
    claim_window_days: 7,
    window_started_at: new Date().toISOString(),
    window_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    decision_ends_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    phase: "collecting",
    awarded_application_id: null,
    award_reason: null,
    summary: { total: 1, bonded: 1, pending_bond: 0 },
    applications: [
      {
        id: "app-1",
        claimer_login: "bob",
        claimer_type: "individual",
        bond_status: "bonded",
        bond_sats: 10_000,
        claim_bond_txid: "a".repeat(64),
        applied_at: new Date().toISOString(),
        bonded_at: new Date().toISOString(),
        summary: {
          active: 0,
          completed: 1,
          expired: 0,
          rejected: 0,
          abandoned: 0,
          track: [
            {
              proposal_id: "shipped-one",
              proposal_path: "proposals/completed/shipped-one.md",
              outcome: "completed",
              at: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      },
    ],
    collaborators: [],
    is_proposer: true,
  });

  it("shows accept/reject for proposers and mempool bond link", () => {
    const html = applicationsPanelHtml(baseApps());
    expect(html).toContain("Applicants");
    expect(html).toContain("Proposer picks");
    expect(html).toContain("1 bonded");
    expect(html).toContain("data-accept-app=\"app-1\"");
    expect(html).toContain("data-reject-app=\"app-1\"");
    expect(html).toContain("Bond paid");
    expect(html).toContain("mempool.space");
    expect(html).toContain("shipped-one");
    expect(html).toContain("claim-apps-head");
    expect(html).not.toContain("%");
  });

  it("shows three shipped links on an applicant and folds the rest", () => {
    const track: {
      proposal_id: string;
      outcome: "completed" | "abandoned";
      at: string;
    }[] = [1, 2, 3, 4, 5].map((n) => ({
      proposal_id: `ship-${n}`,
      outcome: "completed" as const,
      at: `2026-0${n}-01T00:00:00.000Z`,
    }));
    track.push({
      proposal_id: "left-it",
      outcome: "abandoned",
      at: "2025-01-01T00:00:00.000Z",
    });
    const apps = baseApps();
    apps.applications[0]!.summary = {
      active: 0,
      completed: 5,
      expired: 0,
      rejected: 0,
      abandoned: 1,
      track,
    };
    const html = applicationsPanelHtml(apps);
    const beforeMore = html.split("<details")[0] || "";
    expect(beforeMore).toContain("ship-1");
    expect(beforeMore).toContain("ship-3");
    expect(beforeMore).not.toContain("ship-4");
    expect(html).toContain(">2 more<");
    expect(html).toContain("ship-5");
    expect(html).toContain("1 left unfinished");
    expect(html).toContain("Award");
    expect(html).toContain("Bond paid");
    expect(html).toContain("claim-apps-head");
  });

  it("hides accept actions for non-proposers", () => {
    const html = applicationsPanelHtml({ ...baseApps(), is_proposer: false });
    expect(html).not.toContain("data-accept-app");
  });

  it("shows first_bonded mode label and empty state", () => {
    const html = applicationsPanelHtml({
      ...baseApps(),
      claim_mode: "first_bonded",
      applications: [],
      summary: { total: 0, bonded: 0, pending_bond: 0 },
      is_proposer: false,
    });
    expect(html).toContain("First bonded wins");
    expect(html).toContain("No applicants yet");
  });

  it("hides pick countdown when no bonded applicants", () => {
    const html = applicationsPanelHtml({
      ...baseApps(),
      applications: [],
      summary: { total: 0, bonded: 0, pending_bond: 0 },
      is_proposer: false,
    });
    expect(html).toContain("Proposer picks · 7d window");
    expect(html).toContain("No applicants yet");
    expect(html).not.toContain("bonded applicant");
    expect(html).not.toContain(" until ");
    expect(html).not.toContain("data-rel-deadline");
  });

  it("shows grace auto-award copy for proposers", () => {
    const html = applicationsPanelHtml({
      ...baseApps(),
      phase: "grace",
      is_proposer: true,
    });
    expect(html).toContain("Auto-awards");
    expect(html).toContain("@bob");
    expect(html).toContain("unless you pick");
    expect(html).toContain("claim-grace-note");
  });

  it("shows Withdraw for the applicant's own open application", () => {
    const html = applicationsPanelHtml({
      ...baseApps(),
      is_proposer: false,
      mine_application_id: "app-1",
      applications: [
        {
          ...baseApps().applications[0]!,
          is_mine: true,
        },
      ],
    });
    expect(html).toContain("data-withdraw-app=\"app-1\"");
    expect(html).toContain("(you)");
    expect(html).not.toContain("data-accept-app");
  });

  it("links org applicants to /org with avatar slot", () => {
    const html = applicationsPanelHtml({
      ...baseApps(),
      is_proposer: false,
      applications: [
        {
          ...baseApps().applications[0]!,
          claimer_login: "acme",
          claimer_type: "org",
          claim_agent: "alice",
        },
      ],
    });
    expect(html).toContain("/org/acme");
    expect(html).toContain('data-avatar-org="acme"');
    expect(html).toContain("github.com/alice");
  });
});

describe("claimerIdentityHtml", () => {
  it("builds org and user identity markup", () => {
    expect(claimerIdentityHtml("acme", "org")).toContain("/org/acme");
    expect(claimerIdentityHtml("bob", "individual")).toContain("/u/bob");
  });
});

describe("sessionIsClaimer", () => {
  it("matches individual claimer by github/username", async () => {
    const { sessionIsClaimer } = await import("./builder-panel");
    const user = {
      id: "github:1",
      github: "alice",
      username: "alice",
    } as const;
    expect(sessionIsClaimer(user as never, "alice", "individual")).toBe(true);
    expect(sessionIsClaimer(user as never, "bob", "individual")).toBe(false);
  });

  it("org claims match claim_agent only, not linked co-admins", async () => {
    const { sessionIsClaimer } = await import("./builder-panel");
    const agent = {
      id: "github:1",
      github: "alice",
      username: "alice",
      github_orgs: [
        {
          login: "acme",
          role: "admin",
          attested_at: new Date().toISOString(),
        },
      ],
    } as const;
    const coAdmin = {
      id: "github:2",
      github: "bob",
      username: "bob",
      github_orgs: agent.github_orgs,
    } as const;
    expect(
      sessionIsClaimer(agent as never, "acme", "org", "alice"),
    ).toBe(true);
    expect(
      sessionIsClaimer(coAdmin as never, "acme", "org", "alice"),
    ).toBe(false);
    expect(sessionIsClaimer(coAdmin as never, "acme", "org")).toBe(false);
  });

  it("matches truncated nostr claimer and pending user_id", async () => {
    const { sessionIsClaimer } = await import("./builder-panel");
    const full =
      "5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6";
    const user = {
      id: `nostr:${full}`,
      nostr: full,
      username: "npub12f2m7",
    } as const;
    expect(
      sessionIsClaimer(user as never, `nostr:${full.slice(0, 12)}`, "individual"),
    ).toBe(true);
    expect(
      sessionIsClaimer(
        user as never,
        "someone-else",
        "individual",
        null,
        `nostr:${full}`,
      ),
    ).toBe(true);
  });
});

describe("sessionIsClaimStatusFulfiller + applyClaimStatus", () => {
  it("matching nostr claimer_user_id is fulfiller while catalog still listed", async () => {
    const { sessionIsClaimStatusFulfiller } = await import("./builder-panel");
    const { applyClaimStatusToProposal } = await import("./builder");
    const { resolveNextAction } = await import("./next-action");
    const { proposalCurrentStep } = await import("./proposal-ui");
    const full =
      "5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6";
    const user = {
      id: `nostr:${full}`,
      nostr: full,
      username: "npub12f2m7",
    };
    const status = {
      proposal_id: "demo",
      proposal_path: "proposals/listed/demo.md",
      state: "claimed" as const,
      status: "listed",
      confirmed_balance_sats: 15_000,
      claim_floor_sats: 10_000,
      claimer: `nostr:${full}`,
      claimer_user_id: `nostr:${full}`,
      psbt: { structured_state: "awaiting_funds" },
    };
    expect(sessionIsClaimStatusFulfiller(user as never, status)).toBe(true);
    const merged = applyClaimStatusToProposal(proposal({ status: "listed" }), status);
    expect(merged.status).toBe("claimed");
    expect(proposalCurrentStep(merged)).toBe("Build");
    const action = resolveNextAction({
      proposal: merged,
      claim: status,
      user: user as never,
      isBuilder: sessionIsClaimStatusFulfiller(user as never, status),
    });
    expect(action.button).toBe("deliverable");
    expect(action.sentence).toContain("Submit the work when it is done");
    expect(action.sentence).toContain("pooling");
  });
});

describe("bindBuilderPanel stepper refresh", () => {
  it("advances Fund→Build via document-scoped stepper even if root misses it", async () => {
    vi.resetModules();
    vi.doMock("./builder", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./builder")>();
      return {
        ...actual,
        fetchClaimStatus: vi.fn(async () => ({
          proposal_id: "demo",
          proposal_path: "proposals/listed/demo.md",
          state: "claimed" as const,
          status: "listed",
          confirmed_balance_sats: 15_000,
          claim_floor_sats: 10_000,
          claimer: "nostr:abc",
          claimer_user_id: "nostr:abc",
          psbt: { structured_state: "awaiting_funds" },
        })),
        fetchClaimApplications: vi.fn(async () => null),
        fetchClaimParams: vi.fn(async () => ({
          claim_bond_sats: 10_000,
          max_active_claims: 1,
          reclaim_cooldown_days: 30,
          checkpoint_day: 45,
          checkpoint_grace_days: 7,
          fee_address: null,
        })),
        fetchPayoutStatus: vi.fn(async () => null),
      };
    });
    vi.doMock("./reviewers", () => ({
      fetchReviewerMe: vi.fn(async () => null),
    }));

    const { bindBuilderPanel, builderPanelHtml } = await import("./builder-panel");
    const { proposalStepperHtml } = await import("./proposal-ui");

    const p = proposal({
      status: "listed",
      balance_sats: 15_000,
      claimer: null,
    });
    const user = {
      id: "nostr:abc",
      nostr: "abc",
      username: "npub1",
    } as never;

    // Stepper is under .proposal-page; pass a root that does not contain it so
    // root.querySelector(".proposal-stepper") misses — document scope must win.
    document.body.innerHTML = `<div id="app">
      <article class="proposal-page">
        <header class="proposal-hero">
          <div class="proposal-hero-top"><h1>Demo</h1></div>
        </header>
        ${proposalStepperHtml(p)}
        <div id="panel-root">${builderPanelHtml(p, 15_000, false, user)}</div>
      </article>
    </div>`;

    expect(
      document.querySelector(".proposal-step-current")?.textContent,
    ).toBe("Fund");

    await bindBuilderPanel(document.querySelector("#panel-root")!, {
      proposal: { ...p },
      balance: 15_000,
      user,
      watching: false,
    });

    const current = document.querySelector(".proposal-step-current");
    expect(current?.textContent).toBe("Build");
    expect(current?.getAttribute("aria-current")).toBe("step");
    expect(document.body.innerHTML).toMatch(/Submit deliverable/);
    expect(
      document.querySelector(".pill-status")?.textContent?.toLowerCase(),
    ).toMatch(/claim/);
  });
});

describe("bindBuilderPanel donate modal after claim escrow", () => {
  it("inserts #donate-modal and opens it when claim status supplies escrow", async () => {
    vi.resetModules();
    const escrow = "tb1qdonateescrowxxxxxxxxxxxxxxxxxxxx";
    vi.doMock("./builder", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./builder")>();
      return {
        ...actual,
        fetchClaimStatus: vi.fn(async () => ({
          proposal_id: "demo",
          proposal_path: "proposals/listed/demo.md",
          state: "claimed" as const,
          status: "listed",
          confirmed_balance_sats: 15_000,
          claim_floor_sats: 10_000,
          claimer: "alice",
          escrow_address: escrow,
          psbt: { structured_state: "awaiting_funds" },
        })),
        fetchClaimApplications: vi.fn(async () => null),
        fetchClaimParams: vi.fn(async () => ({
          claim_bond_sats: 10_000,
          max_active_claims: 1,
          reclaim_cooldown_days: 30,
          checkpoint_day: 45,
          checkpoint_grace_days: 7,
          fee_address: null,
        })),
        fetchPayoutStatus: vi.fn(async () => null),
      };
    });
    vi.doMock("./reviewers", () => ({
      fetchReviewerMe: vi.fn(async () => null),
    }));
    vi.doMock("./lightning", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./lightning")>();
      return {
        ...actual,
        fetchLightningStatus: vi.fn(async () => ({
          enabled: false,
          reason: "test",
        })),
      };
    });

    const { bindBuilderPanel, builderPanelHtml } = await import("./builder-panel");
    const { proposalStepperHtml } = await import("./proposal-ui");

    // First paint: no escrow → no #donate-modal (mirrors escrowOk=false path).
    const p = proposal({
      status: "listed",
      balance_sats: 15_000,
      claimer: null,
      escrow_address: null,
    });

    document.body.innerHTML = `<div id="app">
      <article class="proposal-page">
        <header class="proposal-hero">
          <div class="proposal-hero-top"><h1>Demo</h1></div>
        </header>
        ${proposalStepperHtml(p)}
        <div id="panel-root">${builderPanelHtml(p, 15_000, false, null)}</div>
      </article>
    </div>`;

    expect(document.querySelector("#donate-modal")).toBeNull();

    await bindBuilderPanel(document.querySelector("#app")!, {
      proposal: { ...p },
      balance: 15_000,
      user: null,
      watching: false,
    });

    // Allow void mountDonateChromeWhenEscrowKnown to settle.
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-modal")).toBeTruthy();
    });

    const modal = document.querySelector<HTMLElement>("#donate-modal")!;
    expect(modal.parentElement).toBe(document.body);
    expect(modal.hidden).toBe(true);

    const donateBtn = document.querySelector<HTMLButtonElement>(
      "[data-open-donate], #donate-open",
    );
    expect(donateBtn).toBeTruthy();
    donateBtn!.click();
    await vi.waitFor(() => {
      expect(modal.hidden).toBe(false);
      expect(document.body.classList.contains("modal-open")).toBe(true);
    });
  });

  it("opens modal when Donate is clicked before claim escrow arrives", async () => {
    vi.resetModules();
    const escrow = "tb1qclickbeforeclaimxxxxxxxxxxxxxxxxx";
    let resolveClaim!: (v: unknown) => void;
    const claimGate = new Promise((r) => {
      resolveClaim = r;
    });
    vi.doMock("./builder", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./builder")>();
      return {
        ...actual,
        fetchClaimStatus: vi.fn(async () => {
          await claimGate;
          return {
            proposal_id: "demo",
            proposal_path: "proposals/listed/demo.md",
            state: "in_review" as const,
            status: "in_review",
            confirmed_balance_sats: 15_000,
            claim_floor_sats: 10_000,
            claimer: "alice",
            escrow_address: escrow,
            psbt: { structured_state: "awaiting_funds" },
          };
        }),
        fetchClaimApplications: vi.fn(async () => null),
        fetchClaimParams: vi.fn(async () => ({
          claim_bond_sats: 10_000,
          max_active_claims: 1,
          reclaim_cooldown_days: 30,
          checkpoint_day: 45,
          checkpoint_grace_days: 7,
          fee_address: null,
        })),
        fetchPayoutStatus: vi.fn(async () => null),
      };
    });
    vi.doMock("./reviewers", () => ({
      fetchReviewerMe: vi.fn(async () => null),
    }));
    vi.doMock("./lightning", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./lightning")>();
      return {
        ...actual,
        fetchLightningStatus: vi.fn(async () => ({
          enabled: false,
          reason: "test",
        })),
      };
    });

    const { bindBuilderPanel, builderPanelHtml } = await import("./builder-panel");
    const { proposalStepperHtml } = await import("./proposal-ui");

    const p = proposal({
      status: "listed",
      balance_sats: 15_000,
      claimer: null,
      escrow_address: null,
    });

    document.body.innerHTML = `<div id="app">
      <article class="proposal-page">
        <header class="proposal-hero">
          <div class="proposal-hero-top"><h1>Demo</h1></div>
        </header>
        ${proposalStepperHtml(p)}
        <div id="panel-root">${builderPanelHtml(p, 15_000, false, null)}</div>
      </article>
    </div>`;

    expect(document.querySelector("#donate-modal")).toBeNull();
    const donateBtn = document.querySelector<HTMLButtonElement>(
      "[data-open-donate], #donate-open",
    );
    expect(donateBtn).toBeTruthy();

    // Start bind (claim fetch hanging) then click Donate immediately.
    const bound = bindBuilderPanel(document.querySelector("#app")!, {
      proposal: { ...p },
      balance: 15_000,
      user: null,
      watching: false,
    });
    donateBtn!.click();
    // Sync shell on body immediately — must not wait for /claims.
    const shell = document.querySelector<HTMLElement>("#donate-modal");
    expect(shell).toBeTruthy();
    expect(shell!.parentElement).toBe(document.body);
    expect(shell!.hidden).toBe(false);
    expect(document.body.classList.contains("modal-open")).toBe(true);

    resolveClaim(undefined);
    await bound;
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-address")?.textContent).toBe(
        escrow,
      );
      const modal = document.querySelector<HTMLElement>("#donate-modal");
      expect(modal).toBeTruthy();
      expect(modal!.hidden).toBe(false);
      expect(modal!.parentElement).toBe(document.body);
    });
  });

  it("keeps #donate-modal on body after .proposal-page innerHTML churn", async () => {
    vi.resetModules();
    const escrow = "tb1qchurnsurvivexxxxxxxxxxxxxxxxxxxxx";
    vi.doMock("./builder", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./builder")>();
      return {
        ...actual,
        fetchClaimStatus: vi.fn(async () => ({
          proposal_id: "demo",
          proposal_path: "proposals/listed/demo.md",
          state: "in_review" as const,
          status: "in_review",
          confirmed_balance_sats: 15_000,
          claim_floor_sats: 10_000,
          claimer: "alice",
          escrow_address: escrow,
          psbt: { structured_state: "awaiting_funds" },
        })),
        fetchClaimApplications: vi.fn(async () => null),
        fetchClaimParams: vi.fn(async () => ({
          claim_bond_sats: 10_000,
          max_active_claims: 1,
          reclaim_cooldown_days: 30,
          checkpoint_day: 45,
          checkpoint_grace_days: 7,
          fee_address: null,
        })),
        fetchPayoutStatus: vi.fn(async () => null),
      };
    });
    vi.doMock("./reviewers", () => ({
      fetchReviewerMe: vi.fn(async () => null),
    }));
    vi.doMock("./lightning", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./lightning")>();
      return {
        ...actual,
        fetchLightningStatus: vi.fn(async () => ({
          enabled: false,
          reason: "test",
        })),
      };
    });

    const { bindBuilderPanel, builderPanelHtml } = await import("./builder-panel");
    const { proposalStepperHtml } = await import("./proposal-ui");

    const p = proposal({
      status: "listed",
      balance_sats: 15_000,
      claimer: null,
      escrow_address: null,
    });

    document.body.innerHTML = `<div id="app">
      <article class="proposal-page">
        <header class="proposal-hero">
          <div class="proposal-hero-top"><h1>Demo</h1></div>
        </header>
        ${proposalStepperHtml(p)}
        <div id="panel-root">${builderPanelHtml(p, 15_000, false, null)}</div>
      </article>
    </div>`;

    await bindBuilderPanel(document.querySelector("#app")!, {
      proposal: { ...p },
      balance: 15_000,
      user: null,
      watching: false,
    });

    await vi.waitFor(() => {
      expect(document.querySelector("#donate-modal")).toBeTruthy();
    });
    expect(document.querySelector("#donate-modal")?.parentElement).toBe(
      document.body,
    );

    // Simulate claimer/authed path rewriting the article (must not wipe modal).
    const page = document.querySelector(".proposal-page")!;
    page.innerHTML = `<p class="churn">rewritten</p>
      <button type="button" data-open-donate>Donate</button>`;

    expect(document.querySelector("#donate-modal")).toBeTruthy();
    expect(document.querySelector("#donate-modal")?.parentElement).toBe(
      document.body,
    );

    document.querySelector<HTMLButtonElement>("[data-open-donate]")!.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLElement>("#donate-modal")!.hidden,
      ).toBe(false);
    });
  });

  it("opens modal via claims fetch on Donate click when context lacks promise", async () => {
    vi.resetModules();
    const escrow = "tb1qclickfetchfallbackxxxxxxxxxxxxxxxx";
    vi.doMock("./builder", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./builder")>();
      return {
        ...actual,
        fetchClaimStatus: vi.fn(async () => ({
          proposal_id: "demo",
          proposal_path: "proposals/listed/demo.md",
          state: "in_review" as const,
          status: "in_review",
          confirmed_balance_sats: 15_000,
          claim_floor_sats: 10_000,
          claimer: "alice",
          escrow_address: escrow,
          psbt: { structured_state: "awaiting_funds" },
        })),
        fetchClaimApplications: vi.fn(async () => null),
        fetchClaimParams: vi.fn(async () => ({
          claim_bond_sats: 10_000,
          max_active_claims: 1,
          reclaim_cooldown_days: 30,
          checkpoint_day: 45,
          checkpoint_grace_days: 7,
          fee_address: null,
        })),
        fetchPayoutStatus: vi.fn(async () => null),
      };
    });
    vi.doMock("./lightning", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./lightning")>();
      return {
        ...actual,
        fetchLightningStatus: vi.fn(async () => ({
          enabled: false,
          reason: "test",
        })),
      };
    });

    const {
      setDonateChromeContext,
      bindDonateModal,
      ensureDonateModalMounted,
    } = await import("./proposal-ui");

    const p = proposal({
      status: "listed",
      balance_sats: 15_000,
      claimer: null,
      escrow_address: null,
    });

    document.body.innerHTML = `<div id="app">
      <article class="proposal-page">
        <button type="button" data-open-donate id="donate-open">Donate</button>
      </article>
    </div>`;

    setDonateChromeContext({
      root: document,
      proposal: p,
      panelOpts: {
        address: "",
        proposalId: p.id,
        proposalPath: p.path,
        proposalTitle: p.title,
        signedIn: true,
      },
      // No in-flight promise — click path must fetchClaimStatus itself.
      claimStatusPromise: null,
    });
    bindDonateModal(document);

    document.querySelector<HTMLButtonElement>("#donate-open")!.click();
    // Shell appears sync; escrow fills after mocked /claims.
    expect(document.querySelector("#donate-modal")?.parentElement).toBe(
      document.body,
    );
    expect(document.querySelector<HTMLElement>("#donate-modal")!.hidden).toBe(
      false,
    );
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-address")?.textContent).toBe(
        escrow,
      );
      const modal = document.querySelector<HTMLElement>("#donate-modal");
      expect(modal).toBeTruthy();
      expect(modal!.hidden).toBe(false);
      expect(modal!.parentElement).toBe(document.body);
    });

    // ensure helper remains queryable via document
    const again = await ensureDonateModalMounted(document);
    expect(again?.id).toBe("donate-modal");
  });

  it("sync-inserts #donate-modal on click before claim escrow resolves", async () => {
    const escrow = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
    let resolveClaim!: (v: unknown) => void;
    const claimPromise = new Promise((resolve) => {
      resolveClaim = resolve;
    });

    vi.resetModules();
    vi.doMock("./builder", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./builder")>();
      return {
        ...actual,
        fetchClaimStatus: vi.fn(async () => claimPromise),
        fetchClaimApplications: vi.fn(async () => null),
        fetchClaimParams: vi.fn(async () => ({
          claim_bond_sats: 10_000,
          max_active_claims: 1,
          reclaim_cooldown_days: 30,
          checkpoint_day: 45,
          checkpoint_grace_days: 7,
          fee_address: null,
        })),
        fetchPayoutStatus: vi.fn(async () => null),
      };
    });
    vi.doMock("./lightning", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./lightning")>();
      return {
        ...actual,
        fetchLightningStatus: vi.fn(async () => ({
          enabled: false,
          reason: "test",
        })),
      };
    });

    const {
      setDonateChromeContext,
      installDonateClickCapture,
    } = await import("./proposal-ui");

    const p = proposal({
      status: "listed",
      balance_sats: 15_000,
      claimer: null,
      escrow_address: null,
    });

    document.body.innerHTML = `<div id="app">
      <article class="proposal-page">
        <button type="button" data-open-donate id="donate-open">Donate</button>
      </article>
    </div>`;

    // No escrow on proposal; capture installed like main.ts (no builder bind).
    setDonateChromeContext({
      root: document,
      proposal: p,
      panelOpts: {
        address: "",
        proposalId: p.id,
        proposalPath: p.path,
        proposalTitle: p.title,
        signedIn: false,
      },
      claimStatusPromise: null,
    });
    installDonateClickCapture();

    expect(document.querySelector("#donate-modal")).toBeNull();
    document.querySelector<HTMLButtonElement>("#donate-open")!.click();

    // Sync: modal is on body and visible before /claims resolves.
    const shell = document.querySelector<HTMLElement>("#donate-modal");
    expect(shell).toBeTruthy();
    expect(shell!.parentElement).toBe(document.body);
    expect(shell!.hidden).toBe(false);

    resolveClaim({
      proposal_id: p.id,
      proposal_path: p.path,
      state: "in_review",
      status: "in_review",
      confirmed_balance_sats: 15_000,
      claim_floor_sats: 10_000,
      claimer: "alice",
      escrow_address: escrow,
      title: p.title,
    });

    await vi.waitFor(() => {
      expect(document.querySelector("#donate-address")?.textContent).toBe(
        escrow,
      );
      const modal = document.querySelector<HTMLElement>("#donate-modal");
      expect(modal).toBeTruthy();
      expect(modal!.hidden).toBe(false);
      expect(modal!.parentElement).toBe(document.body);
    });
  });
});
