import {
  addWatch,
  claimWindowDaysLeft,
  fetchClaimStatus,
  isOpenToClaim,
  removeWatch,
  submitClaim,
  submitDeliverable,
  type ClaimStatus,
} from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import { githubLoginUrl } from "./auth";
import type { AuthUser } from "./auth";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

export function builderPanelHtml(
  p: Proposal,
  balance: number | undefined,
  watching: boolean,
): string {
  const floor = CLAIM_FLOOR_SATS;
  const bal = balance ?? p.balance_sats ?? 0;
  const need = Math.max(0, floor - bal);
  const open = isOpenToClaim({ ...p, balance_sats: bal }, floor);

  return `<div class="builder-panel" id="builder">
    <div class="builder-panel-head">
      <h2 class="builder-title">Build</h2>
      <p class="builder-lede">Watch to follow funding. Claiming locks the work exclusively after a git PR merges — watching does not reserve it.</p>
    </div>
    <div class="builder-actions">
      <button type="button" class="btn ghost" id="builder-watch" data-watching="${watching ? "1" : "0"}">${watching ? "Watching" : "Watch"}</button>
    </div>
    <div id="builder-body" class="builder-body">
      ${
        open
          ? `<p class="builder-status">Open to claim — confirmed funding meets the ${formatSats(floor)} floor.</p>
             <button type="button" class="btn" id="builder-claim">Claim this project</button>`
          : need > 0
            ? `<p class="builder-status">Needs ${formatSats(need)} more confirmed sats to reach the claim floor.</p>
               <button type="button" class="btn" id="builder-claim" disabled>Claim this project</button>`
            : `<p class="builder-status muted">Loading claim status…</p>`
      }
    </div>
    <p class="builder-msg" id="builder-msg" hidden></p>
    <div class="builder-modal" id="builder-claim-modal" hidden>
      <div class="builder-modal-card">
        <h3>Claim this project</h3>
        <p>Exclusive for 90 days after the claim PR merges. First merge wins. Provide a Bitcoin payout address.</p>
        <label class="donate-amount-label" for="claim-payout">Payout address</label>
        <input id="claim-payout" class="donate-amount mono" type="text" placeholder="bc1… or tb1…" />
        <label class="donate-amount-label" for="claim-note">Note (optional)</label>
        <input id="claim-note" class="donate-amount" type="text" maxlength="200" placeholder="Short note for reviewers" />
        <div class="donate-actions">
          <button type="button" class="btn" id="claim-confirm">Open claim PR</button>
          <button type="button" class="btn ghost" id="claim-cancel">Cancel</button>
        </div>
      </div>
    </div>
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

function renderStatusBody(
  body: HTMLElement,
  status: ClaimStatus,
  user: AuthUser | null,
): void {
  const days = claimWindowDaysLeft(status.claimed_at);
  const isYou =
    user &&
    status.claimer &&
    (status.claimer === user.username ||
      status.claimer === user.github ||
      status.claimer === user.id);

  switch (status.state) {
    case "open":
      body.innerHTML = `<p class="builder-status">Open to claim — confirmed funding meets the floor.</p>
        <button type="button" class="btn" id="builder-claim">Claim this project</button>`;
      break;
    case "below_floor": {
      const need = Math.max(
        0,
        status.claim_floor_sats - (status.confirmed_balance_sats ?? 0),
      );
      body.innerHTML = `<p class="builder-status">Needs ${formatSats(need)} more confirmed sats to reach the claim floor.</p>
        <button type="button" class="btn" id="builder-claim" disabled>Claim this project</button>`;
      break;
    }
    case "claim_pending":
      body.innerHTML = `<p class="builder-status">Claim pending review${
        status.pending?.pr_url
          ? ` — <a href="${escapeHtml(status.pending.pr_url)}" target="_blank" rel="noreferrer">view PR</a>`
          : ""
      }. Exclusive lock starts when the PR merges.</p>`;
      break;
    case "claimed":
      if (isYou) {
        body.innerHTML = `<p class="builder-status">You claimed this project${
          days != null ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""
        }.</p>
        <button type="button" class="btn" id="builder-deliverable">Submit deliverable</button>
        <div id="deliverable-form" class="deliverable-form" hidden>
          <label class="donate-amount-label" for="deliv-url">Deliverable URL</label>
          <input id="deliv-url" class="donate-amount" type="url" placeholder="https://…" />
          <label class="donate-amount-label" for="deliv-desc">Description</label>
          <textarea id="deliv-desc" class="donate-amount" rows="3" placeholder="What to review…"></textarea>
          <label class="donate-amount-label" for="deliv-hash">Artifact hash (optional)</label>
          <input id="deliv-hash" class="donate-amount mono" type="text" />
          <button type="button" class="btn" id="deliv-submit">Open deliverable PR</button>
        </div>`;
      } else {
        body.innerHTML = `<p class="builder-status">Claimed by <strong>${escapeHtml(
          status.claimer || "another builder",
        )}</strong>${
          days != null ? ` · ${days} day${days === 1 ? "" : "s"} left in window` : ""
        }. Opens again if the claim expires.</p>`;
      }
      break;
    case "in_review":
      body.innerHTML = `<p class="builder-status">In review${
        status.claimer
          ? ` · fulfiller ${escapeHtml(status.claimer)}`
          : ""
      }.${
        status.pending
          ? ""
          : ""
      }</p>`;
      break;
    case "completed":
      body.innerHTML = `<p class="builder-status">Completed${
        status.claimer ? ` · ${escapeHtml(status.claimer)}` : ""
      }.</p>`;
      break;
    default:
      body.innerHTML = `<p class="builder-status muted">Not available for claim.</p>`;
  }
}

export async function bindBuilderPanel(
  root: ParentNode,
  opts: {
    proposal: Proposal;
    balance?: number;
    user: AuthUser | null;
    watching: boolean;
  },
): Promise<void> {
  const panel = root.querySelector("#builder");
  if (!panel) return;
  const body = panel.querySelector<HTMLElement>("#builder-body");
  const msg = panel.querySelector<HTMLElement>("#builder-msg");
  const watchBtn = panel.querySelector<HTMLButtonElement>("#builder-watch");
  const modal = panel.querySelector<HTMLElement>("#builder-claim-modal");
  const payoutInput = panel.querySelector<HTMLInputElement>("#claim-payout");
  const noteInput = panel.querySelector<HTMLInputElement>("#claim-note");

  if (payoutInput && opts.user?.payout_address) {
    payoutInput.value = opts.user.payout_address;
  }

  const requireLogin = () => {
    location.href = githubLoginUrl(location.hash || "#/");
  };

  watchBtn?.addEventListener("click", async () => {
    if (!opts.user) {
      requireLogin();
      return;
    }
    try {
      const watching = watchBtn.dataset.watching === "1";
      if (watching) {
        await removeWatch(opts.proposal.path);
        watchBtn.dataset.watching = "0";
        watchBtn.textContent = "Watch";
        setMsg(msg, "Removed from your watch list.");
      } else {
        await addWatch(opts.proposal.path);
        watchBtn.dataset.watching = "1";
        watchBtn.textContent = "Watching";
        setMsg(msg, "Watching — this does not reserve the bounty.");
      }
    } catch (e) {
      if ((e as Error).message === "login_required") requireLogin();
      else setMsg(msg, (e as Error).message, "error");
    }
  });

  const bindClaimButton = () => {
    panel.querySelector<HTMLButtonElement>("#builder-claim")?.addEventListener(
      "click",
      () => {
        if (!opts.user) {
          requireLogin();
          return;
        }
        if (modal) modal.hidden = false;
      },
    );
  };
  bindClaimButton();

  panel.querySelector("#claim-cancel")?.addEventListener("click", () => {
    if (modal) modal.hidden = true;
  });

  panel.querySelector("#claim-confirm")?.addEventListener("click", async () => {
    if (!opts.user) {
      requireLogin();
      return;
    }
    const payout = payoutInput?.value.trim() || "";
    if (!payout) {
      setMsg(msg, "Enter a payout address.", "error");
      return;
    }
    setMsg(msg, "Opening claim PR…");
    try {
      const result = await submitClaim({
        proposal_path: opts.proposal.path,
        payout_address: payout,
        note: noteInput?.value.trim() || undefined,
      });
      if (modal) modal.hidden = true;
      setMsg(
        msg,
        `Claim PR opened. Exclusive after merge: ${result.pr_url}`,
        "success",
      );
      const status = await fetchClaimStatus(opts.proposal.path);
      if (status && body) {
        renderStatusBody(body, status, opts.user);
        bindClaimButton();
        bindDeliverable();
      }
    } catch (e) {
      if ((e as Error).message === "login_required") requireLogin();
      else setMsg(msg, (e as Error).message, "error");
    }
  });

  const bindDeliverable = () => {
    panel
      .querySelector("#builder-deliverable")
      ?.addEventListener("click", () => {
        const form = panel.querySelector<HTMLElement>("#deliverable-form");
        if (form) form.hidden = !form.hidden;
      });
    panel.querySelector("#deliv-submit")?.addEventListener("click", async () => {
      const url = (
        panel.querySelector("#deliv-url") as HTMLInputElement | null
      )?.value.trim();
      const description = (
        panel.querySelector("#deliv-desc") as HTMLTextAreaElement | null
      )?.value.trim();
      const hash = (
        panel.querySelector("#deliv-hash") as HTMLInputElement | null
      )?.value.trim();
      if (!url || !description) {
        setMsg(msg, "URL and description required.", "error");
        return;
      }
      setMsg(msg, "Opening deliverable PR…");
      try {
        const result = await submitDeliverable({
          proposal_path: opts.proposal.path,
          deliverable_url: url,
          description,
          artifact_hash: hash || undefined,
        });
        setMsg(msg, `Deliverable PR opened: ${result.pr_url}`, "success");
      } catch (e) {
        if ((e as Error).message === "login_required") requireLogin();
        else setMsg(msg, (e as Error).message, "error");
      }
    });
  };

  try {
    const status = await fetchClaimStatus(opts.proposal.path);
    if (status && body) {
      renderStatusBody(body, status, opts.user);
      bindClaimButton();
      bindDeliverable();
    }
  } catch {
    /* keep static HTML */
  }
}
