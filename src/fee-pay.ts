import QRCode from "qrcode";
import { BITCOIN_NETWORK } from "./config";
import { watchNewUtxos } from "./funder-credit";
import { signetPayNoteHtml } from "./signet";
import { bitcoinUri, escapeHtml, formatSats, themeQrColors } from "./util";

const MEMPOOL_WEB =
  BITCOIN_NETWORK === "signet"
    ? "https://mempool.space/signet"
    : "https://mempool.space";

export type FeePayOpts = {
  /** Unique prefix for element ids (e.g. propose-fee, claim-bond). */
  id: string;
  amountSats: number;
  address: string | null;
  /** Shown under the amount, e.g. refund note for claim bond. */
  note?: string;
  /** Name attribute for the txid input when inside a form. */
  txidName?: string;
  /** Start on the txid step if a value is already present. */
  initialTxid?: string;
};

function networkLabel(): string {
  return BITCOIN_NETWORK === "signet" ? "signet" : "mainnet";
}

/**
 * Step-by-step on-chain fee payment (submission fee / claim bond).
 * Auto-detects a new exact-amount payment; manual txid paste is the fallback.
 */
export function feePayHtml(opts: FeePayOpts): string {
  const net = networkLabel();
  const amount = formatSats(opts.amountSats);
  const addr = opts.address?.trim() || "";
  const hasAddr = Boolean(addr);
  const nameAttr = opts.txidName
    ? ` name="${escapeHtml(opts.txidName)}"`
    : "";
  const initial = opts.initialTxid
    ? escapeHtml(opts.initialTxid)
    : "";

  const payBody = hasAddr
    ? `<div class="fee-pay-qr-wrap">
        <img class="donate-qr" id="${escapeHtml(opts.id)}-qr" alt="QR code for fee payment" width="168" height="168" />
      </div>
      <p class="fee-pay-amount-line">Send exactly <strong class="sats">${escapeHtml(amount)}</strong> on <strong>${escapeHtml(net)}</strong></p>
      ${signetPayNoteHtml("fee")}
      ${opts.note ? `<p class="fee-pay-note">${opts.note}</p>` : ""}
      <code class="donate-address mono" id="${escapeHtml(opts.id)}-address" title="${escapeHtml(addr)}">${escapeHtml(addr)}</code>
      <div class="donate-actions">
        <button type="button" class="btn" id="${escapeHtml(opts.id)}-copy" data-copy="${escapeHtml(addr)}">Copy address</button>
        <a class="btn ghost" id="${escapeHtml(opts.id)}-wallet" href="${escapeHtml(bitcoinUri(addr, opts.amountSats))}">Open wallet</a>
      </div>
      <a class="donate-explorer-link" href="${escapeHtml(`${MEMPOOL_WEB}/address/${encodeURIComponent(addr)}`)}" target="_blank" rel="noreferrer noopener">View on explorer</a>
      <p class="fee-pay-hint muted" id="${escapeHtml(opts.id)}-hint">Payment is detected automatically.</p>
      <p class="fee-pay-status" id="${escapeHtml(opts.id)}-status" aria-live="polite" hidden></p>
      <div class="fee-pay-nav">
        <button type="button" class="btn ghost" id="${escapeHtml(opts.id)}-manual">Enter txid manually</button>
      </div>`
    : `<p class="fee-pay-amount-line">Send exactly <strong class="sats">${escapeHtml(amount)}</strong> on <strong>${escapeHtml(net)}</strong> to the published fee address.</p>
      ${signetPayNoteHtml("fee")}
      ${opts.note ? `<p class="fee-pay-note">${opts.note}</p>` : ""}
      <p class="field-hint">Fee address is not available from the API yet. Pay using the published address, then continue.</p>
      <div class="fee-pay-nav">
        <button type="button" class="btn ghost" id="${escapeHtml(opts.id)}-manual">Enter txid manually</button>
      </div>`;

  return `<div class="fee-pay" id="${escapeHtml(opts.id)}" data-amount="${opts.amountSats}" data-address="${escapeHtml(addr)}">
    <ol class="fee-pay-progress" aria-label="Fee payment steps">
      <li class="fee-pay-progress-item is-current" data-progress="pay">
        <span class="fee-pay-progress-num">1</span>
        <span>Send fee</span>
      </li>
      <li class="fee-pay-progress-item" data-progress="txid">
        <span class="fee-pay-progress-num">2</span>
        <span>Confirm</span>
      </li>
    </ol>

    <div class="fee-pay-step" data-step="pay" id="${escapeHtml(opts.id)}-step-pay">
      <h4 class="fee-pay-step-title">1. Send the fee</h4>
      ${payBody}
    </div>

    <div class="fee-pay-step" data-step="txid" id="${escapeHtml(opts.id)}-step-txid" hidden>
      <h4 class="fee-pay-step-title" id="${escapeHtml(opts.id)}-txid-title">2. Confirm payment</h4>
      <p class="fee-pay-note" id="${escapeHtml(opts.id)}-txid-note">Paste the 64-character txid if automatic detection missed it.</p>
      <label class="donate-amount-label" for="${escapeHtml(opts.id)}-txid">Transaction id</label>
      <input id="${escapeHtml(opts.id)}-txid"${nameAttr} class="donate-amount mono" type="text" pattern="[0-9a-fA-F]{64}" maxlength="64" placeholder="64-character transaction id" value="${initial}" autocomplete="off" spellcheck="false" />
      <div class="fee-pay-nav">
        <button type="button" class="btn ghost" id="${escapeHtml(opts.id)}-back">Back</button>
      </div>
    </div>
  </div>`;
}

