import type { AuthUser } from "./auth";
import {
  type ClaimApplicationsResponse,
  type ClaimStatus,
} from "./builder";
import { claimerTrackHtml } from "./claimer-track-ui";
import {
  nextActionCardHtml,
  nextActionMoreHtml,
  resolveNextAction,
} from "./next-action";
import { sessionIsClaimStatusFulfiller } from "./claimer-match";
import type { Proposal } from "./types";
import { safeHrefAttr } from "./social-links";
import { escapeHtml } from "./util";

export function deliverableFormHtml(): string {
  return `<div id="deliverable-form" class="deliverable-form">
    <label class="donate-amount-label" for="deliv-url">Deliverable URL</label>
    <input id="deliv-url" class="donate-amount" type="url" placeholder="https://…" />
    <label class="donate-amount-label" for="deliv-desc">Description</label>
    <textarea id="deliv-desc" class="donate-amount" rows="3" placeholder="What to review…"></textarea>
    <label class="donate-amount-label" for="deliv-hash">Artifact hash (optional)</label>
    <input id="deliv-hash" class="donate-amount mono" type="text" />
    <button type="button" class="btn" id="deliv-submit">Submit for review</button>
  </div>`;
}

function metaBits(status: ClaimStatus): string {
  const bits: string[] = [];
  if (status.proposer_claimed) {
    bits.push(`<span class="pill pill-status status-active">Proposer-claimed</span>`);
  }
  if (status.claim_bond_txid) {
    bits.push(
      `<span class="builder-meta">Bond locked · <code class="mono">${escapeHtml(status.claim_bond_txid.slice(0, 12))}…</code></span>`,
    );
  }
  if (status.checkpoint_due_at) {
    const due = new Date(status.checkpoint_due_at).toLocaleDateString();
    bits.push(
      status.checkpoint_url
        ? `<span class="builder-meta">Checkpoint filed</span>`
        : `<span class="builder-meta">Checkpoint due ${escapeHtml(due)}</span>`,
    );
  }
  return bits.length
    ? `<div class="builder-meta-row">${bits.join(" ")}</div>`
    : "";
}

export function renderClaimStatusBody(
  body: HTMLElement,
  status: ClaimStatus,
  user: AuthUser | null,
  proposal: Proposal,
  isProposer = false,
  apps?: ClaimApplicationsResponse | null,
  reviewerActive = false,
): void {
  const proposalPath = proposal.path;
  const isYou = sessionIsClaimStatusFulfiller(user, status);
  const action = resolveNextAction({
    proposal,
    claim: status,
    apps,
    user,
    reviewerActive,
    isProposer,
    isBuilder: isYou,
  });
  const track = claimerTrackHtml(status);
  const meta = metaBits(status);
  const wbSlot = `<div id="workboard-settings-host"></div>`;
  const collab = `<div id="claim-collab-host"></div>`;
  const award = `<p class="builder-status muted" id="claim-award-reason" hidden></p>`;
  const checkpointForm = `<div id="checkpoint-form" class="deliverable-form" hidden>
          <label class="donate-amount-label" for="checkpoint-url">Progress URL</label>
          <input id="checkpoint-url" class="donate-amount" type="url" placeholder="https://…" />
          <button type="button" class="btn" id="checkpoint-submit">Save checkpoint</button>
        </div>`;
  const delivForm = deliverableFormHtml().replace(
    'class="deliverable-form"',
    'class="deliverable-form" hidden',
  );
  const more = nextActionMoreHtml(action, {
    checkpoint: `<button type="button" class="btn ghost" id="builder-checkpoint">File checkpoint</button>${checkpointForm}`,
    extension:
      isYou && !status.claim_extension_used
        ? `<button type="button" class="btn ghost" id="builder-request-extension">Request 30-day extension</button>`
        : isYou
          ? `<p class="builder-status muted">30-day extension already used.</p>`
          : "",
    challenge: status.can_challenge_abandoned
      ? `<button type="button" class="btn ghost" id="builder-challenge" data-path="${escapeHtml(proposalPath)}">Challenge as abandoned</button>`
      : "",
    collab,
    workboard: wbSlot,
  });
  const head = nextActionCardHtml(action, {
    extra: `${action.button === "deliverable" || (status.state === "in_review" && isYou && !status.review_decision_open) ? delivForm : ""}${more}`,
  });

  switch (status.state) {
    case "open": {
      const listedStill =
        ["listed", "funding"].includes(String(proposal.status || "")) ||
        ["listed", "funding"].includes(String(status.status || ""));
      body.innerHTML = listedStill
        ? head
        : `${head}${track}<div id="claim-apps-host"></div>`;
      break;
    }
    case "below_floor":
      body.innerHTML = head;
      break;
    case "claim_pending": {
      const pr = safeHrefAttr(status.pending?.pr_url);
      body.innerHTML = `${head}${track}${meta}${
        pr ? `<p class="builder-status muted"><a href="${pr}" target="_blank" rel="noreferrer">PR</a></p>` : ""
      }`;
      break;
    }
    case "claimed":
      body.innerHTML = `${head}${track}${meta}${award}`;
      break;
    case "in_review":
      body.innerHTML = `${head}${track}${meta}${award}`;
      break;
    case "completed":
      body.innerHTML = `${head}${track}${meta}`;
      break;
    default:
      body.innerHTML = head || `<p class="builder-status muted">Not available for claim.</p>`;
  }
}
