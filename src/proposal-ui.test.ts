import { beforeAll, describe, expect, it } from "vitest";
import {
  canEditProposal,
  deliverableChipHtml,
  donatePanelHtml,
  fundingBarScale,
  fundingBarTrackHtml,
  fundingProgressHtml,
  isPastFundingTarget,
  metaChipsHtml,
  milestonesHtml,
  proposalContextHtml,
  proposalFundingBarHtml,
  proposalLifecycleBannersHtml,
  proposalShareUrl,
  proposerBylineHtml,
  refundRegisterHtml,
  shareSlotHtml,
  statusClass,
  statusLabel,
  statusPillHtml,
  userMatchesProposer,
} from "./proposal-ui";
import type { Proposal, ProposalMilestone } from "./types";

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
    expect(html).toContain("@plebly");
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
    expect(statusClass("abandoned_vote")).toBe("status-active");
    expect(statusClass("refunding")).toBe("status-bad");
    expect(statusClass("underfunded")).toBe("status-active");
    expect(statusClass("in_review")).toBe("status-active");
    expect(statusClass("rejected")).toBe("status-bad");
  });

  it("statusPillHtml hides listed", () => {
    expect(statusPillHtml("listed")).toBe("");
    expect(statusPillHtml("funding")).toContain("funding");
    expect(statusPillHtml("funding")).toContain("pill-status");
  });

  it("lifecycle banners cover in_review and rejected", () => {
    const review = proposalLifecycleBannersHtml({
      status: "in_review",
      milestones: [],
    } as Proposal);
    expect(review).toContain("In review");
    expect(review).toContain("AI first-pass");

    const rejected = proposalLifecycleBannersHtml({
      status: "rejected",
      milestones: [],
    } as Proposal);
    expect(rejected).toContain("Rejected");
    expect(rejected).toContain("rebuttal");
  });

  it("lifecycle banners cover refunding with Funds copy", () => {
    const html = proposalLifecycleBannersHtml({
      status: "refunding",
      milestones: [],
    } as Proposal);
    expect(html).toContain("Refunding");
    expect(html).toContain("Account → Funds");
    expect(html).toContain("Sparrow");
  });

  it("lifecycle banners open contributor ballot for underfunded with escrow", () => {
    const withBal = proposalLifecycleBannersHtml(
      { status: "underfunded", milestones: [] } as Proposal,
      50_000,
    );
    expect(withBal).toContain("Ballot open");
    expect(withBal).toContain("underfunded");

    const empty = proposalLifecycleBannersHtml(
      { status: "underfunded", milestones: [] } as Proposal,
      0,
    );
    expect(empty).toContain("Underfunded");
    expect(empty).toContain("empty escrow");
    expect(empty).not.toContain("Ballot open");
  });

  it("refundRegisterHtml includes status host for signed-in funder", () => {
    const html = refundRegisterHtml("p1");
    expect(html).toContain("refund-status");
    expect(html).toContain("refund-register-form");
    expect(html).toContain("refund_rail");
    expect(html).toContain("refund-swap-id");
  });

  it("lifecycle banners cover direct delivery window expiry", () => {
    const expired = new Date(Date.now() - 86400_000).toISOString();
    const html = proposalLifecycleBannersHtml({
      status: "listed",
      proposal_type: "direct",
      delivery_window_ends_at: expired,
      milestones: [],
    } as Proposal);
    expect(html).toContain("Delivery window");
    expect(html).toContain("Window ended");
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
  });

  it("meta chips show type and tags", () => {
    const html = metaChipsHtml({
      id: "PLEBLY-1",
      proposal_type: "direct",
      tags: ["knots", "policy"],
      created_at: null,
    } as Proposal);
    expect(html).toContain("Direct");
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
    expect(html).toContain("50,000 sats to claim floor");
    expect(html).toContain(
      "50,000 sats / 100,000 sats floor (50%) · target 500,000 sats (10%)",
    );
    expect(html).toContain("funding-marker-floor");
    expect(html).not.toContain("funding-marker-lock");
    expect(html).not.toContain("proposal-stats");
  });

  it("funding bar always labels claim floor separately from target", () => {
    const html = proposalFundingBarHtml(5_000, 10_000, 100_000);
    expect(html).toContain("5,000 sats to claim floor");
    expect(html).toContain("10,000 sats floor");
    expect(html).toContain("target 100,000 sats");
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
});
