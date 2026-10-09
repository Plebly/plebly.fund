import { describe, expect, it } from "vitest";
import {
  decisionCardHtml,
  openRemovalFormHtml,
  removalCardHtml,
  reviewerRowHtml,
} from "./governance-decisions-ui";
import type {
  RemovalBallotView,
  ReviewDecisionView,
  ReviewerMe,
  ReviewerPublic,
} from "./reviewers";

const XSS = `<img src=x onerror="alert(1)">`;

function frag(h: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = h;
  return el;
}

const reviewer = (over: Partial<ReviewerPublic> = {}): ReviewerPublic => ({
  user_id: "github:42",
  kind: "earned",
  status: "active",
  seated_at: "2026-01-01T00:00:00Z",
  completed_count: 3,
  completed_proposal_ids: [],
  ...over,
});

const decision = (over: Partial<ReviewDecisionView> = {}): ReviewDecisionView => ({
  id: "dec-1",
  proposal_id: "PLEBLY-2026-001",
  proposal_path: "proposals/listed/PLEBLY-2026-001.md",
  kind: "deliverable_confirm",
  round: 1,
  created_at: "2026-10-01T00:00:00Z",
  closes_at: "2026-10-08T12:00:00Z",
  status: "open",
  counts: { yes: 2, no: 1, abstain: 0 },
  vote_count: 3,
  my_vote: null,
  ...over,
});

const ballot = (over: Partial<RemovalBallotView> = {}): RemovalBallotView => ({
  id: "rem-1",
  target_user_id: "github:7",
  initiator_user_id: "github:8",
  evidence: "Pattern of bad faith across two decisions, cited here.",
  created_at: "2026-10-01T00:00:00Z",
  closes_at: "2026-10-15T00:00:00Z",
  status: "open",
  vote_count: 4,
  counts: { yes: 3, no: 1 },
  ...over,
});

describe("reviewerRowHtml", () => {
  it("labels bootstrap vs earned and shows the completed count", () => {
    expect(frag(reviewerRowHtml(reviewer({ kind: "bootstrap" }))).textContent).toContain("Bootstrap");
    const earned = frag(reviewerRowHtml(reviewer()));
    expect(earned.querySelector(".pill.status-good")?.textContent).toBe("Earned");
    expect(earned.textContent).toContain("3 completed");
    expect(earned.querySelector(".gov-user")?.textContent).toBe("gh:42");
  });

  it("no Select button unless selectable; bootstrap seats get a disabled one", () => {
    expect(frag(reviewerRowHtml(reviewer())).querySelector(".gov-select-target")).toBeNull();
    const boot = frag(reviewerRowHtml(reviewer({ kind: "bootstrap" }), true)).querySelector<HTMLButtonElement>(".gov-select-target")!;
    expect(boot.disabled).toBe(true);
    expect(boot.title).toMatch(/cannot be removed/);
    const earned = frag(reviewerRowHtml(reviewer(), true)).querySelector<HTMLButtonElement>(".gov-select-target")!;
    expect(earned.disabled).toBe(false);
    expect(earned.dataset.target).toBe("github:42");
  });

  it("escapes the user id", () => {
    const el = frag(reviewerRowHtml(reviewer({ user_id: XSS }), true));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("li")?.getAttribute("data-user-id")).toBe(XSS);
  });
});

describe("decisionCardHtml", () => {
  it("non-reviewers get a link to the project page and no vote buttons", () => {
    const el = frag(decisionCardHtml(decision(), false));
    expect(el.querySelector("[data-dec-vote]")).toBeNull();
    const hint = el.querySelector(".gov-hint a") as HTMLAnchorElement;
    expect(hint).not.toBeNull();
    expect(hint.getAttribute("href")).toBe(el.querySelector(".gov-card-title")!.getAttribute("href"));
  });

  it("a reviewer who hasn't voted sees visible Approve / Reject / Abstain", () => {
    const el = frag(decisionCardHtml(decision(), true));
    const actions = el.querySelector<HTMLElement>("[data-dec-actions]")!;
    expect(actions.hidden).toBe(false);
    expect([...actions.querySelectorAll<HTMLElement>("[data-dec-vote]")].map((b) => b.dataset.decVote)).toEqual([
      "yes",
      "no",
      "abstain",
    ]);
    expect(el.querySelector(".gov-my-vote")).toBeNull();
  });

  it.each(["yes", "no", "abstain"] as const)(
    "a reviewer who voted %s on an open decision sees their vote, Change, and hidden buttons",
    (v) => {
      const el = frag(decisionCardHtml(decision({ my_vote: v }), true));
      expect(el.querySelector(".gov-my-vote")?.textContent).toBe(`You voted ${v}.`);
      expect(el.querySelector<HTMLElement>("[data-dec-change]")?.dataset.decChange).toBe("dec-1");
      expect(el.querySelector<HTMLElement>("[data-dec-actions]")!.hidden).toBe(true);
    },
  );

  it("on a closed decision the vote summary is not shown and buttons are not hidden", () => {
    const el = frag(decisionCardHtml(decision({ my_vote: "yes", status: "closed" }), true));
    expect(el.querySelector(".gov-my-vote")).toBeNull();
    expect(el.querySelector<HTMLElement>("[data-dec-actions]")!.hidden).toBe(false);
  });

  it("shows kind label, counts, Round 2 pill and rebuttal reasoning", () => {
    const el = frag(
      decisionCardHtml(
        decision({ round: 2, rebuttal: { reasoning: "We shipped it.", at: "2026-10-02T00:00:00Z" } }),
        true,
      ),
    );
    const pills = [...el.querySelectorAll(".gov-card-head .pill")].map((p) => p.textContent);
    expect(pills).toEqual(["Completion review", "Round 2"]);
    expect(el.querySelector(".review-count.yes")?.textContent).toBe("Yes 2");
    expect(el.querySelector(".review-count.no")?.textContent).toBe("No 1");
    expect(el.querySelector(".review-dissent-text")?.textContent).toBe("We shipped it.");
    const round1 = frag(decisionCardHtml(decision(), true));
    expect(round1.querySelector(".review-dissent-text")).toBeNull();
    expect([...round1.querySelectorAll(".gov-card-head .pill")].map((p) => p.textContent)).toEqual([
      "Completion review",
    ]);
  });

  it("an unparseable closes_at is shown verbatim", () => {
    const el = frag(decisionCardHtml(decision({ closes_at: "soon" }), true));
    expect(el.querySelector(".gov-closes")?.textContent).toBe("Closes soon");
  });

  it("without proposal_path it links to proposals/claimed/<id>.md, same as with an explicit path", () => {
    const withPath = frag(
      decisionCardHtml(decision({ proposal_path: "proposals/claimed/PLEBLY-2026-001.md" }), true),
    ).querySelector(".gov-card-title")!.getAttribute("href");
    const fallback = frag(decisionCardHtml(decision({ proposal_path: undefined }), true))
      .querySelector(".gov-card-title")!
      .getAttribute("href");
    expect(fallback).toBe(withPath);
  });

  it("escapes proposal id and rebuttal text", () => {
    const el = frag(
      decisionCardHtml(
        decision({ proposal_id: XSS, rebuttal: { reasoning: XSS, at: "x" } }),
        true,
      ),
    );
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".review-dissent-text")?.textContent).toBe(XSS);
  });
});

