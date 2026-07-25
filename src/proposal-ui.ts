import QRCode from "qrcode";
import { btnWithIcon, solidIcon } from "./icons";
import { BITCOIN_NETWORK, lightningUiAllowed } from "./config";
import {
  createLightningInvoice,
  fetchLightningStatus,
  fetchLightningSwap,
  weblnPay,
  type LightningStatus,
  type LightningSwapView,
} from "./lightning";
import type { Proposal, ProposalMilestone } from "./types";
import { escapeHtml, formatSats, themeQrColors } from "./util";

const MEMPOOL_WEB =
  BITCOIN_NETWORK === "signet"
    ? "https://mempool.space/signet"
    : "https://mempool.space";

const DONATE_PRESETS_SATS = [10_000, 50_000, 100_000, 500_000];
/** Boltz reverse-swap floors are typically ~25k; clamp LN presets at runtime. */
const LN_PRESETS_SATS = [25_000, 50_000, 100_000, 500_000];

export type DonateBindOpts = {
  address: string;
  proposalId: string | null;
  proposalPath: string;
};

export function bitcoinUri(address: string, amountSats?: number | null): string {
  if (amountSats != null && amountSats > 0) {
    const btc = (amountSats / 1e8).toFixed(8).replace(/\.?0+$/, "");
    return `bitcoin:${address}?amount=${btc}`;
  }
  return `bitcoin:${address}`;
}

export function formatProposalDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function statusClass(status: string): string {
  if (["listed", "claimable", "completed"].includes(status)) return "status-good";
  if (["claimed", "in_review", "funding"].includes(status)) return "status-active";
  if (["declined", "rejected", "underfunded"].includes(status)) return "status-bad";
  return "status-neutral";
}

/** Green to claim floor; glowing orange for overfunding beyond the floor. */
export function fundingBarTrackHtml(
  funded: number,
  floor: number,
  variant: "progress" | "proposal-progress" = "proposal-progress",
): string {
  const safeFloor = Math.max(1, floor);
  const over = funded > safeFloor;
  if (!over) {
    const pct = Math.min(100, Math.round((funded / safeFloor) * 100));
    return `<div class="${variant}" role="progressbar" aria-valuemin="0" aria-valuemax="${safeFloor}" aria-valuenow="${Math.round(funded)}"><span class="progress-floor" style="width:${pct}%"></span></div>`;
  }
  const greenPct = Math.max(0.5, (safeFloor / funded) * 100);
  const orangePct = Math.max(0, 100 - greenPct);
  return `<div class="${variant} is-overfunded" role="progressbar" aria-valuemin="0" aria-valuemax="${Math.round(funded)}" aria-valuenow="${Math.round(funded)}"><span class="progress-floor" style="width:${greenPct}%"></span><span class="progress-over" style="width:${orangePct}%"></span></div>`;
}

export function overfundRatioLabel(funded: number, floor: number): string {
  const ratio = funded / Math.max(1, floor);
  if (ratio < 1.05) return "";
  const pretty =
    ratio >= 100
      ? `${Math.round(ratio)}×`
      : ratio >= 10
        ? `${ratio.toFixed(0)}×`
        : `${ratio.toFixed(1)}×`;
  return `${pretty} claim floor`;
}

export function fundingProgressHtml(
  balance: number | undefined,
  floor: number,
  target: number | null,
): string {
  const funded = balance ?? 0;
  const claimable = funded >= floor;
  const over = funded > floor;
  const toFloorPct = Math.min(100, Math.round((funded / Math.max(1, floor)) * 100));
  const overLabel = overfundRatioLabel(funded, floor);
  const label = over
    ? `Overfunded · ${overLabel}`
    : claimable
      ? "Open to claim"
      : `${toFloorPct}% to claim floor`;
  const labelClass = over
    ? " overfunded"
    : claimable
      ? " claimable"
      : "";
  const goalLine = target != null && target > floor
    ? `${formatSats(funded)} / target ${formatSats(target)}`
    : `${formatSats(funded)} / ${formatSats(floor)} floor`;
  return `<div class="funding-meter">
      <div class="funding-meter-top">
        <span class="funding-meter-label${labelClass}">${label}</span>
        <span class="funding-meter-goal sats">${goalLine}</span>
      </div>
      ${fundingBarTrackHtml(funded, floor, "proposal-progress")}
    </div>`;
}

