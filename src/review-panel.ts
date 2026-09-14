import type { AuthUser } from "./auth";
import { loginChoicesHtml } from "./auth";
import { btnWithIcon } from "./icons";
import { daysLeftFrom } from "./next-action";
import {
  decisionKindLabel,
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
      ? `<p class="ai-next">Revise and resubmit.</p>`
      : `<p class="ai-next">The proposer can mark this done.</p>`;
  return `<div class="ai-review-card ${aiOutcomeClass(ai.outcome)}${opts?.compact ? " is-compact" : ""}" role="status">
    <div class="ai-review-head">
      <span class="ai-k">AI first-pass</span>
      <span class="pill ${aiOutcomeClass(ai.outcome)}">${escapeHtml(aiOutcomeLabel(ai.outcome))}</span>
    </div>
    ${ai.reasoning ? `<p class="ai-reasoning">${escapeHtml(ai.reasoning)}</p>` : ""}
    ${failList}
    ${next}
  </div>`;
}

export function reviewPanelHtml(proposalId: string): string {
  return `<div class="review-panel" id="review-panel" data-proposal-id="${escapeHtml(proposalId)}">
    <h3 class="review-panel-title">Reviewer decision</h3>
    <p class="muted" id="review-status">Loading…</p>
    <div id="review-counts" class="review-counts" hidden></div>
    <div id="review-actions" class="review-actions" hidden>
      <button type="button" class="btn" data-rev-vote="yes">${btnWithIcon("check", "Approve")}</button>
      <button type="button" class="btn ghost" data-rev-vote="no">${btnWithIcon("xmark", "Reject")}</button>
      <button type="button" class="btn ghost" data-rev-vote="abstain">Abstain</button>
    </div>
    <div id="review-dissents" class="review-dissents"></div>
    <div id="review-dissent" class="review-dissent" hidden>
      <label class="donate-amount-label" for="dissent-text">Publish dissent</label>
      <textarea id="dissent-text" class="donate-amount" rows="3" placeholder="Why this does not meet the project…"></textarea>
      <button type="button" class="btn ghost" id="dissent-submit">Publish dissent</button>
    </div>
    <p class="builder-msg" id="review-msg" hidden></p>
  </div>`;
}

export function rebuttalPanelHtml(
  expiresAt?: string | null,
  filed?: string | null,
): string {
  if (filed) {
    return `<div class="rebuttal-panel" id="rebuttal-panel">
    <p class="next-card-sentence">Reply filed. Reviewers will take a second look.</p>
    <p class="review-dissent-text">${escapeHtml(filed)}</p>
  </div>`;
  }
  const days = daysLeftFrom(expiresAt);
  const sentence =
    days != null
      ? `You can file one reply. ${days} day${days === 1 ? "" : "s"} left.`
      : "You can file one reply.";
  return `<div class="rebuttal-panel" id="rebuttal-panel">
    <p class="next-card-sentence">${escapeHtml(sentence)}</p>
    <label class="donate-amount-label" for="rebuttal-text">Reply</label>
    <textarea id="rebuttal-text" class="donate-amount" rows="4" placeholder="Address the rejection with concrete evidence…"></textarea>
    <button type="button" class="btn" id="rebuttal-submit">File reply</button>
    <p class="builder-msg" id="rebuttal-msg" hidden></p>
  </div>`;
}

export function dissentListHtml(
  entries: NonNullable<ReviewDecisionView["dissent"]>,
): string {
  if (!entries.length) return "";
  return `<ul class="review-dissent-list">${entries
    .map(
      (e) =>
        `<li class="review-dissent-item"><p class="review-dissent-text">${escapeHtml(e.reasoning)}</p></li>`,
    )
    .join("")}</ul>`;
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

export function reviewDecisionStatusLine(d: ReviewDecisionView): string {
  const kind = decisionKindLabel(d.kind);
  if (d.status !== "open") {
    const result = d.result || d.status;
    return `${kind} · Closed · ${result}${d.passed ? " (passed)" : ""}`;
  }
  const closes = new Date(d.closes_at).toLocaleDateString();
  const second = d.round === 2 ? " · Second look" : "";
  return `${kind}${second} · ${d.vote_count} vote(s) · closes ${closes}.`;
}

function renderDecision(
  root: ParentNode,
  d: ReviewDecisionView,
  isReviewer: boolean,
  userId?: string | null,
): void {
  const statusEl = root.querySelector<HTMLElement>("#review-status");
  const counts = root.querySelector<HTMLElement>("#review-counts");
  const actions = root.querySelector<HTMLElement>("#review-actions");
  const dissent = root.querySelector<HTMLElement>("#review-dissent");
  const list = root.querySelector<HTMLElement>("#review-dissents");
  const mine = Boolean(
    userId && (d.dissent || []).some((e) => e.user_id === userId),
  );

  if (statusEl) {
    statusEl.textContent = reviewDecisionStatusLine(d);
  }
  if (counts) {
    counts.hidden = false;
    counts.innerHTML = `
      <span class="review-count yes">Yes ${d.counts.yes}</span>
      <span class="review-count no">No ${d.counts.no}</span>
      <span class="review-count abstain">Abstain ${d.counts.abstain}</span>`;
  }
  if (list) {
    const reply = d.rebuttal?.reasoning
      ? `<p class="review-dissent-text">${escapeHtml(d.rebuttal.reasoning)}</p>`
      : "";
    list.innerHTML = `${reply}${dissentListHtml(d.dissent || [])}`;
  }
  if (actions) actions.hidden = !(d.status === "open" && isReviewer);
  if (dissent) dissent.hidden = !(isReviewer && !mine);
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

  renderDecision(panel, decision, isReviewer, opts.user?.id);

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
        renderDecision(panel, next, isReviewer, opts.user?.id);
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
    setMsg(msg, "Publishing…");
    try {
      const next = await publishDissent(decision.id, text);
      renderDecision(panel, next, isReviewer, opts.user?.id);
      setMsg(msg, "Dissent published.", "success");
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
    expiresAt?: string | null;
  },
): Promise<void> {
  const panel = root.querySelector<HTMLElement>("#rebuttal-panel");
  if (!panel) return;
  const msg = panel.querySelector<HTMLElement>("#rebuttal-msg");

  if (!opts.isFulfiller) {
    const days = daysLeftFrom(opts.expiresAt);
    const sentence =
      days != null
        ? `The builder has ${days} day${days === 1 ? "" : "s"} to reply once.`
        : "The builder has time to reply once.";
    panel.innerHTML = `<p class="next-card-sentence">${escapeHtml(sentence)}</p>`;
    return;
  }
  if (!opts.user) {
    panel.querySelector("#rebuttal-submit")?.replaceWith(
      (() => {
        const d = document.createElement("div");
        d.innerHTML = loginChoicesHtml("Sign in as the builder to file a reply.");
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
      setMsg(msg, "Reply needs at least 40 characters.", "error");
      return;
    }
    setMsg(msg, "Filing reply…");
    try {
      const next = await submitRebuttal({
        proposal_id: opts.proposalId,
        proposal_path: opts.proposalPath,
        reasoning,
      });
      panel.outerHTML = rebuttalPanelHtml(opts.expiresAt, next.reasoning || reasoning);
    } catch (e) {
      setMsg(msg, (e as Error).message, "error");
    }
  });
}
