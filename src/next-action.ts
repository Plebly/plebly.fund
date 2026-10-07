import type { AuthUser } from "./auth";
import type { ClaimApplicationsResponse, ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS, isFundableStatus } from "./config";
import { btnWithIcon } from "./icons";
import { sessionMatchesClaimer, sessionMatchesPendingClaim } from "./claimer-match";
import { userMatchesProposer } from "./proposal-ui";
import { STRUCTURED_FUNDING_KNOWN_STATES } from "./proposal-structured-funding";
import { isKnownProposalStatus, type Proposal } from "./types";
import { escapeHtml } from "./util";

/** States that are always blocked (terminal or errored). */
const ALWAYS_BLOCKED_STATES = ["voided", "unreadable"] as const;

/** Known claim states for fail-closed allowlist (unknown → blocked). */
export const KNOWN_CLAIM_STATES = [
  "open",
  "below_floor",
  "claim_pending",
  "claimed",
  "in_review",
  "completed",
  "unavailable",
  "settled",
] as const;

/** True when claim state is unknown (not in allowlist). */
export function isUnknownClaimState(state: string | null | undefined): boolean {
  if (!state) return false;
  return !KNOWN_CLAIM_STATES.includes(state as (typeof KNOWN_CLAIM_STATES)[number]);
}

export type NextButton =
  | "donate"
  | "apply"
  | "deliverable"
  | "done"
  | "flag"
  | "rebuttal"
  | "register"
  | null;

export type NextMoreId =
  | "checkpoint"
  | "extension"
  | "challenge"
  | "collab"
  | "workboard";

export type NextAction = {
  sentence: string;
  /** Optional muted line under the sentence (e.g. listed-state explainer). */
  detail?: string;
  button: NextButton;
  moreIds: NextMoreId[];
  doneAllocations?: { id: string; allocation_sats: number }[];
};

export type NextActionInput = {
  proposal: Proposal;
  claim?: ClaimStatus | null;
  apps?: Pick<ClaimApplicationsResponse, "mine_application_id" | "claim_mode"> | null;
  user?: AuthUser | null;
  reviewerActive?: boolean;
  isProposer?: boolean;
  isBuilder?: boolean;
  /** True when the latest deliverable_confirm ballot is already closed. */
  reviewBallotClosed?: boolean;
  /** Closed-ballot one-liner when Flag should not be the primary CTA. */
  reviewBallotClosedSummary?: string;
};

export function daysLeftFrom(iso?: string | null): number | null {
  if (!iso) return null;
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400_000));
}

function clock(iso?: string | null): string {
  const days = daysLeftFrom(iso);
  if (days == null) return "";
  return ` ${days} day${days === 1 ? "" : "s"} left.`;
}

function isDirect(p: Proposal): boolean {
  return String(p.proposal_type || "bounty").toLowerCase() === "direct";
}

/**
 * Prefer Workers psbt.structured_state. Slow/partial /claims payloads often
 * omit `psbt` while state is already claimed|in_review; treat that as still
 * pooling so Donate stays reachable (full payloads with other states win).
 */
export function claimStructuredState(claim?: ClaimStatus | null): string | null {
  const state = claim?.psbt?.structured_state;
  if (state) return String(state);
  const lifecycle = claim?.state;
  if (lifecycle === "claimed" || lifecycle === "in_review") {
    return "awaiting_funds";
  }
  return null;
}

function structuredState(claim?: ClaimStatus | null): string | null {
  return claimStructuredState(claim);
}

/**
 * True when structured state is voided, unreadable, or unknown — terminal
 * states that should never offer Donate, claim, or sign. Unknown states fail closed.
 */
export function isStructuredTerminalOrUnknown(state: string | null): boolean {
  if (!state) return false;
  if (ALWAYS_BLOCKED_STATES.includes(state as (typeof ALWAYS_BLOCKED_STATES)[number])) {
    return true;
  }
  return !STRUCTURED_FUNDING_KNOWN_STATES.includes(
    state as (typeof STRUCTURED_FUNDING_KNOWN_STATES)[number],
  );
}

/**
 * True when donations/applications are blocked by catalog signals.
 * Catalog can only BLOCK, never ENABLE donations.
 * Checks:
 * - Catalog-level `accepting_funds === false`
 * - Catalog-level `structured_state === "voided"` or unknown
 */
export function isCatalogDonateBlocked(
  proposal: {
    accepting_funds?: boolean | null;
    structured_state?: string | null;
  } | null,
): boolean {
  if (proposal?.accepting_funds === false) return true;
  return isStructuredTerminalOrUnknown(proposal?.structured_state ?? null);
}