function fundingStatsHtml(
  balance: number | undefined,
  target: number | null,
  floor: number,
): string {
  return `<div class="proposal-stats">
      <div class="proposal-stat proposal-stat-primary">
        <span class="proposal-stat-label">Funded</span>
        <span class="proposal-stat-value sats">${balance != null ? formatSats(balance) : "—"}</span>
      </div>
      <div class="proposal-stat">
        <span class="proposal-stat-label">Claim floor</span>
        <span class="proposal-stat-value sats">${formatSats(floor)}</span>
      </div>
      ${
        target != null
          ? `<div class="proposal-stat">
        <span class="proposal-stat-label">Target</span>
        <span class="proposal-stat-value sats">${formatSats(target)}</span>
      </div>`
          : ""
      }
    </div>`;
}

/** Full-width funding summary — sits above proposal body, not in sidebar. */
export function proposalFundingBarHtml(
  balance: number | undefined,
  floor: number,
  target: number | null,
): string {
  return `<div class="proposal-funding-bar">
    ${fundingStatsHtml(balance, target, floor)}
    ${fundingProgressHtml(balance, floor, target)}
  </div>`;
}

function copyBtn(value: string, label: string): string {
  return `<button type="button" class="copy-btn" data-copy="${escapeHtml(value)}" title="Copy ${escapeHtml(label)}">Copy</button>`;
}

function explorerLink(href: string, label: string): string {
  return `<a class="explorer-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`;
}

/** Compact sidebar control — opens donate modal. */
export function donateTriggerHtml(): string {
  return `<div class="donate-trigger-card">
    <button type="button" class="btn donate-open-btn" id="donate-open">${btnWithIcon("bitcoin-sign", "Donate")}</button>
  </div>`;
}

/** Full donate flow inside a modal shell. */
export function donateModalHtml(p: Proposal): string {
  if (!p.escrow_address) return "";
  return `<div class="site-modal donate-modal" id="donate-modal" hidden>
    <div class="site-modal-backdrop" data-close-donate tabindex="-1" aria-hidden="true"></div>
    <div class="site-modal-card donate-modal-card" role="dialog" aria-modal="true" aria-labelledby="donate-modal-title">
      <button type="button" class="site-modal-close" id="donate-close" aria-label="Close">${solidIcon("xmark")}</button>
      ${donatePanelHtml(p)}
    </div>
  </div>`;
}