export type FeePayBinding = {
  root: HTMLElement;
  txidInput: HTMLInputElement;
  getTxid: () => string;
  setStep: (step: "pay" | "txid") => void;
  setAmount: (sats: number) => Promise<void>;
  stop: () => void;
};

function setFeeStatus(
  el: HTMLElement | null,
  message: string | null,
  kind?: "ok" | "live" | "bad",
): void {
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("ok", "live", "bad");
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("live", kind === "live");
  el.classList.toggle("bad", kind === "bad");
}

/** Wire QR, copy, wallet link, auto-detect, and manual txid fallback. */
export async function bindFeePay(
  root: ParentNode,
  id: string,
  hooks?: { onStep?: (step: "pay" | "txid") => void },
): Promise<FeePayBinding | null> {
  const el = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  if (!el) return null;

  const stepPay = el.querySelector<HTMLElement>(`#${CSS.escape(id)}-step-pay`);
  const stepTxid = el.querySelector<HTMLElement>(`#${CSS.escape(id)}-step-txid`);
  const txidInput = el.querySelector<HTMLInputElement>(`#${CSS.escape(id)}-txid`);
  const qrImg = el.querySelector<HTMLImageElement>(`#${CSS.escape(id)}-qr`);
  const walletLink = el.querySelector<HTMLAnchorElement>(`#${CSS.escape(id)}-wallet`);
  const copyBtn = el.querySelector<HTMLButtonElement>(`#${CSS.escape(id)}-copy`);
  const manualBtn = el.querySelector<HTMLButtonElement>(`#${CSS.escape(id)}-manual`);
  const backBtn = el.querySelector<HTMLButtonElement>(`#${CSS.escape(id)}-back`);
  const statusEl = el.querySelector<HTMLElement>(`#${CSS.escape(id)}-status`);
  const hintEl = el.querySelector<HTMLElement>(`#${CSS.escape(id)}-hint`);
  const txidTitle = el.querySelector<HTMLElement>(`#${CSS.escape(id)}-txid-title`);
  const txidNote = el.querySelector<HTMLElement>(`#${CSS.escape(id)}-txid-note`);
  const progressItems = el.querySelectorAll<HTMLElement>("[data-progress]");

  if (!txidInput || !stepPay || !stepTxid) return null;

  let amountSats = Number(el.dataset.amount || "0");
  const address = el.dataset.address || "";
  let detected = false;
  let stopWatch: (() => void) | null = null;

  const setStep = (step: "pay" | "txid") => {
    const onPay = step === "pay";
    stepPay.hidden = !onPay;
    stepTxid.hidden = onPay;
    progressItems.forEach((item) => {
      const key = item.dataset.progress;
      item.classList.toggle("is-current", key === step);
      item.classList.toggle("is-done", key === "pay" && step === "txid");
    });
    if (!onPay && !detected) txidInput.focus();
    hooks?.onStep?.(step);
  };

  const markDetected = (txid: string, confirmed: boolean) => {
    detected = true;
    txidInput.value = txid;
    if (hintEl) hintEl.hidden = true;
    setFeeStatus(
      statusEl,
      confirmed
        ? `Fee payment detected · ${formatSats(amountSats)}`
        : `Fee payment seen · confirming…`,
      confirmed ? "ok" : "live",
    );
    if (txidTitle) txidTitle.textContent = "2. Payment detected";
    if (txidNote) {
      txidNote.textContent = confirmed
        ? "Ready — you can submit. Edit the txid only if this isn’t your payment."
        : "Txid filled from mempool. You can submit once it confirms, or wait.";
    }
    setStep("txid");
  };

  const syncWalletQr = async (sats: number) => {
    amountSats = sats;
    el.dataset.amount = String(sats);
    if (!address) return;
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

  if (address && amountSats > 0) {
    await syncWalletQr(amountSats);
    const watcher = watchNewUtxos(
      address,
      (utxos) => {
        if (detected) return;
        const match = utxos.find((u) => u.value === amountSats);
        if (!match) return;
        markDetected(match.txid, Boolean(match.status?.confirmed));
      },
      { intervalMs: 6_000 },
    );
    stopWatch = watcher.stop;
  }

  copyBtn?.addEventListener("click", async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      const prev = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = prev;
        copyBtn.classList.remove("copied");
      }, 1400);
    } catch {
      /* ignore */
    }
  });

  manualBtn?.addEventListener("click", () => {
    if (hintEl) hintEl.hidden = true;
    setFeeStatus(statusEl, null);
    if (txidTitle) txidTitle.textContent = "2. Paste transaction id";
    if (txidNote) {
      txidNote.textContent =
        "After your wallet broadcasts, copy the 64-character txid and paste it here.";
    }
    setStep("txid");
  });
  backBtn?.addEventListener("click", () => {
    detected = false;
    if (hintEl) hintEl.hidden = false;
    setFeeStatus(statusEl, null);
    setStep("pay");
  });

  if (txidInput.value.trim().length === 64) {
    setStep("txid");
  }

  return {
    root: el,
    txidInput,
    getTxid: () => txidInput.value.trim(),
    setStep,
    setAmount: syncWalletQr,
    stop: () => {
      stopWatch?.();
      stopWatch = null;
    },
  };
}
