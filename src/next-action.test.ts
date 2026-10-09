import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isDonateBlocked,
  isStructuredTerminalOrUnknown,
  isUnknownClaimState,
  nextActionCardHtml,
  nextActionPrimaryHtml,
  resolveNextAction,
  type NextActionInput,
} from "./next-action";
import type { ClaimStatus } from "./builder";
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
    proposer: { id: "github:1", github: "alice", username: "alice" },
    ...partial,
  };
}

function claim(partial: Partial<ClaimStatus> = {}): ClaimStatus {
  return {
    proposal_id: "demo",
    proposal_path: "proposals/claimed/demo.md",
    state: "open",
    confirmed_balance_sats: 200_000,
    claim_floor_sats: 10_000,
    ...partial,
  };
}

const proposer = { id: "github:1", username: "alice", github: "alice" };
const builder = { id: "github:2", username: "bob", github: "bob" };
const donor = { id: "github:3", username: "carol", github: "carol" };
const reviewer = { id: "github:4", username: "dan", github: "dan" };

function act(input: Partial<NextActionInput> & { proposal: Proposal }) {
  return resolveNextAction(input);
}

describe("resolveNextAction", () => {
  const rows: {
    name: string;
    input: NextActionInput;
    sentence: string | RegExp;
    button: NextActionInput extends never ? never : ReturnType<typeof resolveNextAction>["button"];
    more?: string[];
  }[] = [
    {
      name: "unindexed proposer",
      input: { proposal: proposal({ status: "unindexed" }), user: proposer },
      sentence: "Waiting on listing.",
      button: null,
    },
    {
      name: "pr_open proposer",
      input: { proposal: proposal({ status: "pr_open" }), user: proposer },
      sentence: "Waiting on listing.",
      button: null,
    },
    {
      name: "listed visitor",
      input: { proposal: proposal({ status: "listed" }) },
      sentence: "Listed — still raising",
      button: "donate",
    },
    {
      name: "funding anyone",
      input: { proposal: proposal({ status: "funding" }), user: donor },
      sentence: "Listed — still raising",
      button: "donate",
    },
    {
      name: "below floor",
      input: {
        proposal: proposal({ status: "listed" }),
        claim: claim({ state: "below_floor", confirmed_balance_sats: 1 }),
      },
      sentence: "Listed — still raising",
      button: "donate",
    },
    {
      name: "listed + open high balance stays donate (shared escrow)",
      input: {
        proposal: proposal({ status: "listed", balance_sats: 30_586 }),
        claim: claim({
          state: "open",
          status: "listed",
          confirmed_balance_sats: 30_586,
          claim_floor_sats: 10_000,
          claimer: null,
          psbt: { structured_state: "psbt_ready" },
        }),
        user: builder,
      },
      sentence: "Listed — still raising",
      button: "donate",
    },
    {
      name: "funding + open high balance stays donate",
      input: {
        proposal: proposal({ status: "funding", balance_sats: 30_586 }),
        claim: claim({
          state: "open",
          status: "funding",
          confirmed_balance_sats: 30_586,
          claim_floor_sats: 10_000,
        }),
        user: builder,
      },
      sentence: "Listed — still raising",
      button: "donate",
    },
    {
      name: "declined_fundable",
      input: { proposal: proposal({ status: "declined_fundable" }) },
      sentence: "Listing declined. You can still fund.",
      button: "donate",
    },
    {
      name: "claimable proposer_select proposer",
      input: {
        proposal: proposal({ status: "claimable", claim_mode: "proposer_select" }),
        claim: claim({ state: "open" }),
        user: proposer,
      },
      sentence: "Pick a bonded builder.",
      button: null,
    },
    {
      name: "claimable first_bonded proposer",
      input: {
        proposal: proposal({ status: "claimable", claim_mode: "first_bonded" }),
        claim: claim({ state: "open" }),
        user: proposer,
      },
      sentence: "First bonded builder wins.",
      button: null,
    },
    {
      name: "claimable signed-in applicant",
      input: {
        proposal: proposal({ status: "claimable" }),
        claim: claim({ state: "open" }),
        user: builder,
      },
      sentence: "Apply with a bond.",
      button: "apply",
    },
    {
      name: "claimable already applied",
      input: {
        proposal: proposal({ status: "claimable" }),
        claim: claim({ state: "open" }),
        apps: { mine_application_id: "app-1", claim_mode: "proposer_select" },
        user: builder,
      },
      sentence: "Application in.",
      button: null,
    },
    {
      name: "claimable visitor",
      input: {
        proposal: proposal({ status: "claimable" }),
        claim: claim({ state: "open" }),
      },
      sentence: "Open for builders.",
      button: "donate",
    },
    {
      name: "claimed builder",
      input: {
        proposal: proposal({
          status: "claimed",
          claimer: "bob",
          path: "proposals/claimed/demo.md",
        }),
        claim: claim({ state: "claimed", claimer: "bob" }),
        user: builder,
      },
      sentence: "Submit the work when it is done. The pot is still pooling.",
      button: "deliverable",
      more: ["checkpoint", "extension", "collab", "workboard"],
    },
    {
      name: "claimed proposer",
      input: {
        proposal: proposal({ status: "claimed", claimer: "bob" }),
        claim: claim({ state: "claimed", claimer: "bob" }),
        user: proposer,
      },
      sentence: "The pot is still pooling. Donate until the frozen allocation is met.",
      button: "donate",
    },
    {
      name: "claimed donor can challenge",
      input: {
        proposal: proposal({ status: "claimed", claimer: "bob" }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          can_challenge_abandoned: true,
        }),
        user: donor,
      },
      sentence: "The pot is still pooling. Donate until the frozen allocation is met.",
      button: "donate",
      more: ["challenge"],
    },
    {
      name: "in_review proposer can mark done",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({ state: "in_review", claimer: "bob", can_mark_done: true }),
        user: proposer,
      },
      sentence: "Mark it done if the work is finished.",
      button: "done",
    },
    {
      name: "in_review proposer done without session can_mark_done",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        // Public /claims fetch omits credentials → can_mark_done stays false.
        claim: claim({ state: "in_review", claimer: "bob", can_mark_done: false }),
        user: proposer,
      },
      sentence: "Mark it done if the work is finished.",
      button: "done",
    },
    {
      name: "in_review other",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({ state: "in_review", claimer: "bob" }),
        user: donor,
      },
      sentence: "The pot is still pooling. Donate until the frozen allocation is met.",
      button: "donate",
    },
    {
      name: "in_review + awaiting_funds donor → donate",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          psbt: { structured_state: "awaiting_funds" },
        }),
        user: donor,
      },
      sentence: "The pot is still pooling. Donate until the frozen allocation is met.",
      button: "donate",
    },
    {
      name: "in_review + awaiting_funds claimer → donate",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          psbt: { structured_state: "awaiting_funds" },
        }),
        user: builder,
      },
      sentence: "The pot is still pooling. Donate until the frozen allocation is met.",
      button: "donate",
    },
    {
      name: "in_review + awaiting_funds proposer stays done",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          can_mark_done: true,
          psbt: { structured_state: "awaiting_funds" },
        }),
        user: proposer,
      },
      sentence: "Mark it done if the work is finished.",
      button: "done",
    },
    {
      name: "window open donor",
      input: {
        proposal: proposal({
          status: "in_review",
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
        }),
        claim: claim({
          state: "in_review",
          donor_review_status: "window_open",
          can_flag_close: true,
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
        }),
        user: donor,
      },
      sentence: /Flag if the work is not finished\.\s+3 days left\./,
      button: "flag",
    },
    {
      name: "window open but ballot closed — no Flag",
      input: {
        proposal: proposal({
          status: "in_review",
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
        }),
        claim: claim({
          state: "in_review",
          donor_review_status: "window_open",
          can_flag_close: true,
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
        }),
        user: donor,
        reviewBallotClosed: true,
        reviewBallotClosedSummary: "Closed — approve (passed)",
      },
      sentence: "Closed — approve (passed)",
      button: null,
    },
    {
      name: "window open signed-in without can_flag_close",
      input: {
        proposal: proposal({
          status: "in_review",
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 2 * 86400_000).toISOString(),
        }),
        claim: claim({
          state: "in_review",
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 2 * 86400_000).toISOString(),
        }),
        user: builder,
      },
      sentence: /Flag if the work is not finished\./,
      button: "flag",
    },
    {
      name: "window open guest",
      input: {
        proposal: proposal({
          status: "in_review",
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 2 * 86400_000).toISOString(),
        }),
        claim: claim({
          state: "in_review",
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 2 * 86400_000).toISOString(),
        }),
      },
      sentence: /Donors have 2 days to flag\./,
      button: null,
    },
    {
      name: "flagged reviewer",
      input: {
        proposal: proposal({
          status: "in_review",
          donor_review_status: "flagged",
        }),
        claim: claim({
          state: "in_review",
          donor_review_status: "flagged",
          review_decision_open: true,
        }),
        user: reviewer,
        reviewerActive: true,
      },
      sentence: "Vote whether this meets the project.",
      button: null,
    },
    {
      name: "flagged other",
      input: {
        proposal: proposal({
          status: "in_review",
          donor_review_status: "flagged",
        }),
        claim: claim({ state: "in_review", donor_review_status: "flagged" }),
        user: donor,
      },
      sentence: "Reviewers are checking the work.",
      button: null,
    },
    {
      name: "catalog/runtime in_review + flagged without claim → reviewers (not Still raising)",
      input: {
        proposal: proposal({
          status: "in_review",
          donor_review_status: "flagged",
          claimer: "bob",
        }),
        user: donor,
      },
      sentence: "Reviewers are checking the work.",
      button: null,
    },
    {
      name: "in_review claim miss shape never Still raising",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: null,
        user: donor,
      },
      sentence: "Waiting on the proposer.",
      button: null,
    },
    {
      name: "rejected builder",
      input: {
        proposal: proposal({
          status: "rejected",
          claimer: "bob",
          rebuttal_expires_at: new Date(Date.now() + 5 * 86400_000).toISOString(),
        }),
        claim: claim({ state: "unavailable", claimer: "bob" }),
        user: builder,
      },
      sentence: /You can file one reply\.\s+5 days left\./,
      button: "rebuttal",
    },
    {
      name: "rejected other",
      input: {
        proposal: proposal({
          status: "rejected",
          claimer: "bob",
          rebuttal_expires_at: new Date(Date.now() + 1 * 86400_000).toISOString(),
        }),
        user: donor,
      },
      sentence: "The builder has 1 day to reply once.",
      button: null,
    },
    {
      name: "completed",
      input: { proposal: proposal({ status: "completed" }) },
      sentence:
        "Approved. Keyholders sign the selected branch; broadcast stays in Sparrow.",
      button: null,
    },
    {
      name: "completed settled branches",
      input: {
        proposal: proposal({ status: "completed" }),
        claim: claim({
          state: "completed",
          psbt: {
            structured_state: "confirmed",
            selected: { bounty: { kind: "clean" } },
            signoff: { bounty: { state: "settled", signed: 2, required_threshold: 2 } },
          },
        }),
      },
      sentence: "Settled on-chain.",
      button: null,
    },
    {
      name: "claimed pot still pooling",
      input: {
        proposal: proposal({ status: "claimed", claimer: "bob" }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          psbt: { structured_state: "awaiting_funds" },
        }),
        user: donor,
      },
      sentence: "The pot is still pooling. Donate until the frozen allocation is met.",
      button: "donate",
    },
    {
      name: "listed catalog + claim claimed awaiting_funds matching nostr → deliverable",
      input: {
        proposal: proposal({
          status: "listed",
          claimer: null,
        }),
        claim: claim({
          state: "claimed",
          status: "listed",
          claimer:
            "nostr:5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
          claimer_user_id:
            "nostr:5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
          confirmed_balance_sats: 15_000,
          claim_floor_sats: 10_000,
          psbt: { structured_state: "awaiting_funds" },
        }),
        user: {
          id: "nostr:5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
          nostr: "5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
          username: "npub12f2m7",
        } as never,
      },
      sentence: "Submit the work when it is done. The pot is still pooling.",
      button: "deliverable",
    },
    {
      name: "claimed nostr builder truncated claimer still submits",
      input: {
        proposal: proposal({
          status: "claimed",
          claimer: "nostr:5255bf327a89",
        }),
        claim: claim({
          state: "claimed",
          claimer: "nostr:5255bf327a89",
          pending: {
            user_id:
              "nostr:5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
            payout_address: "tb1qtest",
            created_at: "2026-09-19T21:21:08.656Z",
          },
          psbt: { structured_state: "awaiting_funds" },
        }),
        user: {
          id: "nostr:5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
          nostr: "5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
          username: "npub12f2m7",
        } as never,
      },
      sentence: "Submit the work when it is done. The pot is still pooling.",
      button: "deliverable",
    },
    {
      name: "claimed structured ready",
      input: {
        proposal: proposal({ status: "claimed", claimer: "bob" }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          psbt: { structured_state: "psbt_ready" },
        }),
        user: donor,
      },
      sentence: "Structured funding is ready. Keyholders broadcast in Sparrow.",
      button: null,
    },
    {
      name: "claimed structured confirmed for builder",
      input: {
        proposal: proposal({ status: "claimed", claimer: "bob" }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          psbt: { structured_state: "confirmed" },
        }),
        user: builder,
      },
      sentence: "Submit the work when it is done. Funds are structured for release.",
      button: "deliverable",
    },
    {
      name: "claimed structured confirmed for donor — no pooling copy",
      input: {
        proposal: proposal({ status: "claimed", claimer: "bob" }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          psbt: { structured_state: "confirmed" },
        }),
        user: donor,
      },
      sentence: "Funds are structured on-chain. Waiting on the builder.",
      button: null,
    },
    {
      name: "in_review structured confirmed for donor — no pooling copy",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          psbt: { structured_state: "confirmed" },
        }),
        user: donor,
      },
      sentence: "Funds are structured. Waiting on the proposer to mark done.",
      button: null,
    },
    {
      name: "listed awaiting frozen pot",
      input: {
        proposal: proposal({ status: "listed" }),
        claim: claim({
          state: "below_floor",
          psbt: { structured_state: "awaiting_funds" },
        }),
      },
      sentence:
        "Donate until the frozen allocation, reserve, and miner fee are met.",
      button: "donate",
    },
    {
      name: "stall",
      input: {
        proposal: proposal({
          status: "completed",
          release_blocked_reason: "Keyholder stall",
          release_blocked_seats: [1, 4],
        }),
      },
      sentence: "Release stalled. Unsigned: seat 1, seat 4.",
      button: null,
    },
    {
      name: "underfunded with escrow",
      input: {
        proposal: proposal({ status: "underfunded", balance_sats: 50_000 }),
      },
      sentence: "Vote on remaining funds.",
      button: null,
    },
    {
      name: "underfunded empty",
      input: {
        proposal: proposal({ status: "underfunded", balance_sats: 0 }),
      },
      sentence: "Funding ended before this could open.",
      button: null,
    },
    {
      name: "abandoned_vote",
      input: { proposal: proposal({ status: "abandoned_vote" }) },
      sentence: "Vote on remaining funds.",
      button: null,
    },
    {
      name: "refunding",
      input: { proposal: proposal({ status: "refunding" }) },
      sentence: "Add a refund address.",
      button: "register",
    },
    {
      name: "redirected",
      input: { proposal: proposal({ status: "redirected" }) },
      sentence: "Funds are moving to another project.",
      button: null,
    },
    // Regression: claim.state=unavailable must NOT block these statuses' UI actions
    {
      name: "declined_fundable with claim state unavailable keeps Donate",
      input: {
        proposal: proposal({ status: "declined_fundable" }),
        claim: claim({ state: "unavailable" }),
      },
      sentence: "Listing declined. You can still fund.",
      button: "donate",
    },
    {
      name: "refunding with claim state unavailable keeps Register",
      input: {
        proposal: proposal({ status: "refunding" }),
        claim: claim({ state: "unavailable" }),
      },
      sentence: "Add a refund address.",
      button: "register",
    },
    {
      name: "underfunded with claim state unavailable keeps sentence",
      input: {
        proposal: proposal({ status: "underfunded", balance_sats: 50_000 }),
        claim: claim({ state: "unavailable" }),
      },
      sentence: "Vote on remaining funds.",
      button: null,
    },
    {
      name: "abandoned_vote with claim state unavailable keeps sentence",
      input: {
        proposal: proposal({ status: "abandoned_vote" }),
        claim: claim({ state: "unavailable" }),
      },
      sentence: "Vote on remaining funds.",
      button: null,
    },
    {
      name: "redirected with claim state unavailable keeps sentence",
      input: {
        proposal: proposal({ status: "redirected" }),
        claim: claim({ state: "unavailable" }),
      },
      sentence: "Funds are moving to another project.",
      button: null,
    },
    {
      name: "direct funding visitor",
      input: {
        proposal: proposal({ status: "funding", proposal_type: "direct" }),
      },
      sentence: "Donate. Paid monthly.",
      button: "donate",
    },
    {
      name: "direct proposer deliverable",
      input: {
        proposal: proposal({
          status: "claimable",
          proposal_type: "direct",
        }),
        claim: claim({ state: "open" }),
        user: proposer,
      },
      sentence: "Submit work if you want it on the record.",
      button: "deliverable",
    },
    {
      name: "direct listed proposer with floor met",
      input: {
        proposal: proposal({
          status: "listed",
          proposal_type: "direct",
          balance_sats: 200_000,
        }),
        user: proposer,
      },
      sentence: "Submit work if you want it on the record.",
      button: "deliverable",
    },
    {
      name: "proposer+builder while claimed uses builder row",
      input: {
        proposal: proposal({
          status: "claimed",
          claimer: "alice",
          proposer: { id: "github:1", github: "alice", username: "alice" },
        }),
        claim: claim({ state: "claimed", claimer: "alice" }),
        user: proposer,
      },
      sentence: "Submit the work when it is done. The pot is still pooling.",
      button: "deliverable",
    },
    {
      name: "proposer+builder in_review uses done",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "alice",
        }),
        claim: claim({
          state: "in_review",
          claimer: "alice",
          can_mark_done: true,
        }),
        user: proposer,
      },
      sentence: "Mark it done if the work is finished.",
      button: "done",
    },
    {
      name: "voided structure no donate (in_review)",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          psbt: { structured_state: "voided" },
        }),
        user: donor,
      },
      sentence: "Structure unavailable, not accepting funds.",
      button: null,
    },
    {
      name: "voided structure no donate (claimed)",
      input: {
        proposal: proposal({ status: "claimed", claimer: "bob" }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          psbt: { structured_state: "voided" },
        }),
        user: donor,
      },
      sentence: "Structure unavailable, not accepting funds.",
      button: null,
    },
    {
      name: "voided structure no donate (listed below_floor)",
      input: {
        proposal: proposal({ status: "listed" }),
        claim: claim({
          state: "below_floor",
          psbt: { structured_state: "voided" },
        }),
      },
      sentence: "Structure unavailable, not accepting funds.",
      button: null,
    },
    {
      name: "unknown structured state no donate (in_review)",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          psbt: { structured_state: "some_future_state" },
        }),
        user: donor,
      },
      sentence: "Structure unavailable, not accepting funds.",
      button: null,
    },
    {
      name: "unknown structured state no donate (claimed)",
      input: {
        proposal: proposal({ status: "claimed", claimer: "bob" }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          psbt: { structured_state: "some_future_state" },
        }),
        user: donor,
      },
      sentence: "Structure unavailable, not accepting funds.",
      button: null,
    },
    {
      name: "unknown structured state no donate (listed below_floor)",
      input: {
        proposal: proposal({ status: "listed" }),
        claim: claim({
          state: "below_floor",
          psbt: { structured_state: "some_future_state" },
        }),
      },
      sentence: "Structure unavailable, not accepting funds.",
      button: null,
    },
    {
      name: "catalog status voided no donate",
      input: {
        proposal: proposal({ status: "voided" }),
      },
      sentence: "Voided, not accepting funds.",
      button: null,
    },
    {
      name: "unknown catalog status shows Funding status unavailable",
      input: {
        proposal: proposal({ status: "some_future_status" as never }),
      },
      sentence: "Funding status unavailable.",
      button: null,
    },
    {
      name: "unknown claim state shows Unavailable",
      input: {
        proposal: proposal({ status: "listed" }),
        claim: claim({ state: "some_future_state" as never }),
      },
      sentence: "Unavailable.",
      button: null,
    },
    // Settled bounty tests (workers#41)
    // state='settled' or claim_phase='settled' without active claimant → "Bounty paid."
    {
      name: "settled claim.state blocks donate (no active claimant)",
      input: {
        proposal: proposal({ status: "claimable" }),
        claim: claim({ state: "settled" as never }),
      },
      sentence: "Bounty paid.",
      button: null,
    },
    {
      name: "settled claim.claim_phase blocks donate (no active claimant)",
      input: {
        proposal: proposal({ status: "claimable" }),
        claim: claim({ state: "open", claim_phase: "settled" } as never),
      },
      sentence: "Bounty paid.",
      button: null,
    },
    // bounty_settled=true with active claimant: keep claimant actions, no Donate/Apply
    {
      name: "bounty_settled true on claimed builder gets deliverable",
      input: {
        proposal: proposal({ status: "claimed", claimer: "bob" }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: builder,
      },
      sentence: "Submit the work when it is done.",
      button: "deliverable",
      more: ["checkpoint", "extension", "collab", "workboard"],
    },
    {
      name: "bounty_settled true on in_review proposer gets mark done",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          can_mark_done: true,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: proposer,
      },
      sentence: "Mark it done if the work is finished.",
      button: "done",
    },
    {
      name: "bounty_settled true on in_review window_open donor gets flag",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          can_flag_close: true,
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: donor,
      },
      sentence: /Flag if the work is not finished\./,
      button: "flag",
    },
    {
      name: "bounty_settled true on claimable blocks apply",
      input: {
        proposal: proposal({ status: "claimable" }),
        claim: claim({
          state: "open",
          bounty_settled: true,
        } as never),
        user: builder,
      },
      sentence: "Bounty paid.",
      button: null,
    },
    // Catalog contract (workers#41): status='bounty_settled' with claim_phase='settled' and accepting_funds=false
    {
      name: "007 shape: catalog bounty_settled + in_review claim — proposer gets mark done",
      input: {
        proposal: proposal({
          status: "bounty_settled" as never,
          claim_phase: "settled",
          accepting_funds: false,
          claimer: "bob",
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          can_mark_done: true,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: proposer,
      },
      sentence: "Mark it done if the work is finished.",
      button: "done",
    },
    {
      name: "007 shape: catalog bounty_settled + in_review claim window_open — donor gets flag",
      input: {
        proposal: proposal({
          status: "bounty_settled" as never,
          claim_phase: "settled",
          accepting_funds: false,
          claimer: "bob",
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          can_flag_close: true,
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: donor,
      },
      sentence: /Flag if the work is not finished\./,
      button: "flag",
    },
    {
      name: "007 shape: catalog bounty_settled + claimed claim — builder gets deliverable",
      input: {
        proposal: proposal({
          status: "bounty_settled" as never,
          claim_phase: "settled",
          accepting_funds: false,
          claimer: "bob",
        }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: builder,
      },
      sentence: "Submit the work when it is done.",
      button: "deliverable",
      more: ["checkpoint", "extension", "collab", "workboard"],
    },
    {
      name: "007 shape: catalog bounty_settled + completed claim — settled on-chain",
      input: {
        proposal: proposal({
          status: "bounty_settled" as never,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "completed",
          bounty_settled: true,
          accepting_funds: false,
        } as never),
      },
      sentence: "Approved. Keyholders sign the selected branch; broadcast stays in Sparrow.",
      button: null,
    },
    {
      name: "007 shape: catalog bounty_settled visitor sees no Donate",
      input: {
        proposal: proposal({
          status: "bounty_settled" as never,
          claim_phase: "settled",
          accepting_funds: false,
          claimer: "bob",
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
      },
      sentence: "Bounty paid. Waiting on the proposer.",
      button: null,
    },
    {
      name: "007 shape: catalog bounty_settled no claim — Bounty paid",
      input: {
        proposal: proposal({
          status: "bounty_settled" as never,
          claim_phase: "settled",
          accepting_funds: false,
        }),
      },
      sentence: "Bounty paid.",
      button: null,
    },
    {
      name: "settled state on in_review (no active claimant match)",
      input: {
        proposal: proposal({ status: "in_review", claimer: "bob" }),
        claim: claim({
          state: "settled" as never,
          claimer: "bob",
        }),
        user: donor,
      },
      sentence: "Bounty paid.",
      button: null,
    },
    // Revised catalog contract (workers#41): status stays in_review/completed but bounty_settled:true on PROPOSAL
    // 006 shape: status='in_review' + proposal.bounty_settled=true — claimant actions work, no Donate
    {
      name: "006 shape: status in_review + proposal.bounty_settled=true — proposer gets mark done",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          can_mark_done: true,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: proposer,
      },
      sentence: "Mark it done if the work is finished.",
      button: "done",
    },
    {
      name: "006 shape: status in_review + proposal.bounty_settled=true window_open — donor gets flag",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          can_flag_close: true,
          donor_review_status: "window_open",
          donor_review_expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: donor,
      },
      sentence: /Flag if the work is not finished\./,
      button: "flag",
    },
    {
      name: "006 shape: status in_review + proposal.bounty_settled=true visitor — no Donate",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
      },
      sentence: "Bounty paid. Waiting on the proposer.",
      button: null,
    },
    {
      name: "006 shape: status in_review + proposal.bounty_settled=true confirmed — donor sees Bounty paid",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "confirmed" },
        } as never),
        user: donor,
      },
      sentence: "Bounty paid. Waiting on the proposer.",
      button: null,
    },
    // 009 shape: status='in_review' (awarded) + proposal.bounty_settled=true — no Donate
    {
      name: "009 shape: status in_review (awarded) + proposal.bounty_settled=true visitor — no Donate",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
      },
      sentence: "Bounty paid. Waiting on the proposer.",
      button: null,
    },
    // Generic claimed + bounty_settled tests (not 009 shape)
    {
      name: "status claimed + proposal.bounty_settled=true — builder gets deliverable",
      input: {
        proposal: proposal({
          status: "claimed",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: builder,
      },
      sentence: "Submit the work when it is done.",
      button: "deliverable",
      more: ["checkpoint", "extension", "collab", "workboard"],
    },
    {
      name: "status claimed + proposal.bounty_settled=true visitor — no Donate",
      input: {
        proposal: proposal({
          status: "claimed",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "claimed",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: donor,
      },
      sentence: "Bounty paid. Waiting on the builder.",
      button: null,
    },
    // Completed row with bounty_settled:true is unaffected (status completed stays completed)
    {
      name: "completed + proposal.bounty_settled=true — unaffected",
      input: {
        proposal: proposal({
          status: "completed",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "completed",
          bounty_settled: true,
          accepting_funds: false,
        } as never),
      },
      sentence: "Approved. Keyholders sign the selected branch; broadcast stays in Sparrow.",
      button: null,
    },
    {
      name: "completed + proposal.bounty_settled=true with settled branches — settled on-chain",
      input: {
        proposal: proposal({
          status: "completed",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "completed",
          bounty_settled: true,
          accepting_funds: false,
          psbt: {
            structured_state: "confirmed",
            selected: { bounty: { kind: "clean" } },
            signoff: { bounty: { state: "settled", signed: 2, required_threshold: 2 } },
          },
        } as never),
      },
      sentence: "Settled on-chain.",
      button: null,
    },
    // psbt terminal ALWAYS blocks regardless of bountySettled — no Mark done
    {
      name: "settled + voided psbt → blocked, no Mark done",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "voided" },
        } as never),
        user: proposer,
      },
      sentence: "Structure unavailable, not accepting funds.",
      button: null,
    },
    {
      name: "settled + unreadable psbt → blocked, no Mark done",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          bounty_settled: true,
          accepting_funds: false,
          psbt: { structured_state: "unreadable" },
        } as never),
        user: proposer,
      },
      sentence: "Structure unavailable, not accepting funds.",
      button: null,
    },
    // stale catalog settled row + claim-view block → blocked (catalog flags cannot override claim-view)
    {
      name: "stale catalog settled + claim accepting_claims:false (no claim.bounty_settled) → blocked",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          // claim.bounty_settled is NOT true — catalog flags cannot override
          accepting_funds: false,
          accepting_claims: false,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: proposer,
      },
      sentence: "Structure unavailable, not accepting funds.",
      button: null,
    },
    {
      // workers#51: accepting_funds:false alone only hides Donate; the
      // in_review proposer keeps Mark it done.
      name: "stale catalog settled + claim accepting_funds:false only → Mark it done stays",
      input: {
        proposal: proposal({
          status: "in_review",
          claimer: "bob",
          bounty_settled: true,
          claim_phase: "settled",
          accepting_funds: false,
        }),
        claim: claim({
          state: "in_review",
          claimer: "bob",
          accepting_funds: false,
          psbt: { structured_state: "awaiting_funds" },
        } as never),
        user: proposer,
      },
      sentence: "Mark it done if the work is finished.",
      button: "done",
    },
  ];

  it.each(rows)("$name", ({ input, sentence, button, more }) => {
    const got = act(input);
    if (typeof sentence === "string") expect(got.sentence).toBe(sentence);
    else expect(got.sentence).toMatch(sentence);
    expect(got.button).toBe(button);
    if (more) expect(got.moreIds).toEqual(more);
    expect(got.button === null || Boolean(got.button)).toBe(true);
  });

  it("never returns two primaries", () => {
    for (const row of rows) {
      const got = act(row.input);
      const html = nextActionPrimaryHtml(got);
      const primaries = html.match(/class="btn"/g) || [];
      expect(primaries.length).toBe(got.button ? 1 : 0);
    }
  });
});