/**
 * Full claim view shape used for claim-view-first gating.
 * Mirrors fields from ClaimStatus that affect donate eligibility.
 */
export type ClaimViewForDonate = {
  psbt?: { structured_state?: string | null } | null;
  accepting_funds?: boolean | null;
  state?: string | null;
  /** Phase of the claim lifecycle (workers#41: 'settled' for paid bounties). */
  claim_phase?: string | null;
  /** True when bounty is settled — hide Donate/Apply but keep claimant's mark-done/flag. */
  bounty_settled?: boolean | null;
} | null;

/**
 * True when claim view allows donations.
 * Claim view must be loaded and confirm:
 * - `accepting_funds` is not explicitly `false`
 * - `psbt.structured_state` is null/absent or a known non-voided/non-unreadable state
 *
 * NOTE: Do NOT block on claim.state === 'unavailable' — Workers returns that for
 * declined_fundable, refunding, underfunded, abandoned_vote, redirected which need
 * their respective UI actions (Donate, Register, etc.).
 *
 * No structured record (missing psbt AND missing accepting_funds) is ALLOWED — that's
 * what a proposal without structured funding looks like. Workers#40 sends
 * accepting_funds:false explicitly on unreadable records.
 */
export function isClaimViewDonateAllowed(claim: ClaimViewForDonate): boolean {
  if (!claim) return false;

  // Claim-level accepting_funds: false blocks (workers#40 sends this for unreadable)
  if (claim.accepting_funds === false) return false;

  // Settled bounty blocks donations (workers#41)
  if (claim.state === "settled" || claim.claim_phase === "settled") return false;

  // bounty_settled on active-claim view also blocks donations
  if (claim.bounty_settled === true) return false;

  const claimState = claim.psbt?.structured_state ?? null;

  // No structured state yet = allow (no structured record, or pre-structured-funding)
  if (!claimState) return true;

  // Voided or unreadable blocks
  if (ALWAYS_BLOCKED_STATES.includes(claimState as (typeof ALWAYS_BLOCKED_STATES)[number])) {
    return false;
  }

  // Unknown state = fail closed
  return STRUCTURED_FUNDING_KNOWN_STATES.includes(
    claimState as (typeof STRUCTURED_FUNDING_KNOWN_STATES)[number],
  );
}

/**
 * True when donations/applications are blocked.
 * Catalog can only BLOCK (accepting_funds=false or voided/unreadable).
 * Claim view must be loaded and confirm non-voided/non-unreadable to ENABLE.
 * Workers#40: 503 on claim view = blocked (handled by caller passing null).
 */
export function isDonateBlocked(
  proposal: {
    accepting_funds?: boolean | null;
    structured_state?: string | null;
  } | null,
  claim: ClaimViewForDonate,
): boolean {
  if (isCatalogDonateBlocked(proposal)) return true;
  return !isClaimViewDonateAllowed(claim);
}

/**
 * True when the claim view indicates a state that should block ALL actions
 * (voided/unreadable/unknown structure, unknown claim state, or accepting_funds:false without bounty_settled).
 * Used at the top of resolveNextAction to exit early.
 *
 * NOTE: Do NOT block on claim.state === 'unavailable' — Workers returns that for
 * declined_fundable, refunding, underfunded, abandoned_vote, redirected which need
 * their respective UI actions (Donate, Register, etc.).
 *
 * NOTE: When bounty_settled===true with healthy psbt, we do NOT block here —
 * the claim branches (in_review/claimed) should still render their actions
 * (Mark done, Flag, Submit deliverable). Donate/Apply are blocked separately
 * via isClaimViewDonateAllowed.
 */
export function isClaimViewBlocked(claim: ClaimViewForDonate): boolean {
  if (!claim) return false;
  const structured = claim.psbt?.structured_state ?? null;
  // When bounty_settled is true with healthy psbt, let claim branches run
  // (Donate/Apply are blocked separately via isClaimViewDonateAllowed)
  if (claim.bounty_settled === true) {
    if (!structured || !isStructuredTerminalOrUnknown(structured)) {
      return false;
    }
  }
  // accepting_funds:false without bounty_settled blocks everything
  if (claim.accepting_funds === false) return true;
  // Settled state (no active claimant) blocks everything
  if (claim.state === "settled" || claim.claim_phase === "settled") return true;
  // Unknown claim state blocks (fail closed allowlist)
  if (isUnknownClaimState(claim.state)) return true;
  if (structured && isStructuredTerminalOrUnknown(structured)) return true;
  return false;
}

