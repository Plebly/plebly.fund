import {
  currentReturnPath,
  loginChoicesHtml,
  authFetch,
  type AuthUser,
} from "./auth";
import { WORKERS_API } from "./config";
import { btnWithIcon } from "./icons";
import {
  fetchOpsRoles,
  nominateOpsRole,
  opsActionLabel,
  opsRoleLabel,
  voteOpsRoleBallot,
  type OpsRoleBallotView,
  type OpsRolesApiPayload,
  type OpsRolesGate,
  type OpsRolesPayload,
} from "./ops-roles";
import {
  fetchOpenReports,
  resolveModerationReport,
  type ModerationReportView,
} from "./reports";
import {
  decisionKindLabel,
  fetchOpenRemovalBallots,
  fetchOpenReviewDecisions,
  fetchReviewerMe,
  fetchReviewerRoster,
  openRemovalBallot,
  shortUserId,
  voteRemovalBallot,
  voteReviewDecision,
  type RemovalBallotView,
  type ReviewDecisionView,
  type ReviewerMe,
  type ReviewerPublic,
  type ReviewerRoster,
} from "./reviewers";
import { href, projectsHref, proposalHref } from "./router";
import { safeHrefAttr } from "./social-links";
import { escapeHtml, formatSats, timeAgoHtml } from "./util";

export type GovernanceShell = (inner: string) => string;

type GovTab =
  | "roster"
  | "decisions"
  | "removals"
  | "roles"
  | "reports"
  | "keyholders";

const GOV_TABS: GovTab[] = [
  "roster",
  "decisions",
  "removals",
  "roles",
  "reports",
  "keyholders",
];

function initialGovTab(): GovTab {
  const params = new URLSearchParams(location.search);
  const q = params.get("tab") as GovTab | null;
  if (q && GOV_TABS.includes(q)) return q;
  const hash = location.hash.replace(/^#/, "");
  if (hash === "ops-roles") return "roles";
  if (hash === "roster" || hash === "decisions" || hash === "removals" || hash === "reports" || hash === "keyholders") {
    return hash;
  }
  return "decisions";
}

export function reportsInboxHtml(
  reports: ModerationReportView[],
  isReviewer: boolean,
): string {
  if (!isReviewer) {
    return `<div class="empty-state gov-empty"><div class="empty-state-inner">
      <p class="empty-state-title">Reviewers only</p>
      <p class="empty-state-body">Open moderation reports for listings and comments appear here for the active roster.</p>
    </div></div>`;
  }
  if (!reports.length) {
    return `<div class="empty-state gov-empty"><div class="empty-state-inner">
      <p class="empty-state-title">No open reports</p>
      <p class="empty-state-body">Listing and comment reports from the community show up here.</p>
    </div></div>`;
  }
  return `<ul class="gov-list" id="gov-reports">${reports
    .map((r) => {
      const when = timeAgoHtml(r.created_at);
      const target =
        r.target_type === "comment"
          ? `Comment on <a href="${proposalHref(r.proposal_path || "", r.proposal_id)}">${escapeHtml(r.proposal_id)}</a>`
          : `Listing <a href="${proposalHref(r.proposal_path || "", r.proposal_id)}">${escapeHtml(r.proposal_id)}</a>`;
      const actions =
        r.target_type === "comment"
          ? `<button type="button" class="btn" data-report-resolve="hide_comment" data-report-id="${escapeHtml(r.id)}">Hide comment</button>
             <button type="button" class="btn ghost" data-report-resolve="dismiss" data-report-id="${escapeHtml(r.id)}">Dismiss</button>`
          : `<button type="button" class="btn" data-report-resolve="escalate_listing" data-report-id="${escapeHtml(r.id)}">Open challenge ballot</button>
             <button type="button" class="btn ghost" data-report-resolve="dismiss" data-report-id="${escapeHtml(r.id)}">Dismiss</button>`;
      return `<li class="gov-card" data-report-id="${escapeHtml(r.id)}">
        <div class="gov-card-head">
          <span class="gov-card-title">${r.target_type === "comment" ? "Comment" : "Listing"}</span>
          <span class="pill">${escapeHtml(r.status)}</span>
        </div>
        <p class="muted">${target}${when ? ` · ${when}` : ""}</p>
        <p class="gov-evidence">${escapeHtml(r.reason)}</p>
        <div class="gov-card-actions">${actions}</div>
        <p class="builder-msg gov-msg" hidden></p>
      </li>`;
    })
    .join("")}</ul>`;
}

function opsVoteLabels(action: string): { yes: string; no: string } {
  if (action === "remove") return { yes: "Remove", no: "Keep" };
  if (action === "retain") return { yes: "Retain", no: "Replace later" };
  return { yes: "Grant", no: "Reject" };
}

export function opsRoleBallotCardHtml(
  b: OpsRoleBallotView,
  isReviewer: boolean,
): string {
  const labels = opsVoteLabels(b.action);
  const voteRow = isReviewer
    ? `<div class="gov-card-actions">
        <button type="button" class="btn" data-ops-vote="yes" data-ops-ballot-id="${escapeHtml(b.id)}">${escapeHtml(labels.yes)}</button>
        <button type="button" class="btn ghost" data-ops-vote="no" data-ops-ballot-id="${escapeHtml(b.id)}">${escapeHtml(labels.no)}</button>
      </div>`
    : `<p class="muted gov-hint">Active reviewers vote on operational role ballots.</p>`;
  return `<li class="gov-card gov-ops-ballot" data-ops-ballot-id="${escapeHtml(b.id)}">
    <div class="gov-card-head">
      <span class="gov-card-title">${escapeHtml(opsRoleLabel(b.kind))}</span>
      <span class="pill">${escapeHtml(opsActionLabel(b.action))}</span>
    </div>
    <p class="mono muted gov-nominee">Nominee ${escapeHtml(shortUserId(b.nominee_user_id))}</p>
    <p class="gov-evidence">${escapeHtml(b.rationale)}</p>
    <div class="gov-counts">
      <span class="review-count yes">${escapeHtml(labels.yes)} ${b.counts.yes}</span>
      <span class="review-count no">${escapeHtml(labels.no)} ${b.counts.no}</span>
      <span class="muted">${b.vote_count} cast</span>
    </div>
    <p class="muted gov-closes">Closes ${escapeHtml(closesLabel(b.closes_at))}</p>
    ${voteRow}
    <p class="builder-msg gov-msg" hidden></p>
  </li>`;
}

function opsGateProgressHtml(gate: OpsRolesPayload["gate"]): string {
  if (gate.open) return "";
  const cPct = Math.min(
    100,
    Math.round((gate.completions / Math.max(1, gate.min_completions)) * 100),
  );
  const rPct = Math.min(
    100,
    Math.round((gate.reviewers / Math.max(1, gate.min_reviewers)) * 100),
  );
  return `<div class="gov-gate" role="status">
    <p class="gov-gate-title">Role votes unlock after volume gates</p>
    <div class="gov-gate-meters">
      <div class="gov-gate-meter">
        <div class="gov-gate-meter-head">
          <span>Completions</span>
          <span class="mono">${gate.completions}/${gate.min_completions}</span>
        </div>
        <div class="gov-gate-bar" aria-hidden="true"><span style="width:${cPct}%"></span></div>
      </div>
      <div class="gov-gate-meter">
        <div class="gov-gate-meter-head">
          <span>Active reviewers</span>
          <span class="mono">${gate.reviewers}/${gate.min_reviewers}</span>
        </div>
        <div class="gov-gate-bar" aria-hidden="true"><span style="width:${rPct}%"></span></div>
      </div>
    </div>
  </div>`;
}

const DEFAULT_OPS_KINDS = [
  "triage_steward",
  "incident_scribe",
  "comms",
] as const;

const DEFAULT_OPS_GATE: OpsRolesGate = {
  open: false,
  completions: 0,
  min_completions: 10,
  reviewers: 0,
  min_reviewers: 5,
  reason: "gate status unavailable",
};

/** Normalize partial `/ops/roles` payloads from older API deploys. */
export function normalizeOpsRolesPayload(
  payload: OpsRolesApiPayload | OpsRolesPayload | null | undefined,
): OpsRolesPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const roles = Array.isArray(payload.roles) ? payload.roles : [];
  const kinds =
    Array.isArray(payload.kinds) && payload.kinds.length
      ? payload.kinds
      : [...DEFAULT_OPS_KINDS];
  const ballots = Array.isArray(payload.ballots) ? payload.ballots : [];
  const gate: OpsRolesGate =
    payload.gate && typeof payload.gate === "object"
      ? {
          open: Boolean(payload.gate.open),
          completions: Number(payload.gate.completions) || 0,
          min_completions: Number(payload.gate.min_completions) || 10,
          reviewers: Number(payload.gate.reviewers) || 0,
          min_reviewers: Number(payload.gate.min_reviewers) || 5,
          reason: String(payload.gate.reason || ""),
        }
      : { ...DEFAULT_OPS_GATE };
  return {
    roles,
    count: typeof payload.count === "number" ? payload.count : roles.length,
    kinds,
    gate,
    ballots,
  };
}