describe("listed status ignores balance-derived open", () => {
  it("keeps Donate + explainer when listed with open state above floor", () => {
    const action = resolveNextAction({
      proposal: proposal({ status: "listed", balance_sats: 30_586 }),
      claim: claim({
        state: "open",
        status: "listed",
        confirmed_balance_sats: 30_586,
        claim_floor_sats: 10_000,
        claimer: null,
        psbt: { structured_state: "psbt_ready" },
      }),
      user: builder,
    });
    expect(action.sentence).toBe("Listed — still raising");
    expect(action.detail).toContain(
      "applications open when this listing becomes claimable",
    );
    expect(action.button).toBe("donate");
    const html = nextActionPrimaryHtml(action);
    expect(html).toContain("data-open-donate");
    expect(html).toContain("Donate");
    expect(html).not.toContain("builder-claim");
    expect(html).not.toContain("Apply with bond");
  });

  it("still offers Apply when status is claimable with open state", () => {
    const action = resolveNextAction({
      proposal: proposal({ status: "claimable", balance_sats: 30_586 }),
      claim: claim({
        state: "open",
        status: "claimable",
        confirmed_balance_sats: 30_586,
        claim_floor_sats: 10_000,
      }),
      user: builder,
    });
    expect(action.sentence).toBe("Apply with a bond.");
    expect(action.button).toBe("apply");
    expect(nextActionPrimaryHtml(action)).toContain("builder-claim");
  });
});

