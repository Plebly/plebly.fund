import { authFetch, currentReturnPath, loginChoicesHtml, type AuthUser } from "./auth";
import { solidIcon } from "./icons";
import { WORKERS_API } from "./config";
import { confirmAction } from "./confirm-modal";
import { bindKhApplyForm, khApplyFormHtml } from "./governance-page";
import { href } from "./router";
import { authFetchWithTos } from "./tos-modal";
import { bindHashGate, hashGateHtml } from "./psbt-hash-gate";
import { escapeHtml, formatSats } from "./util";

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
  const stateLabel =
    item.state === "threshold_met"
      ? " · threshold met"
      : proposed
        ? " · settle proposed"
        : settled
          ? " · settled"
          : "";
  const who = signerLabels(item.partials, opts?.signerNames || {});
  const canDownload = Boolean(item.psbt_base64);
  return `<div class="form-panel form-panel-wide">
    <h2 class="proposal-block-title" id="kh-branch-title" tabindex="-1">${escapeHtml(item.kind)} · ${escapeHtml(item.proposal_id)} · ${escapeHtml(item.allocation_id)}</h2>
    <p class="next-card-sentence">${escapeHtml(keyholderTxPurpose(item.kind))}</p>
    <p class="kh-sign-chip">${escapeHtml(signatureProgressLabel(signed, need))}${stateLabel ? escapeHtml(stateLabel) : ""}</p>
    ${
      who.length
        ? `<p class="kh-signers">Signed by ${escapeHtml(who.join(", "))}</p>`
        : ""
    }
    <table class="kh-outputs">
      <caption class="sr-only">Outputs</caption>
      <thead><tr><th scope="col">Label</th><th scope="col">Address</th><th scope="col">Amount</th></tr></thead>
      <tbody>
        ${
          outputs.length
            ? outputs
                .map(
                  (o) =>
                    `<tr><td>${escapeHtml(o.label || "—")}</td><td class="mono">${escapeHtml(o.address)}</td><td>${formatSats(o.amount_sats)}</td></tr>`,
                )
                .join("")
            : `<tr><td colspan="3" class="muted">No outputs</td></tr>`
        }
      </tbody>
    </table>
    ${
      canDownload
        ? `<div class="comment-compose-actions"><button type="button" class="btn" id="kh-branch-dl">Download unsigned transaction</button></div>`
        : ""
    }
    <p class="muted">Sign in Sparrow, then paste the partial below. The Worker does not broadcast.</p>
    ${hashGateHtml({
      publishedHash: item.published_sha256,
      inputId: "kh-branch-verify",
      statusId: "kh-branch-hash-status",
    })}
    <label class="donate-amount-label" for="kh-branch-partial">Signed partial (base64)</label>
    <textarea id="kh-branch-partial" class="comment-input mono" rows="3" placeholder="Paste from Sparrow"></textarea>
    <div class="comment-compose-actions">
      <button type="button" class="btn" id="kh-branch-sign" disabled>Upload signature</button>
      ${
        item.combined_sha256
          ? `<button type="button" class="btn ghost" id="kh-branch-combined">Download combined</button>`
          : ""
      }
    </div>
    <p class="builder-msg" id="kh-branch-msg" hidden role="status" aria-live="polite"></p>
    ${
      settled
        ? `<p class="muted">Settled <code class="mono">${escapeHtml(item.settle_txid || "")}</code>. Broadcast stays in Sparrow.</p>`
        : `<div class="form-panel">
      <h3 class="proposal-block-title">Record broadcast</h3>
      <p class="muted">After you broadcast the combined transaction in Sparrow, paste the txid. A second keyholder must confirm.</p>
      <label class="donate-amount-label" for="kh-branch-txid">Settle txid</label>
      <input id="kh-branch-txid" class="donate-amount mono" value="${escapeHtml(item.settle_txid || "")}" ${proposed ? "readonly" : ""} autocomplete="off" />
      <div class="comment-compose-actions">
        <button type="button" class="btn" id="kh-branch-propose" ${proposed ? "disabled" : ""}>Propose settle</button>
        <button type="button" class="btn ghost" id="kh-branch-confirm" ${
          !proposed || item.settle_proposed_by === opts?.userId ? "disabled" : ""
        }>Confirm settle</button>
      </div>
    </div>`
    }
  </div>`;
}