/** Prominent funder panel — Bitcoin on-chain and Lightning as equal rails. */
export function donatePanelHtml(p: Proposal): string {
  if (!p.escrow_address) return "";
  const addr = p.escrow_address;
  const networkNote =
    BITCOIN_NETWORK === "signet"
      ? `<p class="donate-network-note">This project is on <strong>signet</strong> — use a signet wallet for on-chain donations.</p>`
      : "";
  const onchainPresets = DONATE_PRESETS_SATS.map(
    (sats) =>
      `<button type="button" class="donate-preset" data-rail="onchain" data-sats="${sats}">${formatSats(sats)}</button>`,
  ).join("");
  const lnPresets = LN_PRESETS_SATS.map(
    (sats) =>
      `<button type="button" class="donate-preset" data-rail="ln" data-sats="${sats}">${formatSats(sats)}</button>`,
  ).join("");

  return `<div class="donate-panel" id="donate">
    <div class="donate-panel-head">
      <h2 class="donate-title" id="donate-modal-title">Donate</h2>
    </div>
    ${networkNote}
    <div class="donate-rails" role="tablist" aria-label="How to donate">
      <button type="button" class="donate-rail active" role="tab" aria-selected="true" data-tab="onchain" id="donate-rail-onchain">
        <span class="donate-rail-kicker">Bitcoin</span>
        <span class="donate-rail-name">On-chain</span>
      </button>
      <button type="button" class="donate-rail" role="tab" aria-selected="false" data-tab="lightning" id="donate-rail-lightning">
        <span class="donate-rail-kicker">Lightning</span>
        <span class="donate-rail-name">Invoice</span>
      </button>
    </div>

    <div class="donate-pane" data-pane="onchain" role="tabpanel" aria-labelledby="donate-rail-onchain">
      <div class="donate-qr-wrap">
        <img class="donate-qr" id="donate-qr" alt="QR code for donation address" width="168" height="168" />
      </div>
      <label class="donate-amount-label" for="donate-amount">Amount (optional, sats)</label>
      <div class="donate-amount-row">
        <input id="donate-amount" class="donate-amount mono" type="number" min="0" step="1000" placeholder="Any amount" />
      </div>
      <div class="donate-presets">${onchainPresets}<button type="button" class="donate-preset donate-preset-any" data-rail="onchain" data-sats="">Any</button></div>
      <code class="donate-address mono" id="donate-address" title="${escapeHtml(addr)}">${escapeHtml(addr)}</code>
      <div class="donate-actions">
        <button type="button" class="btn donate-copy" id="donate-copy" data-copy="${escapeHtml(addr)}">Copy address</button>
        <a class="btn ghost donate-wallet" id="donate-wallet" href="${escapeHtml(bitcoinUri(addr))}">Open wallet</a>
      </div>
      <a class="donate-explorer-link" href="${escapeHtml(`${MEMPOOL_WEB}/address/${encodeURIComponent(addr)}`)}" target="_blank" rel="noreferrer noopener">View on explorer</a>
    </div>

    <div class="donate-pane" data-pane="lightning" role="tabpanel" aria-labelledby="donate-rail-lightning" hidden>
      <div id="donate-ln-ready" hidden>
        <p class="donate-pane-intro">Reverse swap to escrow — fees apply.</p>
        <label class="donate-amount-label" for="donate-ln-amount">Amount (sats)</label>
        <div class="donate-amount-row">
          <input id="donate-ln-amount" class="donate-amount mono" type="number" min="25000" step="1000" placeholder="25000+" />
        </div>
        <div class="donate-presets donate-ln-presets">${lnPresets}</div>
        <p class="donate-ln-fee muted" id="donate-ln-fee" hidden></p>
        <div class="donate-actions donate-ln-create-row">
          <button type="button" class="btn" id="donate-ln-create">Create Lightning invoice</button>
        </div>
        <div class="donate-ln-invoice" id="donate-ln-invoice" hidden>
          <div class="donate-qr-wrap donate-qr-wrap-ln">
            <img class="donate-qr" id="donate-ln-qr" alt="QR code for Lightning invoice" width="168" height="168" />
          </div>
          <code class="donate-address mono" id="donate-ln-bolt11"></code>
          <div class="donate-actions">
            <button type="button" class="btn donate-copy" id="donate-ln-copy">Copy invoice</button>
            <button type="button" class="btn ghost" id="donate-ln-webln" hidden>Pay with WebLN</button>
          </div>
          <p class="donate-ln-status" id="donate-ln-status" aria-live="polite"></p>
        </div>
        <p class="donate-ln-error error" id="donate-ln-error" hidden></p>
      </div>
      <div id="donate-ln-unavailable" class="donate-ln-unavailable">
        <p class="donate-ln-wait muted" id="donate-ln-wait">Checking availability…</p>
      </div>
    </div>
  </div>`;
}

