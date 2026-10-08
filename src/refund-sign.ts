/**
 * Refund by signing a message: an on-chain donor proves they sent a gift by
 * signing `plebly-refund|<pid>|<txid>:<vout>|<user_id>` with the P2WPKH
 * address they paid from. The Worker checks it at refund registration
 * (`/refunds/register` with `vin_address` + `signature_b64`).
 *
 * Shown only on a refunding proposal; the message only to a signed-in donor.
 * Copy is UI UX's; server text never reaches the page.
 */
import { authFetch, bindLoginHandlers, loginChoicesHtml } from "./auth";
import { addressHrp, BITCOIN_NETWORK, escrowAddressMatchesNetwork, networkLabel, WORKERS_API } from "./config";
import { payoutInvalidReason } from "./payout-destination";
import { escapeHtml } from "./util";

/** Stable anchor so other refund lines (Donate modal) can link here. */
export const REFUND_SIGN_ANCHOR = "signed-refund";

export const REFUND_SIGN_COPY = {
  heading: "Refund by signing a message",
  intro:
    "Prove you sent this gift by signing the message below with the address you paid from. This works only with single-key (P2WPKH) addresses. Exchanges and multisig wallets can't do it.",
  signedOut: "Sign in to get the message to sign.",
  signIn: "Sign in",
  fromLabel: "Address you sent from",
  fromInvalid: "This address type can't sign a refund message.",
  messageLabel: "Message to sign",
  copy: "Copy",
  copied: "Copied.",
  signatureLabel: "Signature",
  signatureHint: "Paste the signature your wallet shows after signing.",
  signatureUnsupported:
    "This wallet's signature format isn't supported yet. Electrum and Sparrow can sign this message.",
  toLabel: "Refund to",
  submit: "Register",
  badSignature:
    "That signature doesn't match this address and message. Sign the exact message above with the address you sent from.",
  notFundingInput: "That address didn't send this gift.",
  // Existing refund-panel lines, reused (no new copy).
  needOutpoint: "Enter the funding txid (and vout).",
  badVout: "Enter a valid vout (integer ≥ 0).",
  registered: "Refund address registered — track under Account → Funds.",
  packageError: "Address saved, but payout setup failed — try Register again.",
  needRefundTo: "Enter a refund address.",
  failed: "Couldn’t register the refund. Try again.",
} as const;

/** Exactly the Worker's `refundVinMessage` for an on-chain outpoint. */
export function refundSignMessage(input: {
  proposalId: string | null | undefined;
  txid: string | null | undefined;
  vout: number | null | undefined;
  userId: string | null | undefined;
}): string | null {
  const pid = (input.proposalId || "").trim();
  const txid = (input.txid || "").trim();
  const uid = (input.userId || "").trim();
  const vout = input.vout;
  if (!pid || !txid || !uid) return null;
  if (typeof vout !== "number" || !Number.isInteger(vout) || vout < 0) return null;
  return `plebly-refund|${pid}|${txid}:${vout}|${uid}`;
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= gen[i]!;
  }
  return chk >>> 0;
}

/**
 * True only for a P2WPKH address on this network: bech32 (not bech32m),
 * witness version 0, a 20-byte program. A P2WSH address (also `…1q`, but a
 * 32-byte program and longer) and P2TR are refused.
 */
export function isP2wpkhAddress(raw: string, network: string = BITCOIN_NETWORK): boolean {
  const s = raw.trim();
  if (!s || (s !== s.toLowerCase() && s !== s.toUpperCase())) return false;
  const lower = s.toLowerCase();
  const hrp = addressHrp(network).slice(0, 2);
  if (!lower.startsWith(`${hrp}1`)) return false;
  const data: number[] = [];
  for (const ch of lower.slice(hrp.length + 1)) {
    const v = BECH32_CHARSET.indexOf(ch);
    if (v < 0) return false;
    data.push(v);
  }
  if (data.length < 7) return false;
  const hrpExpand = [
    ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
    0,
    ...[...hrp].map((c) => c.charCodeAt(0) & 31),
  ];
  if (bech32Polymod([...hrpExpand, ...data]) !== 1) return false;
  const words = data.slice(0, -6);
  if (words[0] !== 0) return false;
  // 5-bit groups → bytes.
  let acc = 0;
  let bits = 0;
  const prog: number[] = [];
  for (const w of words.slice(1)) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      prog.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return false;
  return prog.length === 20;
}

/**
 * The Worker verifies a 65-byte compact signature whose header is 27-34
 * (Electrum, Sparrow) or 39-42 (BIP-137 P2WPKH). Anything else (BIP-322,
 * BIP-137 P2SH-P2WPKH 35-38, 43+) is refused before sending.
 */
export function signatureFormatSupported(b64: string): boolean {
  let bin: string;
  try {
    bin = atob(b64.replace(/\s+/g, ""));
  } catch {
    return false;
  }
  if (bin.length !== 65) return false;
  const h = bin.charCodeAt(0);
  return (h >= 27 && h <= 34) || (h >= 39 && h <= 42);
}