function selectedBranchesSettled(claim?: ClaimStatus | null): boolean {
  const selected = Object.keys(claim?.psbt?.selected || {});
  if (!selected.length) return false;
  const signoff = claim?.psbt?.signoff || {};
  return selected.every((id) => signoff[id]?.state === "settled");
}

function pendingDoneAllocations(
  claim?: ClaimStatus | null,
): { id: string; allocation_sats: number }[] | undefined {
  const allocs = claim?.allocations || [];
  if (allocs.length <= 1) return undefined;
  const closed = new Set(
    (claim?.donor_reviews || [])
      .filter(
        (r) =>
          r.status === "window_open" ||
          r.status === "flagged" ||
          r.status === "auto_completed",
      )
      .map((r) => r.allocation_id || "bounty"),
  );
  const pending = allocs.filter((a) => !closed.has(a.id));
  return pending.length ? pending : undefined;
}

function claimMode(p: Proposal, apps?: NextActionInput["apps"]): string {
  return String(apps?.claim_mode || p.claim_mode || "proposer_select");
}

function roles(input: NextActionInput): {
  isProposer: boolean;
  isBuilder: boolean;
  user: AuthUser | null;
} {
  const user = input.user ?? null;
  const isProposer =
    input.isProposer ??
    userMatchesProposer(user, input.proposal.proposer, input.proposal.proposer_type);
  const isBuilder =
    input.isBuilder ??
    (sessionMatchesClaimer(
      user,
      input.claim?.claimer ?? input.proposal.claimer,
      input.claim?.claimer_type ?? input.proposal.claimer_type,
      input.claim?.claim_agent ?? input.proposal.claim_agent,
    ) ||
      sessionMatchesPendingClaim(
        user,
        input.claim?.claimer_user_id ?? input.claim?.pending?.user_id,
      ));
  return { isProposer, isBuilder, user };
}