async function bindOnchainDonate(
  panel: Element,
  address: string,
): Promise<void> {
  const qrImg = panel.querySelector<HTMLImageElement>("#donate-qr");
  const amountInput = panel.querySelector<HTMLInputElement>("#donate-amount");
  const walletLink = panel.querySelector<HTMLAnchorElement>("#donate-wallet");
  const copyBtnEl = panel.querySelector<HTMLButtonElement>("#donate-copy");

  const sync = async (sats: number | null) => {
    const uri = bitcoinUri(address, sats);
    if (walletLink) walletLink.href = uri;
    if (qrImg) {
      try {
        qrImg.src = await QRCode.toDataURL(uri, {
          width: 168,
          margin: 1,
          color: themeQrColors(),
        });
      } catch {
        /* ignore */
      }
    }
  };

  await sync(null);

  amountInput?.addEventListener("input", () => {
    const n = Number(amountInput.value);
    void sync(Number.isFinite(n) && n > 0 ? Math.floor(n) : null);
  });

  panel.querySelectorAll<HTMLButtonElement>('.donate-preset[data-rail="onchain"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = btn.dataset.sats ?? "";
      panel
        .querySelectorAll('.donate-preset[data-rail="onchain"]')
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (!raw) {
        if (amountInput) amountInput.value = "";
        void sync(null);
        return;
      }
      if (amountInput) amountInput.value = raw;
      void sync(Number(raw));
    });
  });

  copyBtnEl?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(address);
      const prev = copyBtnEl.textContent;
      copyBtnEl.textContent = "Copied";
      copyBtnEl.classList.add("copied");
      setTimeout(() => {
        copyBtnEl.textContent = prev;
        copyBtnEl.classList.remove("copied");
      }, 1400);
    } catch {
      /* ignore */
    }
  });
}

function estimateLnCredit(status: LightningStatus, invoiceSats: number): {
  feeSats: number;
  expectedOnchain: number;
} | null {
  if (!status.fees) return null;
  const service = Math.ceil((invoiceSats * status.fees.percentage) / 100);
  const feeSats = service + status.fees.minerFees.claim;
  return {
    feeSats,
    expectedOnchain: Math.max(0, invoiceSats - feeSats),
  };
}

function selectDonateRail(panel: Element, name: "onchain" | "lightning"): void {
  panel.querySelectorAll<HTMLButtonElement>(".donate-rail").forEach((rail) => {
    const on = rail.dataset.tab === name;
    rail.classList.toggle("active", on);
    rail.setAttribute("aria-selected", on ? "true" : "false");
  });
  panel.querySelectorAll<HTMLElement>(".donate-pane").forEach((pane) => {
    pane.hidden = pane.dataset.pane !== name;
  });
}

function bindDonateRails(panel: Element): void {
  panel.querySelectorAll<HTMLButtonElement>(".donate-rail").forEach((rail) => {
    rail.addEventListener("click", () => {
      const name = rail.dataset.tab === "lightning" ? "lightning" : "onchain";
      selectDonateRail(panel, name);
    });
  });
  if (/(?:^|[?&])(?:rail=lightning|donate=ln)(?:&|$)/.test(location.search)) {
    selectDonateRail(panel, "lightning");
  }
}

function setLightningUnavailable(panel: Element, reason: string): void {
  const ready = panel.querySelector<HTMLElement>("#donate-ln-ready");
  const unavail = panel.querySelector<HTMLElement>("#donate-ln-unavailable");
  const wait = panel.querySelector<HTMLElement>("#donate-ln-wait");
  if (ready) ready.hidden = true;
  if (unavail) unavail.hidden = false;
  if (wait) wait.textContent = reason;
  panel
    .querySelector<HTMLButtonElement>("#donate-rail-lightning")
    ?.classList.add("donate-rail-limited");
}

function setLightningReady(panel: Element): void {
  const ready = panel.querySelector<HTMLElement>("#donate-ln-ready");
  const unavail = panel.querySelector<HTMLElement>("#donate-ln-unavailable");
  if (ready) ready.hidden = false;
  if (unavail) unavail.hidden = true;
  panel
    .querySelector<HTMLButtonElement>("#donate-rail-lightning")
    ?.classList.remove("donate-rail-limited");
}

