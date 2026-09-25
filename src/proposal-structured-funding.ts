import { BITCOIN_NETWORK, WORKERS_API } from "./config";
import { solidIcon } from "./icons";
import { bindHashGate, hashGateHtml } from "./psbt-hash-gate";
import { bindProposalCopyButtons } from "./proposal-copy-buttons";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

const MEMPOOL_WEB =
  BITCOIN_NETWORK === "signet"
    ? "https://mempool.space/signet"
    : BITCOIN_NETWORK === "testnet"
      ? "https://mempool.space/testnet"
    : "https://mempool.space";

function shortMiddle(value: string): string {
  const v = value.trim();
  if (v.length <= 18) return v;
  return `${v.slice(0, 8)}…${v.slice(-6)}`;
}

function idWithCopy(value: string, label: string): string {
  const full = value.trim();
  return `<span class="structured-id"><code class="mono" title="${escapeHtml(full)}">${escapeHtml(shortMiddle(full))}</code><button type="button" class="copy-btn copy-btn-icon" data-copy="${escapeHtml(full)}" title="Copy ${escapeHtml(label)}" aria-label="Copy ${escapeHtml(label)}">${solidIcon("copy")}</button></span>`;
}

function explorerLink(href: string, label: string): string {
  return `<a class="explorer-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`;
}

export function structuredFundingPanelHtml(p: Proposal): string {
  const type = String(p.proposal_type || "bounty").toLowerCase();
  if (type === "direct" || !p.escrow_address || !p.id) return "";
  return `<details class="proposal-structured" id="structured-funding" hidden>
    <summary>
      <h2 class="proposal-block-title">How this pays out</h2>
      <p class="muted structured-funding-status" id="structured-funding-status"></p>
    </summary>
    <div id="structured-funding-body"></div>
  </details>`;
}

export type StructuredFundingView = {
  psbt_kind?: string;
  allocations?: { id: string; allocation_sats: number }[];
  reviewer_reserve_percent?: number;
  reserve_sats?: number;
  donate_address?: string;
  pool_refund_address?: string;
  structured?: {
    state?: string;
    sha256?: string;
    psbt_base64?: string;
    settle_txid?: string;
    decode?: {
      version?: number;
      locktime?: number;
      miner_fee_sats?: number;
      inputs?: { address: string; amount_sats: number }[];
      outputs?: { address: string; amount_sats: number; label?: string }[];
    };
  };
};