/** One sentence and at most one primary button. */
export function resolveNextAction(input: NextActionInput): NextAction {
  const p = input.proposal;
  const claim = input.claim;
  const { isProposer, isBuilder, user } = roles(input);
  const status = String(p.status || "").toLowerCase();
  const donor = claim?.donor_review_status ?? p.donor_review_status ?? null;
  const donorExp = claim?.donor_review_expires_at ?? p.donor_review_expires_at;
  const moreIds: NextMoreId[] = [];

  // FIRST: check catalog status "voided" or unknown — terminal, no actions at all.
  if (status === "voided") {
    return {
      sentence: "Voided, not accepting funds.",
      button: null,
      moreIds,
    };
  }
  if (!isKnownProposalStatus(status)) {
    return {
      sentence: "Unavailable.",
      button: null,
      moreIds,
    };
  }

  // Settled bounty: check first to give correct message (workers#41)
  if (claim?.state === "settled" || claim?.claim_phase === "settled") {
    return { sentence: "Bounty paid.", button: null, moreIds };
  }

  // Check catalog-level blocking (structured_state voided/unknown, accepting_funds:false)
  const catalogBlocked = isCatalogDonateBlocked(p);

  // Unknown claim state blocks (fail closed allowlist)
  if (isUnknownClaimState(claim?.state)) {
    return { sentence: "Unavailable.", button: null, moreIds };
  }

  // Voided/unknown/unavailable/unreadable claim states block fund/apply/mark-done/flag.
  // Exception: "rejected" status should still allow rebuttal action.
  // Exception: "bounty_settled" status should let claim branches run (claimant actions stay available).
  const claimViewBlocked = isClaimViewBlocked(claim ?? null);
  const claimStructured = structuredState(claim);
  const structureBlocked = catalogBlocked || claimViewBlocked || (claimStructured && isStructuredTerminalOrUnknown(claimStructured));

  // For rejected proposals, skip the structure-blocked early exit so rebuttal is still available.
  // For bounty_settled status (workers#41), skip so claim branches can render claimant actions.
  if (structureBlocked && status !== "rejected" && status !== "bounty_settled") {
    // Exception: release_blocked_reason should still show for stalled releases
    if (!p.release_blocked_reason) {
      return {
        sentence: "Structure unavailable, not accepting funds.",
        button: null,
        moreIds,
      };
    }
  }

  if (p.release_blocked_reason) {
    const seats = (p.release_blocked_seats || [])
      .filter((n) => n >= 1 && n <= 5)
      .map((n) => `seat ${n}`);
    const seatLine = seats.length ? ` Unsigned: ${seats.join(", ")}.` : "";
    return {
      sentence: `Release stalled.${seatLine}`,
      button: null,
      moreIds,
    };
  }

  if (isDirect(p)) {
    const bal = p.balance_sats ?? claim?.confirmed_balance_sats ?? 0;
    const floor = claim?.claim_floor_sats ?? CLAIM_FLOOR_SATS;
    const canSubmit = ["listed", "funding", "claimable", "in_review"].includes(
      status,
    );
    if (isProposer && canSubmit && bal >= floor) {
      return {
        sentence: "Submit work if you want it on the record.",
        button: "deliverable",
        moreIds,
      };
    }
    if (isFundableStatus(status)) {
      return { sentence: "Donate. Paid monthly.", button: "donate", moreIds };
    }
    if (status === "completed") {
      return {
        sentence: "Approved. Paid after keyholders sign.",
        button: null,
        moreIds,
      };
    }
    if (status === "refunding") {
      return { sentence: "Add a refund address.", button: "register", moreIds };
    }
    if (status === "redirected" || status === "redirect_pending") {
      return {
        sentence: "Funds are moving to another project.",
        button: null,
        moreIds,
      };
    }
    return { sentence: "Donate. Paid monthly.", button: isFundableStatus(status) ? "donate" : null, moreIds };
  }

  if (status === "unindexed" || status === "pr_open") {
    return { sentence: "Waiting on listing.", button: null, moreIds };
  }

  if (status === "declined_fundable") {
    return {
      sentence: "Listing declined. You can still fund.",
      button: "donate",
      moreIds,
    };
  }

  if (status === "refunding") {
    return { sentence: "Add a refund address.", button: "register", moreIds };
  }

  if (status === "redirected" || status === "redirect_pending") {
    return {
      sentence: "Funds are moving to another project.",
      button: null,
      moreIds,
    };
  }

  if (status === "abandoned_vote") {
    return { sentence: "Vote on remaining funds.", button: null, moreIds };
  }

  if (status === "underfunded") {
    const bal = p.balance_sats ?? claim?.confirmed_balance_sats ?? 0;
    if (bal > 0) {
      return { sentence: "Vote on remaining funds.", button: null, moreIds };
    }
    return {
      sentence: "Funding ended before this could open.",
      button: null,
      moreIds,
    };
  }

  if (status === "rejected") {
    const exp = p.rebuttal_expires_at;
    const days = daysLeftFrom(exp);
    if (isBuilder || (isDirect(p) && isProposer)) {
      return {
        sentence: `You can file one reply.${clock(exp)}`,
        button: "rebuttal",
        moreIds,
      };
    }
    return {
      sentence:
        days != null
          ? `The builder has ${days} day${days === 1 ? "" : "s"} to reply once.`
          : "The builder has time to reply once.",
      button: null,
      moreIds,
    };
  }

  if (status === "completed" || claim?.state === "completed") {
    if (isDirect(p)) {
      return {
        sentence: "Approved. Paid after keyholders sign.",
        button: null,
        moreIds,
      };
    }
    if (selectedBranchesSettled(claim)) {
      return { sentence: "Settled on-chain.", button: null, moreIds };
    }
    return {
      sentence:
        "Approved. Keyholders sign the selected branch; broadcast stays in Sparrow.",
      button: null,
      moreIds,
    };
  }

  if (status === "in_review" || claim?.state === "in_review") {
    const flagged = donor === "flagged" || Boolean(claim?.review_decision_open);
    if (flagged) {
      return {
        sentence: input.reviewerActive
          ? "Vote whether this meets the project."
          : "Reviewers are checking the work.",
        button: null,
        moreIds,
      };
    }
    if (donor === "window_open") {
      // Closed reviewer ballot is the sole primary state — do not leave an
      // actionable Flag CTA competing with "Closed · approve (passed)".
      if (input.reviewBallotClosed) {
        return {
          sentence:
            input.reviewBallotClosedSummary ||
            "Closed — decision recorded.",
          button: null,
          moreIds,
        };
      }
      // Public /claims omits credentials → can_flag_close stays false in the SPA.
      // Show Flag for any signed-in user; POST /claims/flag still enforces
      // confirmed-donor (mirrors Mark Done + local isProposer).
      if (claim?.can_flag_close || Boolean(input.user)) {
        return {
          sentence: `Flag if the work is not finished.${clock(donorExp)}`,
          button: "flag",
          moreIds,
        };
      }
      const days = daysLeftFrom(donorExp);
      return {
        sentence:
          days != null
            ? `Donors have ${days} day${days === 1 ? "" : "s"} to flag.`
            : "Donors have a window to flag.",
        button: null,
        moreIds,
      };
    }
    if (isProposer) {
      // Claim status is fetched public (credentials omit) so can_mark_done is
      // always false in the SPA; isProposer is computed locally. POST /claims/done
      // still enforces proposer session + deliverable + in_review.
      return {
        sentence: "Mark it done if the work is finished.",
        button: "done",
        moreIds: isBuilder ? ["extension"] : moreIds,
        doneAllocations: pendingDoneAllocations(claim),
      };
    }
    const structured = structuredState(claim);
    if (isStructuredTerminalOrUnknown(structured)) {
      return {
        sentence: "Structure voided, not accepting funds.",
        button: null,
        moreIds,
      };
    }
    if (structured === "confirmed") {
      return {
        sentence: "Funds are structured. Waiting on the proposer to mark done.",
        button: null,
        moreIds,
      };
    }
    if (structured === "awaiting_funds") {
      // Catalog bounty_settled blocks Donate even when claim is in_review
      if (status === "bounty_settled") {
        return { sentence: "Bounty paid. Waiting on the proposer.", button: null, moreIds };
      }
      return {
        sentence: "The pot is still pooling. Donate until the frozen allocation is met.",
        button: "donate",
        moreIds,
      };
    }
    // Catalog bounty_settled: show "Bounty paid" instead of generic waiting message
    if (status === "bounty_settled") {
      return { sentence: "Bounty paid. Waiting on the proposer.", button: null, moreIds };
    }
    return { sentence: "Waiting on the proposer.", button: null, moreIds };
  }

  if (status === "claimed" || claim?.state === "claimed") {
    const structured = structuredState(claim);
    if (isStructuredTerminalOrUnknown(structured)) {
      return {
        sentence: "Structure voided, not accepting funds.",
        button: null,
        moreIds,
      };
    }
    // bounty_settled: builder still gets deliverable, just no Donate (blocked via isClaimViewDonateAllowed)
    if (isBuilder) {
      return {
        sentence:
          structured === "psbt_ready"
            ? "Submit the work when it is done. Structured funding is ready for keyholders."
            : structured === "confirmed"
              ? "Submit the work when it is done. Funds are structured for release."
              : structured === "awaiting_funds"
                ? "Submit the work when it is done. The pot is still pooling."
                : "Submit the work when it is done.",
        button: "deliverable",
        moreIds: ["checkpoint", "extension", "collab", "workboard"],
      };
    }
    if (claim?.can_challenge_abandoned) moreIds.push("challenge");
    if (structured === "psbt_ready") {
      return {
        sentence: "Structured funding is ready. Keyholders broadcast in Sparrow.",
        button: null,
        moreIds,
      };
    }
    if (structured === "confirmed") {
      return {
        sentence: "Funds are structured on-chain. Waiting on the builder.",
        button: null,
        moreIds,
      };
    }
    if (structured === "awaiting_funds") {
      // Catalog bounty_settled blocks Donate even when claim is claimed
      if (status === "bounty_settled") {
        return { sentence: "Bounty paid. Waiting on the builder.", button: null, moreIds };
      }
      return {
        sentence: "The pot is still pooling. Donate until the frozen allocation is met.",
        button: "donate",
        moreIds,
      };
    }
    // Catalog bounty_settled: show "Bounty paid" instead of generic waiting message
    if (status === "bounty_settled") {
      return { sentence: "Bounty paid. Waiting on the builder.", button: null, moreIds };
    }
    return { sentence: "Waiting on the builder.", button: null, moreIds };
  }

  if (claim?.state === "claim_pending") {
    return { sentence: "Claim pending.", button: null, moreIds };
  }

  // Prefer Workers/catalog frontmatter status over balance-derived claim.state.
  // Shared Signet escrow can report state=open (≥ floor) while status stays listed.
  const frontmatter = String(claim?.status || status);
  const listedStillRaising =
    status === "listed" ||
    status === "funding" ||
    frontmatter === "listed" ||
    frontmatter === "funding";
  if (
    listedStillRaising &&
    status !== "claimable" &&
    frontmatter !== "claimable"
  ) {
    if (claim?.state === "below_floor") {
      const structured = structuredState(claim);
      if (isStructuredTerminalOrUnknown(structured)) {
        return {
          sentence: "Structure voided, not accepting funds.",
          button: null,
          moreIds,
        };
      }
      if (structured === "psbt_ready") {
        return {
          sentence: "Structured funding is ready. Keyholders broadcast in Sparrow.",
          button: null,
          moreIds,
        };
      }
      if (structured === "awaiting_funds") {
        return {
          sentence:
            "Donate until the frozen allocation, reserve, and miner fee are met.",
          button: "donate",
          moreIds,
        };
      }
    }
    return {
      sentence: "Listed — still raising",
      detail:
        "Donations are open; applications open when this listing becomes claimable.",
      button: "donate",
      moreIds,
    };
  }

  if (status === "claimable" || frontmatter === "claimable") {
    // bounty_settled on active claim hides Apply/Donate but claimant keeps mark-done/flag
    if (claim?.bounty_settled === true) {
      return {
        sentence: "Bounty settled.",
        button: null,
        moreIds,
      };
    }
    const mode = claimMode(p, input.apps);
    if (isProposer) {
      return {
        sentence:
          mode === "first_bonded"
            ? "First bonded builder wins."
            : "Pick a bonded builder.",
        button: null,
        moreIds,
      };
    }
    if (user && input.apps?.mine_application_id) {
      return { sentence: "Application in.", button: null, moreIds };
    }
    if (user) {
      return { sentence: "Apply with a bond.", button: "apply", moreIds };
    }
    return { sentence: "Open for builders.", button: "donate", moreIds };
  }

  // Catalog contract (workers#41): status='bounty_settled' blocks Donate/Apply but claimant actions stay
  // If we reach here without matching a claim branch, the bounty is settled with no active claimant actions.
  if (status === "bounty_settled") {
    return { sentence: "Bounty paid.", button: null, moreIds };
  }

  return {
    sentence: "Listed — still raising",
    detail:
      "Donations are open; applications open when this listing becomes claimable.",
    button: isFundableStatus(status) ? "donate" : null,
    moreIds,
  };
}