function bindLightningDonate(
  panel: Element,
  opts: DonateBindOpts,
  status: LightningStatus,
): void {
  setLightningReady(panel);

  const amountInput = panel.querySelector<HTMLInputElement>("#donate-ln-amount");
  const feeEl = panel.querySelector<HTMLElement>("#donate-ln-fee");
  const createBtn = panel.querySelector<HTMLButtonElement>("#donate-ln-create");
  const invoiceWrap = panel.querySelector<HTMLElement>("#donate-ln-invoice");
  const qrImg = panel.querySelector<HTMLImageElement>("#donate-ln-qr");
  const bolt11El = panel.querySelector<HTMLElement>("#donate-ln-bolt11");
  const copyBtn = panel.querySelector<HTMLButtonElement>("#donate-ln-copy");
  const weblnBtn = panel.querySelector<HTMLButtonElement>("#donate-ln-webln");
  const statusEl = panel.querySelector<HTMLElement>("#donate-ln-status");
  const errorEl = panel.querySelector<HTMLElement>("#donate-ln-error");

  const min = status.limits?.minimal ?? 25_000;
  if (amountInput) {
    amountInput.min = String(min);
    amountInput.placeholder = `${min}+`;
  }

  // Drop presets below Boltz minimum
  panel.querySelectorAll<HTMLButtonElement>('.donate-preset[data-rail="ln"]').forEach((btn) => {
    const sats = Number(btn.dataset.sats);
    if (Number.isFinite(sats) && sats < min) btn.hidden = true;
  });

  const updateFeeHint = () => {
    if (!feeEl || !amountInput) return;
    const n = Math.floor(Number(amountInput.value));
    if (!Number.isFinite(n) || n <= 0) {
      feeEl.hidden = true;
      return;
    }
    const est = estimateLnCredit(status, n);
    if (!est) {
      feeEl.hidden = true;
      return;
    }
    feeEl.hidden = false;
    feeEl.textContent = `Est. escrow credit ~${formatSats(est.expectedOnchain)} after ~${formatSats(est.feeSats)} fees`;
  };

  amountInput?.addEventListener("input", updateFeeHint);

  panel.querySelectorAll<HTMLButtonElement>('.donate-preset[data-rail="ln"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = btn.dataset.sats ?? "";
      panel
        .querySelectorAll('.donate-preset[data-rail="ln"]')
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (amountInput && raw) amountInput.value = raw;
      updateFeeHint();
    });
  });

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const stopPoll = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const setError = (msg: string | null) => {
    if (!errorEl) return;
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  };

  const renderSwap = async (swap: LightningSwapView) => {
    if (invoiceWrap) invoiceWrap.hidden = false;
    if (bolt11El) {
      bolt11El.textContent = swap.bolt11;
      bolt11El.title = swap.bolt11;
    }
    if (qrImg) {
      try {
        qrImg.src = await QRCode.toDataURL(swap.bolt11.toUpperCase(), {
          width: 168,
          margin: 1,
          color: themeQrColors(),
        });
      } catch {
        /* ignore */
      }
    }
    if (weblnBtn) {
      weblnBtn.hidden = !(
        window as Window & { webln?: unknown }
      ).webln;
    }
    if (feeEl) {
      feeEl.hidden = false;
      feeEl.textContent = `Invoice ${formatSats(swap.invoice_amount_sats)} → escrow ~${formatSats(swap.expected_onchain_sats)} (fees ~${formatSats(swap.fee_sats)})`;
    }
    if (statusEl) {
      const map: Record<string, string> = {
        pending: "Waiting for Lightning payment…",
        invoice_paid: "Invoice paid — claiming to escrow…",
        claiming: "Broadcasting claim to escrow…",
        settled: swap.claim_txid
          ? `Settled on-chain. Claim tx: ${swap.claim_txid.slice(0, 12)}…`
          : "Settled on-chain.",
        failed: swap.error || "Swap failed.",
        expired: "Invoice expired. Create a new one.",
      };
      statusEl.textContent = map[swap.status] || swap.status;
      const live = ["pending", "invoice_paid", "claiming"].includes(swap.status);
      statusEl.classList.toggle("live", live);
      statusEl.classList.toggle("ok", swap.status === "settled");
      statusEl.classList.toggle(
        "bad",
        swap.status === "failed" || swap.status === "expired",
      );
    }
  };

  const startPoll = (swapId: string) => {
    stopPoll();
    pollTimer = setInterval(() => {
      void (async () => {
        try {
          const swap = await fetchLightningSwap(swapId);
          await renderSwap(swap);
          if (["settled", "failed", "expired"].includes(swap.status)) {
            stopPoll();
          }
        } catch {
          /* keep polling */
        }
      })();
    }, 4000);
  };

  createBtn?.addEventListener("click", async () => {
    setError(null);
    stopPoll();
    const amount = Math.floor(Number(amountInput?.value));
    if (!Number.isFinite(amount) || amount < min) {
      setError(`Enter at least ${formatSats(min)}.`);
      return;
    }
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.textContent = "Creating…";
    }
    try {
      const swap = await createLightningInvoice({
        proposal_id: opts.proposalId,
        proposal_path: opts.proposalPath,
        escrow_address: opts.address,
        amount_sats: amount,
      });
      await renderSwap(swap);
      startPoll(swap.swap_id);
    } catch (e) {
      setError((e as Error).message);
      if (invoiceWrap) invoiceWrap.hidden = true;
    } finally {
      if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = "Create Lightning invoice";
      }
    }
  });

  copyBtn?.addEventListener("click", async () => {
    const text = bolt11El?.textContent?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const prev = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = prev;
      }, 1400);
    } catch {
      /* ignore */
    }
  });

  weblnBtn?.addEventListener("click", async () => {
    const bolt11 = bolt11El?.textContent?.trim();
    if (!bolt11) return;
    setError(null);
    try {
      await weblnPay(bolt11);
      if (statusEl) statusEl.textContent = "Payment sent — waiting for settle…";
    } catch (e) {
      setError((e as Error).message || "WebLN payment failed");
    }
  });
}

