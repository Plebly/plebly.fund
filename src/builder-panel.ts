import {
  addWatch,
  claimWindowDaysLeft,
  fetchClaimParams,
  fetchClaimStatus,
  isOpenToClaim,
  removeWatch,
  submitAbandonedChallenge,
  submitCheckpoint,
  submitClaim,
  submitDeliverable,
  type ClaimParams,
  type ClaimStatus,
} from "./builder";
import { CLAIM_BOND_SATS, CLAIM_FLOOR_SATS } from "./config";
import { githubLoginUrl } from "./auth";
import type { AuthUser } from "./auth";
import { btnWithIcon, solidIcon } from "./icons";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

function watchBtnHtml(watching: boolean): string {
  return watching
    ? btnWithIcon("eye-slash", "Unwatch")
    : btnWithIcon("eye", "Watch");
}

function claimBtnHtml(disabled = false): string {
  return `<button type="button" class="btn" id="builder-claim"${disabled ? " disabled" : ""}>${btnWithIcon("handshake", "Claim this project")}</button>`;
}

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
    </div>
    <div class="builder-actions">
      <button type="button" class="btn ghost" id="builder-watch" data-watching="${watching ? "1" : "0"}">${watchBtnHtml(watching)}</button>
    </div>
    <div id="builder-body" class="builder-body">
      ${
        open
          ? claimBtnHtml()
          : need > 0
            ? `<p class="builder-status">Needs ${formatSats(need)} more confirmed sats to reach the claim floor.</p>
               ${claimBtnHtml(true)}`
            : `<p class="builder-status muted">Loading claim status…</p>`
      }
    </div>
    <p class="builder-msg" id="builder-msg" hidden></p>
    <div class="site-modal" id="builder-claim-modal" hidden>
      <div class="site-modal-backdrop" data-close-claim tabindex="-1" aria-hidden="true"></div>
      <div class="site-modal-card builder-claim-card" role="dialog" aria-modal="true" aria-labelledby="claim-modal-title">
        <button type="button" class="site-modal-close" id="claim-close" aria-label="Close">${solidIcon("xmark")}</button>
        <h3 id="claim-modal-title">Claim this project</h3>
        <p>Exclusive for 90 days after merge. One active claim per identity. Bond refunded on completion; forfeited on expiry or abandoned checkpoint.</p>
        <p class="builder-bond-hint muted" id="claim-bond-hint">Send claim bond of ${formatSats(CLAIM_BOND_SATS)} to the submission-fee address (refunded on completion).</p>
        <label class="donate-amount-label" for="claim-payout">Payout address</label>
        <input id="claim-payout" class="donate-amount mono" type="text" placeholder="bc1… or tb1…" />
        <label class="donate-amount-label" for="claim-bond-txid">Claim bond txid</label>
        <input id="claim-bond-txid" class="donate-amount mono" type="text" maxlength="64" placeholder="64-char txid" />
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

function setWatchBtn(btn: HTMLButtonElement, watching: boolean): void {
  btn.dataset.watching = watching ? "1" : "0";
  btn.innerHTML = watchBtnHtml(watching);
}

function metaBits(status: ClaimStatus): string {
  const bits: string[] = [];
  if (status.proposer_claimed) {
    bits.push(`<span class="pill pill-status status-active">Proposer-claimed</span>`);
  }
  if (status.claim_bond_txid) {
    bits.push(
      `<span class="builder-meta">Bond locked · <code class="mono">${escapeHtml(status.claim_bond_txid.slice(0, 12))}…</code></span>`,
    );
  }
  if (status.checkpoint_due_at) {
    const due = new Date(status.checkpoint_due_at).toLocaleDateString();
    bits.push(
      status.checkpoint_url
        ? `<span class="builder-meta">Checkpoint filed</span>`
        : `<span class="builder-meta">Checkpoint due ${escapeHtml(due)}</span>`,
    );
  }
  return bits.length
    ? `<div class="builder-meta-row">${bits.join(" ")}</div>`
    : "";
}

