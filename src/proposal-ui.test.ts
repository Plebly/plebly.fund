import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  bindStructuredFunding,
  canEditProposal,
  deliverableChipHtml,
  donatePanelHtml,
  fundingBarScale,
  fundingBarTrackHtml,
  fundingProgressHtml,
  isPastFundingTarget,
  metaChipsHtml,
  milestonesHtml,
  structuredFundingPanelHtml,
  structuredFundingBodyHtml,
  structuredFundingStageSentence,
  structureOutRoleLabel,
  branchSignoffStageLabel,
  proposalContextHtml,
  proposalFundingBarHtml,
  proposalLifecycleBannersHtml,
  proposalCurrentStep,
  proposalStepperHtml,
  proposalShareUrl,
  proposerBylineHtml,
  ballotPanelHtml,
  refundRegisterHtml,
  shareSlotHtml,
  statusClass,
  projectOutcomeHtml,
  statusLabel,
  statusPillHtml,
  userMatchesProposer,
} from "./proposal-ui";
import type { Proposal, ProposalMilestone } from "./types";
import { applyClaimStatusToProposal, type ClaimStatus } from "./builder";

const locationState = {
  origin: "https://plebly.fund",
  pathname: "/p/PLEBLY-1",
  search: "",
  hash: "",
};

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    value: { location: locationState },
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    get: () => locationState,
    configurable: true,
  });
});