export async function bindDonatePanel(
  root: ParentNode,
  opts: DonateBindOpts | string,
): Promise<void> {
  const panel = root.querySelector("#donate");
  if (!panel) return;

  const normalized: DonateBindOpts =
    typeof opts === "string"
      ? { address: opts, proposalId: null, proposalPath: "" }
      : opts;

  bindDonateRails(panel);
  await bindOnchainDonate(panel, normalized.address);

  if (!normalized.proposalPath) {
    setLightningUnavailable(
      panel,
      "Lightning needs a listed project path. Use on-chain for now.",
    );
    return;
  }

  if (!lightningUiAllowed()) {
    setLightningUnavailable(
      panel,
      BITCOIN_NETWORK === "signet"
        ? "Lightning isn’t available on signet. Use Bitcoin on-chain."
        : "Lightning isn’t available right now. Use Bitcoin on-chain.",
    );
    return;
  }

  const status = await fetchLightningStatus();
  if (!status.enabled) {
    setLightningUnavailable(
      panel,
      status.reason ||
        "Lightning reverse swaps are unavailable right now. Use Bitcoin on-chain.",
    );
    return;
  }
  bindLightningDonate(panel, normalized, status);
}

export function bindDonateModal(
  root: ParentNode,
  opts?: { open?: boolean; rail?: "onchain" | "lightning" },
): void {
  const modal = root.querySelector<HTMLElement>("#donate-modal");
  const openBtn = root.querySelector<HTMLButtonElement>("#donate-open");
  const closeBtn = root.querySelector<HTMLButtonElement>("#donate-close");
  const backdrop = root.querySelector<HTMLElement>("[data-close-donate]");
  const panel = root.querySelector("#donate");

  const open = () => {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    if (opts?.rail === "lightning" && panel) {
      selectDonateRail(panel, "lightning");
    }
    closeBtn?.focus();
    window.addEventListener("keydown", onEscape);
  };

  const close = () => {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    window.removeEventListener("keydown", onEscape);
    openBtn?.focus();
  };

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && modal && !modal.hidden) close();
  };

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  if (opts?.open) open();
}

