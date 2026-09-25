import { currentReturnPath, loginChoicesHtml } from "./auth";
import { btnWithIcon } from "./icons";
import { aiReviewCardHtml } from "./review-panel";
import {
  decisionKindLabel,
  decisionPrimarySentence,
  shortUserId,
  type RemovalBallotView,
  type ReviewDecisionView,
  type ReviewerMe,
  type ReviewerPublic,
} from "./reviewers";
import { proposalHref } from "./router";
import { formatSats, html, raw } from "./util";

function decisionPath(d: ReviewDecisionView): string {
  if (d.proposal_path) return d.proposal_path;
  return `proposals/claimed/${d.proposal_id}.md`;
}

function closesLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function reviewerRowHtml(r: ReviewerPublic, selectable = false): string {
  const kind =
    r.kind === "bootstrap"
      ? html`<span class="pill">Bootstrap</span>`
      : html`<span class="pill status-good">Earned</span>`;
  const select =
    selectable && r.kind === "bootstrap"
      ? html`<button type="button" class="btn ghost gov-select-target" data-target="${r.user_id}" disabled title="Bootstrap seats cannot be removed">Select</button>`
      : selectable
        ? html`<button type="button" class="btn ghost gov-select-target" data-target="${r.user_id}">Select</button>`
        : raw("");
  return html`<li class="gov-roster-row" data-user-id="${r.user_id}">
    <div class="gov-roster-main">
      <span class="mono gov-user">${shortUserId(r.user_id)}</span>
      ${kind}
      <span class="muted">${r.completed_count} completed</span>
    </div>
    ${select}
  </li>`.value;
}

export function decisionCardHtml(
  d: ReviewDecisionView,
  isReviewer: boolean,
): string {
  const path = decisionPath(d);
  const buttons = html`<div class="gov-card-actions" data-dec-actions ${d.my_vote && d.status === "open" ? "hidden" : ""}>
      <button type="button" class="btn" data-dec-vote="yes" data-decision-id="${d.id}">${raw(btnWithIcon("check", "Approve"))}</button>
      <button type="button" class="btn ghost" data-dec-vote="no" data-decision-id="${d.id}">${raw(btnWithIcon("xmark", "Reject"))}</button>
      <button type="button" class="btn ghost" data-dec-vote="abstain" data-decision-id="${d.id}">Abstain</button>
    </div>`;
  const voted =
    d.my_vote === "yes"
      ? "yes"
      : d.my_vote === "no"
        ? "no"
        : d.my_vote === "abstain"
          ? "abstain"
          : "";
  const voteRow = !isReviewer
    ? html`<p class="muted gov-hint">Active reviewers vote on the <a href="${proposalHref(path, d.proposal_id)}">project page</a>.</p>`
    : voted && d.status === "open"
      ? html`<p class="gov-my-vote">You voted ${voted}.</p>
        <button type="button" class="btn ghost" data-dec-change="${d.id}">Change</button>
        ${buttons}`
      : buttons;
  const aiBlock = d.ai_review
    ? raw(aiReviewCardHtml(d.ai_review, { compact: true }))
    : raw("");
  const rebuttal = d.rebuttal?.reasoning
    ? html`<p class="review-dissent-text">${d.rebuttal.reasoning}</p>`
    : raw("");
  const round2 = d.round === 2 ? html`<span class="pill">Round 2</span>` : raw("");
  return html`<li class="gov-card" data-decision-id="${d.id}">
    <div class="gov-card-head">
      <a class="gov-card-title" href="${proposalHref(path, d.proposal_id)}">${d.proposal_id}</a>
      <span class="pill">${decisionKindLabel(d.kind)}</span>
      ${round2}
    </div>
    <p class="next-card-sentence">${decisionPrimarySentence(d.kind)}</p>
    ${aiBlock}
    ${rebuttal}
    <div class="gov-counts">
      <span class="review-count yes">Yes ${d.counts.yes}</span>
      <span class="review-count no">No ${d.counts.no}</span>
    </div>
    <p class="muted gov-closes">Closes ${closesLabel(d.closes_at)}</p>
    ${voteRow}
    <p class="builder-msg gov-msg" hidden></p>
  </li>`.value;
}