export function nextActionPrimaryHtml(action: NextAction): string {
  if (!action.button) return "";
  if (action.button === "donate") {
    return `<button type="button" class="btn" id="donate-open" data-open-donate>${btnWithIcon("bitcoin-sign", "Donate")}</button>`;
  }
  if (action.button === "apply") {
    return `<button type="button" class="btn" id="builder-claim">${btnWithIcon("handshake", "Apply with bond")}</button>`;
  }
  if (action.button === "deliverable") {
    return `<button type="button" class="btn" id="builder-deliverable">Submit deliverable</button>`;
  }
  if (action.button === "done") {
    const sel =
      action.doneAllocations && action.doneAllocations.length
        ? `<label class="donate-amount-label" for="builder-allocation">Milestone</label>
           <select id="builder-allocation" class="donate-amount">
             ${action.doneAllocations
               .map(
                 (a) =>
                   `<option value="${escapeHtml(a.id)}">${escapeHtml(a.id)}</option>`,
               )
               .join("")}
           </select>`
        : "";
    return `${sel}<button type="button" class="btn" id="builder-done">This is done</button>`;
  }
  if (action.button === "flag") {
    return `<button type="button" class="btn" id="builder-flag">Flag this close</button>`;
  }
  if (action.button === "rebuttal") {
    return `<button type="button" class="btn" id="next-rebuttal" data-next-rebuttal>File reply</button>`;
  }
  return `<button type="button" class="btn" id="next-register" data-next-register>Register</button>`;
}

export function nextActionSentenceHtml(action: NextAction): string {
  const detail = action.detail
    ? `<p class="next-card-detail muted" id="next-card-detail">${escapeHtml(action.detail)}</p>`
    : "";
  return `<p class="next-card-sentence" id="next-card-sentence">${escapeHtml(action.sentence)}</p>${detail}`;
}

export function nextActionMoreHtml(
  action: NextAction,
  bits: Partial<Record<NextMoreId, string>>,
): string {
  const inner = action.moreIds.map((id) => bits[id] || "").filter(Boolean).join("");
  if (!inner) return "";
  return `<details class="next-card-more"><summary>More</summary>${inner}</details>`;
}

export function nextActionCardHtml(
  action: NextAction,
  opts?: { extra?: string },
): string {
  const primary = nextActionPrimaryHtml(action);
  return `<div class="next-card-main">
    ${nextActionSentenceHtml(action)}
    ${primary ? `<div class="next-card-primary">${primary}</div>` : ""}
    ${opts?.extra || ""}
  </div>`;
}
