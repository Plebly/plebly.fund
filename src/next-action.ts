import type { AuthUser } from "./auth";
import type { ClaimApplicationsResponse, ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS, isFundableStatus } from "./config";
import { btnWithIcon } from "./icons";
import { sessionMatchesClaimer, sessionMatchesPendingClaim } from "./claimer-match";
import { userMatchesProposer } from "./proposal-ui";
import type { Proposal } from "./types";
import { escapeHtml } from "./util";

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

function structuredState(claim?: ClaimStatus | null): string | null {
  const state = claim?.psbt?.structured_state;
  return state ? String(state) : null;
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
  const status = String(p.status || "");
  const donor = claim?.donor_review_status ?? p.donor_review_status ?? null;
  const donorExp = claim?.donor_review_expires_at ?? p.donor_review_expires_at;
  const moreIds: NextMoreId[] = [];

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
      if (claim?.can_flag_close) {
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
      return {
        sentence: "Mark it done if the work is finished.",
        button: claim?.can_mark_done ? "done" : null,
        moreIds: isBuilder ? ["extension"] : moreIds,
        doneAllocations: pendingDoneAllocations(claim),
      };
    }
    return { sentence: "Waiting on the proposer.", button: null, moreIds };
  }

  if (status === "claimed" || claim?.state === "claimed") {
    const structured = structuredState(claim);
    if (isBuilder) {
      return {
        sentence:
          structured === "psbt_ready"
            ? "Submit the work when it is done. Structured funding is ready for keyholders."
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
    if (structured === "awaiting_funds") {
      return {
        sentence: "The pot is still pooling. Donate until the frozen allocation is met.",
        button: "donate",
        moreIds,
      };
    }
    return { sentence: "Waiting on the builder.", button: null, moreIds };
  }

  if (claim?.state === "claim_pending") {
    return { sentence: "Claim pending.", button: null, moreIds };
  }

  if (status === "claimable" || claim?.state === "open") {
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

  if (
    status === "listed" ||
    status === "funding" ||
    claim?.state === "below_floor"
  ) {
    const structured = structuredState(claim);
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
    return { sentence: "Still raising.", button: "donate", moreIds };
  }

  return { sentence: "Still raising.", button: isFundableStatus(status) ? "donate" : null, moreIds };
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
  return `<p class="next-card-sentence" id="next-card-sentence">${escapeHtml(action.sentence)}</p>`;
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