export function opsRolesSectionHtml(
  payload: OpsRolesApiPayload | OpsRolesPayload | null,
  isReviewer: boolean,
): string {
  const normalized = normalizeOpsRolesPayload(payload);
  if (!normalized) {
    return `<div class="empty-state gov-empty"><div class="empty-state-inner">
      <p class="empty-state-title">Roles unavailable</p>
      <p class="empty-state-body">Could not load operational roles from the API.</p>
    </div></div>`;
  }
  const gate = normalized.gate;
  const gatePill = gate.open
    ? `<span class="pill status-good">Votes open</span>`
    : `<span class="pill">Volume-gated</span>`;

  const kinds = normalized.kinds;
  const byKind = new Map(
    normalized.roles.map((r) => [r.kind || r.role, r] as const),
  );
  const seats = `<ul class="gov-roster gov-ops-seats">${kinds
    .map((kind) => {
      const role = byKind.get(kind);
      if (!role) {
        return `<li class="gov-roster-row gov-seat-vacant">
          <div class="gov-roster-main">
            <span class="gov-user">${escapeHtml(opsRoleLabel(kind))}</span>
            <span class="pill">Vacant</span>
          </div>
          <span class="muted">No holder</span>
        </li>`;
      }
      const holder = role.user_id || role.holder || "—";
      const term = role.term_ends_at
        ? `<span class="muted">Term ends ${escapeHtml(closesLabel(role.term_ends_at))}</span>`
        : "";
      return `<li class="gov-roster-row">
        <div class="gov-roster-main">
          <span class="gov-user">${escapeHtml(role.label || opsRoleLabel(kind))}</span>
          <span class="pill">${escapeHtml(role.source)}</span>
        </div>
        <div class="gov-seat-holder">
          <span class="mono">${escapeHtml(shortUserId(holder))}</span>
          ${term}
        </div>
      </li>`;
    })
    .join("")}</ul>`;

  const ballots = normalized.ballots.length
    ? `<ul class="gov-list" id="gov-ops-ballots">${normalized.ballots
        .map((b) => opsRoleBallotCardHtml(b, isReviewer))
        .join("")}</ul>`
    : `<div class="empty-state gov-empty gov-empty-compact"><div class="empty-state-inner">
        <p class="empty-state-title">No open role ballots</p>
        <p class="empty-state-body">Grant, remove, or retain ballots appear here while voting is open.</p>
      </div></div>`;

  let nominateBlock: string;
  if (!gate.open) {
    nominateBlock = opsGateProgressHtml(gate);
  } else if (!isReviewer) {
    nominateBlock = `<div class="gov-form-panel">
      <p class="lede">Sign in as an active reviewer to open a role ballot.</p>
    </div>`;
  } else {
    nominateBlock = `<form id="ops-nominate-form" class="gov-form-panel gov-form">
      <p class="lede">One seat per role. Remove or retain must name the current holder.</p>
      <div class="gov-form-grid">
        <label class="field"><span>Role</span>
          <select id="ops-kind" required>
            ${kinds
              .map(
                (k) =>
                  `<option value="${escapeHtml(k)}">${escapeHtml(opsRoleLabel(k))}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="field"><span>Action</span>
          <select id="ops-action" required>
            <option value="grant">Grant seat</option>
            <option value="remove">Remove holder</option>
            <option value="retain">Retain for new term</option>
          </select>
        </label>
      </div>
      <label class="field"><span>Nominee</span>
        <input id="ops-nominee" class="mono" type="text" required maxlength="120" placeholder="github:…" autocomplete="off" />
      </label>
      <label class="field"><span>Rationale</span>
        <textarea id="ops-rationale" rows="3" required minlength="20" maxlength="4000" placeholder="Why this grant, removal, or retain…"></textarea>
      </label>
      <div class="form-actions">
        <button type="submit" class="btn">Open role ballot</button>
      </div>
      <p class="builder-msg" id="ops-nominate-msg" hidden></p>
    </form>`;
  }

  return `<div class="gov-meta">${gatePill}
      <span class="pill">${normalized.count} filled · ${kinds.length} seats</span>
    </div>
    <p class="muted gov-block-lede">Coordination labels only — never escrow signing, fund movement, or parameter changes. Reviewers vote; ⅔ of cast with quorum.</p>
    <h3 class="gov-subhead">Seats</h3>
    ${seats}
    <h3 class="gov-subhead">Open ballots</h3>
    ${ballots}
    <h3 class="gov-subhead">${gate.open ? "Open a role ballot" : "Activation"}</h3>
    ${nominateBlock}`;
}

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

export function rosterSectionHtml(
  roster: ReviewerRoster | null,
  opts?: { selectable?: boolean },
): string {
  if (!roster) {
    return `<div class="empty-state"><div class="empty-state-inner">
      <p class="empty-state-title">Roster unavailable</p>
      <p class="empty-state-body">Could not load active reviewers from the API.</p>
    </div></div>`;
  }
  const reviewers = Array.isArray(roster.reviewers) ? roster.reviewers : [];
  if (!reviewers.length) {
    return `<div class="empty-state"><div class="empty-state-inner">
      <p class="empty-state-title">No active reviewers</p>
      <p class="empty-state-body">Bootstrap seats have not been seeded yet.</p>
    </div></div>`;
  }
  const rows = reviewers
    .map((r) => reviewerRowHtml(r, opts?.selectable))
    .join("");
  return `<div class="gov-meta">
      <span class="pill">${roster.count ?? reviewers.length} active</span>
      <span class="pill">Platform completions ${roster.platform_completions ?? 0}</span>
    </div>
    <ul class="gov-roster" id="gov-roster">${rows}</ul>`;
}

export function reviewerRowHtml(
  r: ReviewerPublic,
  selectable = false,
): string {
  const kind =
    r.kind === "bootstrap"
      ? `<span class="pill">Bootstrap</span>`
      : `<span class="pill status-good">Earned</span>`;
  const select = selectable
    ? `<button type="button" class="btn ghost gov-select-target" data-target="${escapeHtml(r.user_id)}" ${r.kind === "bootstrap" ? "disabled title=\"Bootstrap seats cannot be removed\"" : ""}>Select</button>`
    : "";
  return `<li class="gov-roster-row" data-user-id="${escapeHtml(r.user_id)}">
    <div class="gov-roster-main">
      <span class="mono gov-user">${escapeHtml(shortUserId(r.user_id))}</span>
      ${kind}
      <span class="muted">${r.completed_count} completed</span>
    </div>
    ${select}
  </li>`;
}

export function openDecisionsHtml(
  decisions: ReviewDecisionView[],
  isReviewer: boolean,
): string {
  if (!decisions.length) {
    return `<div class="empty-state gov-empty"><div class="empty-state-inner">
      <p class="empty-state-title">No open decisions</p>
      <p class="empty-state-body">When AI triage passes or escalates, reviewer ballots appear here and on the project page.</p>
    </div></div>`;
  }
  return `<ul class="gov-list" id="gov-decisions">${decisions
    .map((d) => decisionCardHtml(d, isReviewer))
    .join("")}</ul>`;
}

export function decisionCardHtml(
  d: ReviewDecisionView,
  isReviewer: boolean,
): string {
  const path = decisionPath(d);
  const voteRow = isReviewer
    ? `<div class="gov-card-actions">
        <button type="button" class="btn" data-dec-vote="yes" data-decision-id="${escapeHtml(d.id)}">${btnWithIcon("check", "Approve")}</button>
        <button type="button" class="btn ghost" data-dec-vote="no" data-decision-id="${escapeHtml(d.id)}">${btnWithIcon("xmark", "Reject")}</button>
        <button type="button" class="btn ghost" data-dec-vote="abstain" data-decision-id="${escapeHtml(d.id)}">Abstain</button>
      </div>`
    : `<p class="muted gov-hint">Active reviewers vote on the <a href="${proposalHref(path, d.proposal_id)}">project page</a>.</p>`;
  return `<li class="gov-card" data-decision-id="${escapeHtml(d.id)}">
    <div class="gov-card-head">
      <a class="gov-card-title" href="${proposalHref(path, d.proposal_id)}">${escapeHtml(d.proposal_id)}</a>
      <span class="pill">${escapeHtml(decisionKindLabel(d.kind))}</span>
      ${d.round === 2 ? `<span class="pill">Round 2</span>` : ""}
    </div>
    <div class="gov-counts">
      <span class="review-count yes">Yes ${d.counts.yes}</span>
      <span class="review-count no">No ${d.counts.no}</span>
      <span class="muted">Abstain ${d.counts.abstain}</span>
      <span class="muted">Need ⌈⅔⌉ of ${d.roster_size ?? "?"} (≥${d.need_yes ?? "?"} yes)</span>
    </div>
    <p class="muted gov-closes">Closes ${escapeHtml(closesLabel(d.closes_at))}</p>
    ${voteRow}
    <p class="builder-msg gov-msg" hidden></p>
  </li>`;
}

export function openRemovalsHtml(
  ballots: RemovalBallotView[],
  funderEligible: boolean,
): string {
  if (!ballots.length) {
    return `<div class="empty-state gov-empty"><div class="empty-state-inner">
      <p class="empty-state-title">No open removal ballots</p>
      <p class="empty-state-body">Eligible funders can open a ballot against an earned reviewer with written evidence.</p>
    </div></div>`;
  }
  return `<ul class="gov-list" id="gov-removals">${ballots
    .map((b) => removalCardHtml(b, funderEligible))
    .join("")}</ul>`;
}

export function removalCardHtml(
  b: RemovalBallotView,
  funderEligible: boolean,
): string {
  const voteRow = funderEligible
    ? `<div class="gov-card-actions">
        <button type="button" class="btn" data-rem-vote="yes" data-ballot-id="${escapeHtml(b.id)}">Remove</button>
        <button type="button" class="btn ghost" data-rem-vote="no" data-ballot-id="${escapeHtml(b.id)}">Keep</button>
      </div>`
    : `<p class="muted gov-hint">Voting requires an eligible funder identity (confirmed contribution in the last 12 months).</p>`;
  return `<li class="gov-card gov-removal" data-ballot-id="${escapeHtml(b.id)}">
    <div class="gov-card-head">
      <span class="gov-card-title mono">${escapeHtml(shortUserId(b.target_user_id))}</span>
      <span class="pill">Removal</span>
    </div>
    <p class="gov-evidence">${escapeHtml(b.evidence)}</p>
    ${
      (() => {
        const ev = safeHrefAttr(b.evidence_pr_url);
        const res = safeHrefAttr(b.result_pr_url);
        if (!ev && !res) return "";
        return `<p class="muted gov-closes">${
          ev
            ? `<a href="${ev}" target="_blank" rel="noreferrer">Evidence PR</a>`
            : ""
        }${
          res
            ? `${ev ? " · " : ""}<a href="${res}" target="_blank" rel="noreferrer">Result PR</a>`
            : ""
        }</p>`;
      })()
    }
    <div class="gov-counts">
      <span class="review-count yes">Remove ${b.counts.yes}</span>
      <span class="review-count no">Keep ${b.counts.no}</span>
      <span class="muted">${b.vote_count} cast</span>
    </div>
    <p class="muted gov-closes">Opened by <span class="mono">${escapeHtml(shortUserId(b.initiator_user_id))}</span> · closes ${escapeHtml(closesLabel(b.closes_at))}</p>
    ${voteRow}
    <p class="builder-msg gov-msg" hidden></p>
  </li>`;
}

export function openRemovalFormHtml(
  me: ReviewerMe | null,
  loggedIn: boolean,
): string {
  if (!loggedIn) {
    return `<div class="gov-form-panel">
      <p class="lede">Sign in as an eligible funder to open a removal ballot.</p>
      ${loginChoicesHtml(undefined, currentReturnPath())}
    </div>`;
  }
  const min = me?.removal_min_sats ?? 10_000;
  if (!me?.funder_eligible) {
    return `<div class="gov-form-panel">
      <p class="lede">Removal ballots are open to funders with a confirmed contribution of at least ${escapeHtml(formatSats(min))} in the last 12 months.</p>
      <p class="muted">Link your identity when contributing so the ballot can verify eligibility.</p>
    </div>`;
  }
  return `<form class="gov-form-panel form-panel" id="removal-open-form">
    <p class="lede">Cite a pattern of bad faith across at least two decisions. Bootstrap seats cannot be removed.</p>
    <label class="donate-amount-label" for="removal-target">Target reviewer user id</label>
    <input id="removal-target" class="donate-amount mono" type="text" required maxlength="120" placeholder="github:…" autocomplete="off" />
    <label class="donate-amount-label" for="removal-evidence">Evidence (min 40 characters)</label>
    <textarea id="removal-evidence" class="donate-amount" rows="5" required minlength="40" maxlength="8000" placeholder="Cite specific decisions and the pattern of bad faith…"></textarea>
    <div class="form-actions">
      <button type="submit" class="btn">Open removal ballot</button>
    </div>
    <p class="builder-msg" id="removal-open-msg" hidden></p>
  </form>`;
}

function statusStripHtml(me: ReviewerMe | null, user: AuthUser | null): string {
  if (!user) {
    return `<p class="gov-status muted">Browsing as guest. Sign in to vote if you are a reviewer or eligible funder.</p>`;
  }
  const bits: string[] = [];
  if (me?.active) {
    bits.push(
      `<span class="pill status-good">Reviewer (${escapeHtml(me.reviewer?.kind || "earned")})</span>`,
    );
  }
  if (me?.funder_eligible) {
    bits.push(`<span class="pill status-good">Eligible funder</span>`);
  } else {
    bits.push(`<span class="pill">Not funder-eligible</span>`);
  }
  return `<div class="gov-status">${bits.join("")}</div>`;
}

type KhElectionView = {
  id: string;
  applicant_id: string;
  created_at: string;
  closes_at: string;
  status: string;
  yes: number;
  no: number;
};

type KhApplicationView = {
  user_id: string;
  github: string;
  handle: string;
  hw_type: string;
  statement: string;
  election_id?: string;
};

const govApi = () => WORKERS_API.replace(/\/$/, "");

export function khApplyFormHtml(loggedIn: boolean, canApply: boolean): string {
  if (!loggedIn) {
    return `<div class="gov-form-panel">
      <p class="lede">Sign in as an earned reviewer (at least one completed bounty) to apply as a keyholder.</p>
      ${loginChoicesHtml(undefined, currentReturnPath())}
    </div>`;
  }
  if (!canApply) {
    return `<div class="gov-form-panel">
      <p class="lede">Keyholder seats are elected by earned reviewers with at least one completed bounty. Finish a review cycle first.</p>
    </div>`;
  }
  return `<form class="gov-form-panel form-panel" id="kh-apply-form">
    <p class="lede">7-day majority election among earned reviewers. Pass yields pending attestation — election does not add your key to the descriptor. You cannot vote on your own application.</p>
    <label class="donate-amount-label" for="kh-apply-pubkey">xpub / tpub</label>
    <textarea id="kh-apply-pubkey" class="comment-input mono" rows="2" required maxlength="256"></textarea>
    <label class="donate-amount-label" for="kh-apply-hw">Hardware</label>
    <input id="kh-apply-hw" class="donate-amount" required maxlength="64" placeholder="coldcard / jade / seedsigner…" />
    <label class="donate-amount-label" for="kh-apply-handle">Handle</label>
    <input id="kh-apply-handle" class="donate-amount" maxlength="64" />
    <label class="donate-amount-label" for="kh-apply-statement">Statement</label>
    <textarea id="kh-apply-statement" class="comment-input" rows="4" required maxlength="2000" placeholder="Why you can stay reachable and sign monthly releases…"></textarea>
    <label class="muted"><input type="checkbox" id="kh-apply-ack" required /> I have read the keyholder responsibilities, including that the operator can spend the keyholder pool on the fee address until cash-out.</label>
    <div class="form-actions"><button type="submit" class="btn">Apply</button></div>
    <p class="builder-msg" id="kh-apply-msg" hidden></p>
  </form>`;
}

export function khElectionCardHtml(
  election: KhElectionView,
  application: KhApplicationView | undefined,
  canVote: boolean,
): string {
  const handle = application?.handle || application?.github || election.applicant_id;
  return `<li class="gov-card" data-kh-election="${escapeHtml(election.id)}">
    <p class="gov-card-title">${escapeHtml(handle)}</p>
    <p class="muted">${escapeHtml(application?.hw_type || "")} · yes ${election.yes} / no ${election.no} · closes ${escapeHtml(election.closes_at.slice(0, 10))}</p>
    ${application?.statement ? `<p>${escapeHtml(application.statement)}</p>` : ""}
    ${
      canVote
        ? `<div class="gov-vote-row">
            <button type="button" class="btn" data-kh-vote="yes" data-election-id="${escapeHtml(election.id)}">Yes</button>
            <button type="button" class="btn ghost" data-kh-vote="no" data-election-id="${escapeHtml(election.id)}">No</button>
          </div>`
        : ""
    }
    <p class="builder-msg gov-msg" hidden></p>
  </li>`;
}

export function khElectionsHtml(
  elections: KhElectionView[],
  applications: KhApplicationView[],
  canVote: boolean,
): string {
  if (!elections.length) {
    return `<p class="muted">No open keyholder elections.</p>`;
  }
  const byUser = new Map(applications.map((a) => [a.user_id, a]));
  return `<ul class="gov-list" id="gov-kh-elections">${elections
    .map((e) => khElectionCardHtml(e, byUser.get(e.applicant_id), canVote))
    .join("")}</ul>`;
}

export async function renderGovernance(
  shell: GovernanceShell,
  user: AuthUser | null,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    <section class="wrap-wide detail gov-page">
      <p class="loading">Loading governance…</p>
    </section>
  `);

  const tab = initialGovTab();
  const [roster, decisions, removals, me, opsRoles, reports, khPack] = await Promise.all([
    fetchReviewerRoster().catch(() => null),
    fetchOpenReviewDecisions().catch(() => [] as ReviewDecisionView[]),
    fetchOpenRemovalBallots().catch(() => [] as RemovalBallotView[]),
    user ? fetchReviewerMe().catch(() => null) : Promise.resolve(null),
    tab === "roles"
      ? fetchOpsRoles().catch(() => null)
      : Promise.resolve(null),
    user && tab === "reports"
      ? fetchOpenReports().catch(() => [] as ModerationReportView[])
      : Promise.resolve([] as ModerationReportView[]),
    user && tab === "keyholders"
      ? authFetch(`${govApi()}/keyholders/applications`)
          .then(async (r) =>
            r.ok
              ? ((await r.json()) as {
                  applications: KhApplicationView[];
                  elections: KhElectionView[];
                })
              : { applications: [] as KhApplicationView[], elections: [] as KhElectionView[] },
          )
          .catch(() => ({
            applications: [] as KhApplicationView[],
            elections: [] as KhElectionView[],
          }))
      : Promise.resolve({
          applications: [] as KhApplicationView[],
          elections: [] as KhElectionView[],
        }),
  ]);

  const isReviewer = Boolean(me?.active);
  const funderEligible = Boolean(me?.funder_eligible);
  const canElect = Boolean(
    me?.active && (me.reviewer?.completed_proposal_ids?.length || 0) >= 1,
  );

  const decisionCount = decisions.length;
  const removalCount = removals.length;
  const reportCount = reports.length;
  const opsNormalized = normalizeOpsRolesPayload(opsRoles);
  const opsBallotCount = opsNormalized?.ballots.length ?? 0;

  app.innerHTML = shell(`
    <section class="wrap-wide detail gov-page">
      <header class="gov-hero">
        <p class="about-eyebrow">Governance</p>
        <h1>Reviewers</h1>
        <p class="lede">Human quorum confirms deliverables after AI triage. Eligible funders may remove earned reviewers. After volume gates, reviewers elect coordination roles — never custody.</p>
        ${statusStripHtml(me, user)}
        <div class="account-tabs gov-tabs" role="tablist" aria-label="Governance sections">
          <button type="button" class="account-tab ${tab === "roster" ? "active" : ""}" data-gov-tab="roster" role="tab" aria-selected="${tab === "roster"}">Roster${roster ? ` (${roster.count})` : ""}</button>
          <button type="button" class="account-tab ${tab === "decisions" ? "active" : ""}" data-gov-tab="decisions" role="tab" aria-selected="${tab === "decisions"}">Decisions${decisionCount ? ` (${decisionCount})` : ""}</button>
          <button type="button" class="account-tab ${tab === "removals" ? "active" : ""}" data-gov-tab="removals" role="tab" aria-selected="${tab === "removals"}">Removals${removalCount ? ` (${removalCount})` : ""}</button>
          <button type="button" class="account-tab ${tab === "roles" ? "active" : ""}" data-gov-tab="roles" role="tab" aria-selected="${tab === "roles"}">Roles${opsBallotCount ? ` (${opsBallotCount})` : ""}</button>
          <button type="button" class="account-tab ${tab === "reports" ? "active" : ""}" data-gov-tab="reports" role="tab" aria-selected="${tab === "reports"}">Reports${reportCount ? ` (${reportCount})` : ""}</button>
          <button type="button" class="account-tab ${tab === "keyholders" ? "active" : ""}" data-gov-tab="keyholders" role="tab" aria-selected="${tab === "keyholders"}">Keyholders${khPack.elections.length ? ` (${khPack.elections.length})` : ""}</button>
        </div>
      </header>

      <section class="gov-block account-pane" data-gov-pane="roster" id="roster" ${tab === "roster" ? "" : "hidden"}>
        <h2 class="gov-block-title">Active roster</h2>
        <p class="muted gov-block-lede">⌈⅔⌉ yes of the active roster, with at least five non-abstaining votes, passes a decision.${funderEligible ? " Select an earned seat to prefill a removal." : ""}</p>
        ${rosterSectionHtml(roster, { selectable: funderEligible })}
      </section>

      <section class="gov-block account-pane" data-gov-pane="decisions" id="decisions" ${tab === "decisions" ? "" : "hidden"}>
        <h2 class="gov-block-title">Open decisions</h2>
        <p class="muted gov-block-lede">Reviewers approve or reject. Dissent publishes permanently via PR on the project page.</p>
        ${openDecisionsHtml(decisions, isReviewer)}
      </section>

      <section class="gov-block account-pane" data-gov-pane="removals" id="removals" ${tab === "removals" ? "" : "hidden"}>
        <h2 class="gov-block-title">Removal ballots</h2>
        <p class="muted gov-block-lede">One funder identity = one vote. Passes at ⅔ of votes cast after the window closes.</p>
        ${openRemovalsHtml(removals, funderEligible)}
        <div class="gov-inline-panel" id="open-removal">
          <h3 class="gov-subhead">Open a removal</h3>
          ${openRemovalFormHtml(me, Boolean(user))}
        </div>
      </section>

      <section class="gov-block account-pane" data-gov-pane="roles" id="ops-roles" ${tab === "roles" ? "" : "hidden"}>
        <h2 class="gov-block-title">Operational roles</h2>
        ${opsRolesSectionHtml(opsNormalized, isReviewer)}
      </section>

      <section class="gov-block account-pane" data-gov-pane="reports" id="reports" ${tab === "reports" ? "" : "hidden"}>
        <h2 class="gov-block-title">Reports inbox</h2>
        <p class="muted gov-block-lede">Community reports on listings and comments. Dismiss, hide a comment, or escalate a listing into a formal challenge ballot.</p>
        ${reportsInboxHtml(reports, isReviewer)}
      </section>

      <section class="gov-block account-pane" data-gov-pane="keyholders" id="keyholders" ${tab === "keyholders" ? "" : "hidden"}>
        <h2 class="gov-block-title">Keyholder elections</h2>
        <p class="muted gov-block-lede">Earned reviewers with a completed bounty elect new keyholders. Pass → pending attestation. Fulfillers are paid in the monthly batch, not the instant a bounty completes.</p>
        ${khElectionsHtml(khPack.elections, khPack.applications, canElect)}
        <div class="gov-inline-panel">
          <h3 class="gov-subhead">Apply</h3>
          ${khApplyFormHtml(Boolean(user), canElect)}
        </div>
      </section>

      <p class="gov-foot muted">
        Rules live in
        <a href="https://github.com/Plebly/proposals/blob/main/REVIEWERS.md" target="_blank" rel="noreferrer">REVIEWERS.md</a>.
        Project-level review UI stays on each project page.
        <a href="${projectsHref()}">Browse projects</a>.
      </p>
    </section>
  `);

  bindGovernanceHandlers(app, { isReviewer, funderEligible });
  bindGovTabs(app, {
    onLazyTab: (next) => {
      if (
        (next === "reports" && user && reports.length === 0) ||
        (next === "roles" && !opsRoles) ||
        (next === "keyholders" && user && khPack.elections.length === 0 && khPack.applications.length === 0)
      ) {
        const url = new URL(location.href);
        url.searchParams.set("tab", next);
        history.replaceState(null, "", `${url.pathname}${url.search}`);
        void renderGovernance(shell, user);
        return true;
      }
      return false;
    },
  });
}

