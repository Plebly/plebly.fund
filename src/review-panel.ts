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


/**
 * Challenge AI when the ballot is still open, or when a closed/tallied
 * deliverable_confirm / second_review was AI-decisive and has not actually
 * been challenged or escalated. Matches status-line "AI decisive" Closed.
 */
export function isAiChallengeableDecision(d: ReviewDecisionView): boolean {
  if (d.kind !== "deliverable_confirm" && d.kind !== "second_review") {
    return false;
  }
  // Only hide when challenged or escalated for real — not when merely tallied.
  if (d.ai_challenged_at || d.escalated) return false;
  if (d.status === "open") return true;
  // Any non-open status with ai_decisive (tallied/closed/…) stays challengeable.
  return Boolean(d.ai_decisive);
}

/** Button copy for the Challenge AI control — never lie "Challenged". */
export function challengeAiButtonLabel(d: ReviewDecisionView): string {
  if (d.ai_challenged_at) return "Challenged";
  return "Challenge AI";
}

const UNSCORED_AI_REASON =
  "Intelligence did not score this work against the acceptance lines. Reviewers decide.";

function scoresSupportLabel(ai: {
  outcome: string;
  reasoning?: string;
  failing_criteria?: string[];
  acceptance_scored?: boolean;
}): boolean {
  if (ai.outcome === "fail") return (ai.failing_criteria || []).some((c) => c.trim());
  if (ai.outcome === "pass") {
    if (ai.acceptance_scored === true) return true;
    const reasoning = (ai.reasoning || "").trim();
    return Boolean(reasoning) && !retrievedPassage(reasoning);
  }
  return false;
}

function retrievedPassage(text: string): boolean {
  return /(?:^|\n)[^\n]{0,120} · [^\n]+/.test(text.trim());
}

/** Hide a pass/fail that is only a retrieved passage, and never show those passages as the reason. */
export function presentAiReviewCard<T extends {
  outcome: string;
  reasoning?: string;
  failing_criteria?: string[];
  acceptance_scored?: boolean;
}>(ai: T): T {
  if ((ai.outcome === "pass" || ai.outcome === "fail") && !scoresSupportLabel(ai)) {
    return {
      ...ai,
      outcome: "ambiguous",
      failing_criteria: [],
      acceptance_scored: false,
      reasoning: UNSCORED_AI_REASON,
    };
  }
  if (!ai.reasoning || !retrievedPassage(ai.reasoning)) return ai;
  const unmet = (ai.failing_criteria || []).map((c) => c.trim()).filter(Boolean);
  return {
    ...ai,
    reasoning: unmet.length
      ? "Scored acceptance lines were not met."
      : "The scored acceptance lines were met.",
  };
}

/** True when skipped/unavailable AI chrome should stay tucked under the ballot. */
export function isDemotedAiOutcome(outcome: string): boolean {
  return outcome === "bypass" || outcome === "unavailable";
}

/** Compact AI Reviewer card (deliverable submit, flag window, or decision). */
export function aiReviewCardHtml(
  ai: {
    outcome: string;
    reasoning?: string;
    failing_criteria?: string[];
    acceptance_scored?: boolean;
    attribution?: string;
  },
  opts?: { compact?: boolean; tucked?: boolean },
): string {
  const shown = presentAiReviewCard(ai);
  const failList =
    shown.failing_criteria?.length
      ? `<ul class="ai-fail-list">${shown.failing_criteria
          .map((c) => `<li>${escapeHtml(c)}</li>`)
          .join("")}</ul>`
      : "";
  const next =
    shown.outcome === "unavailable"
      ? `<p class="ai-next">Intelligence was unavailable. Humans continue the review.</p>`
      : shown.outcome === "bypass"
        ? `<p class="ai-next">This listing is outside the AI Reviewer's competence. Humans continue.</p>`
        : shown.outcome === "ambiguous"
          ? `<p class="ai-next">Needs humans. Escalate keeps the ballot open for reviewers.</p>`
          : `<p class="ai-next">Hybrid seat: confident pass/fail is a decisive vote. Challenge AI to escalate to humans. Never releases funds.</p>`;
  const attribution = escapeHtml(
    ai.attribution || "Powered by BTCDecoded Intelligence",
  );
  const rawReason = shown.reasoning || "";
  const compactLimit = 280;
  const truncated =
    Boolean(opts?.compact) && rawReason.length > compactLimit
      ? `${rawReason.slice(0, compactLimit).trimEnd()}…`
      : rawReason;
  const cites = truncated
    ? `<pre class="ai-reasoning${opts?.compact ? " is-compact" : ""}">${escapeHtml(truncated)}</pre>`
    : "";
  const tuck = opts?.tucked ?? isDemotedAiOutcome(shown.outcome);
  const head = `<div class="ai-review-head">
      <span class="ai-k">AI Reviewer</span>
      <span class="pill ${aiOutcomeClass(shown.outcome)}">${escapeHtml(aiOutcomeLabel(shown.outcome))}</span>
    </div>`;
  const body = `<p class="ai-attr">${attribution}</p>
    ${cites}
    ${failList}
    ${next}`;
  const cls = `ai-review-card ${aiOutcomeClass(shown.outcome)}${opts?.compact ? " is-compact" : ""}${tuck ? " is-tucked" : ""}`;
  if (tuck) {
    return `<details class="${cls}" role="status">
    <summary class="ai-review-summary">${head}</summary>
    <div class="ai-review-tucked-body">${body}</div>
  </details>`;
  }
  return `<div class="${cls}" role="status">
    ${head}
    ${body}
  </div>`;
}

