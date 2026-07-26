import { loginChoicesHtml, type AuthUser } from "./auth";
import {
  fetchOpenReviewDecision,
  openListingChallenge,
  type ReviewDecisionView,
} from "./reviewers";
import { href } from "./router";
import { escapeHtml } from "./util";

const CHALLENGEABLE = new Set(["listed", "funding", "claimable"]);

export function listingChallengePanelHtml(
  status: string,
  proposalPath: string,
): string {
  if (!CHALLENGEABLE.has(status)) return "";
  return `<div class="listing-challenge-panel" id="listing-challenge" data-path="${escapeHtml(proposalPath)}">
    <h3 class="review-panel-title">Challenge listing</h3>
    <p class="muted" id="listing-challenge-status">Eligible funders may open a reviewer ballot to decline this listing for documented reasons.</p>
    <div id="listing-challenge-body"></div>
    <p class="builder-msg" id="listing-challenge-msg" hidden></p>
  </div>`;
}

export async function bindListingChallengePanel(
  root: ParentNode,
  opts: {
    proposalId: string | null | undefined;
    proposalPath: string;
    status: string;
    user: AuthUser | null;
  },
): Promise<void> {
  const panel = root.querySelector<HTMLElement>("#listing-challenge");
  if (!panel || !CHALLENGEABLE.has(opts.status) || !opts.proposalId) return;

  const statusEl = panel.querySelector<HTMLElement>("#listing-challenge-status");
  const body = panel.querySelector<HTMLElement>("#listing-challenge-body");
  const msg = panel.querySelector<HTMLElement>("#listing-challenge-msg");
  if (!body) return;

  let open: ReviewDecisionView | null = null;
  try {
    open = await fetchOpenReviewDecision(opts.proposalId);
  } catch {
    open = null;
  }

  if (open?.kind === "listing_challenge" && open.status === "open") {
    if (statusEl) {
      statusEl.textContent = `Listing challenge open · closes ${new Date(open.closes_at).toLocaleDateString()} · ${open.counts.yes} yes / ${open.counts.no} no`;
    }
    body.innerHTML = `<p class="muted">Reviewers vote on the <a href="${href("/reviewers")}#decisions">governance page</a>.</p>`;
    return;
  }

  if (!opts.user) {
    body.innerHTML = loginChoicesHtml(
      "Sign in as an eligible funder to challenge this listing.",
    );
    return;
  }

  body.innerHTML = `<form id="listing-challenge-form" class="gov-form">
    <label class="field"><span>Rationale (min 40 characters)</span>
      <textarea id="listing-challenge-rationale" rows="3" required minlength="40" maxlength="4000" placeholder="Cite why this listing should be declined…"></textarea>
    </label>
    <div class="form-actions">
      <button type="submit" class="btn ghost">Open listing challenge</button>
    </div>
  </form>`;

  panel
    .querySelector<HTMLFormElement>("#listing-challenge-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rationale = panel
        .querySelector<HTMLTextAreaElement>("#listing-challenge-rationale")
        ?.value.trim();
      if (!rationale || rationale.length < 40) {
        if (msg) {
          msg.hidden = false;
          msg.className = "builder-msg error";
          msg.textContent = "Rationale must be at least 40 characters.";
        }
        return;
      }
      if (msg) {
        msg.hidden = false;
        msg.className = "builder-msg";
        msg.textContent = "Opening listing challenge…";
      }
      try {
        const d = await openListingChallenge({
          proposal_path: opts.proposalPath,
          rationale,
        });
        if (msg) {
          msg.className = "builder-msg success";
          msg.textContent = `Challenge opened (${d.id}). Reviewers vote on /reviewers.`;
        }
        if (statusEl) {
          statusEl.textContent = `Listing challenge open · closes ${new Date(d.closes_at).toLocaleDateString()}`;
        }
        body.innerHTML = `<p class="muted">Ballot is live. Vote from <a href="${href("/reviewers")}#decisions">governance</a>.</p>`;
      } catch (err) {
        const text = (err as Error).message;
        if (msg) {
          msg.className = "builder-msg error";
          msg.textContent =
            text === "login_required"
              ? "Sign in to open a listing challenge."
              : text;
        }
      }
    });
}