/** `/refunds/register` body; the vin proof fields only when both are filled. */
export function buildRefundRegisterBody(input: {
  proposal_id: string;
  txid: string;
  vout: number;
  refund_address: string;
  vin_address?: string | null;
  signature_b64?: string | null;
}): Record<string, string | number> {
  const body: Record<string, string | number> = {
    proposal_id: input.proposal_id,
    txid: input.txid,
    vout: input.vout,
    refund_address: input.refund_address,
  };
  const vin = (input.vin_address || "").trim();
  const sig = (input.signature_b64 || "").replace(/\s+/g, "");
  if (vin && sig) {
    body.vin_address = vin;
    body.signature_b64 = sig;
  }
  return body;
}

/**
 * Map the Worker's machine values to UI copy. The Worker answers vin-proof
 * failures with `code: "refund_bind_required"` and a fixed `error` constant
 * (`contrib.ts` applyVinRefundProof); nothing from the body is shown.
 */
export function refundSignErrorCopy(body: { error?: unknown; code?: unknown } | null): string {
  if (body && body.code === "refund_bind_required") {
    if (body.error === "invalid refund signature") return REFUND_SIGN_COPY.badSignature;
    if (body.error === "vin_address is not a funding input") return REFUND_SIGN_COPY.notFundingInput;
  }
  return REFUND_SIGN_COPY.failed;
}

/** Refund-to must be an on-chain address on this network. */
export function refundToInvalidReason(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const reason = payoutInvalidReason(s);
  if (reason) return reason;
  if (!escrowAddressMatchesNetwork(s)) {
    return `Invalid ${networkLabel()} bech32 receive address (${addressHrp()}…).`;
  }
  return null;
}

export function refundSignHtml(signedIn: boolean): string {
  const c = REFUND_SIGN_COPY;
  const head = `<h4 class="refund-sign-title">${escapeHtml(c.heading)}</h4>`;
  if (!signedIn) {
    return `<section class="refund-sign" id="${REFUND_SIGN_ANCHOR}" data-signed-in="0">
      ${head}
      <p class="muted" id="refund-sign-signedout">${escapeHtml(c.signedOut)}</p>
      <button type="button" class="btn" id="refund-sign-signin">${escapeHtml(c.signIn)}</button>
      <div id="refund-sign-login" hidden></div>
    </section>`;
  }
  return `<section class="refund-sign" id="${REFUND_SIGN_ANCHOR}" data-signed-in="1">
    ${head}
    <p class="muted refund-sign-intro">${escapeHtml(c.intro)}</p>
    <label class="donate-amount-label" for="refund-sign-from">${escapeHtml(c.fromLabel)}</label>
    <input id="refund-sign-from" class="donate-amount mono" type="text" autocomplete="off" spellcheck="false" aria-describedby="refund-sign-from-error" />
    <p class="muted error" id="refund-sign-from-error" hidden></p>
    <label class="donate-amount-label" for="refund-sign-message">${escapeHtml(c.messageLabel)}</label>
    <textarea id="refund-sign-message" class="donate-amount mono" rows="3" readonly></textarea>
    <div class="refund-sign-copy-row">
      <button type="button" class="btn ghost" id="refund-sign-copy" disabled>${escapeHtml(c.copy)}</button>
      <span class="muted" id="refund-sign-copied" role="status" hidden>${escapeHtml(c.copied)}</span>
    </div>
    <label class="donate-amount-label" for="refund-sign-signature">${escapeHtml(c.signatureLabel)}</label>
    <textarea id="refund-sign-signature" class="donate-amount mono" rows="2" spellcheck="false" aria-describedby="refund-sign-signature-hint"></textarea>
    <p class="muted" id="refund-sign-signature-hint">${escapeHtml(c.signatureHint)}</p>
    <label class="donate-amount-label" for="refund-sign-to">${escapeHtml(c.toLabel)}</label>
    <input id="refund-sign-to" class="donate-amount mono" type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(addressHrp())}…" />
    <p class="muted error" id="refund-sign-to-error" hidden></p>
    <button type="button" class="btn" id="refund-sign-submit">${escapeHtml(c.submit)}</button>
    <p class="muted" id="refund-sign-msg" hidden></p>
  </section>`;
}

/**
 * Wire the section. Reads the funding txid / vout from the on-chain refund
 * fields above it (`#refund-txid`, `#refund-vout`).
 */