describe("removalCardHtml", () => {
  it("eligible funders get Remove / Keep; others get the eligibility hint", () => {
    const yes = frag(removalCardHtml(ballot(), true));
    expect([...yes.querySelectorAll<HTMLElement>("[data-rem-vote]")].map((b) => b.dataset.remVote)).toEqual(["yes", "no"]);
    expect(yes.querySelector(".gov-hint")).toBeNull();
    const no = frag(removalCardHtml(ballot(), false));
    expect(no.querySelector("[data-rem-vote]")).toBeNull();
    expect(no.querySelector(".gov-hint")?.textContent).toMatch(/eligible funder identity/);
  });

  it("shows target, initiator, counts and escapes evidence", () => {
    const el = frag(removalCardHtml(ballot({ evidence: XSS }), false));
    expect(el.querySelector(".gov-card-title")?.textContent).toBe("gh:7");
    expect(el.querySelector(".gov-closes")?.textContent).toContain("gh:8");
    expect(el.querySelector(".review-count.yes")?.textContent).toBe("Remove 3");
    expect(el.querySelector(".review-count.no")?.textContent).toBe("Keep 1");
    expect(el.textContent).toContain("4 cast");
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".gov-evidence")?.textContent).toBe(XSS);
  });
});

describe("openRemovalFormHtml", () => {
  const me = (over: Partial<ReviewerMe> = {}): ReviewerMe => ({
    active: false,
    funder_eligible: true,
    removal_min_sats: 25_000,
    reviewer: null,
    ...over,
  });

  it("logged out → sign-in prompt, no form", () => {
    const el = frag(openRemovalFormHtml(null, false, [reviewer()]));
    expect(el.textContent).toMatch(/Sign in as an eligible funder/);
    expect(el.querySelector("#removal-open-form")).toBeNull();
  });

  it("not funder-eligible → shows the min contribution (server value, else 10,000 sats), no form", () => {
    let el = frag(openRemovalFormHtml(me({ funder_eligible: false }), true, [reviewer()]));
    expect(el.textContent).toContain("25,000 sats");
    expect(el.querySelector("#removal-open-form")).toBeNull();
    el = frag(openRemovalFormHtml(null, true, [reviewer()]));
    expect(el.textContent).toContain("10,000 sats");
    expect(el.querySelector("#removal-open-form")).toBeNull();
  });

  it("eligible but only bootstrap reviewers → nothing to remove", () => {
    const el = frag(openRemovalFormHtml(me(), true, [reviewer({ kind: "bootstrap" })]));
    expect(el.textContent).toMatch(/No earned reviewers to remove/);
    expect(el.querySelector("#removal-open-form")).toBeNull();
  });

  it("eligible → form lists only earned reviewers and requires 40+ chars of evidence", () => {
    const el = frag(
      openRemovalFormHtml(me(), true, [
        reviewer({ user_id: "github:1", kind: "bootstrap" }),
        reviewer({ user_id: "github:2" }),
        reviewer({ user_id: "github:3", completed_count: 9 }),
      ]),
    );
    const form = el.querySelector("#removal-open-form")!;
    expect(form).not.toBeNull();
    const values = [...form.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(values).toEqual(["", "github:2", "github:3"]);
    const ta = form.querySelector<HTMLTextAreaElement>("#removal-evidence")!;
    expect(ta.minLength).toBe(40);
    expect(ta.required).toBe(true);
  });
});
