import type { AuthUser } from "./auth";
import { loginChoicesHtml } from "./auth";
import { btnWithIcon } from "./icons";
import {
  fetchOpenReviewDecision,
  fetchReviewerMe,
  publishDissent,
  submitRebuttal,
  voteReviewDecision,
  type AiReviewView,
  type ReviewDecisionView,
} from "./reviewers";
import { escapeHtml } from "./util";

export function aiOutcomeLabel(outcome: string): string {
  if (outcome === "pass") return "Clear pass";
  if (outcome === "fail") return "Clear fail";
  return "Needs human review";
}

export function aiOutcomeClass(outcome: string): string {
  if (outcome === "pass") return "ai-pass";
  if (outcome === "fail") return "ai-fail";
  return "ai-ambiguous";
}

/** Compact AI result card (deliverable submit response or decision attachment). */
export function aiReviewCardHtml(ai: AiReviewView, opts?: { compact?: boolean }): string {
  const failList =
    ai.failing_criteria?.length
      ? `<ul class="ai-fail-list">${ai.failing_criteria
          .map((c) => `<li>${escapeHtml(c)}</li>`)
          .join("")}</ul>`
      : "";
  const next =
    ai.outcome === "fail"
      ? `<p class="ai-next">No reviewer ballot opened. Revise and resubmit before the claim window ends.</p>`
      : ai.outcome === "pass"
        ? `<p class="ai-next">Reviewers still confirm — AI never releases funds.</p>`
        : `<p class="ai-next">Escalated to a full reviewer vote.</p>`;
  return `<div class="ai-review-card ${aiOutcomeClass(ai.outcome)}${opts?.compact ? " is-compact" : ""}" role="status">
    <div class="ai-review-head">
      <span class="ai-k">AI first-pass</span>
      <span class="pill ${aiOutcomeClass(ai.outcome)}">${escapeHtml(aiOutcomeLabel(ai.outcome))}</span>
    </div>
    <p class="ai-reasoning">${escapeHtml(ai.reasoning)}</p>
    ${failList}
    ${next}
    <p class="ai-meta muted">Prompt <code class="mono">${escapeHtml(ai.prompt_version)}</code> · ${escapeHtml(ai.model)}</p>
  </div>`;
}

export function reviewPanelHtml(proposalId: string): string {
  return `<div class="review-panel" id="review-panel" data-proposal-id="${escapeHtml(proposalId)}">
    <h3 class="review-panel-title">Reviewer decision</h3>
    <p class="muted" id="review-status">Loading…</p>
    <div id="review-ai-slot"></div>
    <div id="review-counts" class="review-counts" hidden></div>
    <div id="review-actions" class="review-actions" hidden>
      <button type="button" class="btn" data-rev-vote="yes">${btnWithIcon("check", "Approve")}</button>
      <button type="button" class="btn ghost" data-rev-vote="no">${btnWithIcon("xmark", "Reject")}</button>
      <button type="button" class="btn ghost" data-rev-vote="abstain">Abstain</button>
    </div>
    <div id="review-dissent" class="review-dissent" hidden>
      <label class="donate-amount-label" for="dissent-text">Publish dissent (permanent in git)</label>
      <textarea id="dissent-text" class="donate-amount" rows="3" placeholder="Your reasoning for the public record…"></textarea>
      <button type="button" class="btn ghost" id="dissent-submit">Open dissent PR</button>
    </div>
    <p class="builder-msg" id="review-msg" hidden></p>
  </div>`;
}

export function rebuttalPanelHtml(): string {
  return `<div class="rebuttal-panel" id="rebuttal-panel">
    <h3 class="review-panel-title">Rebuttal</h3>
    <p class="muted">Within 14 days of rejection you may file one formal rebuttal. Reviewers get one second vote. No third appeal.</p>
    <label class="donate-amount-label" for="rebuttal-text">Rebuttal</label>
    <textarea id="rebuttal-text" class="donate-amount" rows="4" placeholder="Address the rejection with concrete evidence…"></textarea>
    <button type="button" class="btn" id="rebuttal-submit">Submit rebuttal PR</button>
    <p class="builder-msg" id="rebuttal-msg" hidden></p>
  </div>`;
}

function setMsg(el: HTMLElement | null, text: string | null, cls = ""): void {
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.className = "builder-msg";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `builder-msg ${cls}`.trim();
}

function renderDecision(
  root: ParentNode,
  d: ReviewDecisionView,
  isReviewer: boolean,
): void {
  const statusEl = root.querySelector<HTMLElement>("#review-status");
  const counts = root.querySelector<HTMLElement>("#review-counts");
  const actions = root.querySelector<HTMLElement>("#review-actions");
  const dissent = root.querySelector<HTMLElement>("#review-dissent");
  const aiSlot = root.querySelector<HTMLElement>("#review-ai-slot");

  if (statusEl) {
    const closes = new Date(d.closes_at).toLocaleDateString();
    statusEl.textContent =
      d.status === "open"
        ? `Round ${d.round} · ${d.vote_count} vote(s) · closes ${closes} · need ⌈⅔⌉ yes + 5 non-abstain`
        : `Closed · ${d.result || d.status}${d.passed ? " (passed)" : ""}`;
  }
  if (aiSlot) {
    aiSlot.innerHTML = d.ai_review ? aiReviewCardHtml(d.ai_review, { compact: true }) : "";
  }
  if (counts) {
    counts.hidden = false;
    counts.innerHTML = `
      <span class="review-count yes">Yes ${d.counts.yes}</span>
      <span class="review-count no">No ${d.counts.no}</span>
      <span class="review-count abstain">Abstain ${d.counts.abstain}</span>
      ${d.need_yes != null ? `<span class="muted">Need ${d.need_yes} yes</span>` : ""}`;
  }
  if (actions) actions.hidden = !(d.status === "open" && isReviewer);
  if (dissent) dissent.hidden = !isReviewer;
}

