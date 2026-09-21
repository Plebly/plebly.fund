import {
  claimContribution,
  loadStoredCreditPreferences,
  type CreditPreferences,
} from "./funder-credit";
import type { PublicDonation } from "./donations-page";
import { href } from "./router";
import { escapeHtml } from "./util";

const OUTPOINT_RE = /^([0-9a-fA-F]{64}):(\d+)$/;

export function parseDonationOutpoint(
  id: string,
): { txid: string; vout: number } | null {
  const m = OUTPOINT_RE.exec(String(id || "").trim());
  if (!m) return null;
  return { txid: m[1]!, vout: Number(m[2]) };
}

/** Unlinked confirmed project outpoints are eligible for POST /contributions/claim. */
export function donationIsClaimable(d: PublicDonation): boolean {
  if (d.target_type !== "project") return false;
  if (!parseDonationOutpoint(d.id)) return false;
  if (d.claimable === true) return true;
  // Legacy API rows (pre-claimable field): anonymous + no display ≈ unlinked.
  if (d.claimable == null && d.anonymous && !d.donor_display) return true;
  return false;
}

export function donationClaimActionHtml(
  d: PublicDonation,
  opts: { signedIn: boolean },
): string {
  if (!donationIsClaimable(d)) return "";
  if (!opts.signedIn) {
    return `<p class="donations-claim-hint muted"><a href="${href("/account")}">Sign in</a> to claim credit for this gift.</p>`;
  }
  return `<button type="button" class="btn ghost donations-claim-btn" data-claim-donation="${escapeHtml(d.id)}" data-claim-proposal="${escapeHtml(d.target_id)}" data-claim-amount="${d.amount_sats}">Claim this donation</button>
    <p class="donations-claim-msg muted" hidden></p>`;
}

function defaultClaimPrefs(): CreditPreferences {
  return (
    loadStoredCreditPreferences() || {
      public_credit: true,
      anonymous: false,
      show_amount: false,
    }
  );
}

/**
 * Event delegation for Recent donations / ledger claim buttons.
 * Returns true when the click was handled.
 */
export async function handleDonationClaimClick(
  ev: Event,
  opts?: { onLinked?: (donationId: string) => void },
): Promise<boolean> {
  const btn = (ev.target as HTMLElement | null)?.closest?.<HTMLButtonElement>(
    "[data-claim-donation]",
  );
  if (!btn || btn.disabled) return false;
  const donationId = btn.dataset.claimDonation || "";
  const proposalId = btn.dataset.claimProposal || "";
  const out = parseDonationOutpoint(donationId);
  if (!out || !proposalId) return false;

  const row = btn.closest("li") || btn.parentElement;
  const msg = row?.querySelector<HTMLElement>(".donations-claim-msg");
  const setMsg = (text: string, bad = false) => {
    if (!msg) return;
    msg.hidden = false;
    msg.className = bad ? "donations-claim-msg muted error" : "donations-claim-msg muted";
    msg.textContent = text;
  };

  btn.disabled = true;
  setMsg("Linking funder credit…");
  try {
    await claimContribution({
      proposal_id: proposalId,
      txid: out.txid,
      vout: out.vout,
      ...defaultClaimPrefs(),
    });
    setMsg("Credit linked — you can flag as a confirmed donor.");
    btn.remove();
    opts?.onLinked?.(donationId);
  } catch (e) {
    setMsg((e as Error).message || "Could not link this donation.", true);
    btn.disabled = false;
  }
  return true;
}

export function bindDonationClaimActions(
  root: ParentNode,
  opts?: { onLinked?: (donationId: string) => void },
): void {
  const handler = (ev: Event) => {
    void handleDonationClaimClick(ev, opts);
  };
  root.querySelectorAll<HTMLElement>("[data-claim-donation]").forEach((btn) => {
    btn.addEventListener("click", handler);
  });
}