export function bindRefundSign(
  root: ParentNode,
  opts: {
    proposalId: string | null;
    status: string | null | undefined;
    userId: string | null;
    onRegistered?: () => void;
    onAuthed?: () => void;
  },
): void {
  const host = root.querySelector<HTMLElement>(`#${REFUND_SIGN_ANCHOR}`);
  if (!host) return;
  if (opts.status !== "refunding" || !opts.proposalId) {
    host.remove();
    return;
  }
  if (!opts.userId) {
    host.querySelector("#refund-sign-signin")?.addEventListener("click", () => {
      const login = host.querySelector<HTMLElement>("#refund-sign-login");
      if (!login) return;
      login.hidden = false;
      login.innerHTML = loginChoicesHtml(undefined, `${location.pathname}#${REFUND_SIGN_ANCHOR}`);
      if (opts.onAuthed) bindLoginHandlers(opts.onAuthed);
      login.querySelector<HTMLElement>("a, button")?.focus();
    });
    return;
  }
  const c = REFUND_SIGN_COPY;
  const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel);
  const from = q<HTMLInputElement>("#refund-sign-from");
  const fromErr = q<HTMLElement>("#refund-sign-from-error");
  const messageEl = q<HTMLTextAreaElement>("#refund-sign-message");
  const copyBtn = q<HTMLButtonElement>("#refund-sign-copy");
  const copied = q<HTMLElement>("#refund-sign-copied");
  const sigEl = q<HTMLTextAreaElement>("#refund-sign-signature");
  const toEl = q<HTMLInputElement>("#refund-sign-to");
  const toErr = q<HTMLElement>("#refund-sign-to-error");
  const submit = q<HTMLButtonElement>("#refund-sign-submit");
  const msg = q<HTMLElement>("#refund-sign-msg");

  const outpoint = () => {
    const txid = (root.querySelector<HTMLInputElement>("#refund-txid")?.value || "").trim();
    const voutRaw = (root.querySelector<HTMLInputElement>("#refund-vout")?.value || "").trim();
    const vout = voutRaw === "" ? NaN : Number(voutRaw);
    return { txid, vout };
  };
  const currentMessage = () => {
    const { txid, vout } = outpoint();
    return refundSignMessage({ proposalId: opts.proposalId, txid, vout, userId: opts.userId });
  };
  const syncMessage = () => {
    const m = currentMessage() || "";
    if (messageEl && messageEl.value !== m) {
      messageEl.value = m;
      if (copied) copied.hidden = true;
    }
    if (copyBtn) copyBtn.disabled = !m;
  };
  const showFieldError = (el: HTMLElement | null, text: string | null) => {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
  };
  const show = (text: string, cls = "") => {
    if (!msg) return;
    msg.hidden = false;
    msg.className = cls ? `muted ${cls}` : "muted";
    msg.textContent = text;
  };

  for (const sel of ["#refund-txid", "#refund-vout"]) {
    root.querySelector(sel)?.addEventListener("input", syncMessage);
    root.querySelector(sel)?.addEventListener("change", syncMessage);
  }
  syncMessage();

  from?.addEventListener("input", () => {
    const v = from.value.trim();
    showFieldError(fromErr, v && !isP2wpkhAddress(v) ? c.fromInvalid : null);
  });
  toEl?.addEventListener("input", () => {
    showFieldError(toErr, refundToInvalidReason(toEl.value));
  });

  copyBtn?.addEventListener("click", async () => {
    const m = messageEl?.value || "";
    if (!m) return;
    try {
      await navigator.clipboard.writeText(m);
      if (copied) copied.hidden = false;
    } catch {
      if (copied) copied.hidden = true;
    }
  });

  submit?.addEventListener("click", async () => {
    const { txid, vout } = outpoint();
    if (!txid) return show(c.needOutpoint, "error");
    if (!Number.isInteger(vout) || vout < 0) return show(c.badVout, "error");
    const message = currentMessage();
    if (!message) return show(c.needOutpoint, "error");
    const vin = (from?.value || "").trim();
    if (!isP2wpkhAddress(vin)) {
      showFieldError(fromErr, c.fromInvalid);
      return show(c.fromInvalid, "error");
    }
    const sig = (sigEl?.value || "").replace(/\s+/g, "");
    if (!sig) return show(c.signatureHint, "error");
    if (!signatureFormatSupported(sig)) return show(c.signatureUnsupported, "error");
    const refundTo = (toEl?.value || "").trim();
    if (!refundTo) return show(c.needRefundTo, "error");
    const toReason = refundToInvalidReason(refundTo);
    if (toReason) {
      showFieldError(toErr, toReason);
      return show(toReason, "error");
    }
    const api = WORKERS_API.replace(/\/$/, "");
    try {
      const res = await authFetch(`${api}/refunds/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildRefundRegisterBody({
            proposal_id: opts.proposalId!,
            txid,
            vout,
            refund_address: refundTo,
            vin_address: vin,
            signature_b64: sig,
          }),
        ),
      });
      type RegisterReply = { error?: unknown; code?: unknown; package_error?: unknown };
      let body: RegisterReply | null = null;
      try {
        body = (await res.json()) as RegisterReply;
      } catch {
        body = null;
      }
      if (res.ok) {
        show(c.registered);
        opts.onRegistered?.();
      } else if (body?.package_error === true) {
        show(c.packageError, "error");
        opts.onRegistered?.();
      } else {
        show(refundSignErrorCopy(body), "error");
      }
    } catch {
      show(c.failed, "error");
    }
  });
}