describe("nextActionCardHtml", () => {
  it("uses bindable ids for donate, done, and flag", () => {
    const donate = nextActionCardHtml({
      sentence: "Listed — still raising",
      detail:
        "Donations are open; applications open when this listing becomes claimable.",
      button: "donate",
      moreIds: [],
    });
    expect(donate).toContain('id="donate-open"');
    expect(donate).toContain("data-open-donate");
    expect(donate).toContain("Listed — still raising");
    expect(donate).toContain(
      "applications open when this listing becomes claimable",
    );
    expect(donate.match(/class="btn"/g)?.length).toBe(1);

    const done = nextActionPrimaryHtml({
      sentence: "Mark it done if the work is finished.",
      button: "done",
      moreIds: [],
    });
    expect(done).toContain('id="builder-done"');
    expect(done).toContain("This is done");
    expect(done).not.toContain("builder-allocation");

    const doneMs = nextActionPrimaryHtml({
      sentence: "Mark it done if the work is finished.",
      button: "done",
      moreIds: [],
      doneAllocations: [
        { id: "m1", allocation_sats: 80_000 },
        { id: "m2", allocation_sats: 40_000 },
      ],
    });
    expect(doneMs).toContain('id="builder-allocation"');
    expect(doneMs).toContain("m1");
    expect(doneMs).toContain("m2");

    const flag = nextActionPrimaryHtml({
      sentence: "Flag if the work is not finished.",
      button: "flag",
      moreIds: [],
    });
    expect(flag).toContain('id="builder-flag"');
    expect(flag).not.toMatch(/deliverable_confirm|⌈|tos-2026|decision_id|psbt/i);
  });

  it("does not put a Donate primary on claimed, in_review, or completed", () => {
    for (const status of ["claimed", "in_review", "completed"] as const) {
      const html = nextActionCardHtml(
        resolveNextAction({ proposal: proposal({ status, claimer: "bob" }) }),
      );
      expect(html).not.toContain("data-open-donate");
      expect(html).not.toContain('id="donate-open"');
    }
  });
});


