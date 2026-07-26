import QRCode from "qrcode";
import { BITCOIN_NETWORK } from "./config";
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
 * Step-by-step on-chain fee payment (submission fee / claim bond),
 * patterned after the donate flow: QR → copy / open wallet → paste txid.
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
      ${opts.note ? `<p class="fee-pay-note">${opts.note}</p>` : ""}
      <code class="donate-address mono" id="${escapeHtml(opts.id)}-address" title="${escapeHtml(addr)}">${escapeHtml(addr)}</code>
      <div class="donate-actions">
        <button type="button" class="btn" id="${escapeHtml(opts.id)}-copy" data-copy="${escapeHtml(addr)}">Copy address</button>
        <a class="btn ghost" id="${escapeHtml(opts.id)}-wallet" href="${escapeHtml(bitcoinUri(addr, opts.amountSats))}">Open wallet</a>
      </div>
      <a class="donate-explorer-link" href="${escapeHtml(`${MEMPOOL_WEB}/address/${encodeURIComponent(addr)}`)}" target="_blank" rel="noreferrer noopener">View on explorer</a>
      <div class="fee-pay-nav">
        <button type="button" class="btn" id="${escapeHtml(opts.id)}-next">I've sent it</button>
      </div>`
    : `<p class="fee-pay-amount-line">Send exactly <strong class="sats">${escapeHtml(amount)}</strong> on <strong>${escapeHtml(net)}</strong> to the published fee address.</p>
      ${opts.note ? `<p class="fee-pay-note">${opts.note}</p>` : ""}
      <p class="field-hint">Fee address is not available from the API yet. Pay using the published address, then continue.</p>
      <div class="fee-pay-nav">
        <button type="button" class="btn" id="${escapeHtml(opts.id)}-next">I've sent it</button>
      </div>`;

  return `<div class="fee-pay" id="${escapeHtml(opts.id)}" data-amount="${opts.amountSats}" data-address="${escapeHtml(addr)}">
    <ol class="fee-pay-progress" aria-label="Fee payment steps">
      <li class="fee-pay-progress-item is-current" data-progress="pay">
        <span class="fee-pay-progress-num">1</span>
        <span>Send fee</span>
      </li>
      <li class="fee-pay-progress-item" data-progress="txid">
        <span class="fee-pay-progress-num">2</span>
        <span>Paste txid</span>
      </li>
    </ol>

    <div class="fee-pay-step" data-step="pay" id="${escapeHtml(opts.id)}-step-pay">
      <h4 class="fee-pay-step-title">1. Send the fee</h4>
      ${payBody}
    </div>

    <div class="fee-pay-step" data-step="txid" id="${escapeHtml(opts.id)}-step-txid" hidden>
      <h4 class="fee-pay-step-title">2. Paste the transaction id</h4>
      <p class="fee-pay-note">After your wallet broadcasts, copy the 64-character txid and paste it here.</p>
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
};

/** Wire QR, copy, wallet link, and step navigation. */
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
  const nextBtn = el.querySelector<HTMLButtonElement>(`#${CSS.escape(id)}-next`);
  const backBtn = el.querySelector<HTMLButtonElement>(`#${CSS.escape(id)}-back`);
  const progressItems = el.querySelectorAll<HTMLElement>("[data-progress]");

  if (!txidInput || !stepPay || !stepTxid) return null;

  let amountSats = Number(el.dataset.amount || "0");
  const address = el.dataset.address || "";

  const setStep = (step: "pay" | "txid") => {
    const onPay = step === "pay";
    stepPay.hidden = !onPay;
    stepTxid.hidden = onPay;
    progressItems.forEach((item) => {
      const key = item.dataset.progress;
      item.classList.toggle("is-current", key === step);
      item.classList.toggle("is-done", key === "pay" && step === "txid");
    });
    if (!onPay) txidInput.focus();
    hooks?.onStep?.(step);
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

  nextBtn?.addEventListener("click", () => setStep("txid"));
  backBtn?.addEventListener("click", () => setStep("pay"));

  if (txidInput.value.trim().length === 64) {
    setStep("txid");
  }

  return {
    root: el,
    txidInput,
    getTxid: () => txidInput.value.trim(),
    setStep,
    setAmount: syncWalletQr,
  };
}
