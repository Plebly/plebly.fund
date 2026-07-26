import {
  bindLoginHandlers,
  currentReturnPath,
  loginChoicesHtml,
  type AuthUser,
} from "./auth";
import { solidIcon } from "./icons";
import { fileModerationReport } from "./reports";
import {
  fetchOpenReviewDecision,
  type ReviewerMe,
} from "./reviewers";
import { href } from "./router";
import { escapeHtml, formatTimeAgo } from "./util";

const REPORTABLE = new Set(["listed", "funding", "claimable"]);

/** Compact report control + modal (replaces always-on listing challenge panel). */
export function listingReportControlHtml(
  status: string,
  proposalPath: string,
  proposalId: string | null,
): string {
  if (!REPORTABLE.has(status) || !proposalId) return "";
  return `<div class="listing-report" id="listing-report" data-path="${escapeHtml(proposalPath)}" data-proposal-id="${escapeHtml(proposalId)}">
    <button type="button" class="btn ghost listing-report-trigger" id="listing-report-open">
      ${solidIcon("flag")} Report listing
    </button>
    <p class="muted listing-report-status" id="listing-report-status" hidden></p>
    <div class="site-modal" id="listing-report-modal" hidden>
      <div class="site-modal-backdrop" data-close-report tabindex="-1" aria-hidden="true"></div>
      <div class="site-modal-card listing-report-card" role="dialog" aria-modal="true" aria-labelledby="listing-report-title">
        <button type="button" class="site-modal-close" id="listing-report-close" aria-label="Close">${solidIcon("xmark")}</button>
        <h2 id="listing-report-title">Report listing</h2>
        <p class="muted" id="listing-report-lede" hidden></p>
        <div id="listing-report-body"></div>
        <p class="builder-msg" id="listing-report-msg" hidden></p>
      </div>
    </div>
  </div>`;
}

function formHtml(funderEligible: boolean): string {
  return `<form id="listing-report-form" class="gov-form">
    <label class="field"><span>Reason</span>
      <textarea id="listing-report-reason" rows="4" required minlength="8" maxlength="500" placeholder="Why this listing should be reviewed…"></textarea>
    </label>
    ${
      funderEligible
        ? `<label class="check-row">
            <input type="checkbox" id="listing-report-escalate" />
            <span>Also open a listing challenge ballot</span>
          </label>`
        : ""
    }
    <div class="form-actions">
      <button type="submit" class="btn">Submit report</button>
    </div>
  </form>`;
}

export async function bindListingReportControl(
  root: ParentNode,
  opts: {
    proposalId: string | null | undefined;
    proposalPath: string;
    status: string;
    user: AuthUser | null;
    reviewerMe: ReviewerMe | null;
    onAuthed: () => void;
  },
): Promise<void> {
  const wrap = root.querySelector<HTMLElement>("#listing-report");
  if (!wrap || !REPORTABLE.has(opts.status) || !opts.proposalId) return;

  const modal = wrap.querySelector<HTMLElement>("#listing-report-modal");
  const body = wrap.querySelector<HTMLElement>("#listing-report-body");
  const msg = wrap.querySelector<HTMLElement>("#listing-report-msg");
  const statusEl = wrap.querySelector<HTMLElement>("#listing-report-status");
  const lede = wrap.querySelector<HTMLElement>("#listing-report-lede");
  if (!modal || !body) return;

  const openModal = () => {
    modal.hidden = false;
  };
  const closeModal = () => {
    modal.hidden = true;
  };

  wrap
    .querySelector("#listing-report-open")
    ?.addEventListener("click", openModal);
  wrap
    .querySelector("#listing-report-close")
    ?.addEventListener("click", closeModal);
  wrap.querySelectorAll("[data-close-report]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  let openChallenge = false;
  try {
    const open = await fetchOpenReviewDecision(opts.proposalId);
    if (open?.kind === "listing_challenge" && open.status === "open") {
      openChallenge = true;
      if (statusEl) {
        const when = formatTimeAgo(open.closes_at);
        statusEl.hidden = false;
        statusEl.innerHTML = `Listing challenge open · closes <time datetime="${escapeHtml(open.closes_at)}" title="${escapeHtml(when?.title || open.closes_at)}">${escapeHtml(when?.text || open.closes_at)}</time> · <a href="${href("/reviewers")}?tab=decisions">Vote</a>`;
      }
    }
  } catch {
    /* ignore */
  }

  const funderEligible = Boolean(opts.reviewerMe?.funder_eligible);

  if (!opts.user) {
    body.innerHTML = loginChoicesHtml(
      "Sign in to report this listing.",
      currentReturnPath(),
    );
    bindLoginHandlers(opts.onAuthed);
    if (lede) lede.hidden = true;
    return;
  }

  if (openChallenge) {
    body.innerHTML = `<p class="muted">A listing challenge is already open · <a href="${href("/reviewers")}?tab=decisions">Vote</a></p>
      ${formHtml(false)}`;
  } else {
    body.innerHTML = formHtml(funderEligible);
  }

  wrap
    .querySelector<HTMLFormElement>("#listing-report-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const reason =
        wrap
          .querySelector<HTMLTextAreaElement>("#listing-report-reason")
          ?.value.trim() || "";
      const escalate = Boolean(
        wrap.querySelector<HTMLInputElement>("#listing-report-escalate")
          ?.checked,
      );
      if (reason.length < 8) {
        if (msg) {
          msg.hidden = false;
          msg.className = "builder-msg error";
          msg.textContent = "Reason must be at least 8 characters.";
        }
        return;
      }
      if (escalate && reason.length < 40) {
        if (msg) {
          msg.hidden = false;
          msg.className = "builder-msg error";
          msg.textContent =
            "Listing challenges need at least 40 characters of rationale.";
        }
        return;
      }
      if (msg) {
        msg.hidden = false;
        msg.className = "builder-msg";
        msg.textContent = "Submitting report…";
      }
      try {
        const result = await fileModerationReport({
          target_type: "listing",
          proposal_id: opts.proposalId!,
          proposal_path: opts.proposalPath,
          reason,
          escalate,
        });
        if (msg) {
          msg.className = "builder-msg success";
          msg.textContent =
            result.queue === "listing_challenge"
              ? `Challenge ballot opened (${result.decision_id}). Reviewers vote on /reviewers.`
              : "Report submitted to the reviewer inbox.";
        }
        body.innerHTML = `<p class="muted">${
          result.queue === "listing_challenge"
            ? `Ballot is live. <a href="${href("/reviewers")}?tab=decisions">Open decisions</a>`
            : `Thanks. Reviewers see this under <a href="${href("/reviewers")}?tab=reports">Reports</a>.`
        }</p>`;
      } catch (err) {
        const text = (err as Error).message;
        if (msg) {
          msg.className = "builder-msg error";
          msg.textContent =
            text === "login_required" ? "Sign in to report." : text;
        }
      }
    });
}