describe("in_review pooling donate", () => {
  it("keeps Donate reachable for donors while structured funding awaits funds", () => {
    const action = resolveNextAction({
      proposal: proposal({ status: "in_review", claimer: "bob" }),
      claim: claim({
        state: "in_review",
        claimer: "bob",
        psbt: { structured_state: "awaiting_funds" },
      }),
      user: donor,
    });
    expect(action.button).toBe("donate");
    expect(nextActionPrimaryHtml(action)).toContain("data-open-donate");
  });

  it("slow-path in_review without psbt still offers donate", () => {
    const action = resolveNextAction({
      proposal: proposal({ status: "in_review", claimer: "bob" }),
      claim: claim({ state: "in_review", claimer: "bob" }),
      user: donor,
    });
    expect(action.button).toBe("donate");
    expect(action.sentence).toContain("still pooling");
    expect(nextActionPrimaryHtml(action)).toContain("data-open-donate");
  });

  it("stays review-focused when structured_state is explicitly not pooling", () => {
    const action = resolveNextAction({
      proposal: proposal({ status: "in_review", claimer: "bob" }),
      claim: claim({
        state: "in_review",
        claimer: "bob",
        psbt: { structured_state: "psbt_ready" },
      }),
      user: donor,
    });
    expect(action.button).toBeNull();
    expect(action.sentence).toBe("Waiting on the proposer.");
    expect(nextActionPrimaryHtml(action)).not.toContain("data-open-donate");
  });

  it("keeps proposer primary as done even while awaiting_funds", () => {
    const action = resolveNextAction({
      proposal: proposal({ status: "in_review", claimer: "bob" }),
      claim: claim({
        state: "in_review",
        claimer: "bob",
        can_mark_done: true,
        psbt: { structured_state: "awaiting_funds" },
      }),
      user: proposer,
    });
    expect(action.button).toBe("done");
    expect(nextActionPrimaryHtml(action)).not.toContain("data-open-donate");
  });
});