export function cashoutDeskHtml(opts: {
  amount_sats: number;
  payout_address: string;
}): string {
  return `<div class="form-panel" id="kh-cashout-card">
    <h2 class="proposal-block-title">${escapeHtml(keyholderTxPurpose("cashout"))}</h2>
    <p class="muted">${formatSats(opts.amount_sats)} to <span class="mono">${escapeHtml(opts.payout_address)}</span></p>
    <p class="muted">Sign this in Sparrow. The escrow quorum does not apply.</p>
    <div class="comment-compose-actions">
      <button type="button" class="btn ghost" id="kh-cashout-dl">Download unsigned transaction</button>
    </div>
    <label class="donate-amount-label" for="kh-cashout-txid">Settle txid</label>
    <input id="kh-cashout-txid" class="donate-amount mono" autocomplete="off" />
    <div class="comment-compose-actions">
      <button type="button" class="btn" id="kh-cashout-settle">Record payout</button>
    </div>
    <p class="builder-msg" id="kh-cashout-msg" hidden role="status" aria-live="polite"></p>
  </div>`;
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
    ? `<ol class="kh-steps">
        <li class="${khStepClass("freeze", step, releaseOrder)}">Check the outputs, then freeze the unsigned transaction</li>
        <li class="${khStepClass("sign", step, releaseOrder)}">Sign in Sparrow and paste the partial</li>
        <li class="${khStepClass("broadcast", step, releaseOrder)}">Broadcast when the threshold is met</li>
      </ol>`
    : `<ol class="kh-steps">
        <li class="${step === "settle" ? "is-current" : ""}">Check the outputs, then propose the settle txid</li>
      </ol>`;

  const outputs = `<table class="kh-outputs">
    <caption class="sr-only">Outputs</caption>
    <thead><tr><th scope="col">Label</th><th scope="col">Address</th><th scope="col">Amount</th></tr></thead>
    <tbody>
      ${
        item.outputs.length
          ? item.outputs
              .map(
                (o) =>
                  `<tr><td>${escapeHtml(o.label || "—")}</td><td class="mono">${escapeHtml(o.address)}</td><td>${formatSats(o.amount_sats)}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="3" class="muted">No outputs yet</td></tr>`
      }
    </tbody>
  </table>`;

  const freezeBlock = opts.isRelease
    ? `<div class="comment-compose-actions" ${step === "freeze" || item.psbts?.[0] ? "" : "hidden"}>
          <label class="donate-amount-label" for="kh-psbt-unsigned">Unsigned transaction (base64)</label>
          <textarea id="kh-psbt-unsigned" class="comment-input mono" rows="3" placeholder="Paste from Sparrow" ${
            opts.canUnsigned ? "" : "disabled"
          }></textarea>
          <button type="button" class="btn" id="kh-psbt-upload" ${
            opts.canUnsigned ? "" : "disabled"
          }>Freeze outputs</button>
          ${
            item.psbts?.[0]
              ? `<button type="button" class="btn ghost" id="kh-psbt-dl">Download unsigned transaction</button>`
              : ""
          }
        </div>`
    : `<div class="comment-compose-actions" hidden>
          <textarea id="kh-psbt-unsigned" hidden></textarea>
          <button type="button" id="kh-psbt-upload" hidden></button>
        </div>`;

  const publishedHash = publishedUnsignedHash(item);
  const signBlocked = !opts.canPartial || Boolean(publishedHash);
  const signBlock = opts.isRelease
    ? `<div class="comment-compose-actions" ${
        step === "sign" || step === "broadcast" ? "" : "hidden"
      }>
        ${hashGateHtml({
          publishedHash,
          inputId: "kh-psbt-verify",
          statusId: "kh-hash-status",
        })}
        <label class="donate-amount-label" for="kh-psbt-partial">Signed partial (base64)</label>
        <textarea id="kh-psbt-partial" class="comment-input mono" rows="3" placeholder="Paste from Sparrow" ${
          opts.canPartial ? "" : "disabled"
        }></textarea>
        <button type="button" class="btn" id="kh-sign" ${
          signBlocked ? "disabled" : ""
        }>Upload signature</button>
        <button type="button" class="btn ${step === "broadcast" ? "" : "ghost"}" id="kh-broadcast" ${
          opts.canBroadcast ? "" : "disabled"
        }>Broadcast</button>
      </div>`
    : "";

  const who = signerLabels(item.partials, opts.signerNames || {});
  const progress = need
    ? `${signatureProgressLabel(signed, need)}${who.length ? ` · ${who.join(", ")}` : ""}${
        item.period ? ` · ${item.period}` : ""
      }`
    : "";
  return `<div class="form-panel form-panel-wide">
    <h2 class="proposal-block-title" id="kh-detail-title" tabindex="-1">${escapeHtml(item.kind.replace(/_/g, " "))} · ${escapeHtml(item.proposal_id)}</h2>
    <p class="next-card-sentence">${escapeHtml(keyholderTxPurpose(item.kind))}</p>
    ${readyLine ? `<p class="muted">${escapeHtml(readyLine)}</p>` : ""}
    ${
      item.monthly_accruing
        ? `<p class="muted">Signing opens after month-end freeze.</p>`
        : progress
          ? `<p class="kh-sign-chip">${escapeHtml(progress)}</p>`
          : ""
    }
    ${steps}
    ${
      item.line_items?.length
        ? `<table class="kh-outputs">
             <caption class="sr-only">Line items</caption>
             <thead><tr><th scope="col">Proposal</th><th scope="col">Escrow</th><th scope="col">Payout</th></tr></thead>
             <tbody>${item.line_items
               .map(
                 (l) =>
                   `<tr><td class="mono">${escapeHtml(l.proposal_id)}</td><td class="mono">${escapeHtml(l.escrow_address || "—")}</td><td>${formatSats(l.payout_sats)}</td></tr>`,
               )
               .join("")}</tbody>
           </table>`
        : ""
    }
    ${
      item.ln_destination
        ? `<p class="muted mono">${escapeHtml(item.ln_destination)}${
            item.ln_amount_sats != null ? ` · ${formatSats(item.ln_amount_sats)}` : ""
          }</p>`
        : ""
    }
    ${
      opts.needsLn
        ? `<div class="lifecycle-banner lifecycle-warn">
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
        ? `<p class="muted">Waiting on payout addresses.</p>`
        : ""
    }
    ${outputs}
    ${freezeBlock}
    ${signBlock}
    <details class="next-card-more">
      <summary>Other settle tools</summary>
      <label class="donate-amount-label" for="kh-txid">Broadcast txid</label>
      <input id="kh-txid" class="donate-amount mono" value="${escapeHtml(item.settle_txid || "")}" ${
        opts.canPsbt ? "" : "disabled"
      } />
      <div id="kh-verify-panel" class="lifecycle-banner" hidden>
        <span class="lifecycle-k">Verify</span>
        <p>Match this txid to the outputs above.</p>
        <ul class="kh-verify-outputs">${item.outputs
          .map(
            (o) =>
              `<li class="mono">${escapeHtml(o.address)} · ${formatSats(o.amount_sats)}${
                o.label ? ` · ${escapeHtml(o.label)}` : ""
              }</li>`,
          )
          .join("")}</ul>
      </div>
      <div class="comment-compose-actions">
        <button type="button" class="btn ghost" id="kh-propose" ${
          opts.canPsbt ? "" : "disabled"
        }>Propose settle</button>
        ${
          opts.requiresDualSettle
            ? `<button type="button" class="btn ghost" id="kh-confirm"${
                item.settle_proposed_by === opts.userId || !opts.canPsbt
                  ? " disabled"
                  : ""
              }>Confirm settle</button>`
            : ""
        }
      </div>
      <div id="kh-chat"></div>
      <label class="sr-only" for="kh-chat-input">Message other keyholders</label>
      <textarea id="kh-chat-input" class="comment-input" rows="2" maxlength="2000" placeholder="Message other keyholders…"></textarea>
      <button type="button" class="btn ghost" id="kh-chat-send">Post</button>
    </details>
    <p class="builder-msg" id="kh-settle-msg" hidden role="status" aria-live="polite"></p>
  </div>`;
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
  return `<div class="lifecycle-banner" role="status">
    <span class="lifecycle-k">First seats</span>
    <p>No sitting keyholders yet. Ops activates the first two together. Apply and co-attest on this page start after that.</p>
  </div>`;
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
  return `<div class="form-panel" id="kh-keys-panel">
    <h2 class="proposal-block-title">${escapeHtml(opts.heading)}</h2>
    <p class="muted">Registers fingerprint + xpub on the Worker so other keyholders can co-attest. It does not change the Sparrow descriptor — ops publishes that separately. Saving again clears co-attestations. Never paste a seed.</p>
    <label class="donate-amount-label" for="kh-fp">Fingerprint (8 hex)</label>
    <input id="kh-fp" class="donate-amount mono" maxlength="8" value="${escapeHtml(opts.fingerprint || "")}" autocomplete="off" />
    <label class="donate-amount-label" for="kh-xpub">xpub / tpub</label>
    <textarea id="kh-xpub" class="comment-input mono" rows="3">${escapeHtml(opts.xpub || "")}</textarea>
    <label class="donate-amount-label" for="kh-auth-addr-keys">Auth address (P2WPKH from this xpub)</label>
    <input id="kh-auth-addr-keys" class="donate-amount mono" placeholder="tb1… / bc1…" autocomplete="off" />
    <button type="button" class="btn" id="kh-keys-submit">Save keys</button>
    <p class="builder-msg" id="kh-keys-msg" hidden role="status" aria-live="polite"></p>
  </div>`;
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
    return `<div class="form-panel kh-onboard-card">
      <p class="next-card-sentence">Sign in to continue.</p>
      ${loginChoicesHtml(undefined, currentReturnPath())}
      <p class="muted"><a href="${href("/keyholder-responsibilities")}">Responsibilities</a></p>
    </div>`;
  }
  if (phase === "earn_reviewer") {
    return `<div class="form-panel kh-onboard-card">
      <p class="next-card-sentence">${
        cold
          ? "Later seats open to earned reviewers after the first two are seated."
          : "Seats open to earned reviewers — people who have finished at least one review."
      }</p>
      <p><a class="btn" href="${href("/reviewers")}">Reviewers</a>
      <a class="btn ghost" href="${href("/wanted")}">Most wanted</a></p>
      <p class="muted"><a href="${href("/keyholder-responsibilities")}">Responsibilities</a></p>
    </div>`;
  }
  if (phase === "election") {
    const closes = app?.election?.closes_at?.slice(0, 10) || "";
    const tally =
      app?.election
        ? `yes ${app.election.yes} / no ${app.election.no}`
        : "votes pending";
    return `<div class="form-panel kh-onboard-card">
      <p class="next-card-sentence">Reviewers are voting on your application.</p>
      <p class="muted">${closes ? `Closes ${escapeHtml(closes)} · ` : ""}${escapeHtml(tally)}. Fail → 90 days before you can apply again.</p>
    </div>`;
  }
  if (phase === "apply") {
    const blocked = onboardReapplyBlocked(app);
    const cooldown = blocked
      ? `<p class="muted">You can apply again after ${escapeHtml((app?.reapply_after || "").slice(0, 10))}.</p>`
      : "";
    return `<div class="kh-onboard-card">
      <p class="next-card-sentence">Apply here. A pass invites you to register keys.</p>
      ${cooldown}
      ${blocked ? "" : khApplyFormHtml(true, true)}
    </div>`;
  }
  if (phase === "submit_keys") {
    return `<div class="kh-onboard-card">
      <p class="next-card-sentence">Submit the fingerprint and xpub from your hardware wallet.</p>
      ${keyholderKeysFormHtml({
        fingerprint: kh?.fingerprint,
        xpub: kh?.xpub,
        heading: "Your keys",
      })}
    </div>`;
  }
  if (phase === "await_attest") {
    const n = kh?.attest_count || 0;
    return `<div class="kh-onboard-card">
      <p class="next-card-sentence">${
        cold
          ? "Co-attest cannot start until two seats are already active."
          : `Waiting for two sitting keyholders (${n}/2).`
      }</p>
      <p class="muted">Fingerprint <code class="mono">${escapeHtml(kh?.fingerprint || "—")}</code>. ${
        cold
          ? "Ops activates the first two together."
          : "They open this page → Roster → Co-attest."
      }</p>
      ${keyholderKeysFormHtml({
        fingerprint: kh?.fingerprint,
        xpub: kh?.xpub,
        heading: "Update keys",
      })}
    </div>`;
  }
  return `<div class="form-panel kh-onboard-card">
    <p class="next-card-sentence">You are seated.</p>
    <p class="muted"><a href="${href("/keyholder-responsibilities")}">Responsibilities</a></p>
  </div>`;
}

export function keyholderOnboardHtml(input: KeyholderOnboardInput): string {
  const phase = keyholderOnboardPhase(input);
  const current = keyholderOnboardStepIndex(phase);
  const steps = ONBOARD_STEPS.map((step, i) => {
    const cls = i < current ? "is-done" : i === current ? "is-current" : "";
    return `<li class="${cls}">${escapeHtml(step.label)}</li>`;
  }).join("");
  return `<div class="kh-onboard">
    ${keyholderColdStartHtml(input.activeSeats)}
    <ol class="kh-steps kh-onboard-steps" aria-label="Keyholder onboarding">
      ${steps}
    </ol>
    ${keyholderOnboardCardHtml(input)}
  </div>`;
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

export async function renderKeyholders(
  shell: KeyholdersShell,
  user: AuthUser | null,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const rerender = () => void renderKeyholders(shell, user);
  const activeSeats = await loadActiveSeats();
  if (!user) {
    app.innerHTML = shell(`
      <section class="wrap-wide detail keyholders-page">
        <header class="declined-head">
          <h1>Keyholders</h1>
          <p class="lede">${escapeHtml(coldStartLede("sign_in", activeSeats))}</p>
        </header>
        ${keyholderOnboardHtml({ signedIn: false, canApply: false, activeSeats })}
      </section>
    `);
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
    app.innerHTML = shell(`
      <section class="wrap-wide detail keyholders-page">
        <header class="declined-head">
          <h1>Keyholders</h1>
          <p class="lede">${escapeHtml(coldStartLede(phase, activeSeats))}</p>
        </header>
        ${keyholderOnboardHtml(onboardInput)}
      </section>
    `);
    bindKhApplyForm(app, { onApplied: rerender });
    bindKeyholderKeys(app, { onSaved: rerender });
    return;
  }

  app.innerHTML = shell(`
    <section class="wrap-wide detail keyholders-page">
      <header class="declined-head">
        <p class="eyebrow">Keyholders · Ops</p>
        <h1>Keyholders</h1>
        <p class="lede">${escapeHtml(keyholderOnboardLede("active"))}</p>
        <p class="kh-seat">Seated as @${escapeHtml(kh.github)}${
          kh.fingerprint
            ? ` · <code class="mono">${escapeHtml(kh.fingerprint)}</code>`
            : ""
        }. <a href="${href("/keyholder-responsibilities")}">Responsibilities</a></p>
        <div class="kh-balance">
          <p class="kh-balance-amt"><span>Spendable</span><strong>${formatSats(balance)}</strong></p>
          <p class="kh-earnings">Accrued ${formatSats(earnings)}</p>
          <button type="button" class="btn ghost" id="kh-cashout">Pay out</button>
        </div>
        <div id="kh-cashout-detail" hidden></div>
        ${
          kh.keys_stale
            ? `<div class="lifecycle-banner lifecycle-warn" role="status"><span class="lifecycle-k">Keys older than 1 year</span><p>Re-confirm fingerprint + xpub below.</p></div>`
            : ""
        }
      </header>
      ${
        kh.keys_stale
          ? keyholderKeysFormHtml({
              fingerprint: kh.fingerprint,
              xpub: kh.xpub,
              heading: "Re-confirm keys",
            })
          : ""
      }
      <div class="kh-session-bar">
        <p class="muted" id="kh-session-state">Prove your key before you upload a signature.</p>
        <button type="button" class="btn ghost" id="kh-session-open">Prove your key</button>
      </div>
      <div class="site-modal" id="kh-session" hidden>
        <div class="site-modal-backdrop" data-kh-session-close tabindex="-1" aria-hidden="true"></div>
        <div class="site-modal-card kh-session-card" role="dialog" aria-modal="true" aria-labelledby="kh-session-title">
          <button type="button" class="site-modal-close" data-kh-session-close aria-label="Close">${solidIcon("xmark")}</button>
          <h2 id="kh-session-title" tabindex="-1">Prove you hold the key</h2>
          <p class="muted">GitHub login names this seat. It does not prove the hardware key is still yours. Before an upload is accepted, sign a one-time message from the address registered on the seat.</p>
          <p class="muted">That message is not the escrow or pool transaction. In Sparrow, sign the message with the address below, then paste the signature here. The message expires in a few minutes. After it checks out, this browser can upload signatures for 15 minutes.</p>
          <ol class="kh-session-steps">
            <li>Check the registered address.</li>
            <li>Get a message and sign it in Sparrow.</li>
            <li>Paste the signature and check it.</li>
          </ol>
          <label class="donate-amount-label" for="kh-auth-addr">Registered address</label>
          <input id="kh-auth-addr" class="donate-amount mono" placeholder="tb1… / bc1…" value="${escapeHtml(kh.auth_address || "")}" autocomplete="off" />
          <button type="button" class="btn" id="kh-challenge">Get a message to sign</button>
          <p class="mono kh-challenge-msg" id="kh-challenge-msg" hidden role="status"></p>
          <button type="button" class="btn ghost" id="kh-challenge-copy" hidden>Copy message</button>
          <label class="donate-amount-label" for="kh-challenge-sig">Signature from Sparrow</label>
          <textarea id="kh-challenge-sig" class="comment-input mono" rows="2" placeholder="Paste the compact signature"></textarea>
          <button type="button" class="btn" id="kh-challenge-verify">Check signature</button>
          <p class="builder-msg" id="kh-challenge-status" hidden role="status" aria-live="polite"></p>
        </div>
      </div>
      <div class="account-tabs" role="tablist" aria-label="Disbursement queues">
        <button type="button" class="account-tab active" role="tab" id="kh-tab-release" data-kh-tab="release" aria-selected="true" aria-controls="kh-queue" tabindex="0">Releases</button>
        <button type="button" class="account-tab" role="tab" id="kh-tab-branch" data-kh-tab="branch" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Branches</button>
        <button type="button" class="account-tab" role="tab" id="kh-tab-bond_refund" data-kh-tab="bond_refund" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Bond refunds</button>
        <button type="button" class="account-tab" role="tab" id="kh-tab-contrib_refund" data-kh-tab="contrib_refund" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Contributor refunds</button>
        <button type="button" class="account-tab" role="tab" id="kh-tab-roster" data-kh-tab="roster" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Roster</button>
      </div>
      <div id="kh-queue" role="tabpanel" aria-labelledby="kh-tab-release" aria-live="polite"><p class="muted">Loading…</p></div>
      <div id="kh-detail" hidden></div>
    </section>
  `);

  const queueEl = app.querySelector<HTMLElement>("#kh-queue")!;
  const detailEl = app.querySelector<HTMLElement>("#kh-detail")!;
  const cashoutEl = app.querySelector<HTMLElement>("#kh-cashout-detail")!;
  let kind = "release";
  let challengeMessage = "";
  let signerNames: Record<string, string> = {};
  let cashoutB64 = "";

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
  const openSignSession = () => {
    const session = app.querySelector<HTMLElement>("#kh-session");
    if (!session) return;
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
      state.textContent = "Prove your key, then try the upload again.";
    }
    openSignSession();
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
        queueEl.innerHTML = `<p class="muted">No selected bounty branches ready to sign.</p>`;
        queueEl.removeAttribute("aria-busy");
        return;
      }
      queueEl.innerHTML = `<ul class="declined-list">${data.items
        .map((item) => {
          return `<li class="declined-row">
            <button type="button" class="declined-title btn ghost" data-branch="${escapeHtml(item.proposal_id)}" data-alloc="${escapeHtml(item.allocation_id)}" aria-label="${escapeHtml(item.proposal_id)} ${escapeHtml(item.kind)} ${escapeHtml(signatureProgressLabel(item.signed, item.required_threshold))}">${escapeHtml(item.proposal_id)} · ${escapeHtml(item.allocation_id)}</button>
            <p class="kh-queue-purpose">${escapeHtml(keyholderTxPurpose(item.kind))}</p>
            <span class="declined-meta"><span class="pill">${escapeHtml(item.kind)}</span>
            <span class="kh-sign-chip">${escapeHtml(signatureProgressLabel(item.signed, item.required_threshold))}</span>
            <span class="pill">${escapeHtml(item.state)}</span></span>
          </li>`;
        })
        .join("")}</ul>`;
      queueEl.querySelectorAll<HTMLButtonElement>("[data-branch]").forEach((btn) => {
        btn.addEventListener("click", () => {
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
      queueEl.innerHTML = `<p class="muted">No open ${escapeHtml(kind.replace(/_/g, " "))} items.</p>`;
      queueEl.removeAttribute("aria-busy");
      return;
    }
    queueEl.innerHTML = `<ul class="declined-list">${data.items
      .map((item) => {
        const sum = item.outputs.reduce((a, o) => a + o.amount_sats, 0);
        const waiting = item.outputs.length === 0;
        const lines = item.line_items?.length || 0;
        const signed = item.partials?.length || 0;
        const need = item.required_threshold || 0;
        return `<li class="declined-row">
          <button type="button" class="declined-title btn ghost" data-disburse="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.period || item.proposal_id)} ${escapeHtml(item.state)}${need ? ` ${signatureProgressLabel(signed, need)}` : ""}">${escapeHtml(item.period || item.proposal_id)}</button>
          <p class="kh-queue-purpose">${escapeHtml(keyholderTxPurpose(item.kind))}</p>
          <span class="declined-meta"><span class="pill">${escapeHtml(item.state)}</span>
          ${
            item.monthly_accruing
              ? `<span class="pill">accruing</span>`
              : ""
          }
          ${
            lines
              ? `<span class="muted">${lines} bount${lines === 1 ? "y" : "ies"}</span>`
              : ""
          }
          ${
            need
              ? `<span class="kh-sign-chip">${escapeHtml(signatureProgressLabel(signed, need))}</span>`
              : ""
          }
          ${
            waiting
              ? `<span class="pill">waiting on address</span>`
              : `<span class="muted">${formatSats(sum)}</span>`
          }</span>
        </li>`;
      })
      .join("")}</ul>`;
    queueEl.querySelectorAll<HTMLButtonElement>("[data-disburse]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void openDetail(btn.dataset.disburse || "");
      });
    });
    queueEl.removeAttribute("aria-busy");
  };

  const openBranchDetail = async (proposalId: string, allocationId: string) => {
    const res = await authFetch(
      `${api()}/keyholders/branch-sign/${encodeURIComponent(proposalId)}/${encodeURIComponent(allocationId)}`,
    );
    if (!res.ok) {
      detailEl.hidden = false;
      detailEl.innerHTML = `<p class="builder-msg bad" role="alert">Could not load branch.</p>`;
      return;
    }
    const data = (await res.json()) as { item: BranchSignDeskItem };
    const item = data.item;
    detailEl.hidden = false;
    detailEl.innerHTML = branchSignDeskHtml(item, {
      userId: kh.user_id,
      signerNames,
    });
    detailEl.querySelector<HTMLElement>("#kh-branch-title")?.focus();
    bindHashGate({
      input: detailEl.querySelector<HTMLTextAreaElement>("#kh-branch-verify"),
      status: detailEl.querySelector<HTMLElement>("#kh-branch-hash-status"),
      publishedHash: item.published_sha256,
      action: detailEl.querySelector<HTMLButtonElement>("#kh-branch-sign"),
      enableActionWithoutHash: false,
    });
    detailEl.querySelector("#kh-branch-dl")?.addEventListener("click", () => {
      if (!item.psbt_base64) return;
      downloadBase64File(
        item.psbt_base64,
        `${item.proposal_id}-${item.allocation_id}-unsigned.psbt`,
      );
    });
    const setMsg = (t: string) => {
      const el = detailEl.querySelector<HTMLElement>("#kh-branch-msg");
      if (!el) return;
      el.hidden = !t;
      el.textContent = t;
      noteSignSession(t);
    };
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
        setMsg("Settle proposed. A second keyholder must confirm.");
        void openBranchDetail(item.proposal_id, item.allocation_id);
        void loadQueue();
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
      setMsg(res.ok ? "Settled." : body.error || "Failed");
      if (res.ok) {
        void openBranchDetail(item.proposal_id, item.allocation_id);
        void loadQueue();
      }
    });
  };

  const openDetail = async (id: string) => {
    const res = await authFetch(`${api()}/disburse/${encodeURIComponent(id)}`);
    if (!res.ok) {
      detailEl.hidden = false;
      detailEl.innerHTML = `<p class="builder-msg bad" role="alert">Could not load item.</p>`;
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
    detailEl.hidden = false;
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

    detailEl.querySelector<HTMLElement>("#kh-detail-title")?.focus();

    const publishedHash = publishedUnsignedHash(item);
    bindHashGate({
      input: detailEl.querySelector<HTMLTextAreaElement>("#kh-psbt-verify"),
      status: detailEl.querySelector<HTMLElement>("#kh-hash-status"),
      publishedHash,
      action: detailEl.querySelector<HTMLButtonElement>("#kh-sign"),
      enableActionWithoutHash: canPartial,
    });

    const setMsg = (t: string) => {
      const el = detailEl.querySelector<HTMLElement>("#kh-settle-msg");
      if (!el) return;
      el.hidden = !t;
      el.textContent = t;
      noteSignSession(t);
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
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item.proposal_id}.psbt`;
      a.click();
      URL.revokeObjectURL(url);
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
        setMsg("Settle proposed / completed.");
        void openDetail(id);
        void loadQueue();
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
      setMsg(res.ok ? "Settled." : body.error || "Failed");
      if (res.ok) {
        void openDetail(id);
        void loadQueue();
      }
    });

    const chatEl = detailEl.querySelector<HTMLElement>("#kh-chat");
    const loadChat = async () => {
      const res = await authFetch(`${api()}/disburse/${id}/chat`);
      if (!res.ok || !chatEl) return;
      const data = (await res.json()) as {
        messages: { author: string; body: string; created_at: string }[];
      };
      chatEl.innerHTML = data.messages.length
        ? data.messages
            .map(
              (m) =>
                `<p><strong>@${escapeHtml(m.author)}</strong> <span class="muted">${escapeHtml(m.created_at.slice(0, 16))}</span><br />${escapeHtml(m.body)}</p>`,
            )
            .join("")
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

  app.querySelector("#kh-challenge")?.addEventListener("click", async () => {
    const res = await authFetch(`${api()}/keyholders/challenge`);
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    const el = app.querySelector<HTMLElement>("#kh-challenge-msg");
    const copyBtn = app.querySelector<HTMLButtonElement>("#kh-challenge-copy");
    challengeMessage = res.ok ? body.message || "" : "";
    if (el) {
      el.hidden = false;
      el.textContent = res.ok
        ? challengeMessage
        : body.error || "Challenge failed";
    }
    if (copyBtn) copyBtn.hidden = !challengeMessage;
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
        : "Prove your key before you upload a signature.";
    }
    if (res.ok) closeSignSession();
  });

  app.querySelector("#kh-session-open")?.addEventListener("click", () => {
    openSignSession();
  });
  app.querySelectorAll("[data-kh-session-close]").forEach((el) => {
    el.addEventListener("click", () => closeSignSession());
  });

  bindKeyholderKeys(app);

  const loadRoster = async () => {
    const [pub, pending] = await Promise.all([
      fetch(`${api()}/keyholders/public`).then((r) =>
        r.ok ? r.json() : { keyholders: [] },
      ),
      kh.status === "active"
        ? authFetch(`${api()}/keyholders/pending`).then((r) =>
            r.ok ? r.json() : { keyholders: [] },
          )
        : Promise.resolve({ keyholders: [] }),
    ]);
    const active = (pub as { keyholders: KeyholderMe[] }).keyholders || [];
    const wait = (pending as { keyholders: KeyholderMe[] }).keyholders || [];
    const rows = [
      ...active.map((k) => ({ ...k, _pending: false })),
      ...wait.map((k) => ({ ...k, _pending: true })),
    ];
    queueEl.innerHTML = rows.length
      ? `<p class="builder-msg" id="kh-roster-msg" hidden role="status" aria-live="polite"></p>
         <ul class="declined-list">${rows
          .map(
            (k) =>
              `<li class="declined-row"><span>@${escapeHtml(k.github)}</span>
          <span class="declined-meta"><span class="pill">${escapeHtml(k.status)}</span>
          <span class="mono muted">${escapeHtml(k.fingerprint || "—")}</span></span>
          ${
            k._pending && kh.status === "active"
              ? `<button type="button" class="btn ghost" data-coattest="${escapeHtml(k.user_id)}">Co-attest</button>`
              : ""
          }</li>`,
          )
          .join("")}</ul>`
      : `<p class="muted">No keyholders listed yet.</p>`;
    queueEl.querySelectorAll<HTMLButtonElement>("[data-coattest]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.coattest || "";
        const res = await authFetch(
          `${api()}/keyholders/${encodeURIComponent(id)}/co-attest`,
          { method: "POST" },
        );
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = queueEl.querySelector<HTMLElement>("#kh-roster-msg");
        if (msg) {
          msg.hidden = false;
          msg.textContent = res.ok ? "Co-attested." : body.error || "Failed";
        }
        if (res.ok) void loadRoster();
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
    detailEl.hidden = true;
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
      cashoutEl.innerHTML = `<p class="builder-msg bad" role="alert">${escapeHtml(body.error || "Could not build the payout.")}</p>`;
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

  void loadSignerNames().finally(() => {
    if (start && initial !== "release") {
      setTab(initial, start);
    } else {
      void loadQueue();
    }
  });
}