export function reviewPanelHtml(proposalId: string): string {
  return `<div class="review-panel" id="review-panel" data-proposal-id="${escapeHtml(proposalId)}">
    <h3 class="review-panel-title">Reviewer decision</h3>
    <p class="muted" id="review-status">Loading…</p>
    <div id="review-challenge-ai" class="review-challenge-ai" hidden>
      <label class="donate-amount-label" for="challenge-ai-reason">Challenge AI</label>
      <p class="muted review-challenge-ai-lede">Escalate the AI result to human reviewers. Optional short reason.</p>
      <textarea id="challenge-ai-reason" class="donate-amount" rows="2" maxlength="2000" placeholder="Why escalate to humans…"></textarea>
      <button type="button" class="btn ghost" id="challenge-ai-submit">Challenge AI</button>
    </div>
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

/** Single primary state line for header / sidebar / panel chrome. */
export function primaryBallotStatusLabel(d: ReviewDecisionView): string {
  if (d.status !== "open") return closedBallotSummary(d);
  return `${decisionKindLabel(d.kind)} — open`;
}

export function reviewDecisionStatusLine(d: ReviewDecisionView): string {
  const primary = primaryBallotStatusLabel(d);
  if (d.status !== "open") {
    const aiBit = d.ai_decisive ? " · AI decisive" : "";
    return `${primary}${aiBit}`;
  }
  const closes = new Date(d.closes_at).toLocaleDateString();
  const second = d.round === 2 ? " · Second look" : "";
  const esc = d.escalated ? " · Escalated to humans" : "";
  return `${primary}${second}${esc} · closes ${closes}.`;
}

/** Sole primary closed-ballot summary (sidebar / next-card). */
export function closedBallotSummary(d: ReviewDecisionView): string {
  const result = d.result || d.status;
  return `Closed — ${result}${d.passed ? " (passed)" : ""}`;
}

export const FULFILLER_CANNOT_VOTE =
  "You are the fulfiller; you cannot vote on this proposal’s decision.";

function queryListingChrome(root: ParentNode, selector: string): HTMLElement | null {
  const fromRoot = root.querySelector<HTMLElement>(selector);
  if (fromRoot) return fromRoot;
  if (typeof document !== "undefined" && root !== document) {
    return document.querySelector<HTMLElement>(selector);
  }
  return null;
}

/** Hide actionable Flag when a closed ballot is the sole primary state. */
export function suppressFlagForClosedBallot(
  root: ParentNode,
  d: ReviewDecisionView,
): void {
  if (d.status === "open") return;
  const summary = closedBallotSummary(d);
  const sentence = queryListingChrome(root, "#next-card-sentence");
  if (sentence) sentence.textContent = summary;
  const detail = queryListingChrome(root, "#next-card-detail");
  if (detail) detail.remove();
  const flag = queryListingChrome(root, "#builder-flag") as HTMLButtonElement | null;
  if (!flag) return;
  const primary = flag.closest(".next-card-primary");
  if (primary) primary.remove();
  else flag.remove();
}

/**
 * Drive one status source of truth across listing header, funding meter,
 * sidebar jump, and next-card. Vote / fulfiller-blocked stay the decision
 * primary inside #review-panel.
 */
export function syncListingBallotChrome(
  root: ParentNode,
  d: ReviewDecisionView,
): void {
  const label = primaryBallotStatusLabel(d);
  const pill = queryListingChrome(root, ".proposal-hero-top .pill-status");
  if (pill) pill.textContent = label;
  const meter = queryListingChrome(
    root,
    ".proposal-funding-bar .funding-meter-label",
  );
  if (meter) meter.textContent = label;
  const jump = queryListingChrome(
    root,
    "#review-side-link",
  ) as HTMLAnchorElement | null;
  if (jump && !jump.hidden) {
    jump.textContent = label;
    jump.dataset.ballotChrome = "1";
  }
  if (d.status !== "open") {
    suppressFlagForClosedBallot(root, d);
    return;
  }
  // Open ballot: status chrome only. Decision primary (vote / fulfiller
  // blocked) lives in the review panel — do not leave competing "Review is
  // open" / wrong kind vote prompts in the sidebar.
  const sentence = queryListingChrome(root, "#next-card-sentence");
  if (sentence) sentence.textContent = label;
  const detail = queryListingChrome(root, "#next-card-detail");
  if (detail) detail.remove();
}

/** Paint open/closed decision UI. Exported for fulfiller gate tests. */
export function renderDecision(
  root: ParentNode,
  d: ReviewDecisionView,
  isReviewer: boolean,
  userId?: string | null,
  isFulfiller = false,
): void {
  const statusEl = root.querySelector<HTMLElement>("#review-status");
  const counts = root.querySelector<HTMLElement>("#review-counts");
  const actions = root.querySelector<HTMLElement>("#review-actions");
  const dissent = root.querySelector<HTMLElement>("#review-dissent");
  const list = root.querySelector<HTMLElement>("#review-dissents");
  const mine = Boolean(
    userId && (d.dissent || []).some((e) => e.user_id === userId),
  );
  // Match workers castReviewVote: fulfiller cannot vote on ANY kind of their
  // proposal's decision (not only deliverable_confirm / second_review).
  const fulfillerBlocked = isFulfiller;

  if (statusEl) {
    statusEl.textContent = reviewDecisionStatusLine(d);
  }
  const aiSlot = root.querySelector<HTMLElement>("#review-ai");
  if (aiSlot) {
    aiSlot.innerHTML = d.ai_review
      ? aiReviewCardHtml(d.ai_review, { compact: true })
      : "";
  }
  // Prefer panel-owned tucked AI; drop a competing outer skipped card.
  if (d.ai_review && isDemotedAiOutcome(d.ai_review.outcome)) {
    const host =
      (root instanceof Element ? root.closest("#proposal-review") : null) ||
      (typeof document !== "undefined"
        ? document.querySelector("#proposal-review")
        : null);
    host
      ?.querySelectorAll(":scope > .ai-review-card")
      .forEach((el) => el.remove());
  }
  syncListingBallotChrome(root, d);
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
  if (actions) {
    if (fulfillerBlocked) {
      actions.hidden = false;
      actions.innerHTML = `<p class="review-fulfiller-blocked muted" role="status">${escapeHtml(FULFILLER_CANNOT_VOTE)}</p>`;
    } else {
      actions.hidden = !(d.status === "open" && isReviewer);
    }
  }
  if (dissent) dissent.hidden = fulfillerBlocked ? true : !(isReviewer && !mine);
  const challenge = root.querySelector<HTMLElement>("#review-challenge-ai");
  if (challenge) {
    const show = isAiChallengeableDecision(d);
    challenge.hidden = !show;
    const btn = challenge.querySelector<HTMLButtonElement>("#challenge-ai-submit");
    if (btn) {
      btn.disabled = !show;
      // "Challenged" only when actually challenged; otherwise keep default copy
      // while the slot stays hidden so we never lie about challenge state.
      if (show || d.ai_challenged_at) {
        btn.textContent = challengeAiButtonLabel(d);
      }
    }
  }
}

export async function bindReviewPanel(
  root: ParentNode,
  opts: { proposalId: string; user: AuthUser | null; isFulfiller?: boolean },
): Promise<void> {
  const panel = root.querySelector<HTMLElement>("#review-panel");
  if (!panel || !opts.proposalId) return;
  const msg = panel.querySelector<HTMLElement>("#review-msg");
  const statusEl = panel.querySelector<HTMLElement>("#review-status");

  // Generation guard: claim-refresh / proposal-page may call bind twice.
  // Signed-in paths await fetchReviewerMe first and can lose a race to a
  // later bind — only the latest generation may paint.
  const gen = Number(panel.dataset.reviewBindGen || "0") + 1;
  panel.dataset.reviewBindGen = String(gen);
  const stillCurrent = () => panel.dataset.reviewBindGen === String(gen);

  // Fetch decision in parallel with reviewer me so signed-in users paint as
  // fast as guests (guest skips me). Stale generations bail before paint.
  const decisionPromise = fetchOpenReviewDecision(opts.proposalId);
  const mePromise = opts.user
    ? fetchReviewerMe().catch(() => null)
    : Promise.resolve(null);
  const [decision, me] = await Promise.all([decisionPromise, mePromise]);
  if (!stillCurrent()) return;

  const isReviewer = Boolean(me?.active);
  const isFulfiller = Boolean(opts.isFulfiller);

  if (!decision) {
    if (statusEl) {
      statusEl.textContent = "No open reviewer decision yet.";
    }
    if (isFulfiller) {
      const slot = panel.querySelector<HTMLElement>("#review-actions");
      if (slot) {
        slot.hidden = false;
        slot.innerHTML = `<p class="review-fulfiller-blocked muted" role="status">${escapeHtml(FULFILLER_CANNOT_VOTE)}</p>`;
      }
    } else if (!opts.user) {
      const slot = panel.querySelector<HTMLElement>("#review-actions");
      if (slot) {
        slot.hidden = false;
        slot.innerHTML = loginChoicesHtml("Sign in to vote if you are a reviewer.");
      }
    }
    return;
  }

  renderDecision(panel, decision, isReviewer, opts.user?.id, isFulfiller);
  suppressFlagForClosedBallot(root, decision);
  // Track last painted decision so tests / later sync can detect a good paint.
  panel.dataset.reviewDecisionId = decision.id;
  panel.dataset.reviewDecisionStatus = decision.status;

  if (!opts.user && !isFulfiller && decision.status === "open") {
    const actions = panel.querySelector<HTMLElement>("#review-actions");
    if (actions) {
      actions.hidden = false;
      actions.innerHTML = loginChoicesHtml("Reviewers: sign in to cast your vote.");
    }
  }

  // Attach listeners once per panel mount. Re-binds from syncHybridReviewUi
  // only refresh paint (above); stacking click handlers would double-POST
  // challenge-ai and leave the slot painted Challenged after the first wins.
  if (panel.dataset.reviewListeners === "1") return;
  panel.dataset.reviewListeners = "1";

  const liveDecision = () => panel.dataset.reviewDecisionId || decision.id;

  panel.querySelectorAll<HTMLButtonElement>("[data-rev-vote]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const vote = btn.dataset.revVote as "yes" | "no" | "abstain";
      setMsg(msg, "Recording vote…");
      try {
        const next = await voteReviewDecision(liveDecision(), vote);
        renderDecision(panel, next, isReviewer, opts.user?.id, isFulfiller);
        suppressFlagForClosedBallot(root, next);
        panel.dataset.reviewDecisionId = next.id;
        panel.dataset.reviewDecisionStatus = next.status;
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
      const next = await publishDissent(liveDecision(), text);
      renderDecision(panel, next, isReviewer, opts.user?.id, isFulfiller);
        suppressFlagForClosedBallot(root, next);
      panel.dataset.reviewDecisionId = next.id;
      panel.dataset.reviewDecisionStatus = next.status;
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
      const next = await challengeAiReviewDecision(
        liveDecision(),
        reason || undefined,
      );
      renderDecision(panel, next, isReviewer, opts.user?.id, isFulfiller);
        suppressFlagForClosedBallot(root, next);
      panel.dataset.reviewDecisionId = next.id;
      panel.dataset.reviewDecisionStatus = next.status;
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