export function removalCardHtml(
  b: RemovalBallotView,
  funderEligible: boolean,
): string {
  const voteRow = funderEligible
    ? html`<div class="gov-card-actions">
        <button type="button" class="btn" data-rem-vote="yes" data-ballot-id="${b.id}">Remove</button>
        <button type="button" class="btn ghost" data-rem-vote="no" data-ballot-id="${b.id}">Keep</button>
      </div>`
    : html`<p class="muted gov-hint">Voting requires an eligible funder identity (confirmed contribution in the last 12 months).</p>`;
  return html`<li class="gov-card gov-removal" data-ballot-id="${b.id}">
    <div class="gov-card-head">
      <span class="gov-card-title mono">${shortUserId(b.target_user_id)}</span>
      <span class="pill">Removal</span>
    </div>
    <p class="next-card-sentence">Vote whether to remove this reviewer.</p>
    <p class="gov-evidence">${b.evidence}</p>
    <div class="gov-counts">
      <span class="review-count yes">Remove ${b.counts.yes}</span>
      <span class="review-count no">Keep ${b.counts.no}</span>
      <span class="muted">${b.vote_count} cast</span>
    </div>
    <p class="muted gov-closes">Opened by <span class="mono">${shortUserId(b.initiator_user_id)}</span> · closes ${closesLabel(b.closes_at)}</p>
    ${voteRow}
    <p class="builder-msg gov-msg" hidden></p>
  </li>`.value;
}

export function openRemovalFormHtml(
  me: ReviewerMe | null,
  loggedIn: boolean,
  reviewers: ReviewerPublic[] = [],
): string {
  if (!loggedIn) {
    return html`<div class="gov-form-panel">
      <p class="lede">Sign in as an eligible funder to open a removal ballot.</p>
      ${raw(loginChoicesHtml(undefined, currentReturnPath()))}
    </div>`.value;
  }
  const min = me?.removal_min_sats ?? 10_000;
  if (!me?.funder_eligible) {
    return html`<div class="gov-form-panel">
      <p class="lede">Removal ballots are open to funders with a confirmed contribution of at least ${formatSats(min)} in the last 12 months.</p>
      <p class="muted">Link your identity when contributing so the ballot can verify eligibility.</p>
    </div>`.value;
  }
  const earned = reviewers.filter((r) => r.kind !== "bootstrap");
  if (!earned.length) {
    return html`<div class="gov-form-panel">
      <p class="lede">No earned reviewers to remove.</p>
    </div>`.value;
  }
  const options = earned.map(
    (r) =>
      html`<option value="${r.user_id}">${shortUserId(r.user_id)} · ${r.completed_count} completed</option>`,
  );
  return html`<form class="gov-form-panel form-panel" id="removal-open-form">
    <p class="lede">Cite a pattern of bad faith across at least two decisions. Bootstrap seats cannot be removed.</p>
    <label class="donate-amount-label" for="removal-target">Reviewer</label>
    <select id="removal-target" class="donate-amount" required>
      <option value="">Choose an earned reviewer</option>
      ${options}
    </select>
    <label class="donate-amount-label" for="removal-evidence">Evidence (min 40 characters)</label>
    <textarea id="removal-evidence" class="donate-amount" rows="5" required minlength="40" maxlength="8000" placeholder="Cite specific decisions and the pattern of bad faith…"></textarea>
    <div class="form-actions">
      <button type="submit" class="btn">Open removal ballot</button>
    </div>
    <p class="builder-msg" id="removal-open-msg" hidden></p>
  </form>`.value;
}