export function bindStructuredFunding(
  root: ParentNode,
  proposalId: string,
): void {
  const panel = root.querySelector<HTMLElement>("#structured-funding");
  const statusEl = root.querySelector<HTMLElement>("#structured-funding-status");
  const bodyEl = root.querySelector<HTMLElement>("#structured-funding-body");
  if (!panel || !statusEl || !bodyEl || !proposalId) return;
  const jump = root.querySelector<HTMLAnchorElement>("#funding-side-link");
  if (jump && jump.dataset.fundingJump !== "1") {
    jump.dataset.fundingJump = "1";
    jump.addEventListener("click", () => {
      if (panel instanceof HTMLDetailsElement) panel.open = true;
    });
  }
  const api = WORKERS_API.replace(/\/$/, "");
  void (async () => {
    try {
      const res = await fetch(
        `${api}/proposals/${encodeURIComponent(proposalId)}/structured-funding`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as StructuredFundingView;
      panel.hidden = false;
      if (panel instanceof HTMLDetailsElement) panel.open = false;
      const state = data.structured?.state || "awaiting_funds";
      if (jump) {
        jump.hidden = false;
        jump.textContent =
          state === "awaiting_funds"
            ? "Structure · waiting for funds"
            : state === "confirmed"
              ? "Structure · confirmed"
              : "Structure · ready for keyholders";
      }
      const kind = data.psbt_kind === "milestone" ? "Type 2 (milestones)" : "Type 1 (single bounty)";
      statusEl.textContent = structuredFundingStageSentence(state, kind);
      bodyEl.innerHTML = structuredFundingBodyHtml(data);
      const branchRes = await fetch(
        `${api}/proposals/${encodeURIComponent(proposalId)}/branches`,
      );
      if (branchRes.ok) {
        const branches = (await branchRes.json()) as BranchPublicView;
        bodyEl.insertAdjacentHTML(
          "beforeend",
          branchListHtml(branches.branches, branches.selected, branches.signoff),
        );
        bindBranchHashGate(bodyEl, branches);
      }
      bindProposalCopyButtons(bodyEl);
    } catch {
      /* public view is optional */
    }
  })();
}

type BranchPublicView = {
  selected?: Record<string, { kind?: string; sha256?: string }>;
  signoff?: Record<
    string,
    {
      signed?: number;
      required_threshold?: number;
      state?: string;
      settle_txid?: string;
    }
  >;
  branches?: {
    state?: string;
    items?: {
      allocation_id: string;
      kind: string;
      sha256: string;
      locktime: number;
      psbt_base64?: string;
    }[];
  };
};

function selectedBranchHash(view: BranchPublicView): string {
  const selected = view.selected || {};
  for (const row of Object.values(selected)) {
    if (row?.sha256) return row.sha256;
  }
  const items = view.branches?.items || [];
  const clean = items.find((b) => b.kind === "clean");
  return clean?.sha256 || items[0]?.sha256 || "";
}

function bindBranchHashGate(root: ParentNode, view: BranchPublicView): void {
  const published = selectedBranchHash(view);
  bindHashGate({
    input: root.querySelector<HTMLTextAreaElement>("#branch-psbt-verify"),
    status: root.querySelector<HTMLElement>("#branch-hash-status"),
    publishedHash: published,
    action: root.querySelector<HTMLButtonElement>("#branch-sign-ready"),
    enableActionWithoutHash: false,
    disabledReason:
      "Paste a matching unsigned Release PSBT (base64) to enable — not a settle txid",
    enabledReason: "Hash matches — copy Release PSBT for Sparrow cosign",
  });
  const btn = root.querySelector<HTMLButtonElement>("#branch-sign-ready");
  const input = root.querySelector<HTMLTextAreaElement>("#branch-psbt-verify");
  btn?.addEventListener("click", () => {
    if (btn.disabled) return;
    const b64 = input?.value.trim() || "";
    const item = (view.branches?.items || []).find((b) => b.sha256 === published);
    const copy = b64 || item?.psbt_base64 || "";
    if (!copy) return;
    void navigator.clipboard.writeText(copy).catch(() => undefined);
  });
}

/** Cosign vs broadcast vs settle — public Release branch progress. */
export function branchSignoffStageLabel(so: {
  signed?: number;
  required_threshold?: number;
  state?: string;
  settle_txid?: string;
}): string {
  const signed = so.signed ?? 0;
  const need = so.required_threshold ?? 0;
  const state = String(so.state || "");
  if (state === "settled") {
    return so.settle_txid
      ? "Settled — broadcast already recorded (settle txid below)"
      : "Settled — broadcast already recorded";
  }
  if (state === "settle_proposed") {
    return "Settle proposed — waiting for a second keyholder to confirm txid";
  }
  if (state === "threshold_met" || (need > 0 && signed >= need)) {
    return `${signed}/${need} signed — ready to broadcast in Sparrow (then paste settle txid)`;
  }
  if (need > 0) {
    return `Needs ${signed}/${need} signatures (cosign — not broadcast yet)`;
  }
  return state ? `${signed} signed · ${state}` : `${signed} signed`;
}

function branchListHtml(
  branches?: BranchPublicView["branches"],
  selected?: BranchPublicView["selected"],
  signoff?: BranchPublicView["signoff"],
): string {
  if (!branches) return "";
  if (branches.state !== "ready" || !branches.items?.length) {
    return `<p class="muted structured-funding-status">Release · waiting — refund and timelock branches construct after Structure confirms. Clean and disputed pay branches wait for an awarded on-chain payout.</p>`;
  }
  const picked = selected || {};
  const pickedSignoff = signoff || {};
  const rows = branches.items
    .map((b) => {
      const sel = picked[b.allocation_id];
      const isSel = sel?.kind === b.kind;
      const so = pickedSignoff[b.allocation_id];
      const signLabel = isSel && so ? branchSignoffStageLabel(so) : "";
      const settled =
        isSel && so?.state === "settled" && so.settle_txid
          ? `<span class="structured-settle-txid"><span class="onchain-label">Settle txid</span> ${idWithCopy(so.settle_txid, "txid")}</span>`
          : "";
      return `<div class="structured-branch${isSel ? " is-selected" : ""}">
        <div class="structured-branch-main">
          <span class="structured-branch-name">${escapeHtml(b.allocation_id)} · ${escapeHtml(b.kind)}${isSel ? " · selected" : ""}</span>
          <span class="structured-branch-meta">${escapeHtml(String(b.locktime))} locktime${signLabel ? ` · ${escapeHtml(signLabel)}` : ""}${settled ? ` · ${settled}` : ""}</span>
          ${idWithCopy(b.sha256, "hash")}
        </div>
      </div>`;
    })
    .join("");
  const published = selectedBranchHash({ selected, branches });
  return `<div class="structured-branches">
    <p class="fee-pay-bond-label">RELEASE · COSIGN</p>
    <p class="fee-pay-bond-contrast">Paste an <strong>unsigned Release PSBT</strong> to verify the hash. This is not a settle txid and not Structure funding. Broadcast stays in Sparrow after N-of-M cosign.</p>
    <p class="onchain-label">Release branches (unsigned)</p>
    ${rows}
    ${hashGateHtml({
      publishedHash: published,
      inputId: "branch-psbt-verify",
      statusId: "branch-hash-status",
      compact: true,
      pasteLabel: "Release PSBT (base64) — not a settle txid",
      placeholder: "Paste unsigned Release PSBT to verify SHA-256",
    })}
    <button type="button" class="btn" id="branch-sign-ready" disabled title="Paste a matching unsigned Release PSBT (base64) to enable — not a settle txid" aria-label="Paste a matching unsigned Release PSBT (base64) to enable — not a settle txid">Hash matches — copy for Sparrow</button>
  </div>`;
}

/** Public Structure stage sentence (summary line). */
export function structuredFundingStageSentence(
  state: string,
  kind: string,
): string {
  if (state === "awaiting_funds") {
    return `${kind} — Structure · waiting for confirmed funds (allocation, reviewer reserve, miner fee). Do not send bond or Donate to Structure outs.`;
  }
  if (state === "confirmed") {
    return `${kind} — Structure · confirmed on-chain. Release branches may follow for payout.`;
  }
  return `${kind} — Structure · unsigned PSBT ready. Keyholders cosign in Sparrow; this site does not broadcast.`;
}

/** Structure out role label — never imply claim-bond / Donate destinations. */
export function structureOutRoleLabel(raw?: string | null): string {
  const s = String(raw || "").trim();
  if (!s) return "structure out";
  const key = s.toLowerCase().replace(/[\s-]+/g, "_");
  if (
    key === "bounty" ||
    key === "allocation" ||
    key === "milestone" ||
    key.startsWith("milestone_")
  ) {
    return "bounty / allocation";
  }
  if (key === "reserve" || key === "reviewer_reserve" || key === "reviewer") {
    return "reviewer reserve";
  }
  if (key === "kh_fee" || key === "keyholder" || key === "keyholders") {
    return "keyholder fee";
  }
  if (key === "platform" || key === "platform_fee" || key === "fee") {
    return "platform fee";
  }
  if (key === "bdi" || key === "bitcoin_district" || key.includes("district")) {
    return "Bitcoin District";
  }
  if (key === "change" || key === "miner" || key === "miner_fee") {
    return s;
  }
  return s;
}

export function structuredFundingBodyHtml(data: StructuredFundingView): string {
  const rows: string[] = [];
  rows.push(`<p class="fee-pay-bond-label">STRUCTURE OUTPUTS</p>
    <p class="fee-pay-bond-contrast">Addresses below are Structure / bounty / reserve outs for keyholder funding — <strong>not</strong> Donate/escrow and <strong>not</strong> claim bond. Do not send payments here by index or by accident.</p>`);
  if (data.pool_refund_address) {
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Structure · donor pool refund</span>
      <div class="onchain-value">
        ${idWithCopy(data.pool_refund_address, "address")}
      </div>
    </div>`);
  }
  if (data.reserve_sats != null) {
    rows.push(`<div class="onchain-row onchain-row-inline">
      <span class="onchain-label">Reviewer reserve</span>
      <span class="onchain-inline-value">${escapeHtml(formatSats(data.reserve_sats))} (${escapeHtml(String(data.reviewer_reserve_percent ?? ""))}%)</span>
    </div>`);
  }
  const hash = data.structured?.sha256;
  if (hash) {
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Structure PSBT SHA-256</span>
      <div class="onchain-value">
        ${idWithCopy(hash, "hash")}
      </div>
    </div>`);
  }
  const decode = data.structured?.decode;
  if (decode) {
    rows.push(`<div class="onchain-row onchain-row-inline">
      <span class="onchain-label">Locktime / version / miner fee</span>
      <span class="onchain-inline-value">${escapeHtml(String(decode.locktime ?? 0))} / v${escapeHtml(String(decode.version ?? 2))} / ${escapeHtml(formatSats(decode.miner_fee_sats || 0))}</span>
    </div>`);
    const io = [
      ...(decode.inputs || []).map(
        (i) =>
          `<div class="structured-io-row"><span>in</span><span class="structured-io-label">escrow in</span>${idWithCopy(i.address, "address")}<span class="structured-io-amt">${escapeHtml(formatSats(i.amount_sats))}</span></div>`,
      ),
      ...(decode.outputs || []).map(
        (o) =>
          `<div class="structured-io-row"><span>out</span><span class="structured-io-label">${escapeHtml(structureOutRoleLabel(o.label))}</span>${idWithCopy(o.address, "address")}<span class="structured-io-amt">${escapeHtml(formatSats(o.amount_sats))}</span></div>`,
      ),
    ].join("");
    if (io) {
      rows.push(`<div class="structured-io">${io}</div>`);
    }
  }
  if (data.structured?.settle_txid) {
    const tx = data.structured.settle_txid;
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Structure settle txid (broadcast already recorded)</span>
      <div class="onchain-value">
        ${idWithCopy(tx, "txid")}
        <span class="onchain-actions">
          ${explorerLink(`${MEMPOOL_WEB}/tx/${tx}`, "Explorer")}
        </span>
      </div>
    </div>`);
  }
  return rows.join("");
}