export async function bindReviewPanel(
  root: ParentNode,
  opts: { proposalId: string; user: AuthUser | null },
): Promise<void> {
  const panel = root.querySelector<HTMLElement>("#review-panel");
  if (!panel || !opts.proposalId) return;
  const msg = panel.querySelector<HTMLElement>("#review-msg");
  const statusEl = panel.querySelector<HTMLElement>("#review-status");

  let me = opts.user ? await fetchReviewerMe().catch(() => null) : null;
  const isReviewer = Boolean(me?.active);

  const decision = await fetchOpenReviewDecision(opts.proposalId);
  if (!decision) {
    if (statusEl) {
      statusEl.textContent = "No open reviewer decision yet.";
    }
    if (!opts.user) {
      const slot = panel.querySelector<HTMLElement>("#review-actions");
      if (slot) {
        slot.hidden = false;
        slot.innerHTML = loginChoicesHtml("Sign in to vote if you are a reviewer.");
      }
    }
    return;
  }

  renderDecision(panel, decision, isReviewer);

  if (!opts.user && decision.status === "open") {
    const actions = panel.querySelector<HTMLElement>("#review-actions");
    if (actions) {
      actions.hidden = false;
      actions.innerHTML = loginChoicesHtml("Reviewers: sign in to cast your vote.");
    }
  }

  panel.querySelectorAll<HTMLButtonElement>("[data-rev-vote]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const vote = btn.dataset.revVote as "yes" | "no" | "abstain";
      setMsg(msg, "Recording vote…");
      try {
        const next = await voteReviewDecision(decision.id, vote);
        renderDecision(panel, next, isReviewer);
        setMsg(msg, "Vote recorded.", "success");
      } catch (e) {
        if ((e as Error).message === "login_required") {
          setMsg(msg, null);
          if (msg) {
            msg.hidden = false;
            msg.innerHTML = loginChoicesHtml("Sign in to vote.");
          }
        } else setMsg(msg, (e as Error).message, "error");
      }
    });
  });

  panel.querySelector("#dissent-submit")?.addEventListener("click", async () => {
    const text = (
      panel.querySelector("#dissent-text") as HTMLTextAreaElement | null
    )?.value.trim();
    if (!text || text.length < 20) {
      setMsg(msg, "Dissent needs at least 20 characters.", "error");
      return;
    }
    setMsg(msg, "Opening dissent PR…");
    try {
      const { pr_url } = await publishDissent(decision.id, text);
      setMsg(msg, `Dissent PR opened: ${pr_url}`, "success");
    } catch (e) {
      if ((e as Error).message === "login_required") {
        if (msg) {
          msg.hidden = false;
          msg.innerHTML = loginChoicesHtml("Sign in to publish dissent.");
        }
      } else setMsg(msg, (e as Error).message, "error");
    }
  });
}

export async function bindRebuttalPanel(
  root: ParentNode,
  opts: {
    proposalId: string;
    proposalPath: string;
    user: AuthUser | null;
    isFulfiller: boolean;
  },
): Promise<void> {
  const panel = root.querySelector<HTMLElement>("#rebuttal-panel");
  if (!panel) return;
  const msg = panel.querySelector<HTMLElement>("#rebuttal-msg");

  if (!opts.isFulfiller) {
    panel.innerHTML = `<h3 class="review-panel-title">Rejected</h3><p class="muted">The fulfiller may file one rebuttal within 14 days.</p>`;
    return;
  }
  if (!opts.user) {
    panel.querySelector("#rebuttal-submit")?.replaceWith(
      (() => {
        const d = document.createElement("div");
        d.innerHTML = loginChoicesHtml("Sign in as the fulfiller to rebut.");
        return d;
      })(),
    );
    return;
  }

  panel.querySelector("#rebuttal-submit")?.addEventListener("click", async () => {
    const reasoning = (
      panel.querySelector("#rebuttal-text") as HTMLTextAreaElement | null
    )?.value.trim();
    if (!reasoning || reasoning.length < 40) {
      setMsg(msg, "Rebuttal needs at least 40 characters.", "error");
      return;
    }
    setMsg(msg, "Opening rebuttal PR…");
    try {
      const result = await submitRebuttal({
        proposal_id: opts.proposalId,
        proposal_path: opts.proposalPath,
        reasoning,
      });
      setMsg(
        msg,
        `Rebuttal opened — second review ${result.decision_id}. ${result.pr_url}`,
        "success",
      );
    } catch (e) {
      setMsg(msg, (e as Error).message, "error");
    }
  });
}