describe("proposal UI critical render helpers", () => {
  it("proposerBylineHtml links site username to profile", () => {
    const html = proposerBylineHtml(
      { username: "secsovereign", github: null },
      (u) => `/u/${u}`,
    );
    expect(html).toContain(">by<");
    expect(html).toContain('href="/u/secsovereign"');
    expect(html).toContain(">secsovereign<");
    expect(html).toContain('data-avatar-user="secsovereign"');
  });

  it("proposerBylineHtml falls back to github link", () => {
    const html = proposerBylineHtml(
      { username: null, github: "alice" },
      (u) => `/u/${u}`,
    );
    expect(html).toContain("https://github.com/alice");
  });

  it("proposerBylineHtml empty without identity", () => {
    expect(proposerBylineHtml(null, (u) => `/u/${u}`)).toBe("");
    expect(proposerBylineHtml({}, (u) => `/u/${u}`)).toBe("");
  });

  it("proposerBylineHtml links org proposers to /org/:login", () => {
    const html = proposerBylineHtml(
      { username: null, github: "plebly" },
      (u) => `/u/${u}`,
      { proposer_type: "org", orgHref: (l) => `/org/${l}` },
    );
    expect(html).toContain('href="/org/plebly"');
    expect(html).toContain(">plebly<");
    expect(html).not.toContain("@plebly");
    expect(html).not.toContain("https://github.com/plebly");
    expect(html).not.toContain("/u/");
  });

  it("milestonesHtml renders rail with verify + sats total", () => {
    const milestones: ProposalMilestone[] = [
      {
        id: "m1",
        deliverable: "Ship checklist at https://example.com/check",
        verification: "Page loads via https://example.com/verify",
        out_of_scope: "Mainnet",
        allocation_sats: 50_000,
        deadline: "2026-08-15",
      },
      {
        id: "m2",
        deliverable: "Fund path",
        verification: "Balance updates",
        out_of_scope: "Multisig",
        allocation_sats: 50_000,
        deadline: "2026-09-15",
      },
    ];
    const now = Date.parse("2026-07-26T17:00:00.000Z");
    const html = milestonesHtml(milestones, now);
    expect(html).toContain("proposal-milestones");
    expect(html).toContain("milestone-rail");
    expect(html).toContain("Out of scope");
    expect(html).toContain("Mainnet");
    expect(html).toContain("Ship checklist");
    expect(html).toContain("Verify");
    expect(html).toContain("Page loads");
    expect(html).toContain('href="https://example.com/check"');
    expect(html).toContain('href="https://example.com/verify"');
    expect(html).toMatch(/100[,.]?000|100k/i);
    expect(html).toContain("Due");
    expect(html).toContain("milestone-rail-due-rel");
    expect(html).toMatch(/in \d+ (week|month)s?/);
  });

  it("milestonesHtml empty when no milestones", () => {
    expect(milestonesHtml([])).toBe("");
  });

  it("status helpers cover ballot/refund states", () => {
    expect(statusLabel("abandoned_vote")).toBe("abandoned vote");
    expect(statusLabel("listed")).toBe("Listed — still raising");
    expect(statusLabel("claimable")).toBe("Claimable");
    expect(statusLabel("in_review")).toBe("In review");
    expect(statusClass("abandoned_vote")).toBe("status-active");
    expect(statusClass("refunding")).toBe("status-bad");
    expect(statusClass("underfunded")).toBe("status-active");
    expect(statusClass("in_review")).toBe("status-active");
    expect(statusClass("rejected")).toBe("status-bad");
  });

  it("states a closed project in one sentence", () => {
    expect(projectOutcomeHtml("listed")).toBe("");
    expect(projectOutcomeHtml("completed")).toContain("Shipped.");
    expect(projectOutcomeHtml("completed", "ada")).toContain("Shipped by @ada.");
    expect(projectOutcomeHtml("refunding")).toContain("Refunding.");
    expect(projectOutcomeHtml("declined_fundable")).toContain("Declined.");
    expect(projectOutcomeHtml("declined")).toContain("Declined.");
    expect(projectOutcomeHtml("underfunded")).toContain("Underfunded.");
    expect(projectOutcomeHtml("redirected")).toContain("Redirected.");
    expect(projectOutcomeHtml("claimed")).toBe("");
    expect(projectOutcomeHtml("refunding", "ada")).not.toContain("@ada");
  });

  it("statusPillHtml shows canonical labels including listed", () => {
    expect(statusPillHtml("listed")).toContain("Listed — still raising");
    expect(statusPillHtml("claimable")).toContain("Claimable");
    expect(statusPillHtml("in_review")).toContain("In review");
    expect(statusPillHtml("funding")).toContain("funding");
    expect(statusPillHtml("funding")).toContain("pill-status");
  });

  it("lifecycle banners skip in_review and rejected", () => {
    const review = proposalLifecycleBannersHtml({
      status: "in_review",
      milestones: [],
    } as Proposal);
    expect(review).toBe("");
    expect(review).not.toContain("In review");
    expect(review).not.toContain("Donor check");
    expect(review).not.toContain("AI first-pass");

    const rejected = proposalLifecycleBannersHtml({
      status: "rejected",
      milestones: [],
    } as Proposal);
    expect(rejected).toBe("");
    expect(rejected).not.toContain("rebuttal");
    expect(rejected).not.toContain("third appeal");
  });

  it("donor-window clock is not a second banner", () => {
    const exp = new Date(Date.now() + 4 * 86400_000).toISOString();
    const html = proposalLifecycleBannersHtml({
      status: "in_review",
      milestones: [],
      donor_review_status: "window_open",
      donor_review_expires_at: exp,
    } as Proposal);
    expect(html).toBe("");
    expect(html).not.toContain("Donor check");
    expect(html).not.toContain("4 days left");
  });

  it("emits at most one banner when stall, funding window, and milestones could all fire", () => {
    const html = proposalLifecycleBannersHtml({
      status: "listed",
      milestones: [],
      release_blocked_reason: "Keyholder stall",
      release_blocked_seats: [2],
      funding_window_ends_at: new Date(Date.now() + 5 * 86400_000).toISOString(),
      milestones_due_at: new Date(Date.now() + 10 * 86400_000).toISOString(),
    } as Proposal);
    expect(html.match(/lifecycle-banner/g)?.length).toBe(1);
    expect(html).toContain("Release stalled");
    expect(html).not.toContain("Funding window");
    expect(html).not.toContain("Milestones");
  });

  it("rejected clock lives on the card, not a banner", () => {
    const exp = new Date(Date.now() + 5 * 86400_000).toISOString();
    const html = proposalLifecycleBannersHtml({
      status: "rejected",
      milestones: [],
      rebuttal_expires_at: exp,
    } as Proposal);
    expect(html).toBe("");
    expect(html).not.toContain("5 days left");
  });

  it("in_review never Fund stepper (catalog/runtime overlay shape)", () => {
    const p = {
      id: "PLEBLY-2026-003",
      path: "proposals/listed/PLEBLY-2026-003.md",
      title: "Wave B",
      status: "in_review",
      claimer: "bob",
      target_sats: null,
      escrow_address: "tb1qtest",
      milestones: [],
    } as Proposal;
    const html = proposalStepperHtml(p);
    expect(html).toContain('aria-current="step"');
    expect(html).toMatch(/proposal-step-current[^>]*>Review</);
    expect(html).not.toMatch(/proposal-step-current[^>]*>Fund</);
  });

  it("stall banner prints seat numbers and no forced exit", () => {
    const html = proposalLifecycleBannersHtml({
      status: "completed",
      milestones: [],
      release_blocked_reason: "Keyholder stall",
      release_blocked_seats: [1, 4],
    } as Proposal);
    expect(html).toContain("seat 1");
    expect(html).toContain("seat 4");
    expect(html).not.toContain("on-chain");
    expect(html).not.toContain("forced");
  });

  it("stepper uses claimed after applyClaimStatusToProposal overlays listed", () => {
    const listed = {
      id: "PLEBLY-2026-001",
      path: "proposals/listed/PLEBLY-2026-001.md",
      title: "Demo",
      status: "listed",
      target_sats: null,
      escrow_address: "tb1qtest",
      submission_fee_txid: null,
      created_at: null,
      escrow_index: null,
      milestones: [],
      body: "",
      balance_sats: 15_000,
      claimer: null,
    } as Proposal;
    expect(proposalCurrentStep(listed)).toBe("Fund");
    const claim: ClaimStatus = {
      proposal_id: "PLEBLY-2026-001",
      proposal_path: listed.path,
      state: "claimed",
      status: "listed",
      confirmed_balance_sats: 15_000,
      claim_floor_sats: 10_000,
      claimer:
        "nostr:5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
    };
    const merged = applyClaimStatusToProposal(listed, claim);
    expect(proposalCurrentStep(merged)).toBe("Build");
    const html = proposalStepperHtml(merged);
    expect(html).toMatch(
      /proposal-step-current"[^>]*>Build<\/li>/,
    );
    expect(html).not.toMatch(
      /proposal-step-current"[^>]*>Fund<\/li>/,
    );
  });

  it("stepper marks in_review as Review", () => {
    const p = { status: "in_review", milestones: [] } as Proposal;
    expect(proposalCurrentStep(p)).toBe("Review");
    expect(proposalStepperHtml(p)).toContain("aria-current=\"step\"");
    expect(proposalStepperHtml(p)).toContain("Review");
    expect(proposalStepperHtml({ ...p, proposal_type: "direct" })).not.toContain(
      ">Award</li>",
    );
    const rejected = proposalStepperHtml({
      ...p,
      status: "rejected",
    } as Proposal);
    expect(rejected).toContain("Rebuttal");
    expect(rejected).toContain('aria-current="step"');
  });

  it("lifecycle banners cover refunding with Funds copy", () => {
    const html = proposalLifecycleBannersHtml({
      status: "refunding",
      milestones: [],
    } as Proposal);
    expect(html).toContain("Refunding");
    expect(html).toContain("Account");
    expect(html).not.toContain("Sparrow");
  });

  it("lifecycle banners open contributor ballot for underfunded with escrow", () => {
    const withBal = proposalLifecycleBannersHtml(
      { status: "underfunded", milestones: [] } as Proposal,
      50_000,
    );
    expect(withBal).toContain("Vote open");
    expect(withBal).toContain("Donors are voting");

    const empty = proposalLifecycleBannersHtml(
      { status: "underfunded", milestones: [] } as Proposal,
      0,
    );
    expect(empty).toContain("Underfunded");
    expect(empty).toContain("could open");
    expect(empty).not.toContain("Vote open");
  });

  it("refundRegisterHtml includes status host for signed-in funder", () => {
    const html = refundRegisterHtml("p1");
    expect(html).toContain('id="refund-panel"');
    expect(html).toContain("refund-status");
    expect(html).toContain("refund-register-form");
    expect(html).toContain("refund_rail");
    expect(html).toContain("refund-swap-id");
  });

  it("ballot panel keeps a stable host id", () => {
    const html = ballotPanelHtml("p1");
    expect(html).toContain('id="ballot-panel"');
    expect(html).toContain('data-proposal-id="p1"');
  });

  it("lifecycle banners do not mention delivery-window refunds", () => {
    const expired = new Date(Date.now() - 86400_000).toISOString();
    const html = proposalLifecycleBannersHtml({
      status: "listed",
      proposal_type: "direct",
      delivery_window_ends_at: expired,
      milestones: [],
    } as Proposal);
    expect(html).not.toContain("Delivery window");
    expect(html).not.toContain("refund path");
  });

  it("donate panel is a credit-then-pay wizard", () => {
    const signedOut = donatePanelHtml({
      escrow_address: "tb1qtest",
    } as Proposal);
    expect(signedOut).toContain('id="donate-step-credit"');
    expect(signedOut).toContain('id="donate-step-pay"');
    expect(signedOut).toContain("Continue anonymously");
    expect(signedOut).toContain("Get credit for this donation");
    expect(signedOut).toContain("donate-credit-advisory");
    expect(signedOut).toContain("sign in first");
    expect(signedOut).not.toContain("Step 1 of 2");
    expect(signedOut).not.toContain("Step 2 of 2");
    expect(signedOut).not.toContain("Change credit preferences");
    expect(signedOut).not.toContain("donate-credit-public");

    const signedIn = donatePanelHtml(
      { escrow_address: "tb1qtest" } as Proposal,
      { signedIn: true },
    );
    expect(signedIn).toContain("Funder credit");
    expect(signedIn).toContain("Step 1 of 2");
    expect(signedIn).toContain("Step 2 of 2");
    expect(signedIn).toContain("donate-credit-public");
    expect(signedIn).toContain("donate-credit-amount");
    expect(signedIn).toContain("Continue to payment");
    expect(signedIn).toContain("Change credit preferences");
    expect(signedIn).toContain("Legal name for tax receipt (optional)");
    expect(signedIn).toContain('id="donate-legal-name"');
    expect(signedOut).not.toContain("donate-legal-name");
    expect(signedOut).toContain("DONATE / ESCROW ADDRESS");
    expect(signedOut).toContain("Not claim bond · not payout");
    expect(signedOut).toContain("Send any amount here on");
    expect(signedOut).toContain('id="donate-escrow-label"');
    expect(signedIn).toContain("DONATE / ESCROW ADDRESS");
    expect(signedIn).toContain("Not claim bond · not payout");
  });

  it("meta chips show type and tags", () => {
    const html = metaChipsHtml({
      id: "PLEBLY-1",
      proposal_type: "direct",
      tags: ["knots", "policy"],
      created_at: null,
    } as Proposal);
    expect(html).toContain("Campaign");
    expect(html).toContain("knots");
    expect(html).toContain("policy");
    expect(html).toContain("PLEBLY-1");
  });

  it("userMatchesProposer / canEditProposal identity gates", () => {
    const proposer = { username: "alice", github: "alice-gh" };
    expect(
      userMatchesProposer({ username: "alice" }, proposer),
    ).toBe(true);
    expect(
      userMatchesProposer({ github: "alice-gh" }, proposer),
    ).toBe(true);
    expect(userMatchesProposer({ username: "bob" }, proposer)).toBe(false);
    expect(canEditProposal({ username: "alice" }, proposer, "listed")).toBe(
      true,
    );
    expect(canEditProposal({ username: "alice" }, proposer, "claimed")).toBe(
      false,
    );
  });

  it("userMatchesProposer matches fresh org admin", () => {
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const orgProposer = { github: "plebly", agent: "alice", id: "github:1" };
    expect(
      userMatchesProposer(
        {
          id: "github:2",
          github: "carol",
          github_orgs: [
            { login: "plebly", role: "admin", verified_at: fresh },
          ],
        },
        orgProposer,
        "org",
      ),
    ).toBe(true);
    expect(
      userMatchesProposer(
        {
          id: "github:2",
          github: "carol",
          github_orgs: [
            { login: "plebly", role: "admin", verified_at: stale },
          ],
        },
        orgProposer,
        "org",
      ),
    ).toBe(false);
    expect(
      canEditProposal(
        {
          id: "github:2",
          github: "carol",
          github_orgs: [
            { login: "plebly", role: "admin", verified_at: fresh },
          ],
        },
        orgProposer,
        "listed",
        "org",
      ),
    ).toBe(true);
  });

  it("deliverableChipHtml only accepts https URLs", () => {
    expect(deliverableChipHtml("http://insecure.example")).toBe("");
    expect(deliverableChipHtml("https://example.com/out")).toContain(
      "example.com/out",
    );
  });

  it("milestonesHtml tucks verify/oos behind details", () => {
    const html = milestonesHtml([
      {
        id: "m1",
        deliverable: "Ship checklist",
        verification: "Page loads",
        out_of_scope: "Mainnet",
        allocation_sats: 50_000,
        deadline: "2026-08-15",
      },
    ]);
    expect(html).toContain("milestone-more");
    expect(html).toContain("<summary>Details</summary>");
  });

  it("proposalContextHtml merges deps and related work", () => {
    const html = proposalContextHtml(
      [
        {
          kind: "external",
          label: "Prior",
          ref: "https://example.com/dep",
          note: "See also https://example.com/note",
        },
      ],
      [
        {
          label: "Spec",
          url: "https://example.com/spec",
          note: "Background at https://example.com/bg",
        },
      ],
    );
    expect(html).toContain("proposal-context");
    expect(html).toContain("Depends on");
    expect(html).toContain("Related work");
    expect(html).toContain("Prior");
    expect(html).toContain("Spec");
    expect(html).toContain('href="https://example.com/dep"');
    expect(html).toContain('href="https://example.com/spec"');
    expect(html).toContain('href="https://example.com/note"');
    expect(html).toContain('href="https://example.com/bg"');
  });

  it("funding bar stays slim without duplicate stats", () => {
    const html = proposalFundingBarHtml(50_000, 100_000, 500_000);
    expect(html).toContain("funding-meter");
    expect(html).toContain("50,000 sats to open");
    expect(html).toContain(
      "50,000 sats / 100,000 sats to open (50%) · goal 500,000 sats (10%)",
    );
    expect(html).toContain("funding-marker-floor");
    expect(html).not.toContain("funding-marker-lock");
    expect(html).not.toContain("proposal-stats");
  });

  it("funding bar always labels the open threshold separately from target", () => {
    const html = proposalFundingBarHtml(5_000, 10_000, 100_000);
    expect(html).toContain("5,000 sats to open");
    expect(html).toContain("10,000 sats to open");
    expect(html).toContain("goal 100,000 sats");
    expect(html).not.toMatch(/\/ 100,000 sats · /);
  });

  it("funding bar shows lock markers only for funding_threshold_sats", () => {
    const html = proposalFundingBarHtml(50_000, 10_000, 200_000, [
      {
        deliverable: "Ship A",
        verification: "PR merged with tests",
        out_of_scope: "Docs",
        allocation_sats: 100_000,
        funding_threshold_sats: 100_000,
        deadline: "2026-12-01",
        id: "m1",
      },
    ]);
    expect(html).toContain("funding-marker-threshold");
    expect(html).toContain("funding-marker-lock");
    expect(html).toContain("is-locked");
  });

  it("card track scales to target and does not treat floor as the ceiling", () => {
    const html = fundingBarTrackHtml(5_000, 10_000, "progress", 100_000);
    expect(html).toContain('aria-valuemax="100000"');
    expect(html).toContain('style="width:5%"');
    expect(html).toContain("progress-floor");
    expect(html).not.toContain("progress-toward-target");

    const pastFloor = fundingBarTrackHtml(50_000, 10_000, "progress", 100_000);
    expect(pastFloor).toContain("progress-toward-target");
    expect(pastFloor).toContain('style="width:10%"'); // green to floor
    expect(pastFloor).toContain('style="width:40%"'); // tertiary toward target
  });

  it("labels open-to-claim past floor and overfunded only past target", () => {
    expect(isPastFundingTarget(50_000, 100_000)).toBe(false);
    expect(isPastFundingTarget(100_001, 100_000)).toBe(true);
    expect(isPastFundingTarget(1_000_000, null)).toBe(false);

    const pastFloor = fundingProgressHtml(50_000, 10_000, 100_000);
    expect(pastFloor).toContain("Open to apply");
    expect(pastFloor).not.toContain("Overfunded");

    const pastTarget = fundingProgressHtml(250_000, 10_000, 100_000);
    expect(pastTarget).toContain("Overfunded");
    expect(pastTarget).toContain("target");
    expect(pastTarget).not.toContain("claim floor");

    const noTarget = fundingProgressHtml(50_000, 10_000, null);
    expect(noTarget).toContain("Open to apply");
    expect(noTarget).not.toContain("Overfunded");
  });

  it("does not show Open to apply when claimed or awarded", () => {
    const claimed = fundingProgressHtml(50_000, 10_000, 100_000, [], {
      status: "claimed",
      claimer: "alice",
      proposal_type: "bounty",
    });
    expect(claimed).toContain("Claimed");
    expect(claimed).not.toContain("Open to apply");
    expect(claimed).not.toContain("claimable");
    expect(claimed).not.toContain("to open");
    expect(claimed).toContain("50,000 sats / 10,000 sats floor");
    expect(claimed).not.toContain("Opens for builders");
    expect(claimed).toContain("Claim floor 10,000 sats, reached");

    const claimableOpen = fundingProgressHtml(50_000, 10_000, 100_000, [], {
      status: "claimable",
      proposal_type: "bounty",
    });
    expect(claimableOpen).toContain("Open to apply");
    expect(claimableOpen).toContain("to open");
    expect(claimableOpen).toContain("Opens for builders");

    const withClaimer = fundingProgressHtml(50_000, 10_000, null, [], {
      status: "claimable",
      claimer: "bob",
    });
    expect(withClaimer).not.toContain("Open to apply");
    expect(withClaimer).toContain("Applications closed");
    expect(withClaimer).not.toContain("to open");
    expect(withClaimer).toContain("floor ·");
  });

  it("keeps to-open goal copy while still funding toward the floor", () => {
    const funding = fundingProgressHtml(5_000, 10_000, null, [], {
      status: "listed",
      proposal_type: "bounty",
    });
    expect(funding).toContain("5,000 sats to open");
    expect(funding).toContain("5,000 sats / 10,000 sats to open");
    expect(funding).toContain("Opens for builders");
  });

  it("fundingBarScale always includes floor and ignores allocation-only milestones", () => {
    const empty = fundingBarScale(10_000, null, []);
    expect(empty.scale).toBe(10_000);
    expect(empty.markers).toEqual([
      expect.objectContaining({ kind: "floor", sats: 10_000 }),
    ]);

    const withTarget = fundingBarScale(10_000, 500_000, [
      {
        deliverable: "A",
        verification: "Bbbbbbbbbb",
        out_of_scope: "C",
        allocation_sats: 250_000,
        deadline: "2026-12-01",
      },
    ]);
    expect(withTarget.scale).toBe(500_000);
    expect(withTarget.markers.every((m) => m.kind === "floor")).toBe(true);

    const withThreshold = fundingBarScale(10_000, 200_000, [
      {
        deliverable: "A",
        verification: "Bbbbbbbbbb",
        out_of_scope: "C",
        allocation_sats: 50_000,
        funding_threshold_sats: 150_000,
        deadline: "2026-12-01",
        id: "m1",
      },
    ]);
    expect(withThreshold.scale).toBe(200_000);
    expect(withThreshold.markers.map((m) => m.kind)).toEqual([
      "floor",
      "threshold",
    ]);
  });

  it("shareSlotHtml offers a single Share control", () => {
    const path = "proposals/listed/knots-spam-heuristics.md";
    const html = shareSlotHtml("Knots spam heuristics", path, "PLEBLY-42");
    expect(proposalShareUrl(path, "PLEBLY-42")).toContain("/p/plebly-42");
    expect(html).toContain("proposal-share-slot");
    expect(html).toContain('data-share="native"');
    expect(html).toContain("fa-share-nodes");
    expect(html).not.toContain('data-share="copy"');
    expect(html).not.toContain("fa-x-twitter");
    expect(html).not.toContain("fa-reddit");
    expect(html).not.toContain("intent/post");
  });

  it("structuredFundingPanelHtml is bounty+escrow only", () => {
    expect(
      structuredFundingPanelHtml({
        id: "PLEBLY-1",
        escrow_address: "tb1qtest",
        proposal_type: "bounty",
        milestones: [],
      } as Proposal),
    ).toContain('id="structured-funding"');
    expect(
      structuredFundingPanelHtml({
        id: "PLEBLY-1",
        escrow_address: "tb1qtest",
        proposal_type: "direct",
        milestones: [],
      } as Proposal),
    ).toBe("");
    expect(
      structuredFundingPanelHtml({
        id: "PLEBLY-1",
        proposal_type: "bounty",
        milestones: [],
      } as Proposal),
    ).toBe("");
  });

  it("bindStructuredFunding shows Type 1 ready copy, hash-gates, and never offers broadcast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/structured-funding")) {
          return new Response(
            JSON.stringify({
              psbt_kind: "single",
              structured: { state: "psbt_ready", sha256: "aa".repeat(32) },
            }),
          );
        }
        return new Response(
          JSON.stringify({
            branches: {
              state: "ready",
              items: [
                {
                  allocation_id: "bounty",
                  kind: "clean",
                  sha256: "aa".repeat(32),
                  locktime: 0,
                  psbt_base64: "cHNidP8BAAD4",
                },
              ],
            },
            selected: { bounty: { kind: "clean", sha256: "aa".repeat(32) } },
            signoff: { bounty: { signed: 0, required_threshold: 2, state: "open" } },
          }),
        );
      }),
    );
    document.body.innerHTML = structuredFundingPanelHtml({
      id: "PLEBLY-1",
      escrow_address: "tb1qtest",
      proposal_type: "bounty",
      milestones: [],
    } as Proposal);
    bindStructuredFunding(document, "PLEBLY-1");
    await vi.waitFor(() => {
      expect(document.querySelector("#structured-funding")?.hidden).toBe(false);
    });
    const panel = document.querySelector("#structured-funding");
    expect(panel).toBeInstanceOf(HTMLDetailsElement);
    expect((panel as HTMLDetailsElement).open).toBe(false);
    expect(document.querySelector("#structured-funding-status")?.textContent).toMatch(
      /Type 1/,
    );
    expect(document.querySelector("#structured-funding-status")?.textContent).toMatch(
      /Structure/,
    );
    expect(document.querySelector("#branch-psbt-verify")).toBeTruthy();
    expect(document.body.innerHTML).toContain("Release PSBT (base64) — not a settle txid");
    expect(document.body.innerHTML).toContain("STRUCTURE OUTPUTS");
    expect(document.body.innerHTML).toContain("not</strong> Donate/escrow");
    expect(document.body.innerHTML).toContain("Needs 0/2 signatures (cosign");
    const ready = document.querySelector<HTMLButtonElement>("#branch-sign-ready");
    expect(ready?.disabled).toBe(true);
    expect(ready?.title || "").toMatch(/Release PSBT/);
    expect(panel?.textContent || "").not.toContain("a".repeat(32));
    expect(panel?.querySelector(".copy-btn-icon .fa-copy")).toBeTruthy();
    expect(panel?.querySelector(".copy-btn-icon")?.getAttribute("data-copy")).toBe(
      "aa".repeat(32),
    );
    // Public panel never offers a Broadcast CTA (broadcast stays in Sparrow).
    expect(document.body.innerHTML).not.toMatch(/>\s*Broadcast\s*</);
    expect(document.body.innerHTML).not.toContain("cHNidP8");
    vi.unstubAllGlobals();
  });

  it("structure outs hard-label roles and never invite bond/donate sends", () => {
    expect(structureOutRoleLabel("")).toBe("structure out");
    expect(structureOutRoleLabel("bounty")).toBe("bounty / allocation");
    expect(structureOutRoleLabel("reviewer_reserve")).toBe("reviewer reserve");
    expect(structureOutRoleLabel("kh_fee")).toBe("keyholder fee");
    expect(
      structuredFundingStageSentence("awaiting_funds", "Type 1 (single bounty)"),
    ).toMatch(/Structure · waiting/);
    expect(
      structuredFundingStageSentence("psbt_ready", "Type 1 (single bounty)"),
    ).toMatch(/does not broadcast/);
    expect(branchSignoffStageLabel({ signed: 1, required_threshold: 3, state: "open" })).toMatch(
      /Needs 1\/3 signatures \(cosign/,
    );
    expect(
      branchSignoffStageLabel({
        signed: 3,
        required_threshold: 3,
        state: "threshold_met",
      }),
    ).toMatch(/ready to broadcast in Sparrow/);
    expect(
      branchSignoffStageLabel({
        signed: 3,
        required_threshold: 3,
        state: "settled",
        settle_txid: "ab".repeat(32),
      }),
    ).toMatch(/Settled/);
    const body = structuredFundingBodyHtml({
      pool_refund_address: "tb1qrefund",
      structured: {
        state: "psbt_ready",
        sha256: "cd".repeat(32),
        decode: {
          locktime: 0,
          version: 2,
          miner_fee_sats: 200,
          inputs: [{ address: "tb1qin", amount_sats: 100_000 }],
          outputs: [
            { address: "tb1qbounty", amount_sats: 80_000, label: "bounty" },
            { address: "tb1qreserve", amount_sats: 10_000, label: "" },
          ],
        },
      },
    });
    expect(body).toContain("STRUCTURE OUTPUTS");
    expect(body).toContain("not</strong> Donate/escrow");
    expect(body).toContain("not</strong> claim bond");
    expect(body).toContain("bounty / allocation");
    expect(body).toContain("structure out");
    expect(body).toContain("escrow in");
    expect(body).not.toContain("CLAIM BOND");
    expect(body).not.toContain("DONATE / ESCROW ADDRESS");
  });
});