function renderStatusBody(
  body: HTMLElement,
  status: ClaimStatus,
  user: AuthUser | null,
  proposalPath: string,
): void {
  const days = claimWindowDaysLeft(status.claimed_at);
  const isYou =
    user &&
    status.claimer &&
    (status.claimer === user.username ||
      status.claimer === user.github ||
      status.claimer === user.id);
  const meta = metaBits(status);

  switch (status.state) {
    case "open":
      body.innerHTML = claimBtnHtml();
      break;
    case "below_floor": {
      const need = Math.max(
        0,
        status.claim_floor_sats - (status.confirmed_balance_sats ?? 0),
      );
      body.innerHTML = `<p class="builder-status">Needs ${formatSats(need)} more confirmed sats to reach the claim floor.</p>
        ${claimBtnHtml(true)}`;
      break;
    }
    case "claim_pending":
      body.innerHTML = `${meta}<p class="builder-status">Claim pending${
        status.pending?.pr_url
          ? ` — <a href="${escapeHtml(status.pending.pr_url)}" target="_blank" rel="noreferrer">PR</a>`
          : ""
      }. Exclusive after merge.</p>`;
      break;
    case "claimed":
      if (isYou) {
        body.innerHTML = `${meta}<p class="builder-status">You claimed this project${
          days != null ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""
        }.</p>
        <div class="builder-claim-tools">
          <button type="button" class="btn ghost" id="builder-checkpoint">File checkpoint</button>
          <button type="button" class="btn" id="builder-deliverable">Submit deliverable</button>
        </div>
        <div id="checkpoint-form" class="deliverable-form" hidden>
          <label class="donate-amount-label" for="checkpoint-url">Progress URL</label>
          <input id="checkpoint-url" class="donate-amount" type="url" placeholder="https://…" />
          <button type="button" class="btn" id="checkpoint-submit">Save checkpoint</button>
        </div>
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
        body.innerHTML = `${meta}<p class="builder-status">Claimed by <strong>${escapeHtml(
          status.claimer || "another builder",
        )}</strong>${
          days != null ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""
        }.</p>
        <button type="button" class="btn ghost" id="builder-challenge" data-path="${escapeHtml(proposalPath)}">Challenge as abandoned</button>`;
      }
      break;
    case "in_review":
      body.innerHTML = `${meta}<p class="builder-status">In review${
        status.claimer ? ` · fulfiller ${escapeHtml(status.claimer)}` : ""
      }.</p>`;
      break;
    case "completed":
      body.innerHTML = `${meta}<p class="builder-status">Completed${
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
  const bondInput = panel.querySelector<HTMLInputElement>("#claim-bond-txid");
  const bondHint = panel.querySelector<HTMLElement>("#claim-bond-hint");

  let params: ClaimParams = {
    claim_bond_sats: CLAIM_BOND_SATS,
    max_active_claims: 1,
    reclaim_cooldown_days: 30,
    checkpoint_day: 45,
    checkpoint_grace_days: 7,
    fee_address: null,
  };
  try {
    params = await fetchClaimParams();
    if (bondHint) {
      const addr = params.fee_address
        ? ` to <code class="mono">${escapeHtml(params.fee_address)}</code>`
        : " to the submission-fee address";
      bondHint.innerHTML = `Send claim bond of <strong>${formatSats(params.claim_bond_sats)}</strong>${addr} (same as submission fee; refunded on completion).`;
    }
  } catch {
    /* defaults */
  }

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
        setWatchBtn(watchBtn, false);
        setMsg(msg, null);
      } else {
        await addWatch(opts.proposal.path);
        setWatchBtn(watchBtn, true);
        setMsg(msg, null);
      }
    } catch (e) {
      if ((e as Error).message === "login_required") requireLogin();
      else setMsg(msg, (e as Error).message, "error");
    }
  });

  const refreshStatus = async () => {
    const status = await fetchClaimStatus(opts.proposal.path);
    if (status && body) {
      renderStatusBody(body, status, opts.user, opts.proposal.path);
      bindClaimButton();
      bindDeliverable();
      bindCheckpoint();
      bindChallenge();
    }
  };

  const closeClaimModal = () => {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    window.removeEventListener("keydown", onClaimEscape);
  };

  const onClaimEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeClaimModal();
  };

  const openClaimModal = () => {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", onClaimEscape);
    panel.querySelector<HTMLButtonElement>("#claim-close")?.focus();
  };

  const bindClaimButton = () => {
    panel.querySelector<HTMLButtonElement>("#builder-claim")?.addEventListener(
      "click",
      () => {
        if (!opts.user) {
          requireLogin();
          return;
        }
        openClaimModal();
      },
    );
  };
  bindClaimButton();

  panel.querySelector("#claim-cancel")?.addEventListener("click", closeClaimModal);
  panel.querySelector("#claim-close")?.addEventListener("click", closeClaimModal);
  panel
    .querySelector("[data-close-claim]")
    ?.addEventListener("click", closeClaimModal);

  panel.querySelector("#claim-confirm")?.addEventListener("click", async () => {
    if (!opts.user) {
      requireLogin();
      return;
    }
    const payout = payoutInput?.value.trim() || "";
    const bond = bondInput?.value.trim() || "";
    if (!payout) {
      setMsg(msg, "Enter a payout address.", "error");
      return;
    }
    if (!bond || bond.length !== 64) {
      setMsg(msg, "Enter the 64-character claim bond txid.", "error");
      return;
    }
    setMsg(msg, "Opening claim PR…");
    try {
      const result = await submitClaim({
        proposal_path: opts.proposal.path,
        payout_address: payout,
        note: noteInput?.value.trim() || undefined,
        claim_bond_txid: bond,
      });
      closeClaimModal();
      setMsg(
        msg,
        `Claim PR opened (bond ${formatSats(result.bond_sats || params.claim_bond_sats)}). Exclusive after merge: ${result.pr_url}`,
        "success",
      );
      await refreshStatus();
    } catch (e) {
      if ((e as Error).message === "login_required") requireLogin();
      else setMsg(msg, (e as Error).message, "error");
    }
  });

  const bindCheckpoint = () => {
    panel.querySelector("#builder-checkpoint")?.addEventListener("click", () => {
      const form = panel.querySelector<HTMLElement>("#checkpoint-form");
      if (form) form.hidden = !form.hidden;
    });
    panel.querySelector("#checkpoint-submit")?.addEventListener("click", async () => {
      const url = (
        panel.querySelector("#checkpoint-url") as HTMLInputElement | null
      )?.value.trim();
      if (!url?.startsWith("https://")) {
        setMsg(msg, "Checkpoint URL must be https://", "error");
        return;
      }
      try {
        await submitCheckpoint({
          proposal_path: opts.proposal.path,
          url,
        });
        setMsg(msg, "Checkpoint saved.", "success");
        await refreshStatus();
      } catch (e) {
        if ((e as Error).message === "login_required") requireLogin();
        else setMsg(msg, (e as Error).message, "error");
      }
    });
  };

  const bindChallenge = () => {
    panel.querySelector("#builder-challenge")?.addEventListener("click", async () => {
      if (!opts.user) {
        requireLogin();
        return;
      }
      const reason = window.prompt(
        "Why is this claim abandoned? (visible in challenge PR)",
        "No progress / missed checkpoint",
      );
      if (reason == null) return;
      setMsg(msg, "Opening abandoned-claim challenge…");
      try {
        const result = await submitAbandonedChallenge({
          proposal_path: opts.proposal.path,
          reason: reason.trim() || undefined,
        });
        setMsg(
          msg,
          result.pr_url
            ? `Challenge opened: ${result.pr_url}`
            : "Challenge recorded.",
          "success",
        );
      } catch (e) {
        if ((e as Error).message === "login_required") requireLogin();
        else setMsg(msg, (e as Error).message, "error");
      }
    });
  };

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
    await refreshStatus();
  } catch {
    /* keep static HTML */
  }
}
