import { authFetch, currentReturnPath, githubLoginUrl, loginChoicesHtml, logout, updateProfile, type AuthUser } from "./auth";
import { solidIcon } from "./icons";
import { WORKERS_API } from "./config";
import { confirmAction } from "./confirm-modal";
import { bindKhApplyForm, khApplyFormHtml } from "./governance-page";
import { href } from "./router";
import { authFetchWithTos } from "./tos-modal";
import { bindHashGate, hashGateHtml } from "./psbt-hash-gate";
import { formatSats, html, raw } from "./util";
import { payoutLooksValid } from "./payout-destination";

export type KeyholdersShell = (inner: string) => string;

const KH_TABS = [
  "release",
  "branch",
  "bond_refund",
  "contrib_refund",
  "roster",
] as const;

export type KeyholderTab = (typeof KH_TABS)[number];

export function keyholderTabFromSearch(search: string): KeyholderTab {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const tab = new URLSearchParams(raw).get("tab") || "";
  return (KH_TABS as readonly string[]).includes(tab)
    ? (tab as KeyholderTab)
    : "release";
}

/** Compact empty queue chrome for Releases / Branches / refunds / roster. */
export function keyholderQueueEmptyHtml(title: string, body: string): string {
  return html`<div class="empty-state empty-state-compact kh-queue-empty"><div class="empty-state-inner">
    <p class="empty-state-title">${title}</p>
    <p class="empty-state-body">${body}</p>
  </div></div>`.value;
}

type DisburseItem = {
  id: string;
  kind: string;
  state: string;
  proposal_id: string;
  outputs: { address: string; amount_sats: number; label?: string }[];
  settle_txid?: string;
  settle_proposed_by?: string;
  unsigned_sha256?: string;
  psbts?: { sha256: string; uploader: string; created_at: string; kind?: string }[];
  addresses_frozen?: boolean;
  ln_destination?: string;
  ln_amount_sats?: number;
  period?: string;
  monthly_accruing?: boolean;
  line_items?: { proposal_id: string; payout_sats: number; escrow_address?: string }[];
  partials?: { keyholder_id: string; fingerprint: string }[];
  psbt_status?: string;
  required_threshold?: number;
};

/** One sentence on a ready, signable release. Null otherwise. */
export function keyholderPackageSentence(item: {
  kind: string;
  monthly_accruing?: boolean;
  outputs: unknown[];
}): string | null {
  if (item.kind !== "release") return null;
  if (item.monthly_accruing) return null;
  if (!item.outputs.length) return null;
  return "Sign this release.";
}

/** Plain purpose for a branch, release, refund, or pool payout. */
export function keyholderTxPurpose(kind: string): string {
  switch (kind) {
    case "clean":
      return "Pay the builder, and send the keyholder and reviewer shares out of this escrow.";
    case "reserve_reviewers":
      return "Pay reviewers from the reserve.";
    case "reserve_refund":
    case "refund":
    case "contrib_refund":
    case "bond_refund":
      return "Return funds.";
    case "disputed":
      return "Pay the disputed branch.";
    case "timelock":
      return "Spend the timelock branch.";
    case "release":
      return "Pay this month's lines, including the keyholder pool output.";
    case "cashout":
      return "Pay this keyholder from the pool.";
    default:
      return kind.replace(/_/g, " ");
  }
}

/** Threshold 1 is a single signature. Anything higher is the multisig quorum. */
export function signatureProgressLabel(signed: number, need: number): string {
  const n = Math.max(0, Math.floor(need));
  const s = Math.max(0, Math.floor(signed));
  if (n <= 1) return "One signature";
  return `Multisig · ${s} of ${n}`;
}

export function signerLabels(
  partials: { keyholder_id: string; fingerprint: string }[] | undefined,
  names: Record<string, string>,
): string[] {
  return (partials || []).map((p) => {
    const name = names[p.keyholder_id];
    if (name) return name.startsWith("@") ? name : `@${name}`;
    return p.fingerprint || p.keyholder_id;
  });
}

/** Shorten a 64-hex settle txid for queue / chip chrome. */
export function shortSettleTxid(txid: string | undefined | null): string {
  const t = (txid || "").trim();
  if (t.length < 16) return t;
  return `${t.slice(0, 8)}…${t.slice(-8)}`;
}

/**
 * Primary status chip for a branch signoff.
 * Settled (or settle_txid on a settled row) must not surface "Needs 0/2 cosignatures".
 */
export function branchSignChipLabel(item: {
  state: string;
  signed: number;
  required_threshold: number;
  settle_txid?: string;
}): string {
  const need = item.required_threshold || 0;
  const signed = item.signed || 0;
  const tx = (item.settle_txid || "").trim();
  if (item.state === "settled") {
    return tx ? `Settled · ${shortSettleTxid(tx)}` : "Settled";
  }
  if (item.state === "settle_proposed") {
    return tx
      ? `Settle proposed · ${shortSettleTxid(tx)}`
      : "Settle proposed — waiting confirm";
  }
  if (item.state === "threshold_met" || (need > 0 && signed >= need)) {
    return `${signatureProgressLabel(signed, need)} · ready to broadcast`;
  }
  if (need > 0 && signed < need) {
    return `${signatureProgressLabel(signed, need)} · Needs ${signed}/${need} cosignatures`;
  }
  return signatureProgressLabel(signed, need);
}

/** Clear next action under the N-of-M chip (desk detail). */
export function branchSignNextAction(
  item: {
    state: string;
    signed: number;
    required_threshold: number;
    settle_txid?: string;
    published_sha256?: string;
    partials?: { keyholder_id: string; fingerprint: string }[];
  },
  opts?: { signerNames?: Record<string, string> },
): string {
  const need = item.required_threshold || 0;
  const signed = item.signed || 0;
  const tx = (item.settle_txid || "").trim();
  if (item.state === "settled") {
    return tx
      ? `Settled — broadcast recorded. Settle txid ${tx}`
      : "Settled — broadcast recorded";
  }
  if (item.state === "settle_proposed") {
    return "Settle proposed — another keyholder must Confirm settle";
  }
  if (item.state === "threshold_met" || (need > 0 && signed >= need)) {
    return "Ready to broadcast in Sparrow — then paste settle txid";
  }
  const who = signerLabels(item.partials, opts?.signerNames || {});
  const fps = (item.partials || [])
    .map((p) => (p.fingerprint || "").trim())
    .filter(Boolean);
  const signedBit = fps.length
    ? `Signed ${fps.join(", ")}${who.length ? ` (${who.join(", ")})` : ""}`
    : who.length
      ? `Signed ${who.join(", ")}`
      : "No partials on desk yet";
  const remain = Math.max(0, need - signed);
  return `${signedBit}. Needs ${remain} more cosignature${remain === 1 ? "" : "s"} (${signed}/${need}) — or paste settle txid after off-desk Sparrow broadcast`;
}

/**
 * Public Signet 2-of-3 join materials only (descriptor xpubs / fingerprints).
 * BIP84 m/84'/1'/0' — not BIP48. No seeds.
 */
export const SIGNET_23_JOIN_SHEET = `# Signet 2-of-3 join sheet (public only — no seeds)

Threshold: 2 of 3
Network: Signet
Script: wsh(sortedmulti(2,…)) BIP84-style account xpubs
Derivation: m/84'/1'/0' (BIP84 Signet) — not BIP48

## Cosigners
1. Josh     fp=5c4993d8  tpub=tpubDDbJhLEZXSNLtUwJQd2BY8N99yqnfwDEUGsHgSm7WDKxKQxt8mbrM1pis1TrkfUtoiR2URaTTMiijNEifVKEijwhksQQHa4roCEDvjWDkhD
2. Agent-A  fp=d9ae90f0  tpub=tpubDDCPG9Rx5V3HncoC8Hpotoec7wUw83RahiARSJn4CTQv1UEX7yFNMXKYyzvtKkjcGNV1VQq3UQi9B6dgQwPxBc7xmyQq79Gzr8sK4Y6gWuC
3. Agent-B  fp=0623e747  tpub=tpubDCWfK6qmDSRB6AprCbchFHveXGUdwwgLLeEy5noeoWtwmNQCKEqvQ1Fu2311Uf8BEPyJfDJmiPjm4cgH4SrGDzJA8uH1eSJMxKWLAEm7Kp1

## Descriptor (paste into Sparrow Multisig / Settings)
wsh(sortedmulti(2,[5c4993d8/84h/1h/0h]tpubDDbJhLEZXSNLtUwJQd2BY8N99yqnfwDEUGsHgSm7WDKxKQxt8mbrM1pis1TrkfUtoiR2URaTTMiijNEifVKEijwhksQQHa4roCEDvjWDkhD/0/*,[d9ae90f0/84h/1h/0h]tpubDDCPG9Rx5V3HncoC8Hpotoec7wUw83RahiARSJn4CTQv1UEX7yFNMXKYyzvtKkjcGNV1VQq3UQi9B6dgQwPxBc7xmyQq79Gzr8sK4Y6gWuC/0/*,[0623e747/84h/1h/0h]tpubDCWfK6qmDSRB6AprCbchFHveXGUdwwgLLeEy5noeoWtwmNQCKEqvQ1Fu2311Uf8BEPyJfDJmiPjm4cgH4SrGDzJA8uH1eSJMxKWLAEm7Kp1/0/*))

## Receive #0 expectation (must match Sparrow first receive)
tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx

## Sparrow steps
1. File → New Wallet → Multi Signature → Signet
2. Policy 2 of 3
3. Keystore 1: Josh Signet BIP84 wallet / xpub (fp 5c4993d8), derivation m/84'/1'/0'
4. Keystore 2: paste Agent-A tpub with derivation m/84'/1'/0'
5. Keystore 3: paste Agent-B tpub the same way
6. Confirm receive #0 equals the address above

Public only — never paste seeds into this sheet or the SPA.
`;

export type KeyholderDeskItem = {
  kind: string;
  proposal_id: string;
  state: string;
  monthly_accruing?: boolean;
  addresses_frozen?: boolean;
  period?: string;
  outputs: { address: string; amount_sats: number; label?: string }[];
  line_items?: { proposal_id: string; payout_sats: number; escrow_address?: string }[];
  partials?: { keyholder_id: string; fingerprint: string }[];
  required_threshold?: number;
  ln_destination?: string;
  ln_amount_sats?: number;
  settle_txid?: string;
  settle_proposed_by?: string;
  unsigned_sha256?: string;
  psbts?: { sha256: string; kind?: string }[];
};

export type BranchSignDeskItem = {
  proposal_id: string;
  allocation_id: string;
  kind: string;
  published_sha256: string;
  psbt_base64?: string;
  signed: number;
  required_threshold: number;
  state: string;
  combined_sha256?: string;
  settle_txid?: string;
  settle_proposed_by?: string;
  partials?: { keyholder_id: string; fingerprint: string }[];
  decode?: {
    outputs?: { address: string; amount_sats: number; label?: string }[];
  };
};

