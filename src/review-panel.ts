import type { AuthUser } from "./auth";
import { loginChoicesHtml } from "./auth";
import { btnWithIcon } from "./icons";
import { daysLeftFrom } from "./next-action";
import {
  challengeAiReviewDecision,
  decisionKindLabel,
  fetchOpenReviewDecision,
  fetchReviewerMe,
  publishDissent,
  submitRebuttal,
  voteReviewDecision,
  type ReviewDecisionView,
} from "./reviewers";
import { escapeHtml } from "./util";

export function aiOutcomeLabel(outcome: string): string {
  if (outcome === "pass") return "Clear pass";
  if (outcome === "fail") return "Clear fail";
  if (outcome === "bypass") return "Skipped";
  if (outcome === "unavailable") return "Unavailable";
  return "Needs human review";
}

export function aiOutcomeClass(outcome: string): string {
  if (outcome === "pass") return "ai-pass";
  if (outcome === "fail") return "ai-fail";
  return "ai-ambiguous";
}


/** Open deliverable_confirm / second_review that has not been escalated yet. */
export function isAiChallengeableDecision(d: ReviewDecisionView): boolean {
  const openOrAiDecisive =
    d.status === "open" ||
    (d.status === "tallied" && Boolean(d.ai_decisive));
  if (!openOrAiDecisive) return false;
  if (d.kind !== "deliverable_confirm" && d.kind !== "second_review") {
    return false;
  }
  if (d.escalated || d.ai_challenged_at) return false;
  return true;
}

/** Compact AI Reviewer card (deliverable submit, flag window, or decision). */
export function aiReviewCardHtml(
  ai: {
    outcome: string;
    reasoning?: string;
    failing_criteria?: string[];
    attribution?: string;
  },
  opts?: { compact?: boolean },
): string {
  const failList =
    ai.failing_criteria?.length
      ? `<ul class="ai-fail-list">${ai.failing_criteria
          .map((c) => `<li>${escapeHtml(c)}</li>`)
          .join("")}</ul>`
      : "";
  const next =
    ai.outcome === "unavailable"
      ? `<p class="ai-next">Intelligence was unavailable. Humans continue the review.</p>`
      : ai.outcome === "bypass"
        ? `<p class="ai-next">This listing is outside the AI Reviewer's competence. Humans continue.</p>`
        : ai.outcome === "ambiguous"
          ? `<p class="ai-next">Needs humans. Escalate keeps the ballot open for reviewers.</p>`
          : `<p class="ai-next">Hybrid seat: confident pass/fail is a decisive vote. Challenge AI to escalate to humans. Never releases funds.</p>`;
  const attribution = escapeHtml(
    ai.attribution || "Powered by BTCDecoded Intelligence",
  );
  const cites = ai.reasoning
    ? `<pre class="ai-reasoning">${escapeHtml(ai.reasoning)}</pre>`
    : "";
  return `<div class="ai-review-card ${aiOutcomeClass(ai.outcome)}${opts?.compact ? " is-compact" : ""}" role="status">
    <div class="ai-review-head">
      <span class="ai-k">AI Reviewer</span>
      <span class="pill ${aiOutcomeClass(ai.outcome)}">${escapeHtml(aiOutcomeLabel(ai.outcome))}</span>
    </div>
    <p class="ai-attr">${attribution}</p>
    ${cites}
    ${failList}
    ${next}
  </div>`;
}

export function reviewPanelHtml(proposalId: string): string {
  return `<div class="review-panel" id="review-panel" data-proposal-id="${escapeHtml(proposalId)}">
    <h3 class="review-panel-title">Reviewer decision</h3>
    <p class="muted" id="review-status">Loading…</p>
    <div id="review-ai"></div>
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
    <div id="review-challenge-ai" class="review-challenge-ai" hidden>
      <label class="donate-amount-label" for="challenge-ai-reason">Challenge AI</label>
      <p class="muted review-challenge-ai-lede">Escalate the AI result to human reviewers. Optional short reason.</p>
      <textarea id="challenge-ai-reason" class="donate-amount" rows="2" maxlength="2000" placeholder="Why escalate to humans…"></textarea>
      <button type="button" class="btn ghost" id="challenge-ai-submit">Challenge AI</button>
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
    const aiBit = d.ai_decisive ? " · AI decisive" : "";
    return `${kind} · Closed · ${result}${d.passed ? " (passed)" : ""}${aiBit}`;
  }
  const closes = new Date(d.closes_at).toLocaleDateString();
  const second = d.round === 2 ? " · Second look" : "";
  const esc = d.escalated ? " · Escalated to humans" : "";
  return `${kind}${second}${esc} · ${d.vote_count} vote(s) · closes ${closes}.`;
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
  const aiSlot = root.querySelector<HTMLElement>("#review-ai");
  if (aiSlot) {
    aiSlot.innerHTML = d.ai_review ? aiReviewCardHtml(d.ai_review, { compact: true }) : "";
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
  const challenge = root.querySelector<HTMLElement>("#review-challenge-ai");
  if (challenge) {
    const show = isAiChallengeableDecision(d);
    challenge.hidden = !show;
    const btn = challenge.querySelector<HTMLButtonElement>("#challenge-ai-submit");
    if (btn) {
      btn.disabled = !show;
      btn.textContent = show ? "Challenge AI" : "Challenged";
    }
  }
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

  panel.querySelector("#challenge-ai-submit")?.addEventListener("click", async () => {
    const reason = (
      panel.querySelector("#challenge-ai-reason") as HTMLTextAreaElement | null
    )?.value.trim();
    setMsg(msg, "Challenging AI…");
    try {
      const next = await challengeAiReviewDecision(decision.id, reason || undefined);
      renderDecision(panel, next, isReviewer, opts.user?.id);
      setMsg(msg, "AI challenged — escalated to humans.", "success");
    } catch (e) {
      if ((e as Error).message === "login_required") {
        if (msg) {
          msg.hidden = false;
          msg.innerHTML = loginChoicesHtml(
            "Sign in as a donor or the proposer to challenge AI.",
          );
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
