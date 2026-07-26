import {
  currentReturnPath,
  loginChoicesHtml,
  type AuthUser,
} from "./auth";
import { btnWithIcon } from "./icons";
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
import { WORKERS_API } from "./config";
import { href, proposalHref } from "./router";
import { escapeHtml, formatSats } from "./util";

export type GovernanceShell = (inner: string) => string;

type OpsRole = { role?: string; name?: string; user_id?: string; holder?: string };

async function fetchOpsRoles(): Promise<OpsRole[]> {
  if (!WORKERS_API) return [];
  const res = await fetch(`${WORKERS_API.replace(/\/$/, "")}/ops/roles`);
  if (!res.ok) return [];
  const data = (await res.json()) as { roles?: OpsRole[] } | OpsRole[];
  return Array.isArray(data) ? data : data.roles || [];
}

function opsRolesHtml(roles: OpsRole[]): string {
  if (!roles.length) {
    return `<div class="empty-state gov-empty"><div class="empty-state-inner">
      <p class="empty-state-title">Not active yet</p>
      <p class="empty-state-body">Operational roles are volume-gated until the reviewer pool has meaningful activity. No role vote is live.</p>
    </div></div>`;
  }
  return `<ul class="gov-roster">${roles
    .map((role) => `<li class="gov-roster-row"><span>${escapeHtml(role.role || role.name || "Operational role")}</span><span class="mono muted">${escapeHtml(role.user_id || role.holder || "Assigned")}</span></li>`)
    .join("")}</ul>`;
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
  if (!roster.reviewers.length) {
    return `<div class="empty-state"><div class="empty-state-inner">
      <p class="empty-state-title">No active reviewers</p>
      <p class="empty-state-body">Bootstrap seats have not been seeded yet.</p>
    </div></div>`;
  }
  const rows = roster.reviewers
    .map((r) => reviewerRowHtml(r, opts?.selectable))
    .join("");
  return `<div class="gov-meta">
      <span class="pill">${roster.count} active</span>
      <span class="pill">Platform completions ${roster.platform_completions}</span>
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

export async function renderGovernance(
  shell: GovernanceShell,
  user: AuthUser | null,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    <section class="wrap detail gov-page">
      <p class="loading">Loading governance…</p>
    </section>
  `);

  const [roster, decisions, removals, me, opsRoles] = await Promise.all([
    fetchReviewerRoster().catch(() => null),
    fetchOpenReviewDecisions().catch(() => [] as ReviewDecisionView[]),
    fetchOpenRemovalBallots().catch(() => [] as RemovalBallotView[]),
    user ? fetchReviewerMe().catch(() => null) : Promise.resolve(null),
    fetchOpsRoles().catch(() => [] as OpsRole[]),
  ]);

  const isReviewer = Boolean(me?.active);
  const funderEligible = Boolean(me?.funder_eligible);

  app.innerHTML = shell(`
    <section class="wrap detail gov-page">
      <header class="gov-hero">
        <p class="about-eyebrow">Governance</p>
        <h1>Reviewers</h1>
        <p class="lede">Human quorum confirms deliverables after AI triage. Eligible funders may remove earned reviewers for a documented pattern of bad faith. Bootstrap seats stay permanent.</p>
        ${statusStripHtml(me, user)}
      </header>

      <section class="gov-block" id="roster">
        <h2 class="gov-block-title">Active roster</h2>
        <p class="muted gov-block-lede">⌈⅔⌉ yes of the active roster, with at least five non-abstaining votes, passes a decision.</p>
        ${rosterSectionHtml(roster, { selectable: funderEligible })}
      </section>

      <section class="gov-block" id="decisions">
        <h2 class="gov-block-title">Open decisions</h2>
        <p class="muted gov-block-lede">Reviewers approve or reject. Dissent publishes permanently via PR on the project page.</p>
        ${openDecisionsHtml(decisions, isReviewer)}
      </section>

      <section class="gov-block" id="removals">
        <h2 class="gov-block-title">Removal ballots</h2>
        <p class="muted gov-block-lede">One funder identity = one vote. Passes at ⅔ of votes cast after the window closes (ops tally).</p>
        ${openRemovalsHtml(removals, funderEligible)}
      </section>

      <section class="gov-block" id="open-removal">
        <h2 class="gov-block-title">Open a removal</h2>
        ${openRemovalFormHtml(me, Boolean(user))}
      </section>

      <section class="gov-block" id="ops-roles">
        <h2 class="gov-block-title">Operational roles</h2>
        ${opsRolesHtml(opsRoles)}
      </section>

      <p class="gov-foot muted">
        Rules live in
        <a href="https://github.com/Plebly/proposals/blob/main/REVIEWERS.md" target="_blank" rel="noreferrer">REVIEWERS.md</a>.
        Project-level review UI stays on each project page.
        <a href="${href("/")}">Browse projects</a>.
      </p>
    </section>
  `);

  bindGovernanceHandlers(app, { isReviewer, funderEligible });
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

    const selectBtn = t?.closest?.<HTMLButtonElement>(".gov-select-target");
    if (selectBtn && page.contains(selectBtn)) {
      const target = selectBtn.dataset.target;
      const input = page.querySelector<HTMLInputElement>("#removal-target");
      if (target && input) {
        input.value = target;
        input.focus();
        page.querySelector("#open-removal")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
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
}