export function branchSignDeskHtml(
  item: BranchSignDeskItem,
  opts?: { userId?: string; signerNames?: Record<string, string> },
): string {
  const need = item.required_threshold || 0;
  const signed = item.signed || 0;
  const outputs = item.decode?.outputs || [];
  const settled = item.state === "settled";
  const proposed = item.state === "settle_proposed";
  const who = signerLabels(item.partials, opts?.signerNames || {});
  const canDownload = Boolean(item.psbt_base64);
  const chip = branchSignChipLabel(item);
  const nextAction = branchSignNextAction(item, opts);
  const outputRows = outputs.length
    ? outputs.map(
        (o) =>
          html`<tr><td>${o.label || "—"}</td><td class="mono">${o.address}</td><td>${formatSats(o.amount_sats)}</td></tr>`,
      )
    : html`<tr><td colspan="3" class="muted">No outputs</td></tr>`;
  return html`<div class="form-panel form-panel-wide">
    <h2 class="proposal-block-title" id="kh-branch-title" tabindex="-1">${item.kind} · ${item.proposal_id} · ${item.allocation_id}</h2>
    <p class="next-card-sentence">${keyholderTxPurpose(item.kind)}</p>
    <p class="kh-sign-chip">${chip}</p>
    <p class="muted kh-branch-next" id="kh-branch-next">${nextAction}</p>
    ${who.length ? html`<p class="kh-signers">Signed by ${who.join(", ")}</p>` : ""}
    <table class="kh-outputs">
      <caption class="sr-only">Outputs</caption>
      <thead><tr><th scope="col">Label</th><th scope="col">Address</th><th scope="col">Amount</th></tr></thead>
      <tbody>${outputRows}</tbody>
    </table>
    ${
      canDownload
        ? html`<div class="comment-compose-actions">
            <button type="button" class="btn" id="kh-branch-dl">Download unsigned transaction</button>
            <button type="button" class="btn ghost" id="kh-branch-copy">Copy unsigned base64</button>
          </div>`
        : ""
    }
    <p class="muted">Cosign: sign in Sparrow, then paste the signed partial below. The Worker does not broadcast — broadcast stays in Sparrow after N-of-M. Off-desk Sparrow cosign + broadcast is fine — paste the settle txid when ready.</p>
    ${raw(hashGateHtml({
      publishedHash: item.published_sha256,
      inputId: "kh-branch-verify",
      statusId: "kh-branch-hash-status",
      pasteLabel: "Unsigned Release PSBT you received (base64) — not a settle txid",
      placeholder: "Paste unsigned Release PSBT to verify SHA-256",
    }))}
    <label class="donate-amount-label" for="kh-branch-partial">Signed partial (base64) — not a settle txid</label>
    <textarea id="kh-branch-partial" class="comment-input mono" rows="3" placeholder="Paste signed partial from Sparrow"></textarea>
    <div class="comment-compose-actions">
      <button type="button" class="btn" id="kh-branch-sign" disabled title="Paste a matching unsigned Release PSBT above, then a signed partial" aria-label="Paste a matching unsigned Release PSBT above, then a signed partial">Upload signature</button>
      ${
        item.combined_sha256
          ? html`<button type="button" class="btn ghost" id="kh-branch-combined">Download combined</button>`
          : ""
      }
    </div>
    <p class="builder-msg" id="kh-branch-msg" hidden role="status" aria-live="polite"></p>
    ${
      settled
        ? html`<div class="lifecycle-banner" role="status">
            <span class="lifecycle-k">Settled</span>
            <p>Broadcast already recorded. Settle txid <code class="mono">${item.settle_txid || ""}</code>.</p>
          </div>`
        : (() => {
            const thresholdMet =
              item.state === "threshold_met" ||
              (need > 0 && signed >= need);
            // Off-desk Sparrow cosign + broadcast: keep Propose settle enabled while
            // the branch is still open so KH can paste a confirmed Release txid.
            // Confirm settle keeps dual-KH rules. Worker verifies the txid.
            const proposeDisabled = proposed;
            const proposeWhy = proposed
              ? "Settle already proposed — waiting for another keyholder to confirm"
              : thresholdMet
                ? "After you broadcast in Sparrow, paste the 64-character settle txid"
                : "Off-desk cosign OK — after Sparrow broadcast, paste the confirmed 64-character settle txid (API verifies)";
            const confirmDisabled =
              !proposed || item.settle_proposed_by === opts?.userId;
            const confirmWhy = !proposed
              ? "Waiting for a keyholder to propose the settle txid"
              : item.settle_proposed_by === opts?.userId
                ? "You proposed this settle — another keyholder must confirm"
                : "Confirm the proposed settle txid matches the Release outputs";
            return html`<div class="form-panel">
      <h3 class="proposal-block-title">Settle · record broadcast</h3>
      <p class="fee-pay-bond-label">SETTLE TXID</p>
      <p class="fee-pay-bond-contrast">${
        thresholdMet
          ? html`Ready to broadcast in Sparrow when combined. Then paste the <strong>64-character settle txid</strong> here — not a PSBT.`
          : html`Desk cosign is at <strong>${signed}/${need || "?"}</strong>. You can still paste a settle txid after an <strong>off-desk Sparrow broadcast</strong> — the API verifies Release outputs. Not a PSBT.`
      }</p>
      <label class="donate-amount-label" for="kh-branch-txid">Settle txid (64 hex) — not a PSBT</label>
      <input id="kh-branch-txid" class="donate-amount mono" value="${item.settle_txid || ""}" ${proposed ? "readonly" : ""} autocomplete="off" placeholder="64-character transaction id" />
      <div class="comment-compose-actions">
        <button type="button" class="btn" id="kh-branch-propose" ${proposeDisabled ? "disabled" : ""} title="${proposeWhy}" aria-label="${proposeWhy}">Propose settle</button>
        <button type="button" class="btn ghost" id="kh-branch-confirm" ${confirmDisabled ? "disabled" : ""} title="${confirmWhy}" aria-label="${confirmWhy}">Confirm settle</button>
      </div>
    </div>`;
          })()
    }
  </div>`.value;
}

/** Absolute age from JWT iat. Matches workers KEYHOLDER_SESSION_MAX_AGE_MS. */
export const KEYHOLDER_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Prompt re-login this long before the money-move bound, without moving the bound. */
export const KEYHOLDER_REAUTH_WARN_MS = 15 * 60 * 1000;

const SETTLE_DRAFT_PREFIX = "plebly_kh_settle_draft:";

export type SettleDraft = {
  proposalId: string;
  disburseId: string;
  txid: string;
};

/** Keyholder money and key changes refuse a GitHub login older than 12 hours. */
export function keyholderSessionStale(message: string): boolean {
  return /session older than 12h/i.test(message);
}

export function keyholderSessionIssuedAtMs(token: string | null | undefined): number | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
    const payload = JSON.parse(json) as { iat?: unknown };
    return typeof payload.iat === "number" ? payload.iat * 1000 : null;
  } catch {
    return null;
  }
}

/** True once the login is inside the warn window or already past the 12h money bound. */
export function keyholderSessionNeedsReauth(
  token: string | null | undefined,
  now = Date.now(),
): boolean {
  const issued = keyholderSessionIssuedAtMs(token);
  if (issued == null) return false;
  return now - issued >= KEYHOLDER_SESSION_MAX_AGE_MS - KEYHOLDER_REAUTH_WARN_MS;
}

export function saveSettleDraft(draft: SettleDraft, storage: Storage = localStorage): void {
  const txid = draft.txid.trim();
  if (!draft.proposalId || !draft.disburseId || !/^[0-9a-fA-F]{64}$/.test(txid)) return;
  storage.setItem(
    SETTLE_DRAFT_PREFIX + draft.proposalId,
    JSON.stringify({ proposalId: draft.proposalId, disburseId: draft.disburseId, txid }),
  );
}

export function readSettleDraft(
  proposalId: string,
  storage: Storage = localStorage,
): SettleDraft | null {
  const raw = storage.getItem(SETTLE_DRAFT_PREFIX + proposalId);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<SettleDraft>;
    if (data.proposalId !== proposalId || !data.disburseId || !data.txid) return null;
    if (!/^[0-9a-fA-F]{64}$/.test(data.txid)) return null;
    return { proposalId, disburseId: data.disburseId, txid: data.txid };
  } catch {
    return null;
  }
}

export function clearSettleDraft(proposalId: string, storage: Storage = localStorage): void {
  storage.removeItem(SETTLE_DRAFT_PREFIX + proposalId);
}

/** Short txid prefix for page-level settle toasts (empty when missing/invalid). */
export function settleToastTxidPrefix(txid?: string | null): string {
  const t = (txid || "").trim();
  if (!/^[0-9a-fA-F]{8,}$/.test(t)) return "";
  return t.slice(0, 8);
}

/** Copy for post-settle page toast after the detail modal closes. */
export function keyholderSettleToastText(opts: {
  outcome: "settled" | "proposed_waiting";
  txid?: string | null;
}): string {
  const prefix = settleToastTxidPrefix(opts.txid);
  const tip = prefix ? ` · ${prefix}…` : "";
  if (opts.outcome === "proposed_waiting") {
    return `Settle proposed — waiting for second keyholder${tip}`;
  }
  return `Settled.${tip}`;
}

/** Page-level success banner HTML (outside the closed detail modal). */
export function keyholderPageToastHtml(message: string): string {
  return html`<div class="lifecycle-banner kh-page-toast" id="kh-page-toast" role="status" aria-live="polite">
    <span class="lifecycle-k">Settle</span>
    <p>${message}</p>
    <button type="button" class="btn ghost btn-compact" data-kh-toast-dismiss aria-label="Dismiss">Dismiss</button>
  </div>`.value;
}

export type KeyholderReturnState = {
  step: "why" | "address" | "sign";
  address: string;
  tab: string;
  wizardOpen: boolean;
  branch?: { proposalId: string; allocationId: string };
  disburseId?: string;
};

const KH_RETURN_KEY = "plebly_kh_return";

export function parseKeyholderReturnState(raw: string | null): KeyholderReturnState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<KeyholderReturnState>;
    const step = data.step;
    if (step !== "why" && step !== "address" && step !== "sign") return null;
    return {
      step,
      address: typeof data.address === "string" ? data.address : "",
      tab: typeof data.tab === "string" && data.tab ? data.tab : "release",
      wizardOpen: Boolean(data.wizardOpen),
      branch:
        data.branch?.proposalId && data.branch.allocationId
          ? {
              proposalId: data.branch.proposalId,
              allocationId: data.branch.allocationId,
            }
          : undefined,
      disburseId: typeof data.disburseId === "string" ? data.disburseId : undefined,
    };
  } catch {
    return null;
  }
}