describe("isUnknownClaimState", () => {
  it("returns false for null/undefined", () => {
    expect(isUnknownClaimState(null)).toBe(false);
    expect(isUnknownClaimState(undefined)).toBe(false);
  });

  it("returns false for known claim states", () => {
    expect(isUnknownClaimState("open")).toBe(false);
    expect(isUnknownClaimState("below_floor")).toBe(false);
    expect(isUnknownClaimState("claim_pending")).toBe(false);
    expect(isUnknownClaimState("claimed")).toBe(false);
    expect(isUnknownClaimState("in_review")).toBe(false);
    expect(isUnknownClaimState("completed")).toBe(false);
    expect(isUnknownClaimState("unavailable")).toBe(false);
    expect(isUnknownClaimState("settled")).toBe(false);
  });

  it("returns true for unknown claim states (fail closed)", () => {
    expect(isUnknownClaimState("some_future_state")).toBe(true);
    expect(isUnknownClaimState("unknown")).toBe(true);
    expect(isUnknownClaimState("blocked")).toBe(true);
  });
});

describe("isStructuredTerminalOrUnknown", () => {
  it("returns false for null (no structured state)", () => {
    expect(isStructuredTerminalOrUnknown(null)).toBe(false);
  });

  it("returns false for known healthy states", () => {
    expect(isStructuredTerminalOrUnknown("awaiting_funds")).toBe(false);
    expect(isStructuredTerminalOrUnknown("psbt_ready")).toBe(false);
    expect(isStructuredTerminalOrUnknown("broadcast")).toBe(false);
    expect(isStructuredTerminalOrUnknown("confirmed")).toBe(false);
  });

  it("returns true for voided state", () => {
    expect(isStructuredTerminalOrUnknown("voided")).toBe(true);
  });

  it("returns true for unknown states (fail closed)", () => {
    expect(isStructuredTerminalOrUnknown("some_future_state")).toBe(true);
    expect(isStructuredTerminalOrUnknown("unknown")).toBe(true);
  });

  it("returns false for empty string (treated as no state)", () => {
    expect(isStructuredTerminalOrUnknown("")).toBe(false);
  });
});