function bindGovTabs(
  root: ParentNode,
  opts?: { onLazyTab?: (tab: GovTab) => boolean },
): void {
  const page = root.querySelector(".gov-page");
  if (!page || page.getAttribute("data-gov-tabs") === "1") return;
  page.setAttribute("data-gov-tabs", "1");

  const activate = (tab: GovTab) => {
    if (opts?.onLazyTab?.(tab)) return;
    page.querySelectorAll<HTMLButtonElement>("[data-gov-tab]").forEach((btn) => {
      const on = btn.dataset.govTab === tab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    page.querySelectorAll<HTMLElement>("[data-gov-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.govPane !== tab;
    });
    const url = new URL(location.href);
    url.searchParams.set("tab", tab);
    history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  page.addEventListener("click", (ev) => {
    const btn = (ev.target as Element | null)?.closest<HTMLButtonElement>(
      "[data-gov-tab]",
    );
    if (!btn?.dataset.govTab) return;
    const tab = btn.dataset.govTab as GovTab;
    if (!GOV_TABS.includes(tab)) return;
    activate(tab);
  });
}

function setCardMsg(card: Element | null, text: string, cls = ""): void {
  const el = card?.querySelector<HTMLElement>(".gov-msg");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text;
  el.className = `builder-msg gov-msg ${cls}`.trim();
}

function bindGovernanceHandlers(
  root: ParentNode,
  ctx: { isReviewer: boolean; funderEligible: boolean },
): void {
  const page = root.querySelector(".gov-page");
  if (!page || page.getAttribute("data-gov-bound") === "1") return;
  page.setAttribute("data-gov-bound", "1");

  page.addEventListener("click", async (ev) => {
    const t = ev.target as Element | null;
    const decBtn = t?.closest?.<HTMLButtonElement>("[data-dec-vote]");
    if (decBtn && page.contains(decBtn)) {
      const id = decBtn.dataset.decisionId;
      const vote = decBtn.dataset.decVote as "yes" | "no" | "abstain" | undefined;
      if (!id || !vote) return;
      const card = decBtn.closest(".gov-card");
      setCardMsg(card, "Submitting…");
      try {
        const d = await voteReviewDecision(id, vote);
        const li = page.querySelector(`[data-decision-id="${CSS.escape(id)}"]`);
        if (li) li.outerHTML = decisionCardHtml(d, ctx.isReviewer);
      } catch (e) {
        const msg = (e as Error).message;
        setCardMsg(
          card,
          msg === "login_required" ? "Sign in to vote." : msg,
          "error",
        );
      }
      return;
    }

    const remBtn = t?.closest?.<HTMLButtonElement>("[data-rem-vote]");
    if (remBtn && page.contains(remBtn)) {
      const id = remBtn.dataset.ballotId;
      const vote = remBtn.dataset.remVote as "yes" | "no" | undefined;
      if (!id || !vote) return;
      const card = remBtn.closest(".gov-card");
      setCardMsg(card, "Submitting…");
      try {
        const b = await voteRemovalBallot(id, vote);
        const li = page.querySelector(`[data-ballot-id="${CSS.escape(id)}"]`);
        if (li) li.outerHTML = removalCardHtml(b, ctx.funderEligible);
      } catch (e) {
        const msg = (e as Error).message;
        setCardMsg(
          card,
          msg === "login_required" ? "Sign in to vote." : msg,
          "error",
        );
      }
      return;
    }

    const opsBtn = t?.closest?.<HTMLButtonElement>("[data-ops-vote]");
    if (opsBtn && page.contains(opsBtn)) {
      const id = opsBtn.dataset.opsBallotId;
      const vote = opsBtn.dataset.opsVote as "yes" | "no" | undefined;
      if (!id || !vote) return;
      const card = opsBtn.closest(".gov-card");
      setCardMsg(card, "Submitting…");
      try {
        const b = await voteOpsRoleBallot(id, vote);
        const li = page.querySelector(`[data-ops-ballot-id="${CSS.escape(id)}"]`);
        if (li) li.outerHTML = opsRoleBallotCardHtml(b, ctx.isReviewer);
      } catch (e) {
        const msg = (e as Error).message;
        setCardMsg(
          card,
          msg === "login_required" ? "Sign in to vote." : msg,
          "error",
        );
      }
      return;
    }

    const reportBtn = t?.closest?.<HTMLButtonElement>("[data-report-resolve]");
    if (reportBtn && page.contains(reportBtn)) {
      const id = reportBtn.dataset.reportId;
      const action = reportBtn.dataset.reportResolve as
        | "dismiss"
        | "escalate_listing"
        | "hide_comment"
        | undefined;
      if (!id || !action) return;
      const card = reportBtn.closest(".gov-card");
      setCardMsg(card, "Working…");
      try {
        await resolveModerationReport(id, action);
        const li = page.querySelector(`[data-report-id="${CSS.escape(id)}"]`);
        li?.remove();
        const list = page.querySelector("#gov-reports");
        if (list && !list.children.length) {
          list.outerHTML = reportsInboxHtml([], true);
        }
      } catch (e) {
        const msg = (e as Error).message;
        setCardMsg(
          card,
          msg === "login_required" ? "Sign in as a reviewer." : msg,
          "error",
        );
      }
      return;
    }

    const selectBtn = t?.closest?.<HTMLButtonElement>(".gov-select-target");
    if (selectBtn && page.contains(selectBtn)) {
      const target = selectBtn.dataset.target;
      const input = page.querySelector<HTMLInputElement>("#removal-target");
      if (target && input) {
        input.value = target;
        input.focus();
        const removalsTab = page.querySelector<HTMLButtonElement>(
          '[data-gov-tab="removals"]',
        );
        removalsTab?.click();
        page.querySelector("#open-removal")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }
  });

  page
    .querySelector<HTMLFormElement>("#ops-nominate-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = page.querySelector<HTMLElement>("#ops-nominate-msg");
      const kind = page.querySelector<HTMLSelectElement>("#ops-kind");
      const action = page.querySelector<HTMLSelectElement>("#ops-action");
      const nominee = page.querySelector<HTMLInputElement>("#ops-nominee");
      const rationale = page.querySelector<HTMLTextAreaElement>("#ops-rationale");
      if (!msg || !kind || !action || !nominee || !rationale) return;
      msg.hidden = false;
      msg.className = "builder-msg";
      msg.textContent = "Opening role ballot…";
      try {
        const ballot = await nominateOpsRole({
          kind: kind.value,
          action: action.value as "grant" | "remove" | "retain",
          nominee_user_id: nominee.value.trim(),
          rationale: rationale.value.trim(),
        });
        msg.textContent = "Role ballot opened.";
        msg.className = "builder-msg success";
        const list = page.querySelector("#gov-ops-ballots");
        const html = opsRoleBallotCardHtml(ballot, ctx.isReviewer);
        if (list) {
          list.insertAdjacentHTML("afterbegin", html);
        } else {
          const block = page.querySelector("#ops-roles");
          const placeholder = block?.querySelector("p.muted");
          // Replace the "No open role ballots" line when present
          const emptyLine = [...(block?.querySelectorAll("p.muted") || [])].find(
            (el) => el.textContent?.includes("No open role ballots"),
          );
          if (emptyLine) {
            emptyLine.outerHTML = `<ul class="gov-list" id="gov-ops-ballots">${html}</ul>`;
          } else {
            placeholder?.insertAdjacentHTML(
              "afterend",
              `<ul class="gov-list" id="gov-ops-ballots">${html}</ul>`,
            );
          }
        }
        rationale.value = "";
      } catch (err) {
        const text = (err as Error).message;
        msg.textContent =
          text === "login_required" ? "Sign in to open a ballot." : text;
        msg.className = "builder-msg error";
      }
    });

  page
    .querySelector<HTMLFormElement>("#removal-open-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = page.querySelector<HTMLElement>("#removal-open-msg");
      const target = page.querySelector<HTMLInputElement>("#removal-target");
      const evidence = page.querySelector<HTMLTextAreaElement>("#removal-evidence");
      if (!target || !evidence || !msg) return;
      msg.hidden = false;
      msg.className = "builder-msg";
      msg.textContent = "Opening ballot…";
      try {
        const ballot = await openRemovalBallot({
          target_user_id: target.value.trim(),
          evidence: evidence.value.trim(),
        });
        msg.textContent = "Ballot opened.";
        msg.className = "builder-msg success";
        const block = page.querySelector("#removals");
        const empty = block?.querySelector(".gov-empty");
        if (empty) {
          empty.outerHTML = `<ul class="gov-list" id="gov-removals">${removalCardHtml(ballot, ctx.funderEligible)}</ul>`;
        } else {
          const list = page.querySelector("#gov-removals");
          const existing = list?.querySelector(
            `[data-ballot-id="${CSS.escape(ballot.id)}"]`,
          );
          if (existing) {
            existing.outerHTML = removalCardHtml(ballot, ctx.funderEligible);
          } else {
            list?.insertAdjacentHTML(
              "afterbegin",
              removalCardHtml(ballot, ctx.funderEligible),
            );
          }
        }
        evidence.value = "";
      } catch (err) {
        const text = (err as Error).message;
        msg.textContent =
          text === "login_required" ? "Sign in to open a ballot." : text;
        msg.className = "builder-msg error";
      }
    });

  page.addEventListener("click", async (ev) => {
    const btn = (ev.target as Element | null)?.closest?.<HTMLButtonElement>(
      "[data-kh-vote]",
    );
    if (!btn || !page.contains(btn)) return;
    const id = btn.dataset.electionId;
    const vote = btn.dataset.khVote as "yes" | "no" | undefined;
    if (!id || !vote) return;
    const card = btn.closest(".gov-card");
    setCardMsg(card, "Submitting…");
    const res = await authFetch(`${govApi()}/keyholders/election/${encodeURIComponent(id)}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      election?: KhElectionView;
    };
    if (!res.ok) {
      setCardMsg(card, body.error || "Vote failed", "error");
      return;
    }
    setCardMsg(card, `Recorded (${body.election?.yes ?? "?"} yes / ${body.election?.no ?? "?"} no).`);
  });

  page
    .querySelector<HTMLFormElement>("#kh-apply-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = page.querySelector<HTMLElement>("#kh-apply-msg");
      if (!msg) return;
      msg.hidden = false;
      msg.textContent = "Submitting…";
      const res = await authFetch(`${govApi()}/keyholders/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: page.querySelector<HTMLTextAreaElement>("#kh-apply-pubkey")?.value || "",
          hw_type: page.querySelector<HTMLInputElement>("#kh-apply-hw")?.value || "",
          handle: page.querySelector<HTMLInputElement>("#kh-apply-handle")?.value || "",
          statement: page.querySelector<HTMLTextAreaElement>("#kh-apply-statement")?.value || "",
          ack: page.querySelector<HTMLInputElement>("#kh-apply-ack")?.checked,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      msg.textContent = res.ok ? "Application opened." : body.error || "Apply failed";
      msg.className = `builder-msg ${res.ok ? "success" : "error"}`;
    });
}