export function saveKeyholderReturnState(state: KeyholderReturnState): void {
  try {
    sessionStorage.setItem(KH_RETURN_KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

export function takeKeyholderReturnState(): KeyholderReturnState | null {
  try {
    const raw = sessionStorage.getItem(KH_RETURN_KEY);
    sessionStorage.removeItem(KH_RETURN_KEY);
    return parseKeyholderReturnState(raw);
  } catch {
    return null;
  }
}

/** True when the field still holds the address the wizard opened with. */
export function receiveAddressUnchanged(current: string, initial: string): boolean {
  const next = current.trim().toLowerCase();
  const saved = initial.trim().toLowerCase();
  return Boolean(saved) && next === saved;
}

/** The address this check signs. The seat address wins when it is already on-chain. */
export function keyholderReceiveAddress(authAddress: string, payoutAddress = ""): string {
  const auth = authAddress.trim();
  if (auth && payoutLooksValid(auth, "onchain")) return auth;
  const payout = payoutAddress.trim();
  if (payout && payoutLooksValid(payout, "onchain")) return payout;
  return auth;
}

/** Walk through setting the receive address, then signing a message from it. */
export function keyholderProofWizardHtml(
  authAddress: string,
  payoutAddress = "",
): string {
  const addr = keyholderReceiveAddress(authAddress, payoutAddress);
  return html`<p class="kh-wizard-progress" id="kh-wizard-progress">Step 1 of 3</p>
    <div data-kh-wizard="why">
      <p>You are about to upload a signature on a transaction. GitHub only tells the site which seat this is. It does not show that the wallet for this seat is in your hands.</p>
      <p class="muted">This check is a signed message, not that transaction. You sign it in Sparrow. After it passes, this browser can upload signatures for 15 minutes.</p>
      <div class="kh-wizard-actions">
        <button type="button" class="btn" data-kh-wizard-go="address">Continue</button>
      </div>
    </div>
    <div data-kh-wizard="address" hidden>
      <p>This is your receive address. It is the one already saved for this seat, or your Account address if the seat does not have one yet.</p>
      <p class="muted">Change it only if you want a different address. Saving a new one stores it on your Account and on this seat. The message in the next step is signed from this address. It is not the project escrow.</p>
      <label class="donate-amount-label" for="kh-auth-addr">Receive address</label>
      <input id="kh-auth-addr" class="donate-amount mono" data-initial="${addr}" value="${addr}" placeholder="tb1… / bc1…" autocomplete="off" />
      <p class="builder-msg" id="kh-auth-msg" hidden role="status"></p>
      <a class="btn" id="kh-relogin-inline" href="#" hidden>Log in with GitHub</a>
      <div class="kh-wizard-actions">
        <button type="button" class="btn ghost" data-kh-wizard-go="why">Back</button>
        <button type="button" class="btn" id="kh-wizard-save-addr">Save and continue</button>
      </div>
    </div>
    <div data-kh-wizard="sign" hidden>
      <p>In Sparrow, open Tools, then Sign/Verify Message. Sign with this receive address:</p>
      <div class="kh-wizard-addr-row"><p class="mono kh-wizard-addr" id="kh-auth-shown">${addr}</p><button type="button" class="btn ghost" id="kh-auth-copy">Copy for Sparrow</button></div>
      <p class="mono kh-challenge-msg" id="kh-challenge-msg" hidden role="status"></p>
      <button type="button" class="btn ghost" id="kh-challenge" hidden>Try again</button>
      <div id="kh-wizard-paste" hidden>
        <button type="button" class="btn ghost" id="kh-challenge-copy">Copy message</button>
        <p class="muted">Paste that message into Sparrow, sign it, then paste the signature here.</p>
        <label class="donate-amount-label" for="kh-challenge-sig">Signature from Sparrow</label>
        <textarea id="kh-challenge-sig" class="comment-input mono" rows="3" placeholder="Paste the compact signature"></textarea>
        <button type="button" class="btn" id="kh-challenge-verify">Check signature</button>
      </div>
      <p class="builder-msg" id="kh-challenge-status" hidden role="status" aria-live="polite"></p>
      <div class="kh-wizard-actions">
        <button type="button" class="btn ghost" data-kh-wizard-go="address">Back</button>
      </div>
    </div>`.value;
}

export function cashoutDeskHtml(opts: {
  amount_sats: number;
  payout_address: string;
}): string {
  return html`<div class="form-panel" id="kh-cashout-card">
    <h2 class="proposal-block-title">${keyholderTxPurpose("cashout")}</h2>
    <p class="muted">${formatSats(opts.amount_sats)} to <span class="mono">${opts.payout_address}</span></p>
    <p class="muted">Sign this in Sparrow. The escrow quorum does not apply.</p>
    <div class="comment-compose-actions">
      <button type="button" class="btn ghost" id="kh-cashout-dl">Download unsigned transaction</button>
    </div>
    <p class="fee-pay-bond-contrast">After broadcast, paste the <strong>64-character settle txid</strong> — not a PSBT.</p>
    <label class="donate-amount-label" for="kh-cashout-txid">Settle txid (64 hex) — not a PSBT</label>
    <input id="kh-cashout-txid" class="donate-amount mono" autocomplete="off" placeholder="64-character transaction id" />
    <div class="comment-compose-actions">
      <button type="button" class="btn" id="kh-cashout-settle">Record payout</button>
    </div>
    <p class="builder-msg" id="kh-cashout-msg" hidden role="status" aria-live="polite"></p>
  </div>`.value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function downloadBase64File(b64: string, filename: string): void {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTextFile(text: string, filename: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function publishedUnsignedHash(item: {
  unsigned_sha256?: string;
  psbts?: { sha256: string; kind?: string }[];
}): string {
  return (
    item.unsigned_sha256 ||
    item.psbts?.find((p) => p.kind === "unsigned")?.sha256 ||
    item.psbts?.[0]?.sha256 ||
    ""
  );
}

export function keyholderDeskStep(opts: {
  kind: string;
  monthly_accruing?: boolean;
  needsLn: boolean;
  outputs: unknown[];
  canUnsigned: boolean;
  canPartial: boolean;
  canBroadcast: boolean;
  isRelease: boolean;
}): "lockup" | "accruing" | "wait" | "freeze" | "sign" | "broadcast" | "settle" {
  if (opts.monthly_accruing) return "accruing";
  if (opts.needsLn) return "lockup";
  if (!opts.outputs.length) return "wait";
  if (opts.isRelease) {
    if (opts.canUnsigned) return "freeze";
    if (opts.canBroadcast) return "broadcast";
    return "sign";
  }
  return "settle";
}

function khStepClass(
  name: ReturnType<typeof keyholderDeskStep>,
  current: ReturnType<typeof keyholderDeskStep>,
  order: ReturnType<typeof keyholderDeskStep>[],
): string {
  const i = order.indexOf(name);
  const c = order.indexOf(current);
  if (i < 0) return "";
  if (i < c) return "is-done";
  if (i === c) return "is-current";
  return "";
}

export function keyholderDeskHtml(
  item: KeyholderDeskItem,
  opts: {
    needsLn: boolean;
    canPsbt: boolean;
    canUnsigned: boolean;
    canPartial: boolean;
    canBroadcast: boolean;
    isRelease: boolean;
    requiresDualSettle: boolean;
    userId: string;
    signerNames?: Record<string, string>;
  },
): string {
  const signed = item.partials?.length || 0;
  const need = item.required_threshold || 0;
  const step = keyholderDeskStep({
    kind: item.kind,
    monthly_accruing: item.monthly_accruing,
    needsLn: opts.needsLn,
    outputs: item.outputs,
    canUnsigned: opts.canUnsigned,
    canPartial: opts.canPartial,
    canBroadcast: opts.canBroadcast,
    isRelease: opts.isRelease,
  });
  const readyLine =
    keyholderPackageSentence(item) ||
    (item.kind === "release" ? null : "Finish this refund.");
  const releaseOrder: ReturnType<typeof keyholderDeskStep>[] = [
    "freeze",
    "sign",
    "broadcast",
  ];
  const steps = opts.isRelease
    ? html`<ol class="kh-steps">
        <li class="${khStepClass("freeze", step, releaseOrder)}">Structure/Release · check outputs, then freeze the unsigned transaction</li>
        <li class="${khStepClass("sign", step, releaseOrder)}">Cosign · sign in Sparrow and paste the partial (not a settle txid)</li>
        <li class="${khStepClass("broadcast", step, releaseOrder)}">Broadcast in Sparrow when N-of-M is met — then settle txid if needed</li>
      </ol>`
    : html`<ol class="kh-steps">
        <li class="${step === "settle" ? "is-current" : ""}">Settle · check outputs, then paste the settle txid (64 hex — not a PSBT)</li>
      </ol>`;

  const outputs = html`<table class="kh-outputs">
    <caption class="sr-only">Outputs</caption>
    <thead><tr><th scope="col">Label</th><th scope="col">Address</th><th scope="col">Amount</th></tr></thead>
    <tbody>
      ${
        item.outputs.length
          ? item.outputs.map(
              (o) =>
                html`<tr><td>${o.label || "—"}</td><td class="mono">${o.address}</td><td>${formatSats(o.amount_sats)}</td></tr>`,
            )
          : html`<tr><td colspan="3" class="muted">No outputs yet</td></tr>`
      }
    </tbody>
  </table>`;

  const freezeBlock = opts.isRelease
    ? html`<div class="comment-compose-actions" ${step === "freeze" || item.psbts?.[0] ? "" : "hidden"}>
          <label class="donate-amount-label" for="kh-psbt-unsigned">Unsigned transaction (base64)</label>
          <textarea id="kh-psbt-unsigned" class="comment-input mono" rows="3" placeholder="Paste from Sparrow" ${
            opts.canUnsigned ? "" : "disabled"
          }></textarea>
          <button type="button" class="btn" id="kh-psbt-upload" ${
            opts.canUnsigned ? "" : "disabled"
          }>Freeze outputs</button>
          ${
            item.psbts?.[0]
              ? html`<button type="button" class="btn ghost" id="kh-psbt-dl">Download unsigned transaction</button>`
              : ""
          }
        </div>`
    : html`<div class="comment-compose-actions" hidden>
          <textarea id="kh-psbt-unsigned" hidden></textarea>
          <button type="button" id="kh-psbt-upload" hidden></button>
        </div>`;

  const publishedHash = publishedUnsignedHash(item);
  const signBlocked = !opts.canPartial || Boolean(publishedHash);
  const signBlock = opts.isRelease
    ? html`<div class="comment-compose-actions" ${
        step === "sign" || step === "broadcast" ? "" : "hidden"
      }>
        ${raw(hashGateHtml({
          publishedHash,
          inputId: "kh-psbt-verify",
          statusId: "kh-hash-status",
        }))}
        <label class="donate-amount-label" for="kh-psbt-partial">Signed partial (base64)</label>
        <textarea id="kh-psbt-partial" class="comment-input mono" rows="3" placeholder="Paste from Sparrow" ${
          opts.canPartial ? "" : "disabled"
        }></textarea>
        <button type="button" class="btn" id="kh-sign" ${
          signBlocked ? "disabled" : ""
        }>Upload signature</button>
        <button type="button" class="btn ${step === "broadcast" ? "" : "ghost"}" id="kh-broadcast" ${
          opts.canBroadcast ? "" : "disabled"
        } title="${
          opts.canBroadcast
            ? "Threshold met — broadcast the combined transaction in Sparrow (or via Worker if enabled)"
            : need
              ? `Waiting for ${signed}/${need} cosignatures before broadcast`
              : "Waiting for cosignatures before broadcast"
        }" aria-label="${
          opts.canBroadcast
            ? "Threshold met — ready to broadcast"
            : need
              ? `Waiting for ${signed}/${need} cosignatures before broadcast`
              : "Waiting for cosignatures before broadcast"
        }">Broadcast</button>
      </div>`
    : "";

  const who = signerLabels(item.partials, opts.signerNames || {});
  const progress = need
    ? `${signatureProgressLabel(signed, need)}${who.length ? ` · ${who.join(", ")}` : ""}${
        item.period ? ` · ${item.period}` : ""
      }`
    : "";
  const proposeWhy = !opts.canPsbt
    ? "Waiting on payout addresses / package readiness"
    : opts.requiresDualSettle
      ? "Propose this settle txid for dual-ack"
      : "After Sparrow broadcast, paste the 64-character settle txid and propose";
  const confirmWhy = !opts.canPsbt
    ? "Waiting on payout addresses / package readiness"
    : item.settle_proposed_by === opts.userId
      ? "You proposed this settle — another keyholder must confirm"
      : item.settle_proposed_by
        ? "Confirm the proposed settle txid"
        : "Waiting for a keyholder to propose the settle txid";
  // Non-release (bond_refund / contrib_refund): settle txid + Propose settle are the
  // only real action — keep them primary, not buried under "Other settle tools".
  // Release keeps settle secondary inside details (PSBT / Download is primary).
  const settlePrimary = !opts.isRelease;
  const settleContrast = settlePrimary
    ? html`Pay/broadcast from the fee/bond Sparrow wallet to the output row above, then paste the <strong>64-character broadcast txid</strong> — not a PSBT and not Structure outs.`
    : html`Paste the <strong>64-character broadcast txid</strong> after Sparrow broadcast — not a PSBT and not Structure outs.`;
  const settleControls = html`<p class="fee-pay-bond-label">SETTLE TXID</p>
      <p class="fee-pay-bond-contrast">${settleContrast}</p>
      <label class="donate-amount-label" for="kh-txid">Settle txid (64 hex) — not a PSBT</label>
      <input id="kh-txid" class="donate-amount mono" value="${item.settle_txid || ""}" ${
        opts.canPsbt ? "" : "disabled"
      } placeholder="64-character transaction id" title="${
        opts.canPsbt ? "Paste settle txid after broadcast" : "Waiting for package readiness"
      }" />
      <div id="kh-verify-panel" class="lifecycle-banner" hidden>
        <span class="lifecycle-k">Verify</span>
        <p>Match this settle txid to the outputs above.</p>
        <ul class="kh-verify-outputs">${item.outputs.map(
          (o) =>
            html`<li class="mono">${o.address} · ${formatSats(o.amount_sats)}${
              o.label ? html` · ${o.label}` : ""
            }</li>`,
        )}</ul>
      </div>
      <div class="comment-compose-actions">
        <button type="button" class="btn${settlePrimary ? "" : " ghost"}" id="kh-propose" ${
          opts.canPsbt ? "" : "disabled"
        } title="${proposeWhy}" aria-label="${proposeWhy}">Propose settle</button>
        ${
          opts.requiresDualSettle
            ? html`<button type="button" class="btn ghost" id="kh-confirm"${
                item.settle_proposed_by === opts.userId || !opts.canPsbt
                  ? " disabled"
                  : ""
              } title="${confirmWhy}" aria-label="${confirmWhy}">Confirm settle</button>`
            : ""
        }
      </div>`;
  const settlePrimaryBlock = settlePrimary
    ? html`<div class="kh-settle-primary" data-kh-settle-primary="1">
      <h3 class="proposal-block-title">Settle · record broadcast</h3>
      ${settleControls}
    </div>`
    : "";
  const settleDetailsInner = settlePrimary
    ? ""
    : settleControls;
  const chatBlock = html`<div id="kh-chat"></div>
      <label class="sr-only" for="kh-chat-input">Message other keyholders</label>
      <textarea id="kh-chat-input" class="comment-input" rows="2" maxlength="2000" placeholder="Message other keyholders…"></textarea>
      <button type="button" class="btn ghost" id="kh-chat-send">Post</button>`;

  return html`<div class="form-panel form-panel-wide">
    <h2 class="proposal-block-title" id="kh-detail-title" tabindex="-1">${item.kind.replace(/_/g, " ")} · ${item.proposal_id}</h2>
    <p class="next-card-sentence">${keyholderTxPurpose(item.kind)}</p>
    ${readyLine ? html`<p class="muted">${readyLine}</p>` : ""}
    ${
      item.monthly_accruing
        ? html`<p class="muted">Signing opens after month-end freeze.</p>`
        : progress
          ? html`<p class="kh-sign-chip">${progress}</p>`
          : ""
    }
    ${steps}
    ${
      item.line_items?.length
        ? html`<table class="kh-outputs">
             <caption class="sr-only">Line items</caption>
             <thead><tr><th scope="col">Proposal</th><th scope="col">Escrow</th><th scope="col">Payout</th></tr></thead>
             <tbody>${item.line_items.map(
               (l) =>
                 html`<tr><td class="mono">${l.proposal_id}</td><td class="mono">${l.escrow_address || "—"}</td><td>${formatSats(l.payout_sats)}</td></tr>`,
             )}</tbody>
           </table>`
        : ""
    }
    ${
      item.ln_destination
        ? html`<p class="muted mono">${item.ln_destination}${
            item.ln_amount_sats != null ? ` · ${formatSats(item.ln_amount_sats)}` : ""
          }</p>`
        : ""
    }
    ${
      opts.needsLn
        ? html`<div class="lifecycle-banner lifecycle-warn">
            <span class="lifecycle-k">Lockup</span>
            <p>Paste the lockup address, then sign in Sparrow.</p>
            <label class="donate-amount-label" for="kh-lockup">Lockup address</label>
            <input id="kh-lockup" class="donate-amount mono" placeholder="bc1… / tb1…" />
            <button type="button" class="btn" id="kh-lockup-save">Attach lockup</button>
          </div>`
        : ""
    }
    ${
      !opts.canPsbt && !opts.needsLn && !item.monthly_accruing
        ? html`<p class="muted">Waiting on payout addresses.</p>`
        : ""
    }
    ${outputs}
    ${freezeBlock}
    ${signBlock}
    ${settlePrimaryBlock}
    <details class="next-card-more">
      <summary>${settlePrimary ? "Keyholder chat" : "Other settle tools"}</summary>
      ${settleDetailsInner}
      ${chatBlock}
    </details>
    <p class="builder-msg" id="kh-settle-msg" hidden role="status" aria-live="polite"></p>
  </div>`.value;
}

type KeyholderMe = {
  user_id: string;
  github: string;
  fingerprint?: string | null;
  xpub?: string | null;
  auth_address?: string | null;
  status: string;
  verified_at?: string | null;
  keys_stale?: boolean;
  attest_count?: number;
};

export type KeyholderOnboardPhase =
  | "sign_in"
  | "earn_reviewer"
  | "apply"
  | "election"
  | "submit_keys"
  | "await_attest"
  | "active";

export type KeyholderOnboardApplication = {
  status: string;
  reapply_after?: string | null;
  hw_type?: string;
  handle?: string;
  election?: {
    status: string;
    yes: number;
    no: number;
    closes_at: string;
  } | null;
};

export type KeyholderOnboardInput = {
  signedIn: boolean;
  canApply: boolean;
  /** Live active seats from GET /keyholders/public. <2 means co-attest cannot run. */
  activeSeats?: number;
  application?: KeyholderOnboardApplication | null;
  keyholder?: {
    status: string;
    fingerprint?: string | null;
    xpub?: string | null;
    keys_stale?: boolean;
    attest_count?: number;
  } | null;
};

export function keyholderColdStart(activeSeats?: number): boolean {
  return typeof activeSeats === "number" && activeSeats < 2;
}

export function keyholderColdStartHtml(activeSeats?: number): string {
  if (!keyholderColdStart(activeSeats)) return "";
  return html`<div class="lifecycle-banner" role="status">
    <span class="lifecycle-k">First seats</span>
    <p>No sitting keyholders yet. Ops activates the first two together. Apply and co-attest on this page start after that.</p>
  </div>`.value;
}

const ONBOARD_STEPS: { id: KeyholderOnboardPhase; label: string }[] = [
  { id: "sign_in", label: "Sign in" },
  { id: "earn_reviewer", label: "Finish a completed review" },
  { id: "apply", label: "Apply — reviewers vote for 7 days" },
  { id: "submit_keys", label: "Register fingerprint + xpub" },
  { id: "await_attest", label: "Two keyholders co-attest" },
  { id: "active", label: "Sign releases" },
];

export function keyholderOnboardPhase(
  input: KeyholderOnboardInput,
): KeyholderOnboardPhase {
  if (!input.signedIn) return "sign_in";
  const st = input.keyholder?.status;
  if (st === "active") return "active";
  if (st === "pending_attest") return "await_attest";
  if (st === "invited") return "submit_keys";
  if (input.application?.status === "pending") return "election";
  if (input.application?.status === "approved") return "submit_keys";
  if (input.canApply) return "apply";
  return "earn_reviewer";
}

export function keyholderOnboardStepIndex(phase: KeyholderOnboardPhase): number {
  if (phase === "election") return 2;
  return ONBOARD_STEPS.findIndex((s) => s.id === phase);
}

export function keyholderOnboardLede(phase: KeyholderOnboardPhase): string {
  switch (phase) {
    case "sign_in":
      return "Sign in, then follow the steps.";
    case "earn_reviewer":
      return "Finish one completed review, then apply here.";
    case "apply":
      return "Reviewers vote for seven days.";
    case "election":
      return "Waiting on the reviewer vote.";
    case "submit_keys":
      return "Register fingerprint and xpub with the Worker. This does not update the Sparrow descriptor.";
    case "await_attest":
      return "Two sitting keyholders must co-attest your keys.";
    case "active":
      return "Sign releases and refunds.";
  }
}

function coldStartLede(phase: KeyholderOnboardPhase, activeSeats = 0): string {
  if (keyholderColdStart(activeSeats) && phase !== "active") {
    return "Ops seats the first two. This page is for later seats.";
  }
  return keyholderOnboardLede(phase);
}

export function keyholderKeysFormHtml(opts: {
  fingerprint?: string | null;
  xpub?: string | null;
  heading: string;
}): string {
  return html`<div class="form-panel" id="kh-keys-panel">
    <h2 class="proposal-block-title">${opts.heading}</h2>
    <p class="muted">Registers fingerprint + xpub on the Worker so other keyholders can co-attest. It does not change the Sparrow descriptor — ops publishes that separately. Saving again clears co-attestations. Never paste a seed.</p>
    <label class="donate-amount-label" for="kh-fp">Fingerprint (8 hex)</label>
    <input id="kh-fp" class="donate-amount mono" maxlength="8" value="${opts.fingerprint || ""}" autocomplete="off" />
    <label class="donate-amount-label" for="kh-xpub">xpub / tpub</label>
    <textarea id="kh-xpub" class="comment-input mono" rows="3">${opts.xpub || ""}</textarea>
    <label class="donate-amount-label" for="kh-auth-addr-keys">Auth address (P2WPKH from this xpub)</label>
    <input id="kh-auth-addr-keys" class="donate-amount mono" placeholder="tb1… / bc1…" autocomplete="off" />
    <button type="button" class="btn" id="kh-keys-submit">Save keys</button>
    <p class="builder-msg" id="kh-keys-msg" hidden role="status" aria-live="polite"></p>
  </div>`.value;
}

function onboardReapplyBlocked(app: KeyholderOnboardApplication | null | undefined): boolean {
  if (app?.status !== "rejected" || !app.reapply_after) return false;
  const t = Date.parse(app.reapply_after);
  return Number.isFinite(t) && Date.now() < t;
}

function keyholderOnboardCardHtml(input: KeyholderOnboardInput): string {
  const phase = keyholderOnboardPhase(input);
  const app = input.application;
  const kh = input.keyholder;
  const cold = keyholderColdStart(input.activeSeats);
  if (phase === "sign_in") {
    return html`<div class="form-panel kh-onboard-card">
      <p class="next-card-sentence">Sign in to continue.</p>
      ${raw(loginChoicesHtml(undefined, currentReturnPath()))}
      <p class="muted"><a href="${href("/keyholder-responsibilities")}">Responsibilities</a></p>
    </div>`.value;
  }
  if (phase === "earn_reviewer") {
    return html`<div class="form-panel kh-onboard-card">
      <p class="next-card-sentence">${
        cold
          ? "Later seats open to earned reviewers after the first two are seated."
          : "Seats open to earned reviewers — people who have finished at least one review."
      }</p>
      <p><a class="btn" href="${href("/reviewers")}">Reviewers</a>
      <a class="btn ghost" href="${href("/wanted")}">Most wanted</a></p>
      <p class="muted"><a href="${href("/keyholder-responsibilities")}">Responsibilities</a></p>
    </div>`.value;
  }
  if (phase === "election") {
    const closes = app?.election?.closes_at?.slice(0, 10) || "";
    const tally =
      app?.election
        ? `yes ${app.election.yes} / no ${app.election.no}`
        : "votes pending";
    return html`<div class="form-panel kh-onboard-card">
      <p class="next-card-sentence">Reviewers are voting on your application.</p>
      <p class="muted">${closes ? html`Closes ${closes} · ` : ""}${tally}. Fail → 90 days before you can apply again.</p>
    </div>`.value;
  }
  if (phase === "apply") {
    const blocked = onboardReapplyBlocked(app);
    const cooldown = blocked
      ? html`<p class="muted">You can apply again after ${(app?.reapply_after || "").slice(0, 10)}.</p>`
      : "";
    return html`<div class="kh-onboard-card">
      <p class="next-card-sentence">Apply here. A pass invites you to register keys.</p>
      ${cooldown}
      ${blocked ? "" : raw(khApplyFormHtml(true, true))}
    </div>`.value;
  }
  if (phase === "submit_keys") {
    return html`<div class="kh-onboard-card">
      <p class="next-card-sentence">Submit the fingerprint and xpub from your hardware wallet.</p>
      ${raw(keyholderKeysFormHtml({
        fingerprint: kh?.fingerprint,
        xpub: kh?.xpub,
        heading: "Your keys",
      }))}
    </div>`.value;
  }
  if (phase === "await_attest") {
    const n = kh?.attest_count || 0;
    return html`<div class="kh-onboard-card">
      <p class="next-card-sentence">${
        cold
          ? "Co-attest cannot start until two seats are already active."
          : `Waiting for two sitting keyholders (${n}/2).`
      }</p>
      <p class="muted">Fingerprint <code class="mono">${kh?.fingerprint || "—"}</code>. ${
        cold
          ? "Ops activates the first two together."
          : "They open this page → Roster → Co-attest."
      }</p>
      ${raw(keyholderKeysFormHtml({
        fingerprint: kh?.fingerprint,
        xpub: kh?.xpub,
        heading: "Update keys",
      }))}
    </div>`.value;
  }
  return html`<div class="form-panel kh-onboard-card">
    <p class="next-card-sentence">You are seated.</p>
    <p class="muted"><a href="${href("/keyholder-responsibilities")}">Responsibilities</a></p>
  </div>`.value;
}

export function keyholderOnboardHtml(input: KeyholderOnboardInput): string {
  const phase = keyholderOnboardPhase(input);
  const current = keyholderOnboardStepIndex(phase);
  const steps = ONBOARD_STEPS.map((step, i) => {
    const cls = i < current ? "is-done" : i === current ? "is-current" : "";
    return html`<li class="${cls}">${step.label}</li>`;
  });
  return html`<div class="kh-onboard">
    ${raw(keyholderColdStartHtml(input.activeSeats))}
    <ol class="kh-steps kh-onboard-steps" aria-label="Keyholder onboarding">
      ${steps}
    </ol>
    ${raw(keyholderOnboardCardHtml(input))}
  </div>`.value;
}

const api = () => WORKERS_API.replace(/\/$/, "");

async function loadActiveSeats(): Promise<number> {
  try {
    const res = await fetch(`${api()}/keyholders/public`);
    if (!res.ok) return 0;
    const data = (await res.json()) as { seats?: number };
    return typeof data.seats === "number" ? data.seats : 0;
  } catch {
    return 0;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function bindKeyholderKeys(
  root: ParentNode,
  opts?: { onSaved?: () => void },
): void {
  root.querySelector("#kh-keys-submit")?.addEventListener("click", async () => {
    const fingerprint = (
      root.querySelector<HTMLInputElement>("#kh-fp")?.value || ""
    ).trim();
    const xpub = (
      root.querySelector<HTMLTextAreaElement>("#kh-xpub")?.value || ""
    ).trim();
    const res = await authFetch(`${api()}/keyholders/me/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fingerprint,
        xpub,
        auth_address: (
          root.querySelector<HTMLInputElement>("#kh-auth-addr-keys")?.value ||
          root.querySelector<HTMLInputElement>("#kh-auth-addr")?.value ||
          ""
        ).trim(),
      }),
    });
    const msg = root.querySelector<HTMLElement>("#kh-keys-msg");
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (msg) {
      msg.hidden = false;
      msg.textContent = res.ok ? "Keys saved." : body.error || "Failed";
    }
    if (res.ok) opts?.onSaved?.();
  });
}

export type RosterSeat = {
  user_id: string;
  github: string;
  status: string;
  fingerprint?: string | null;
  pending_revoke?: boolean;
  revoke_attest_count?: number;
  revoke_reason?: string;
  revoke_attested_by_me?: boolean;
  revoke_attested_by?: string[];
};

function rosterSeatAction(seat: RosterSeat, selfId: string) {
  if (seat.status !== "active") {
    return html`<button type="button" class="btn ghost" data-coattest="${seat.user_id}">Co-attest</button>`;
  }
  if (seat.user_id === selfId) {
    return html`<span class="muted">You</span>`;
  }
  if (seat.pending_revoke && seat.revoke_attested_by_me) {
    return html`<span class="muted">You confirmed</span>`;
  }
  if (seat.pending_revoke) {
    return html`<button type="button" class="btn ghost" data-kh-revoke="${seat.user_id}">Confirm</button>`;
  }
  return html`<button type="button" class="btn ghost" data-kh-revoke="${seat.user_id}">Revoke</button>`;
}

function rosterSeatRow(seat: RosterSeat, selfId: string) {
  const count = seat.pending_revoke ? seat.revoke_attest_count || 1 : 0;
  return html`<li class="declined-row kh-roster-row">
    <span class="kh-roster-name">@${seat.github}</span>
    <span class="declined-meta">
      <span class="pill">${seat.pending_revoke ? `${count} of 2` : seat.status}</span>
      <span class="mono muted">${seat.fingerprint || "—"}</span>
    </span>
    ${rosterSeatAction(seat, selfId)}
    ${
      seat.pending_revoke && seat.revoke_attested_by?.length
        ? html`<p class="muted kh-roster-confirmed">Confirmed by ${seat.revoke_attested_by.map((name) => `@${name}`).join(", ")}</p>`
        : ""
    }
  </li>`;
}

/** Waiting seats keep co-attest. Sitting seats can start or confirm a revoke. */
export function keyholderRosterHtml(rows: RosterSeat[], selfId: string): string {
  const waiting = rows.filter((k) => k.status === "invited" || k.status === "pending_attest");
  const sitting = rows.filter((k) => k.status === "active");
  const group = (title: string, seats: RosterSeat[]) =>
    seats.length
      ? html`<h3 class="kh-roster-group">${title}</h3>
        <ul class="declined-list">${seats.map((s) => rosterSeatRow(s, selfId))}</ul>`
      : "";
  return html`<p class="builder-msg" id="kh-roster-msg" hidden role="status" aria-live="polite"></p>
    <p class="muted">Revoke removes someone from this desk after two keyholders confirm. It does not change the Sparrow descriptor. <a href="${href("/reviewers", "?tab=keyholders")}">Seat a replacement</a>.</p>
    ${group("Waiting to sit", waiting)}
    ${group("Sitting", sitting)}`.value;
}

export async function renderKeyholders(
  shell: KeyholdersShell,
  user: AuthUser | null,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const rerender = () => void renderKeyholders(shell, user);
  const activeSeats = await loadActiveSeats();
  if (!user) {
    app.innerHTML = shell(html`
      <section class="wrap-wide detail keyholders-page">
        <header class="declined-head">
          <h1>Keyholders</h1>
          <p class="lede">${coldStartLede("sign_in", activeSeats)}</p>
        </header>
        ${raw(keyholderOnboardHtml({ signedIn: false, canApply: false, activeSeats }))}
      </section>
    `.value);
    return;
  }

  const meRes = await authFetch(`${api()}/keyholders/me`);
  const meBody = meRes.ok
    ? ((await meRes.json()) as {
        keyholder: KeyholderMe | null;
        earnings_sats?: number;
        cashed_out_sats?: number;
        balance_sats?: number;
        can_apply?: boolean;
        application?: KeyholderOnboardApplication | null;
      })
    : { keyholder: null, earnings_sats: 0, balance_sats: 0, can_apply: false, application: null };
  const kh = meBody.keyholder;
  const earnings = meBody.earnings_sats || 0;
  const balance = meBody.balance_sats ?? earnings;
  const onboardInput: KeyholderOnboardInput = {
    signedIn: true,
    canApply: Boolean(meBody.can_apply),
    application: meBody.application,
    keyholder: kh,
    activeSeats,
  };
  const phase = keyholderOnboardPhase(onboardInput);

  if (!kh || kh.status !== "active") {
    app.innerHTML = shell(html`
      <section class="wrap-wide detail keyholders-page">
        <header class="declined-head">
          <h1>Keyholders</h1>
          <p class="lede">${coldStartLede(phase, activeSeats)}</p>
        </header>
        ${raw(keyholderOnboardHtml(onboardInput))}
      </section>
    `.value);
    bindKhApplyForm(app, { onApplied: rerender });
    bindKeyholderKeys(app, { onSaved: rerender });
    return;
  }

  app.innerHTML = shell(html`
    <section class="wrap-wide detail keyholders-page">
      <header class="declined-head">
        <p class="eyebrow">Keyholders · Ops</p>
        <h1>Keyholders</h1>
        <p class="lede">${keyholderOnboardLede("active")}</p>
        <p class="kh-seat">Seated as @${kh.github}${
          kh.fingerprint
            ? html` · <code class="mono">${kh.fingerprint}</code>`
            : ""
        }. <a href="${href("/keyholder-responsibilities")}">Responsibilities</a></p>
        <div class="kh-balance">
          <p class="kh-balance-amt"><span>Spendable</span><strong>${formatSats(balance)}</strong></p>
          <p class="kh-earnings">Accrued ${formatSats(earnings)}</p>
          <button type="button" class="btn ghost" id="kh-cashout">Pay out</button>
          <button type="button" class="btn ghost" id="kh-join-sheet-dl" title="Public Signet 2-of-3 descriptor xpubs only — no seeds">Download Signet join sheet</button>
        </div>
        <div id="kh-cashout-detail" hidden></div>
        <div class="lifecycle-banner" id="kh-relogin" hidden role="status">
          <span class="lifecycle-k">Log in again</span>
          <p>Keyholder changes need a GitHub login from the last 12 hours. Log in again and you come back to this page.</p>
          <a class="btn" id="kh-relogin-link" href="#">Log in with GitHub</a>
        </div>
        ${
          kh.keys_stale
            ? `<div class="lifecycle-banner lifecycle-warn" role="status"><span class="lifecycle-k">Keys older than 1 year</span><p>Re-confirm fingerprint + xpub below.</p></div>`
            : ""
        }
      </header>
      ${
        kh.keys_stale
          ? raw(keyholderKeysFormHtml({
              fingerprint: kh.fingerprint,
              xpub: kh.xpub,
              heading: "Re-confirm keys",
            }))
          : ""
      }
      <div class="kh-session-bar">
        <p class="muted" id="kh-session-state">Before an upload, confirm the wallet saved for this seat.</p>
        <button type="button" class="btn ghost btn-compact" id="kh-session-open">Start the check</button>
      </div>
      <div class="site-modal" id="kh-session" hidden>
        <div class="site-modal-backdrop" data-kh-session-close tabindex="-1" aria-hidden="true"></div>
        <div class="site-modal-card kh-session-card" role="dialog" aria-modal="true" aria-labelledby="kh-session-title">
          <button type="button" class="site-modal-close" data-kh-session-close aria-label="Close">${raw(solidIcon("xmark"))}</button>
          <h2 id="kh-session-title" tabindex="-1">Why this check exists</h2>
          ${raw(keyholderProofWizardHtml(kh.auth_address || "", user.payout_address || ""))}
        </div>
      </div>
      <div id="kh-page-toast-host" class="kh-page-toast-host" hidden></div>
      <div class="kh-desk-queues">
        <h2 class="kh-desk-queues-title">Signing queues</h2>
        <div class="account-tabs" role="tablist" aria-label="Disbursement queues">
          <button type="button" class="account-tab active" role="tab" id="kh-tab-release" data-kh-tab="release" data-kh-label="Releases" aria-selected="true" aria-controls="kh-queue" tabindex="0">Releases</button>
          <button type="button" class="account-tab" role="tab" id="kh-tab-branch" data-kh-tab="branch" data-kh-label="Branches" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Branches</button>
          <button type="button" class="account-tab" role="tab" id="kh-tab-bond_refund" data-kh-tab="bond_refund" data-kh-label="Bond refunds" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Bond refunds</button>
          <button type="button" class="account-tab" role="tab" id="kh-tab-contrib_refund" data-kh-tab="contrib_refund" data-kh-label="Contributor refunds" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Contributor refunds</button>
          <button type="button" class="account-tab" role="tab" id="kh-tab-roster" data-kh-tab="roster" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Roster</button>
        </div>
        <div id="kh-queue" class="kh-queue" role="tabpanel" aria-labelledby="kh-tab-release" aria-live="polite"><p class="muted">Loading…</p></div>
      </div>
      <div class="site-modal" id="kh-revoke-modal" hidden>
        <div class="site-modal-backdrop" data-kh-revoke-close tabindex="-1" aria-hidden="true"></div>
        <div class="site-modal-card kh-desk-card" role="dialog" aria-modal="true" aria-labelledby="kh-revoke-title">
          <button type="button" class="site-modal-close" data-kh-revoke-close aria-label="Close">${raw(solidIcon("xmark"))}</button>
          <h2 class="proposal-block-title" id="kh-revoke-title" tabindex="-1">Revoke</h2>
          <p class="muted" id="kh-revoke-copy"></p>
          <label class="donate-amount-label" for="kh-revoke-reason">Reason</label>
          <textarea id="kh-revoke-reason" class="comment-input" rows="3" maxlength="500"></textarea>
          <p class="muted" id="kh-revoke-reason-read" hidden></p>
          <p class="builder-msg" id="kh-revoke-msg" hidden role="status"></p>
          <div class="comment-compose-actions">
            <button type="button" class="btn" id="kh-revoke-submit" disabled>Attest revoke</button>
          </div>
        </div>
      </div>
      <div class="site-modal" id="kh-detail-modal" hidden>
        <div class="site-modal-backdrop" data-kh-detail-close tabindex="-1" aria-hidden="true"></div>
        <div class="site-modal-card kh-desk-card" role="dialog" aria-modal="true" aria-labelledby="kh-detail-title">
          <button type="button" class="site-modal-close" data-kh-detail-close aria-label="Close">${raw(solidIcon("xmark"))}</button>
          <div id="kh-detail"></div>
        </div>
      </div>
    </section>
  `.value);

  const queueEl = app.querySelector<HTMLElement>("#kh-queue")!;
  const detailEl = app.querySelector<HTMLElement>("#kh-detail")!;
  const detailModal = app.querySelector<HTMLElement>("#kh-detail-modal")!;
  const cashoutEl = app.querySelector<HTMLElement>("#kh-cashout-detail")!;
  let kind = "release";
  let challengeMessage = "";
  let challengeSeq = 0;
  let signerNames: Record<string, string> = {};
  let cashoutB64 = "";
  let lastDeskOpener: HTMLButtonElement | null = null;
  let detailKeyHandler: ((ev: KeyboardEvent) => void) | null = null;
  let openBranch: { proposalId: string; allocationId: string } | null = null;
  let openDisburse: string | null = null;
  let persistOpenSettleDraft: () => void = () => {};

  const labelDetailDialog = () => {
    const card = detailModal.querySelector<HTMLElement>("[role='dialog']");
    const title = detailEl.querySelector<HTMLElement>(
      "#kh-detail-title, #kh-branch-title",
    );
    if (card && title?.id) card.setAttribute("aria-labelledby", title.id);
  };
  const closeDetailModal = () => {
    const wasOpen = !detailModal.hidden;
    detailModal.hidden = true;
    detailEl.innerHTML = "";
    openBranch = null;
    openDisburse = null;
    document.body.classList.remove("modal-open");
    if (detailKeyHandler) {
      document.removeEventListener("keydown", detailKeyHandler);
      detailKeyHandler = null;
    }
    if (wasOpen) lastDeskOpener?.focus();
  };
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const showPageToast = (message: string) => {
    const host = app.querySelector<HTMLElement>("#kh-page-toast-host");
    if (!host) return;
    host.hidden = false;
    host.innerHTML = keyholderPageToastHtml(message);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      host.innerHTML = "";
      host.hidden = true;
      toastTimer = null;
    }, 6000);
    host.querySelector("[data-kh-toast-dismiss]")?.addEventListener("click", () => {
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = null;
      host.innerHTML = "";
      host.hidden = true;
    });
  };
  /** Close modal, refresh queue, surface settle result on the desk (not inside the popup). */
  const settleSuccess = (opts: {
    outcome: "settled" | "proposed_waiting";
    txid?: string | null;
    proposalId?: string;
  }) => {
    if (opts.proposalId) clearSettleDraft(opts.proposalId);
    closeDetailModal();
    void loadQueue();
    showPageToast(keyholderSettleToastText(opts));
  };
  const showDetailModal = () => {
    detailModal.hidden = false;
    document.body.classList.add("modal-open");
    labelDetailDialog();
    if (detailKeyHandler) return;
    detailKeyHandler = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (document.querySelector(".confirm-modal")) return;
      ev.preventDefault();
      closeDetailModal();
    };
    document.addEventListener("keydown", detailKeyHandler);
  };

  let sessionKeyHandler: ((ev: KeyboardEvent) => void) | null = null;
  const closeSignSession = () => {
    const session = app.querySelector<HTMLElement>("#kh-session");
    if (session) session.hidden = true;
    if (sessionKeyHandler) {
      document.removeEventListener("keydown", sessionKeyHandler);
      sessionKeyHandler = null;
    }
    app.querySelector<HTMLButtonElement>("#kh-session-open")?.focus();
  };
  const showProofStep = (step: string) => {
    const titles: Record<string, string> = {
      why: "Why this check exists",
      address: "Your receive address",
      sign: "Sign a message in Sparrow",
    };
    const n = step === "address" ? 2 : step === "sign" ? 3 : 1;
    app.querySelectorAll<HTMLElement>("[data-kh-wizard]").forEach((el) => {
      el.hidden = el.dataset.khWizard !== step;
    });
    const progress = app.querySelector<HTMLElement>("#kh-wizard-progress");
    if (progress) progress.textContent = `Step ${n} of 3`;
    const title = app.querySelector<HTMLElement>("#kh-session-title");
    if (title) title.textContent = titles[step] || titles.why;
    title?.focus();
    if (step === "sign") void loadChallenge();
    else resetChallenge();
  };
  const resetChallenge = () => {
    challengeSeq += 1;
    challengeMessage = "";
    const el = app.querySelector<HTMLElement>("#kh-challenge-msg");
    const paste = app.querySelector<HTMLElement>("#kh-wizard-paste");
    const sig = app.querySelector<HTMLTextAreaElement>("#kh-challenge-sig");
    const status = app.querySelector<HTMLElement>("#kh-challenge-status");
    const retry = app.querySelector<HTMLButtonElement>("#kh-challenge");
    if (el) {
      el.hidden = true;
      el.textContent = "";
    }
    if (paste) paste.hidden = true;
    if (sig) sig.value = "";
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }
    if (retry) retry.hidden = true;
  };
  const loadChallenge = async () => {
    const seq = ++challengeSeq;
    challengeMessage = "";
    const el = app.querySelector<HTMLElement>("#kh-challenge-msg");
    const paste = app.querySelector<HTMLElement>("#kh-wizard-paste");
    const sig = app.querySelector<HTMLTextAreaElement>("#kh-challenge-sig");
    const status = app.querySelector<HTMLElement>("#kh-challenge-status");
    const retry = app.querySelector<HTMLButtonElement>("#kh-challenge");
    if (sig) sig.value = "";
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }
    if (paste) paste.hidden = true;
    if (retry) retry.hidden = true;
    if (el) {
      el.hidden = false;
      el.textContent = "Loading a message to sign…";
    }
    const res = await authFetch(`${api()}/keyholders/challenge`);
    if (seq !== challengeSeq) return;
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    challengeMessage = res.ok ? body.message || "" : "";
    if (el) {
      el.hidden = false;
      el.textContent = challengeMessage || body.error || "Could not load a message to sign.";
    }
    if (paste) paste.hidden = !challengeMessage;
    if (retry) retry.hidden = Boolean(challengeMessage);
  };
  const openSignSession = () => {
    const session = app.querySelector<HTMLElement>("#kh-session");
    if (!session) return;
    showProofStep("why");
    session.hidden = false;
    if (!sessionKeyHandler) {
      sessionKeyHandler = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        closeSignSession();
      };
      document.addEventListener("keydown", sessionKeyHandler);
    }
    app.querySelector<HTMLElement>("#kh-session-title")?.focus();
  };
  const noteSignSession = (message: string) => {
    if (!/bitcoin-key session/i.test(message)) return;
    const state = app.querySelector<HTMLElement>("#kh-session-state");
    if (state) {
      state.dataset.live = "needed";
      state.textContent = "Confirm the wallet saved for this seat, then try the upload again.";
    }
    openSignSession();
  };

  const captureReturn = () => {
    const session = app.querySelector<HTMLElement>("#kh-session");
    const visible = [...app.querySelectorAll<HTMLElement>("[data-kh-wizard]")].find(
      (el) => !el.hidden,
    );
    const step = visible?.dataset.khWizard;
    saveKeyholderReturnState({
      step: step === "why" || step === "sign" || step === "address" ? step : "address",
      address: app.querySelector<HTMLInputElement>("#kh-auth-addr")?.value || "",
      tab: kind,
      wizardOpen: Boolean(session && !session.hidden),
      branch: openBranch || undefined,
      disburseId: openDisburse || undefined,
    });
  };

  const noteStaleSession = (message: string): string => {
    if (!keyholderSessionStale(message)) return message;
    persistOpenSettleDraft();
    const href = githubLoginUrl(currentReturnPath());
    const box = app.querySelector<HTMLElement>("#kh-relogin");
    const link = app.querySelector<HTMLAnchorElement>("#kh-relogin-link");
    const inline = app.querySelector<HTMLAnchorElement>("#kh-relogin-inline");
    if (link) link.href = href;
    if (inline) {
      inline.href = href;
      inline.hidden = false;
    }
    if (box) box.hidden = false;
    captureReturn();
    void logout().finally(() => {
      window.location.assign(href);
    });
    return "Signing you out. A keyholder change needs a new GitHub login.";
  };

  const loadSignerNames = async () => {
    try {
      const res = await fetch(`${api()}/keyholders/public`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        keyholders?: { user_id?: string; github?: string }[];
      };
      const next: Record<string, string> = {};
      for (const row of data.keyholders || []) {
        if (row.user_id && row.github) next[row.user_id] = row.github;
      }
      signerNames = next;
    } catch {
      signerNames = {};
    }
  };

  const loadQueue = async () => {
    queueEl.setAttribute("aria-busy", "true");
    if (kind === "branch") {
      const res = await authFetch(`${api()}/keyholders/branch-queue`);
      if (!res.ok) {
        queueEl.innerHTML = `<p class="muted">Could not load branch queue.</p>`;
        queueEl.removeAttribute("aria-busy");
        return;
      }
      const data = (await res.json()) as { items: BranchSignDeskItem[] };
      if (!data.items.length) {
        queueEl.innerHTML = keyholderQueueEmptyHtml(
          "Nothing to sign",
          "No selected bounty branches ready to sign.",
        );
        queueEl.removeAttribute("aria-busy");
        return;
      }
      queueEl.innerHTML = html`<ul class="declined-list">${data.items.map(
        (item) => {
          const chip = branchSignChipLabel(item);
          return html`<li class="declined-row">
            <button type="button" class="declined-title btn ghost" data-branch="${item.proposal_id}" data-alloc="${item.allocation_id}" aria-label="${item.proposal_id} ${item.kind} ${chip}">${item.proposal_id} · ${item.allocation_id}</button>
            <p class="kh-queue-purpose">${keyholderTxPurpose(item.kind)}</p>
            <span class="declined-meta"><span class="pill">${item.kind}</span>
            <span class="kh-sign-chip">${chip}</span>
            ${item.state === "settled" ? "" : html`<span class="pill">${item.state}</span>`}</span>
          </li>`;
        },
      )}</ul>`.value;
      queueEl.querySelectorAll<HTMLButtonElement>("[data-branch]").forEach((btn) => {
        btn.addEventListener("click", () => {
          lastDeskOpener = btn;
          void openBranchDetail(btn.dataset.branch || "", btn.dataset.alloc || "");
        });
      });
      queueEl.removeAttribute("aria-busy");
      return;
    }
    const res = await authFetch(
      `${api()}/disburse/queue?kind=${encodeURIComponent(kind)}`,
    );
    if (!res.ok) {
      queueEl.innerHTML = `<p class="muted">Could not load queue.</p>`;
      queueEl.removeAttribute("aria-busy");
      return;
    }
    const data = (await res.json()) as { items: DisburseItem[] };
    if (!data.items.length) {
      queueEl.innerHTML = keyholderQueueEmptyHtml(
        "Nothing to sign",
        `No open ${kind.replace(/_/g, " ")} items.`,
      );
      queueEl.removeAttribute("aria-busy");
      return;
    }
    queueEl.innerHTML = html`<ul class="declined-list">${data.items.map((item) => {
      const sum = item.outputs.reduce((a, o) => a + o.amount_sats, 0);
      const waiting = item.outputs.length === 0;
      const lines = item.line_items?.length || 0;
      const signed = item.partials?.length || 0;
      const need = item.required_threshold || 0;
      return html`<li class="declined-row">
          <button type="button" class="declined-title btn ghost" data-disburse="${item.id}" aria-label="${item.period || item.proposal_id} ${item.state}${need ? ` ${signatureProgressLabel(signed, need)}` : ""}">${item.period || item.proposal_id}</button>
          <p class="kh-queue-purpose">${keyholderTxPurpose(item.kind)}</p>
          <span class="declined-meta"><span class="pill">${item.state}</span>
          ${item.monthly_accruing ? html`<span class="pill">accruing</span>` : ""}
          ${lines ? html`<span class="muted">${lines} bount${lines === 1 ? "y" : "ies"}</span>` : ""}
          ${need ? html`<span class="kh-sign-chip">${signatureProgressLabel(signed, need)}</span>` : ""}
          ${waiting ? html`<span class="pill">waiting on address</span>` : html`<span class="muted">${formatSats(sum)}</span>`}
          </span>
        </li>`;
    })}</ul>`.value;
    queueEl.querySelectorAll<HTMLButtonElement>("[data-disburse]").forEach((btn) => {
      btn.addEventListener("click", () => {
        lastDeskOpener = btn;
        void openDetail(btn.dataset.disburse || "");
      });
    });
    queueEl.removeAttribute("aria-busy");
  };

  const openBranchDetail = async (proposalId: string, allocationId: string) => {
    openBranch = { proposalId, allocationId };
    openDisburse = null;
    const res = await authFetch(
      `${api()}/keyholders/branch-sign/${encodeURIComponent(proposalId)}/${encodeURIComponent(allocationId)}`,
    );
    if (!res.ok) {
      detailEl.innerHTML = `<h2 class="proposal-block-title" id="kh-branch-title" tabindex="-1">Could not load</h2><p class="builder-msg bad" role="alert">Could not load branch.</p>`;
      showDetailModal();
      detailEl.querySelector<HTMLElement>("#kh-branch-title")?.focus();
      return;
    }
    const data = (await res.json()) as { item: BranchSignDeskItem };
    const item = data.item;
    detailEl.innerHTML = branchSignDeskHtml(item, {
      userId: kh.user_id,
      signerNames,
    });
    showDetailModal();
    detailEl.querySelector<HTMLElement>("#kh-branch-title")?.focus();
    const branchGate = bindHashGate({
      input: detailEl.querySelector<HTMLTextAreaElement>("#kh-branch-verify"),
      status: detailEl.querySelector<HTMLElement>("#kh-branch-hash-status"),
      publishedHash: item.published_sha256,
      action: detailEl.querySelector<HTMLButtonElement>("#kh-branch-sign"),
      enableActionWithoutHash: false,
      alsoRequire: detailEl.querySelector<HTMLTextAreaElement>("#kh-branch-partial"),
      alsoRequireEmptyReason: "Paste a signed partial to enable",
      disabledReason:
        "Paste a matching unsigned Release PSBT (base64) to enable — not a settle txid",
      enabledReason: "Hash matches and signed partial ready — upload signature",
    });
    detailEl.querySelector("#kh-branch-dl")?.addEventListener("click", () => {
      if (!item.psbt_base64) return;
      downloadBase64File(
        item.psbt_base64,
        `${item.proposal_id}-${item.allocation_id}-unsigned.psbt`,
      );
      void branchGate.acceptDownload(item.psbt_base64);
    });
    const setMsg = (t: string) => {
      const el = detailEl.querySelector<HTMLElement>("#kh-branch-msg");
      if (!el) return;
      const text = noteStaleSession(t);
      el.hidden = !text;
      el.textContent = text;
      noteSignSession(text);
    };
    detailEl.querySelector("#kh-branch-copy")?.addEventListener("click", async () => {
      if (!item.psbt_base64) return;
      const ok = await copyText(item.psbt_base64);
      setMsg(ok ? "Unsigned PSBT base64 copied." : "Could not copy unsigned PSBT.");
      if (ok) void branchGate.acceptDownload(item.psbt_base64);
    });
    detailEl.querySelector("#kh-branch-sign")?.addEventListener("click", async () => {
      const btn = detailEl.querySelector<HTMLButtonElement>("#kh-branch-sign");
      if (btn?.disabled) {
        setMsg("Verify the published SHA-256 before uploading a signature.");
        return;
      }
      const b64 =
        detailEl.querySelector<HTMLTextAreaElement>("#kh-branch-partial")?.value.trim() ||
        "";
      if (!b64) {
        setMsg("Paste a signed partial.");
        return;
      }
      const ok = await confirmAction({
        title: "Upload signature",
        body: "Store your signature on the selected branch. The Worker will not broadcast.",
        confirmLabel: "Upload",
      });
      if (!ok) return;
      const res = await authFetchWithTos(
        `${api()}/keyholders/branch-sign/${encodeURIComponent(item.proposal_id)}/${encodeURIComponent(item.allocation_id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            psbt_base64: b64,
            published_sha256: item.published_sha256,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        threshold_met?: boolean;
        broadcast?: boolean;
      };
      setMsg(
        res.ok
          ? body.threshold_met
            ? "Threshold met — download the combined transaction and broadcast in Sparrow."
            : "Partial stored"
          : body.error || "Sign failed",
      );
      if (res.ok) {
        void openBranchDetail(item.proposal_id, item.allocation_id);
        void loadQueue();
      }
    });
    detailEl.querySelector("#kh-branch-combined")?.addEventListener("click", async () => {
      const dl = await authFetch(
        `${api()}/keyholders/branch-sign/${encodeURIComponent(item.proposal_id)}/${encodeURIComponent(item.allocation_id)}/combined`,
      );
      if (!dl.ok) {
        setMsg("Combined transaction is not ready.");
        return;
      }
      const blob = await dl.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item.proposal_id}-${item.allocation_id}.psbt`;
      a.click();
      URL.revokeObjectURL(url);
    });
    detailEl.querySelector("#kh-branch-propose")?.addEventListener("click", async () => {
      const txid =
        detailEl.querySelector<HTMLInputElement>("#kh-branch-txid")?.value.trim() ||
        "";
      if (!txid) {
        setMsg("Paste the broadcast txid.");
        return;
      }
      const ok = await confirmAction({
        title: "Propose settle",
        body: "Confirm this txid pays every output on the selected branch. A second keyholder must confirm. The Worker will not broadcast.",
        confirmLabel: "Propose",
      });
      if (!ok) return;
      const res = await authFetch(
        `${api()}/keyholders/branch-sign/${encodeURIComponent(item.proposal_id)}/${encodeURIComponent(item.allocation_id)}/propose-settle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txid }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        missing?: { address: string; amount_sats: number }[];
      };
      if (res.ok) {
        settleSuccess({
          outcome: "proposed_waiting",
          txid,
        });
        return;
      }
      const miss = body.missing?.length
        ? ` Missing: ${body.missing
            .map((m) => `${m.address} (${m.amount_sats} sats)`)
            .join("; ")}`
        : "";
      setMsg((body.error || "Failed") + miss);
    });
    detailEl.querySelector("#kh-branch-confirm")?.addEventListener("click", async () => {
      const btn = detailEl.querySelector<HTMLButtonElement>("#kh-branch-confirm");
      if (btn?.disabled) {
        setMsg("A second keyholder must confirm settle.");
        return;
      }
      const ok = await confirmAction({
        title: "Confirm settle",
        body: "Second keyholder confirmation. Re-verifies the txid against the selected branch outputs.",
        confirmLabel: "Confirm",
        danger: true,
      });
      if (!ok) return;
      const res = await authFetch(
        `${api()}/keyholders/branch-sign/${encodeURIComponent(item.proposal_id)}/${encodeURIComponent(item.allocation_id)}/confirm-settle`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        settleSuccess({
          outcome: "settled",
          txid: item.settle_txid,
        });
        return;
      }
      setMsg(body.error || "Failed");
    });
  };

  const openDetail = async (id: string) => {
    openDisburse = id;
    openBranch = null;
    const res = await authFetch(`${api()}/disburse/${encodeURIComponent(id)}`);
    if (!res.ok) {
      detailEl.innerHTML = `<h2 class="proposal-block-title" id="kh-detail-title" tabindex="-1">Could not load</h2><p class="builder-msg bad" role="alert">Could not load item.</p>`;
      showDetailModal();
      detailEl.querySelector<HTMLElement>("#kh-detail-title")?.focus();
      return;
    }
    const data = (await res.json()) as {
      item: DisburseItem;
      requires_dual_settle: boolean;
      needs_ln_lockup?: boolean;
    };
    const item = data.item;
    const needsLn = Boolean(data.needs_ln_lockup);
    const canPsbt =
      item.outputs.length > 0 && !needsLn && !item.monthly_accruing;
    const isRelease = item.kind === "release";
    const signed = item.partials?.length || 0;
    const need = item.required_threshold || 0;
    const hasUnsigned = Boolean(
      item.addresses_frozen || item.psbts?.some((p) => p.kind === "unsigned") || item.psbts?.[0],
    );
    const canUnsigned = canPsbt && !(isRelease && signed > 0);
    const canPartial = isRelease && canPsbt && hasUnsigned;
    const canBroadcast = canPartial && need > 0 && signed >= need;
    detailEl.innerHTML = keyholderDeskHtml(item, {
      needsLn,
      canPsbt,
      canUnsigned,
      canPartial,
      canBroadcast,
      isRelease,
      requiresDualSettle: data.requires_dual_settle,
      userId: kh.user_id,
      signerNames,
    });
    showDetailModal();

    const txidInput = detailEl.querySelector<HTMLInputElement>("#kh-txid");
    persistOpenSettleDraft = () => {
      if (!txidInput || !item.proposal_id) return;
      saveSettleDraft({
        proposalId: item.proposal_id,
        disburseId: id,
        txid: txidInput.value,
      });
    };
    const saved = readSettleDraft(item.proposal_id);
    if (txidInput && !txidInput.value.trim() && saved?.disburseId === id) {
      txidInput.value = saved.txid;
    }
    txidInput?.addEventListener("input", () => persistOpenSettleDraft());

    detailEl.querySelector<HTMLElement>("#kh-detail-title")?.focus();

    const publishedHash = publishedUnsignedHash(item);
    const releaseGate = bindHashGate({
      input: detailEl.querySelector<HTMLTextAreaElement>("#kh-psbt-verify"),
      status: detailEl.querySelector<HTMLElement>("#kh-hash-status"),
      publishedHash,
      action: detailEl.querySelector<HTMLButtonElement>("#kh-sign"),
      enableActionWithoutHash: canPartial,
      alsoRequire: detailEl.querySelector<HTMLTextAreaElement>("#kh-psbt-partial"),
      alsoRequireEmptyReason: "Paste a signed partial to enable",
      disabledReason:
        "Paste a matching unsigned PSBT (base64) to enable — not a settle txid",
      enabledReason: "Hash matches and signed partial ready — upload signature",
    });

    const setMsg = (t: string) => {
      const el = detailEl.querySelector<HTMLElement>("#kh-settle-msg");
      if (!el) return;
      const text = noteStaleSession(t);
      el.hidden = !text;
      el.textContent = text;
      noteSignSession(text);
    };

    detailEl.querySelector("#kh-lockup-save")?.addEventListener("click", async () => {
      const lockup =
        detailEl.querySelector<HTMLInputElement>("#kh-lockup")?.value.trim() ||
        "";
      if (!lockup) {
        setMsg("Paste the Boltz lockup address.");
        return;
      }
      const res = await authFetch(`${api()}/disburse/${id}/lockup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockup_address: lockup }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(res.ok ? "Lockup attached." : body.error || "Could not attach lockup");
      if (res.ok) void openDetail(id);
    });

    detailEl.querySelector("#kh-sign")?.addEventListener("click", async () => {
      const signBtn = detailEl.querySelector<HTMLButtonElement>("#kh-sign");
      if (signBtn?.disabled) {
        setMsg("Verify the published SHA-256 before uploading a signature.");
        return;
      }
      const b64 = detailEl.querySelector<HTMLTextAreaElement>("#kh-psbt-partial")?.value.trim() || "";
      if (!b64) {
        setMsg("Paste a partial PSBT.");
        return;
      }
      const wouldComplete = need > 0 && signed + 1 >= need;
      const ok = await confirmAction({
        title: wouldComplete ? "Upload partial and broadcast" : "Upload partial",
        body: wouldComplete
          ? "This signature may complete the threshold. The Worker will try to broadcast."
          : "Store your signature on the frozen PSBT.",
        confirmLabel: wouldComplete ? "Sign and broadcast" : "Upload",
        danger: wouldComplete,
      });
      if (!ok) return;
      const res = await authFetchWithTos(`${api()}/disburse/${id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ psbt_base64: b64 }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        threshold_met?: boolean;
        broadcast?: boolean;
        txid?: string;
      };
      setMsg(
        res.ok
          ? body.broadcast
            ? `Broadcast ${body.txid}`
            : body.threshold_met
              ? "Threshold met — broadcast if ready"
              : "Partial stored"
          : body.error || "Sign failed",
      );
      if (res.ok) void openDetail(id);
    });

    detailEl.querySelector("#kh-broadcast")?.addEventListener("click", async () => {
      const sum = item.outputs.reduce((a, o) => a + o.amount_sats, 0);
      const ok = await confirmAction({
        title: "Broadcast",
        body: `Broadcast the combined transaction (${item.outputs.length} outputs, ${formatSats(sum)}).`,
        confirmLabel: "Broadcast",
        danger: true,
      });
      if (!ok) return;
      const res = await authFetchWithTos(`${api()}/disburse/${id}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        txid?: string;
      };
      setMsg(res.ok ? `Broadcast ${body.txid}` : body.error || "Broadcast failed");
      if (res.ok) void openDetail(id);
    });

    detailEl.querySelector("#kh-psbt-upload")?.addEventListener("click", async () => {
      if (!canUnsigned) {
        setMsg(
          item.monthly_accruing
            ? "Month still accruing."
            : needsLn
              ? "Attach Boltz lockup first."
              : signed > 0
                ? "Unsigned PSBT is frozen."
                : "No outputs yet.",
        );
        return;
      }
      const b64 = detailEl.querySelector<HTMLTextAreaElement>("#kh-psbt-unsigned")?.value.trim() || "";
      if (!b64) {
        setMsg("Paste an unsigned PSBT.");
        return;
      }
      const outs = item.outputs
        .map(
          (o) =>
            `${o.label || "out"}: ${o.address} · ${formatSats(o.amount_sats)}`,
        )
        .join("\n");
      const ok = await confirmAction({
        title: "Upload PSBT",
        body: `Confirm this PSBT pays exactly these outputs (addresses freeze after upload):\n\n${outs}`,
        confirmLabel: "Upload",
      });
      if (!ok) return;
      const res = await authFetchWithTos(`${api()}/disburse/${id}/psbt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ psbt_base64: b64 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(res.ok ? "PSBT uploaded." : body.error || "Upload failed");
      if (res.ok) void openDetail(id);
    });

    detailEl.querySelector("#kh-psbt-dl")?.addEventListener("click", async () => {
      const res = await authFetch(`${api()}/disburse/${id}/psbt`);
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const b64 = bytesToBase64(bytes);
      downloadBase64File(b64, `${item.proposal_id}.psbt`);
      void releaseGate.acceptDownload(b64);
    });

    detailEl.querySelector("#kh-propose")?.addEventListener("click", async () => {
      if (!canPsbt) {
        setMsg(
          needsLn
            ? "Attach Boltz lockup for the Lightning payout first."
            : "No outputs yet — waiting on refund/payout addresses.",
        );
        return;
      }
      persistOpenSettleDraft();
      const token = sessionStorage.getItem("plebly_session");
      if (keyholderSessionNeedsReauth(token)) {
        const href = githubLoginUrl(currentReturnPath());
        const box = app.querySelector<HTMLElement>("#kh-relogin");
        const link = app.querySelector<HTMLAnchorElement>("#kh-relogin-link");
        const inline = app.querySelector<HTMLAnchorElement>("#kh-relogin-inline");
        if (link) link.href = href;
        if (inline) {
          inline.href = href;
          inline.hidden = false;
        }
        if (box) box.hidden = false;
        captureReturn();
        setMsg("This login is about to expire for keyholder actions. Log in again — the settle txid stays on this proposal.");
        return;
      }
      const txid = detailEl.querySelector<HTMLInputElement>("#kh-txid")?.value || "";
      const panel = detailEl.querySelector<HTMLElement>("#kh-verify-panel");
      if (panel) panel.hidden = false;
      const ok = await confirmAction({
        title: "Propose settle",
        body: `Confirm this txid pays every output listed (${item.outputs.length} outputs).${
          data.requires_dual_settle
            ? " A second keyholder must confirm before status becomes settled."
            : ""
        } Dual-ack is the fallback if broadcast fails.`,
        confirmLabel: "Propose",
      });
      if (!ok) return;
      const res = await authFetch(`${api()}/disburse/${id}/propose-settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txid }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        missing?: { address: string; amount_sats: number }[];
      };
      if (res.ok) {
        settleSuccess({
          outcome: data.requires_dual_settle ? "proposed_waiting" : "settled",
          txid,
          proposalId: item.proposal_id,
        });
      } else {
        const miss = body.missing?.length
          ? ` Missing: ${body.missing
              .map((m) => `${m.address} (${m.amount_sats} sats)`)
              .join("; ")}`
          : "";
        setMsg((body.error || "Failed") + miss);
      }
    });

    detailEl.querySelector("#kh-confirm")?.addEventListener("click", async () => {
      const ok = await confirmAction({
        title: "Confirm settle",
        body: "Second keyholder confirmation. Re-verifies the txid on-chain.",
        confirmLabel: "Confirm",
        danger: true,
      });
      if (!ok) return;
      const res = await authFetch(`${api()}/disburse/${id}/confirm-settle`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        settleSuccess({
          outcome: "settled",
          txid: item.settle_txid || detailEl.querySelector<HTMLInputElement>("#kh-txid")?.value,
          proposalId: item.proposal_id,
        });
        return;
      }
      setMsg(body.error || "Failed");
    });

    const chatEl = detailEl.querySelector<HTMLElement>("#kh-chat");
    const loadChat = async () => {
      const res = await authFetch(`${api()}/disburse/${id}/chat`);
      if (!res.ok || !chatEl) return;
      const data = (await res.json()) as {
        messages: { author: string; body: string; created_at: string }[];
      };
      chatEl.innerHTML = data.messages.length
        ? html`${data.messages.map(
            (m) =>
              html`<p><strong>@${m.author}</strong> <span class="muted">${m.created_at.slice(0, 16)}</span><br />${m.body}</p>`,
          )}`.value
        : `<p class="muted">No messages yet.</p>`;
    };
    void loadChat();
    detailEl.querySelector("#kh-chat-send")?.addEventListener("click", async () => {
      const input = detailEl.querySelector<HTMLTextAreaElement>("#kh-chat-input");
      const body = input?.value.trim() || "";
      if (!body) return;
      await authFetch(`${api()}/disburse/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (input) input.value = "";
      void loadChat();
    });
  };

  app.querySelector("#kh-challenge")?.addEventListener("click", () => {
    void loadChallenge();
  });
  app.querySelector("#kh-challenge-copy")?.addEventListener("click", async () => {
    const ok = await copyText(challengeMessage);
    const el = app.querySelector<HTMLElement>("#kh-challenge-status");
    if (el) {
      el.hidden = false;
      el.textContent = ok
        ? "Copied."
        : "Copy failed — select the message manually.";
    }
  });
  app.querySelector("#kh-challenge-verify")?.addEventListener("click", async () => {
    const address =
      app.querySelector<HTMLInputElement>("#kh-auth-addr")?.value.trim() || "";
    const signature =
      app.querySelector<HTMLTextAreaElement>("#kh-challenge-sig")?.value.trim() ||
      "";
    const el = app.querySelector<HTMLElement>("#kh-challenge-status");
    if (!address || !signature) {
      if (el) {
        el.hidden = false;
        el.textContent = "Address and signature required.";
      }
      return;
    }
    const res = await authFetch(`${api()}/keyholders/challenge/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (el) {
      el.hidden = false;
      el.textContent = res.ok
        ? "Checked. This browser can upload signatures for 15 minutes."
        : body.error || "Could not check that signature.";
    }
    const state = app.querySelector<HTMLElement>("#kh-session-state");
    if (state) {
      state.dataset.live = res.ok ? "active" : "";
      state.textContent = res.ok
        ? "This browser can upload signatures for 15 minutes."
        : "Before an upload, confirm the wallet saved for this seat.";
    }
    if (res.ok) closeSignSession();
  });

  app.querySelector("#kh-session-open")?.addEventListener("click", () => {
    openSignSession();
  });
  app.querySelector("#kh-wizard-save-addr")?.addEventListener("click", async () => {
    const input = app.querySelector<HTMLInputElement>("#kh-auth-addr");
    const msg = app.querySelector<HTMLElement>("#kh-auth-msg");
    const say = (t: string) => {
      if (!msg) return;
      const text = noteStaleSession(t);
      msg.hidden = !text;
      msg.textContent = text;
    };
    const addr = input?.value.trim() || "";
    if (!payoutLooksValid(addr, "onchain")) {
      say("Enter an on-chain receive address (tb1… or bc1…).");
      return;
    }
    const seatAddr = (kh.auth_address || "").trim();
    const matchesSeat =
      Boolean(seatAddr) && addr.toLowerCase() === seatAddr.toLowerCase();
    const seatReady = Boolean(seatAddr) && payoutLooksValid(seatAddr, "onchain");
    if (matchesSeat || (receiveAddressUnchanged(addr, input?.dataset.initial || "") && seatReady)) {
      const signWith = matchesSeat ? addr : seatAddr;
      if (input) input.value = signWith;
      const shown = app.querySelector<HTMLElement>("#kh-auth-shown");
      if (shown) shown.textContent = signWith;
      say("");
      showProofStep("sign");
      return;
    }
    const btn = app.querySelector<HTMLButtonElement>("#kh-wizard-save-addr");
    if (btn) btn.disabled = true;
    try {
      if (addr !== (user.payout_address || "").trim()) {
        await updateProfile({ payout_address: addr });
        user.payout_address = addr;
      }
      if (addr.toLowerCase() !== (kh.auth_address || "").trim().toLowerCase()) {
        if (!kh.fingerprint || !kh.xpub) {
          say("Saved on your Account. This seat has no wallet keys yet, so the signature check cannot run.");
          return;
        }
        const res = await authFetch(`${api()}/keyholders/me/keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fingerprint: kh.fingerprint,
            xpub: kh.xpub,
            auth_address: addr,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          say(body.error || "Saved on your Account, but the seat could not store this address.");
          return;
        }
        kh.auth_address = addr;
      }
      const shown = app.querySelector<HTMLElement>("#kh-auth-shown");
      if (shown) shown.textContent = addr;
      say("");
      showProofStep("sign");
    } catch (err) {
      say(err instanceof Error ? err.message : "Could not save the address.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  app.querySelector("#kh-auth-copy")?.addEventListener("click", async () => {
    const addr =
      app.querySelector<HTMLInputElement>("#kh-auth-addr")?.value.trim() || "";
    const el = app.querySelector<HTMLElement>("#kh-challenge-status");
    const ok = addr ? await copyText(addr) : false;
    if (el) {
      el.hidden = false;
      el.textContent = ok ? "Address copied." : "Could not copy the address.";
    }
  });
  app.querySelectorAll<HTMLButtonElement>("[data-kh-wizard-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showProofStep(btn.dataset.khWizardGo || "why");
    });
  });
  app.querySelectorAll("[data-kh-session-close]").forEach((el) => {
    el.addEventListener("click", () => closeSignSession());
  });
  app.querySelectorAll("[data-kh-detail-close]").forEach((el) => {
    el.addEventListener("click", () => closeDetailModal());
  });
  // #app uses overflow-x: clip, which traps position:fixed inside the page.
  // Mount the desk on body so it covers the viewport like the other popups.
  const revokeModal = app.querySelector<HTMLElement>("#kh-revoke-modal")!;
  document.body.appendChild(detailModal);
  document.body.appendChild(revokeModal);
  const page = app.querySelector(".keyholders-page");
  if (page) {
    const detach = new MutationObserver(() => {
      if (document.contains(page)) return;
      closeDetailModal();
      revokeModal.hidden = true;
      detailModal.remove();
      revokeModal.remove();
      detach.disconnect();
    });
    detach.observe(document.documentElement, { childList: true, subtree: true });
  }

  bindKeyholderKeys(app);

  let rosterSeats: RosterSeat[] = [];
  let rosterNote = "";
  let revokeTarget: RosterSeat | null = null;
  const closeRevoke = () => {
    revokeModal.hidden = true;
    revokeTarget = null;
    if (detailModal.hidden) document.body.classList.remove("modal-open");
  };
  const openRevoke = (seat: RosterSeat) => {
    revokeTarget = seat;
    const confirming = Boolean(seat.pending_revoke);
    const title = revokeModal.querySelector<HTMLElement>("#kh-revoke-title");
    const copy = revokeModal.querySelector<HTMLElement>("#kh-revoke-copy");
    const reason = revokeModal.querySelector<HTMLTextAreaElement>("#kh-revoke-reason");
    const reasonLabel = revokeModal.querySelector<HTMLElement>("label[for='kh-revoke-reason']");
    const written = revokeModal.querySelector<HTMLElement>("#kh-revoke-reason-read");
    const submit = revokeModal.querySelector<HTMLButtonElement>("#kh-revoke-submit");
    const err = revokeModal.querySelector<HTMLElement>("#kh-revoke-msg");
    if (title) title.textContent = confirming ? `Confirm revoke of @${seat.github}` : `Revoke @${seat.github}`;
    if (copy) {
      copy.textContent = confirming
        ? "A second confirmation removes them from this desk. The Sparrow descriptor stays as it is."
        : "This removes them from the keyholder desk after a second keyholder confirms. It does not change the Sparrow descriptor or coins already in escrow.";
    }
    if (reason) {
      reason.hidden = confirming;
      reason.value = "";
    }
    if (reasonLabel) reasonLabel.hidden = confirming;
    if (written) {
      written.hidden = !confirming;
      written.textContent = seat.revoke_reason || "";
    }
    if (submit) {
      submit.textContent = confirming ? "Confirm revoke" : "Attest revoke";
      submit.disabled = !confirming;
    }
    if (err) err.hidden = true;
    revokeModal.hidden = false;
    document.body.classList.add("modal-open");
    title?.focus();
  };
  revokeModal.querySelector("#kh-revoke-reason")?.addEventListener("input", () => {
    const reason = revokeModal.querySelector<HTMLTextAreaElement>("#kh-revoke-reason");
    const submit = revokeModal.querySelector<HTMLButtonElement>("#kh-revoke-submit");
    if (reason && submit && !reason.hidden) submit.disabled = reason.value.trim().length < 16;
  });
  revokeModal.querySelectorAll("[data-kh-revoke-close]").forEach((el) => {
    el.addEventListener("click", () => closeRevoke());
  });
  revokeModal.querySelector("#kh-revoke-submit")?.addEventListener("click", async () => {
    const seat = revokeTarget;
    if (!seat) return;
    const reasonEl = revokeModal.querySelector<HTMLTextAreaElement>("#kh-revoke-reason");
    const reason = seat.pending_revoke ? seat.revoke_reason || "" : reasonEl?.value.trim() || "";
    const err = revokeModal.querySelector<HTMLElement>("#kh-revoke-msg");
    if (reason.trim().length < 16) {
      if (err) {
        err.hidden = false;
        err.textContent = "Write at least 16 characters.";
      }
      return;
    }
    const submit = revokeModal.querySelector<HTMLButtonElement>("#kh-revoke-submit");
    if (submit) submit.disabled = true;
    const res = await authFetch(`${api()}/keyholders/${encodeURIComponent(seat.user_id)}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; keyholder?: { status?: string } };
    if (!res.ok) {
      const text = noteStaleSession(body.error || "Could not revoke.");
      if (err) {
        err.hidden = !text;
        err.textContent = text;
      }
      if (submit) submit.disabled = false;
      return;
    }
    rosterNote = body.keyholder?.status === "revoked"
      ? html`@${seat.github} revoked from the desk. The Sparrow descriptor is unchanged. <a href="${href("/reviewers", "?tab=keyholders")}">Seat a replacement</a>.`.value
      : html`Revoke of @${seat.github} attested. A second keyholder must confirm.`.value;
    closeRevoke();
    void loadRoster();
  });

  const loadRoster = async () => {
    const res = await authFetch(`${api()}/keyholders/roster`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      queueEl.innerHTML = html`<p class="builder-msg bad" role="alert">${noteStaleSession(body.error || "Could not load the roster.")}</p>`.value;
      return;
    }
    const data = (await res.json()) as { keyholders?: RosterSeat[] };
    rosterSeats = data.keyholders || [];
    queueEl.innerHTML = rosterSeats.length
      ? keyholderRosterHtml(rosterSeats, kh.user_id)
      : keyholderQueueEmptyHtml(
          "No seats listed",
          "Active and pending keyholders appear here when the roster has rows.",
        );
    const msg = queueEl.querySelector<HTMLElement>("#kh-roster-msg");
    if (msg && rosterNote) {
      msg.hidden = false;
      msg.innerHTML = rosterNote;
      rosterNote = "";
    }
    queueEl.querySelectorAll<HTMLButtonElement>("[data-coattest]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.coattest || "";
        const attest = await authFetch(
          `${api()}/keyholders/${encodeURIComponent(id)}/co-attest`,
          { method: "POST" },
        );
        const body = (await attest.json().catch(() => ({}))) as { error?: string };
        const line = queueEl.querySelector<HTMLElement>("#kh-roster-msg");
        if (!attest.ok) {
          const text = noteStaleSession(body.error || "Failed");
          if (line) {
            line.hidden = !text;
            line.textContent = text;
          }
          return;
        }
        rosterNote = html`Co-attested.`.value;
        void loadRoster();
      });
    });
    queueEl.querySelectorAll<HTMLButtonElement>("[data-kh-revoke]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const seat = rosterSeats.find((s) => s.user_id === btn.dataset.khRevoke);
        if (seat && !seat.revoke_attested_by_me) openRevoke(seat);
      });
    });
  };

  const setTab = (next: string, btn: HTMLButtonElement) => {
    kind = next;
    app.querySelectorAll<HTMLButtonElement>("[data-kh-tab]").forEach((t) => {
      const on = t === btn;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    queueEl.setAttribute("aria-labelledby", btn.id);
    closeDetailModal();
    if (kind === "roster") {
      void loadRoster();
    } else {
      void loadQueue();
    }
  };
  app.querySelectorAll<HTMLButtonElement>("[data-kh-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setTab(btn.dataset.khTab || "release", btn);
    });
  });
  app.querySelector(".account-tabs")?.addEventListener("keydown", (ev) => {
    const ke = ev as KeyboardEvent;
    if (ke.key !== "ArrowRight" && ke.key !== "ArrowLeft") return;
    const tabs = [
      ...app.querySelectorAll<HTMLButtonElement>("[data-kh-tab]"),
    ];
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    if (i < 0) return;
    ke.preventDefault();
    const next =
      tabs[(i + (ke.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    next.focus();
    setTab(next.dataset.khTab || "release", next);
  });

  const initial = keyholderTabFromSearch(
    typeof location !== "undefined" ? location.search : "",
  );
  const start = app.querySelector<HTMLButtonElement>(
    `[data-kh-tab="${initial}"]`,
  );

  app.querySelector("#kh-join-sheet-dl")?.addEventListener("click", () => {
    downloadTextFile(SIGNET_23_JOIN_SHEET, "plebly-signet-2of3-join-sheet.md", "text/markdown");
  });

  app.querySelector("#kh-cashout")?.addEventListener("click", async () => {
    const res = await authFetchWithTos(`${api()}/keyholders/me/cashout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      psbt_base64?: string;
      amount_sats?: number;
      payout_address?: string;
    };
    if (!res.ok || !body.psbt_base64 || !body.payout_address) {
      cashoutEl.hidden = false;
      cashoutEl.innerHTML = html`<p class="builder-msg bad" role="alert">${body.error || "Could not build the payout."}</p>`.value;
      return;
    }
    cashoutB64 = body.psbt_base64;
    cashoutEl.hidden = false;
    cashoutEl.innerHTML = cashoutDeskHtml({
      amount_sats: body.amount_sats || 0,
      payout_address: body.payout_address,
    });
    cashoutEl.querySelector("#kh-cashout-dl")?.addEventListener("click", () => {
      if (!cashoutB64) return;
      downloadBase64File(cashoutB64, "keyholder-payout-unsigned.psbt");
    });
    cashoutEl.querySelector("#kh-cashout-settle")?.addEventListener("click", async () => {
      const txid =
        cashoutEl.querySelector<HTMLInputElement>("#kh-cashout-txid")?.value.trim() ||
        "";
      const note = cashoutEl.querySelector<HTMLElement>("#kh-cashout-msg");
      if (!txid) {
        if (note) {
          note.hidden = false;
          note.textContent = "Paste the broadcast txid.";
        }
        return;
      }
      const settled = await authFetchWithTos(`${api()}/keyholders/me/cashout/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txid }),
      });
      const settledBody = (await settled.json().catch(() => ({}))) as { error?: string };
      if (note) {
        note.hidden = false;
        note.textContent = settled.ok
          ? "Payout recorded."
          : settledBody.error || "Could not record the payout.";
      }
      if (settled.ok) rerender();
    });
  });

  const resume = takeKeyholderReturnState();

  const paintQueueCount = (tab: string, n: number) => {
    const btn = app.querySelector<HTMLButtonElement>(`[data-kh-tab="${tab}"]`);
    const label = btn?.dataset.khLabel;
    if (!btn || !label) return;
    btn.textContent = n > 0 ? `${label} (${n})` : label;
  };
  const loadQueueCounts = async () => {
    const [disburse, branch] = await Promise.all([
      authFetch(`${api()}/disburse/queue?summary=1`).then(async (r) =>
        r.ok
          ? ((await r.json()) as { release?: number; bond_refund?: number; contrib_refund?: number })
          : {},
      ),
      authFetch(`${api()}/keyholders/branch-queue?summary=1`).then(async (r) =>
        r.ok ? ((await r.json()) as { count?: number }) : {},
      ),
    ]);
    paintQueueCount("release", disburse.release || 0);
    paintQueueCount("bond_refund", disburse.bond_refund || 0);
    paintQueueCount("contrib_refund", disburse.contrib_refund || 0);
    paintQueueCount("branch", branch.count || 0);
  };

  void loadSignerNames().finally(() => {
    const resumeTab = resume?.tab && resume.tab !== "release" ? resume.tab : "";
    const resumeBtn = resumeTab
      ? app.querySelector<HTMLButtonElement>(`[data-kh-tab="${resumeTab}"]`)
      : null;
    if (resumeBtn) {
      setTab(resumeTab, resumeBtn);
    } else if (start && initial !== "release") {
      setTab(initial, start);
    } else {
      void loadQueue();
    }
    void loadQueueCounts();
    if (resume?.wizardOpen) {
      openSignSession();
      const input = app.querySelector<HTMLInputElement>("#kh-auth-addr");
      if (input && resume.address) input.value = resume.address;
      const shown = app.querySelector<HTMLElement>("#kh-auth-shown");
      if (shown && resume.address) shown.textContent = resume.address;
      showProofStep(resume.step);
    }
    if (resume?.branch) {
      void openBranchDetail(resume.branch.proposalId, resume.branch.allocationId);
    } else if (resume?.disburseId) {
      void openDetail(resume.disburseId);
    }
  });
}