const CLAIM_ESCROW = "tb1qf8agl2750ezeuwt7ys5ghzmul9wutls0cs9jyt";

describe("isDonateBlocked (claim-view-first)", () => {
  it("returns true when claim view is null (claim-view-first requires loaded claim)", () => {
    expect(isDonateBlocked(null, null)).toBe(true);
    expect(isDonateBlocked({}, null)).toBe(true);
    expect(isDonateBlocked({ accepting_funds: true }, null)).toBe(true);
    expect(isDonateBlocked({ structured_state: "awaiting_funds" }, null)).toBe(true);
  });

  it("returns true when proposal.accepting_funds is false", () => {
    expect(isDonateBlocked({ accepting_funds: false }, { accepting_funds: true })).toBe(true);
  });

  it("returns true when proposal.structured_state is voided", () => {
    expect(isDonateBlocked({ structured_state: "voided" }, { accepting_funds: true })).toBe(true);
  });

  it("returns true when proposal.structured_state is unknown", () => {
    expect(isDonateBlocked({ structured_state: "some_unknown_state" }, { accepting_funds: true })).toBe(true);
  });

  it("returns true when claim.psbt.structured_state is voided", () => {
    expect(isDonateBlocked({}, { psbt: { structured_state: "voided" } })).toBe(true);
  });

  it("returns true when claim.psbt.structured_state is unknown", () => {
    expect(isDonateBlocked({}, { psbt: { structured_state: "future_state" } })).toBe(true);
  });

  it("returns false when claim view allows and has healthy structured state", () => {
    const e = CLAIM_ESCROW;
    expect(isDonateBlocked({}, { psbt: { structured_state: "awaiting_funds" }, accepting_funds: true, escrow_address: e })).toBe(false);
    expect(isDonateBlocked({}, { psbt: { structured_state: "confirmed" }, accepting_funds: true, escrow_address: e })).toBe(false);
    expect(isDonateBlocked({}, { psbt: { structured_state: "psbt_ready" }, accepting_funds: true, escrow_address: e })).toBe(false);
    expect(isDonateBlocked({}, { psbt: { structured_state: "broadcast" }, accepting_funds: true, escrow_address: e })).toBe(false);
  });

  it("returns false when claim view has no psbt but accepting_funds is true", () => {
    expect(isDonateBlocked({}, { accepting_funds: true, escrow_address: CLAIM_ESCROW })).toBe(false);
  });

  it("returns true when claim view has no accepting_funds (unresolved reply; only true opens Donate)", () => {
    // Every resolved Workers claim view sends accepting_funds; the unresolved
    // reply (git file missing) omits it and must not open Donate.
    expect(isDonateBlocked({}, { state: "open", escrow_address: CLAIM_ESCROW })).toBe(true);
    expect(isDonateBlocked({}, { accepting_funds: null, escrow_address: CLAIM_ESCROW })).toBe(true);
    expect(isDonateBlocked({}, {})).toBe(true);
  });

  it("returns true when claim view says accepting_funds:true but has no escrow_address of its own", () => {
    expect(isDonateBlocked({}, { accepting_funds: true })).toBe(true);
    expect(isDonateBlocked({}, { accepting_funds: true, escrow_address: "  " })).toBe(true);
  });

  it("does NOT block on claim.state === unavailable (workers returns that for declined_fundable etc)", () => {
    // Workers returns state: unavailable for declined_fundable, refunding, underfunded, etc.
    // which still need their UI actions (Donate, Register, etc.)
    expect(isDonateBlocked({}, { state: "unavailable", accepting_funds: true, escrow_address: CLAIM_ESCROW })).toBe(false);
  });

  it("returns true when claim accepting_funds is false", () => {
    expect(isDonateBlocked({}, { accepting_funds: false })).toBe(true);
  });

  it("proposal-level accepting_funds=false overrides healthy claim state", () => {
    expect(
      isDonateBlocked(
        { accepting_funds: false },
        { psbt: { structured_state: "awaiting_funds" }, accepting_funds: true },
      ),
    ).toBe(true);
  });

  it("proposal-level structured_state=voided overrides healthy claim state", () => {
    expect(
      isDonateBlocked(
        { structured_state: "voided" },
        { psbt: { structured_state: "awaiting_funds" }, accepting_funds: true },
      ),
    ).toBe(true);
  });

  it("returns true when claim.state is settled (workers#41)", () => {
    expect(isDonateBlocked({}, { state: "settled", accepting_funds: true })).toBe(true);
  });

  it("returns true when claim.claim_phase is settled (workers#41)", () => {
    expect(isDonateBlocked({}, { claim_phase: "settled", accepting_funds: true })).toBe(true);
  });

  it("returns true when claim.bounty_settled is true (workers#41)", () => {
    expect(isDonateBlocked({}, { bounty_settled: true, accepting_funds: true })).toBe(true);
  });
});