export function onChainPanelHtml(p: Proposal): string {
  const rows: string[] = [];

  if (p.escrow_address) {
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Escrow address</span>
      <div class="onchain-value">
        <code class="mono">${escapeHtml(p.escrow_address)}</code>
        <span class="onchain-actions">
          ${explorerLink(`${MEMPOOL_WEB}/address/${encodeURIComponent(p.escrow_address)}`, "Explorer")}
          ${copyBtn(p.escrow_address, "address")}
        </span>
      </div>
    </div>`);
  }

  if (p.submission_fee_txid) {
    const tx = p.submission_fee_txid;
    const short = `${tx.slice(0, 8)}…${tx.slice(-8)}`;
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Submission fee</span>
      <div class="onchain-value">
        <code class="mono" title="${escapeHtml(tx)}">${escapeHtml(short)}</code>
        <span class="onchain-actions">
          ${explorerLink(`${MEMPOOL_WEB}/tx/${tx}`, "Explorer")}
          ${copyBtn(tx, "txid")}
        </span>
      </div>
    </div>`);
  }

  if (p.escrow_index != null) {
    rows.push(`<div class="onchain-row onchain-row-inline">
      <span class="onchain-label">Escrow index</span>
      <span class="onchain-inline-value">${escapeHtml(String(p.escrow_index))}</span>
    </div>`);
  }

  if (!rows.length) return "";
  return `<div class="onchain-panel">${rows.join("")}</div>`;
}

export function metaChipsHtml(p: Proposal): string {
  const chips: string[] = [];
  if (p.id) {
    chips.push(`<span class="meta-chip"><span class="meta-chip-k">ID</span>${escapeHtml(p.id)}</span>`);
  }
  const created = formatProposalDate(p.created_at);
  if (created) {
    chips.push(`<span class="meta-chip"><span class="meta-chip-k">Created</span>${escapeHtml(created)}</span>`);
  }
  if (!chips.length) return "";
  return `<div class="meta-chips">${chips.join("")}</div>`;
}

export function milestonesHtml(milestones: ProposalMilestone[]): string {
  if (!milestones.length) return "";
  return `<div class="milestones">
    <h3 class="milestones-title">Milestones</h3>
    <div class="milestone-list">${milestones
      .map(
        (m, i) => `<article class="milestone-card">
          <div class="milestone-head">
            <span class="milestone-num">${i + 1}</span>
            <span class="milestone-sats sats">${formatSats(m.allocation_sats)}</span>
          </div>
          <p class="milestone-deadline">${escapeHtml(m.deadline)}</p>
          <p class="milestone-text">${escapeHtml(m.deliverable)}</p>
        </article>`,
      )
      .join("")}</div>
  </div>`;
}

function verificationStepsHtml(body: string): string | null {
  const items = body
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^\d+\.\s+/, "").trim());
  if (items.length < 2) return null;
  return `<ol class="verify-steps">${items
    .map((item) => `<li>${linkifyInline(item)}</li>`)
    .join("")}</ol>`;
}

function linkifyInline(text: string): string {
  return escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>',
  );
}

export function sectionBodyHtml(title: string, body: string, renderMd: (s: string) => string): string {
  const key = title.toLowerCase();
  if (key === "verification") {
    const steps = verificationStepsHtml(body);
    if (steps) return steps;
  }
  return `<div class="prose-rich">${renderMd(body)}</div>`;
}

export function bindProposalCopyButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.dataset.copy;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      } catch {
        /* ignore */
      }
    });
  });
}