describe("project-page chrome contracts", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "proposal-page.ts"),
    "utf8",
  );

  it("keeps a static next-card and stable panel mounts", () => {
    expect(src).toContain('id="next-card"');
    expect(src).toContain("reviewPanelHtml");
    expect(src).toContain("rebuttalPanelHtml");
    expect(src).toContain("ballotPanelHtml");
    expect(src).toContain("refundRegisterHtml");
    expect(src).toContain("builderPanelHtml");
    const mainAt = src.indexOf('class="proposal-main"');
    const fundingAt = src.indexOf("structuredFundingPanelHtml(match)");
    const reviewAt = src.indexOf('id="proposal-review"');
    const commentsAt = src.indexOf("commentsHtml(match.id");
    const sideAt = src.indexOf('class="proposal-sidebar"');
    expect(fundingAt).toBeGreaterThan(mainAt);
    expect(reviewAt).toBeGreaterThan(fundingAt);
    expect(commentsAt).toBeGreaterThan(reviewAt);
    expect(sideAt).toBeGreaterThan(commentsAt);
    const side = src.slice(sideAt);
    expect(side).not.toContain("structuredFundingPanelHtml");
    expect(side).not.toContain("reviewPanelHtml");
    expect(side).toContain('id="funding-side-link"');
    expect(side).toContain('id="review-side-link"');
  });

  it("omits donate-open from the slot when the card owns Donate", () => {
    expect(src).toContain("proposal-donate-slot");
    // Donate slot starts hidden; claim-view-first reveals after check passes
    expect(src).toMatch(/proposal-donate-slot".*hidden/);
  });

  it("mounts donate chrome for claimed/in_review pooling statuses", () => {
    expect(src).toContain("isDonateChromeStatus");
    // Donate chrome mounting moved to claim-view-first flow in builder-panel.ts
    expect(src).toContain("showDonatePlaceholder");
  });
});
